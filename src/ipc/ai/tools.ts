/**
 * AI Tools — database introspection tools that the AI model can invoke.
 *
 * These tools let the AI assistant inspect the user's database schema and
 * query data, enabling context-aware SQL generation.
 *
 * Uses a FACTORY PATTERN: `createAiTools(connectionId)` returns the tool set
 * with `connectionId` baked into the closure.
 */
import { tool } from "ai";
import { z } from "zod";
import { driverRegistry } from "@/ipc/db/registry";
import { loadConnections } from "@/ipc/db/connection-store";
import type { DatabaseType } from "@/ipc/db/types";
import type { DriverConnectionConfig } from "@/ipc/db/driver";
import {
  getCachedTableDetails,
  getCachedIndexes,
  getCachedConstraints,
  getCachedTableStats,
  getCachedTableSample,
  setCachedTableDetails,
  setCachedIndexes,
  setCachedConstraints,
  setCachedTableStats,
  setCachedTableSample,
} from "./schema-cache";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve a connection by ID and build its connection string. */
async function resolveConnection(connectionId: string) {
  const connections = await loadConnections();
  const connection = connections.find((c) => c.id === connectionId);
  if (!connection) throw new Error("Connection not found");
  const dbType: DatabaseType = connection.db_type || "postgresql";
  const driver = driverRegistry.get(dbType);
  const config: DriverConnectionConfig = {
    host: connection.host ?? "",
    port: connection.port ?? driver.defaultPort,
    database: connection.database ?? driver.defaultDatabase,
    username: connection.username ?? driver.defaultUsername,
    password: connection.password ?? "",
    ssl_mode: connection.ssl_mode ?? "prefer",
    url: connection.url,
  };
  const connStr = driver.buildConnectionString(config);
  return { connection, connStr, dbType, driver };
}

/**
 * Validate a SQL identifier (schema/table/column name) to prevent injection.
 * Only allows alphanumeric, underscores, and dollars. Must not be empty.
 */
function isValidIdentifier(id: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_$]*$/.test(id);
}

const SENSITIVE_COLUMN_PATTERN =
  /(password|passwd|pwd|token|secret|api[_-]?key|access[_-]?key|refresh[_-]?token|credential|private[_-]?key|ssn|cpf)/i;

function isSensitiveColumnName(columnName: string): boolean {
  return SENSITIVE_COLUMN_PATTERN.test(columnName);
}

// ---------------------------------------------------------------------------
// Factory — creates tool set with connectionId in closure
// ---------------------------------------------------------------------------

/**
 * Create the AI tool set for a specific connection.
 *
 * MUST be called with the connectionId before passing to streamText/generateText.
 * The connectionId is captured in each tool's execute closure.
 */
export function createAiTools(connectionId: string) {
  /**
   * List columns in a specific table — gives the AI column names, types,
   * nullability, and defaults so it can write accurate SQL.
   */
  const columns = tool({
    description:
      "Get the list of columns in a specific database table, including their data types, nullability, and defaults. Use this before writing SQL to ensure correct column names and types.",
    inputSchema: z.object({
      schemaName: z.string().describe("The schema name (e.g. 'public')"),
      tableName: z.string().describe("The table name"),
    }),
    execute: async ({ schemaName, tableName }) => {
      if (!isValidIdentifier(schemaName) || !isValidIdentifier(tableName)) {
        return "Invalid identifier — only alphanumeric characters, underscores, and dollar signs are allowed.";
      }

      // Check cache first
      let details = getCachedTableDetails(connectionId, schemaName, tableName);

      if (!details) {
        const { driver, connStr } = await resolveConnection(connectionId);
        details = await driver.getTableDetails(connStr, schemaName, tableName);
        setCachedTableDetails(connectionId, schemaName, tableName, details);
      }

      return details.columns.map((c) => ({
        name: c.name,
        type: c.data_type,
        nullable: c.is_nullable,
        default: c.column_default,
      }));
    },
  });

  /**
   * List enums in the database — useful for understanding custom types
   * that constrain column values (PostgreSQL-specific feature).
   */
  const enums = tool({
    description:
      "Get the list of enum types defined in the database. Returns schema, name, and allowed values for each enum.",
    inputSchema: z.object({}),
    execute: async () => {
      const { driver, connStr, dbType } = await resolveConnection(connectionId);
      // Enums are only meaningful for PostgreSQL
      if (dbType !== "postgresql") {
        return "Enums are not supported for this database type.";
      }
      const schema = await driver.getSchema(connStr);
      // Extract enum-like info from columns with enum types
      const enumCols = schema.tables
        .flatMap((t) => t.columns)
        .filter((c) => c.data_type === "USER-DEFINED" || c.udt_name?.startsWith("enum_"))
        .map((c) => ({ column: c.name, type: c.udt_name ?? c.data_type }));
      return enumCols.length > 0 ? enumCols : "No enum types found in this database.";
    },
  });

  /**
   * List tables in a schema — lets the AI discover what tables exist
   * before inspecting specific ones.
   */
  const tables = tool({
    description:
      "Get the list of tables in a specific database schema. Returns table names and whether they have row-level security. Use this to discover available tables before querying.",
    inputSchema: z.object({
      schemaName: z.string().describe("The schema name (e.g. 'public')"),
    }),
    execute: async ({ schemaName }) => {
      if (!isValidIdentifier(schemaName)) {
        return "Invalid schema name — only alphanumeric characters, underscores, and dollar signs are allowed.";
      }
      const { driver, connStr } = await resolveConnection(connectionId);
      const schema = await driver.getSchema(connStr);
      const tables = schema.tables
        .filter((t) => t.schema === schemaName)
        .map((t) => ({ name: t.name, columns: t.columns.length, hasRls: t.has_rls }));
      return tables.length > 0
        ? tables
        : `No tables found in schema '${schemaName}'.`;
    },
  });

  /**
   * Query data from a table — allows the AI to sample data to better
   * understand the content and structure of a table. Restricted to small
   * result sets for safety.
   */
  const select = tool({
    description:
      "Query a small sample of data from a database table. Use this to understand the actual data in a table. IMPORTANT: Only select non-sensitive columns. Never select password, token, secret, or API key columns. Limit results to 10 rows max.",
    inputSchema: z.object({
      schemaName: z.string().describe("The schema name"),
      tableName: z.string().describe("The table name"),
      selectColumns: z
        .array(z.string())
        .optional()
        .describe("Specific columns to select. Omit for all columns."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .describe("Maximum rows to return (default 10, max 20)"),
    }),
    execute: async ({ schemaName, tableName, selectColumns, limit: rawLimit }) => {
      // Validate identifiers to prevent SQL injection
      if (!isValidIdentifier(schemaName) || !isValidIdentifier(tableName)) {
        return "Invalid identifier — only alphanumeric characters, underscores, and dollar signs are allowed.";
      }
      if (selectColumns) {
        for (const col of selectColumns) {
          if (!isValidIdentifier(col)) {
            return `Invalid column name '${col}' — only alphanumeric characters, underscores, and dollar signs are allowed.`;
          }
        }
      }

      const { driver, connStr } = await resolveConnection(connectionId);
      const limit = rawLimit ?? 10;
      const tableDetails = await driver.getTableDetails(connStr, schemaName, tableName);
      const allColumns = tableDetails.columns.map((c) => c.name);
      const allowedColumns = allColumns.filter((col) => !isSensitiveColumnName(col));

      let finalColumns: string[];
      if (selectColumns && selectColumns.length > 0) {
        const requested = new Set(selectColumns);
        const unknownColumns = [...requested].filter((col) => !allColumns.includes(col));
        if (unknownColumns.length > 0) {
          return `Unknown column(s): ${unknownColumns.join(", ")}. Use the columns tool first to inspect valid names.`;
        }

        const blockedColumns = [...requested].filter((col) => isSensitiveColumnName(col));
        if (blockedColumns.length > 0) {
          return `Refusing to query sensitive column(s): ${blockedColumns.join(", ")}.`;
        }

        finalColumns = [...requested];
      } else {
        if (allowedColumns.length === 0) {
          return "No non-sensitive columns available to sample in this table.";
        }
        finalColumns = allowedColumns;
      }

      const cols = finalColumns.map((c) => `"${c}"`).join(", ");

      const sql = `SELECT ${cols} FROM "${schemaName}"."${tableName}" LIMIT ${limit}`;

      try {
        const result = await driver.executeQuery(connStr, sql);
        return {
          columns: result.columns.map((c) => c.name),
          rows: result.rows,
          rowCount: result.row_count,
        };
      } catch (err) {
        return `Error executing query: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });

  /**
   * List indexes for a table — gives the AI information about available indexes,
   * including unique constraints and index types (btree, hash, gin, etc.).
   */
  const indexes = tool({
    description:
      "Get the list of indexes on a specific database table, including index names, columns, uniqueness, and index types. Use this to understand query optimization opportunities and existing constraints.",
    inputSchema: z.object({
      schemaName: z.string().describe("The schema name (e.g. 'public')"),
      tableName: z.string().describe("The table name"),
    }),
    execute: async ({ schemaName, tableName }) => {
      if (!isValidIdentifier(schemaName) || !isValidIdentifier(tableName)) {
        return "Invalid identifier — only alphanumeric characters, underscores, and dollar signs are allowed.";
      }

      // Check cache first
      let indexList = getCachedIndexes(connectionId, schemaName, tableName);

      if (!indexList) {
        const { driver, connStr } = await resolveConnection(connectionId);
        indexList = await driver.getIndexes(connStr, schemaName, tableName);
        setCachedIndexes(connectionId, schemaName, tableName, indexList);
      }

      return indexList.map((idx) => ({
        name: idx.name,
        columns: idx.columns,
        isUnique: idx.isUnique,
        isPrimary: idx.isPrimary,
        type: idx.type,
      }));
    },
  });

  /**
   * List constraints for a table — gives the AI information about all constraints
   * including primary keys, foreign keys, unique constraints, and check constraints.
   */
  const constraints = tool({
    description:
      "Get the list of constraints on a specific database table, including primary keys, foreign keys, unique constraints, and check constraints. Use this to understand table relationships and validation rules.",
    inputSchema: z.object({
      schemaName: z.string().describe("The schema name (e.g. 'public')"),
      tableName: z.string().describe("The table name"),
    }),
    execute: async ({ schemaName, tableName }) => {
      if (!isValidIdentifier(schemaName) || !isValidIdentifier(tableName)) {
        return "Invalid identifier — only alphanumeric characters, underscores, and dollar signs are allowed.";
      }

      // Check cache first
      let constraintList = getCachedConstraints(connectionId, schemaName, tableName);

      if (!constraintList) {
        const { driver, connStr } = await resolveConnection(connectionId);
        constraintList = await driver.getConstraints(connStr, schemaName, tableName);
        setCachedConstraints(connectionId, schemaName, tableName, constraintList);
      }

      return constraintList.map((c) => ({
        name: c.name,
        type: c.type,
        columns: c.columns,
        referencedTable: c.referencedTable,
        referencedColumns: c.referencedColumns,
        updateRule: c.updateRule,
        deleteRule: c.deleteRule,
      }));
    },
  });

  /**
   * Get table statistics — gives the AI information about table size, row count,
   * and maintenance history (vacuum/analyze timestamps for PostgreSQL).
   */
  const tableStats = tool({
    description:
      "Get statistics for a specific database table, including row count, table size, and last maintenance timestamps (vacuum/analyze). Use this to understand table scale and performance characteristics.",
    inputSchema: z.object({
      schemaName: z.string().describe("The schema name (e.g. 'public')"),
      tableName: z.string().describe("The table name"),
    }),
    execute: async ({ schemaName, tableName }) => {
      if (!isValidIdentifier(schemaName) || !isValidIdentifier(tableName)) {
        return "Invalid identifier — only alphanumeric characters, underscores, and dollar signs are allowed.";
      }

      // Check cache first
      let stats = getCachedTableStats(connectionId, schemaName, tableName);

      if (!stats) {
        const { driver, connStr } = await resolveConnection(connectionId);
        stats = await driver.getTableStats(connStr, schemaName, tableName);
        setCachedTableStats(connectionId, schemaName, tableName, stats);
      }

      return {
        rowCount: stats.rowCount,
        size: stats.sizeFormatted,
        lastVacuum: stats.lastVacuum,
        lastAnalyze: stats.lastAnalyze,
      };
    },
  });

  /**
   * Get table sample — returns representative sample rows and column statistics.
   * Better than raw SELECT because it provides statistical summaries (min/max/avg,
   * top values, null percentages) that help the AI understand data distribution.
   */
  const tableSample = tool({
    description:
      "Get a representative sample of table data with column statistics. Returns random sample rows plus statistical summaries (min/max/avg for numeric columns, most frequent values for categorical columns, null percentages). Use this to understand the shape and distribution of data before writing queries, especially for unfamiliar tables.",
    inputSchema: z.object({
      schemaName: z.string().describe("The schema name (e.g. 'public')"),
      tableName: z.string().describe("The table name"),
      sampleSize: z
        .number()
        .optional()
        .default(50)
        .describe("Number of sample rows to return (default: 50, max: 200)"),
    }),
    execute: async ({ schemaName, tableName, sampleSize }) => {
      if (!isValidIdentifier(schemaName) || !isValidIdentifier(tableName)) {
        return "Invalid identifier — only alphanumeric characters, underscores, and dollar signs are allowed.";
      }

      // Clamp sample size to reasonable bounds
      const clampedSize = Math.max(10, Math.min(sampleSize ?? 50, 200));

      // Check cache first
      let sampleResult = getCachedTableSample(connectionId, schemaName, tableName);

      if (!sampleResult) {
        const { driver, connStr } = await resolveConnection(connectionId);
        sampleResult = await driver.getTableSample(connStr, schemaName, tableName, clampedSize);
        setCachedTableSample(connectionId, schemaName, tableName, sampleResult);
      }

      return {
        totalRows: sampleResult.totalRows,
        sampleSize: sampleResult.sampleSize,
        rows: sampleResult.rows,
        columnStats: sampleResult.columnStats.map((stat) => ({
          columnName: stat.columnName,
          dataType: stat.dataType,
          min: stat.min,
          max: stat.max,
          avg: stat.avg,
          uniqueCount: stat.uniqueCount,
          nullPercentage: stat.nullPercentage,
          topValues: stat.topValues?.slice(0, 5),
        })),
      };
    },
  });

  /**
   * Explain query plan — lets the AI analyze how a query will be executed.
   * Returns the execution plan showing scan types, index usage, join methods,
   * and estimated costs. Use this to optimize slow queries or understand
   * database performance characteristics.
   */
  const explain = tool({
    description:
      "Analyze the execution plan of a SQL query. Returns detailed information about how the database will execute the query, including scan types (sequential scan, index scan), join methods, estimated costs, and row counts. Use this to optimize slow queries, understand performance bottlenecks, or verify that indexes are being used effectively.",
    inputSchema: z.object({
      sql: z.string().describe("The SQL query to analyze (e.g. 'SELECT * FROM users WHERE id = 1')"),
      analyze: z
        .boolean()
        .optional()
        .default(false)
        .describe("If true, execute the query and show actual execution stats (timing, actual rows). Only use for SELECT queries that you know are safe to run."),
    }),
    execute: async ({ sql, analyze }) => {
      // Basic SQL validation - only allow SELECT, WITH, and EXPLAIN queries
      const trimmed = sql.trim().toLowerCase();
      if (!trimmed.match(/^(select|with|explain)\s/)) {
        return "Only SELECT, WITH, and EXPLAIN queries can be analyzed. DDL and DML operations are not supported.";
      }

      try {
        const { driver, connStr } = await resolveConnection(connectionId);
        const planResult = await driver.explainQuery(connStr, sql, analyze);

        return {
          plan: planResult.plan,
          hasExecutionStats: planResult.hasExecutionStats,
          totalCost: planResult.totalCost,
          estimatedRows: planResult.estimatedRows,
          executionTimeMs: planResult.executionTimeMs,
        };
      } catch (err) {
        return `Error analyzing query plan: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });

  return { columns, enums, tables, select, indexes, constraints, tableStats, tableSample, explain };
}
