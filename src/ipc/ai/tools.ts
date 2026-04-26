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

  // ── Fase 1 — Quick Wins (Descoberta de Schema) ────────────────────────

  /**
   * List schemas available in the database, with approximate table counts.
   * Lets the AI choose the right schema instead of assuming 'public'.
   */
  const listSchemas = tool({
    description:
      "List all schemas available in the connected database, including the number of tables in each. Use this before querying to pick the correct schema instead of assuming 'public'.",
    inputSchema: z.object({}),
    execute: async () => {
      const { driver, connStr } = await resolveConnection(connectionId);
      const summary = await driver.getSchemaSummary(connStr);
      const tableCounts = new Map<string, number>();
      for (const t of summary.tables) {
        tableCounts.set(t.schema, (tableCounts.get(t.schema) ?? 0) + 1);
      }
      return summary.schemas.map((name) => ({
        name,
        tableCount: tableCounts.get(name) ?? 0,
      }));
    },
  });

  /**
   * Search for tables and columns matching a keyword.
   * Useful for large databases where the AI needs to locate relevant entities quickly.
   */
  const searchSchema = tool({
    description:
      "Search for tables and columns that match a keyword. Returns matching tables, columns, and the type of match (table name, column name, or data type). Use this to discover relevant entities in large databases without manually browsing every schema.",
    inputSchema: z.object({
      query: z.string().min(1).describe("Search term (case-insensitive)"),
      schemaName: z.string().optional().describe("Optional schema to restrict the search"),
      limit: z.number().int().min(1).max(100).optional().default(20).describe("Max results to return (default 20, max 100)"),
    }),
    execute: async ({ query, schemaName, limit }) => {
      const { driver, connStr } = await resolveConnection(connectionId);
      const schema = await driver.getSchema(connStr);
      const term = query.toLowerCase();
      const results: Array<{
        schema: string;
        table: string;
        column?: string;
        matchType: "table_name" | "column_name" | "data_type";
      }> = [];

      for (const table of schema.tables) {
        if (schemaName && table.schema !== schemaName) continue;

        if (table.name.toLowerCase().includes(term)) {
          results.push({ schema: table.schema, table: table.name, matchType: "table_name" });
        }

        for (const col of table.columns) {
          if (results.length >= limit) break;
          if (col.name.toLowerCase().includes(term)) {
            results.push({
              schema: table.schema,
              table: table.name,
              column: col.name,
              matchType: "column_name",
            });
          } else if (col.data_type.toLowerCase().includes(term)) {
            results.push({
              schema: table.schema,
              table: table.name,
              column: col.name,
              matchType: "data_type",
            });
          }
        }

        if (results.length >= limit) break;
      }

      return results;
    },
  });

  /**
   * Get the foreign-key relations graph for selected tables or an entire schema.
   * Helps the AI suggest JOINs based on actual database constraints.
   */
  const getRelationsGraph = tool({
    description:
      "Get the foreign-key relationship graph for tables in a schema. Returns which columns reference which tables and columns. Use this to suggest accurate JOINs based on real database constraints.",
    inputSchema: z.object({
      schemaName: z.string().optional().describe("Schema to inspect (defaults to all user schemas)"),
      tables: z.array(z.string()).optional().describe("Optional list of table names to restrict the graph"),
    }),
    execute: async ({ schemaName, tables }) => {
      const { driver, connStr } = await resolveConnection(connectionId);
      const schema = await driver.getSchema(connStr);
      const tableFilter = tables ? new Set(tables.map((t) => t.toLowerCase())) : null;

      const relations = [];
      for (const table of schema.tables) {
        if (schemaName && table.schema !== schemaName) continue;
        if (tableFilter && !tableFilter.has(table.name.toLowerCase())) continue;

        for (const fk of table.foreign_keys) {
          relations.push({
            fromTable: table.name,
            fromSchema: table.schema,
            fromColumn: fk.column_name,
            toTable: fk.referenced_table,
            toSchema: fk.referenced_schema ?? table.schema,
            toColumn: fk.referenced_column,
            constraintName: fk.name,
          });
        }
      }

      return relations;
    },
  });

  // ── Fase 2 — Segurança e Governança ───────────────────────────────────

  /**
   * Validate whether a SQL query is safe to run.
   * Classifies as safe (read-only), risky (mutation), or blocked (DDL/admin).
   */
  const validateSqlSafety = tool({
    description:
      "Analyze a SQL query and classify its safety level: 'safe' for read-only queries (SELECT/WITH/EXPLAIN), 'risky' for mutations (UPDATE/DELETE/INSERT), or 'blocked' for dangerous operations (DROP, TRUNCATE, ALTER, GRANT, etc). Returns the classification and a list of reasons.",
    inputSchema: z.object({
      sql: z.string().min(1).describe("The SQL query to classify"),
    }),
    execute: async ({ sql }) => {
      const normalized = sql.trim().toLowerCase().replace(/\s+/g, " ");
      const reasons: string[] = [];

      // Blocked patterns — DDL and admin commands
      const blockedPatterns = [
        { pattern: /\b(drop|truncate)\b/, reason: "Contains DROP or TRUNCATE which destroys data or structures." },
        { pattern: /\b(alter\s+(table|schema|database|index|sequence))\b/, reason: "Contains ALTER which modifies database structure." },
        { pattern: /\b(create\s+(table|schema|database|index|sequence|view|materialized\s+view|or\s+replace))\b/, reason: "Contains CREATE which modifies database structure." },
        { pattern: /\b(grant|revoke)\b/, reason: "Contains GRANT/REVOKE which changes permissions." },
        { pattern: /\b(comment\s+on)\b/, reason: "Contains COMMENT ON which modifies metadata." },
        { pattern: /;\s*(drop|truncate|alter|create|grant|revoke|comment\s+on)\b/, reason: "Multiple statements detected with dangerous commands." },
      ];

      for (const { pattern, reason } of blockedPatterns) {
        if (pattern.test(normalized)) {
          reasons.push(reason);
        }
      }

      if (reasons.length > 0) {
        return { classification: "blocked" as const, reasons };
      }

      // Risky patterns — DML mutations
      const riskyPatterns = [
        { pattern: /\b(update|delete|insert|merge|upsert|replace)\b/, reason: "Contains UPDATE/DELETE/INSERT/MERGE which modifies data." },
        { pattern: /\b(copy\s+.*\s+from)\b/, reason: "Contains COPY FROM which imports data." },
      ];

      for (const { pattern, reason } of riskyPatterns) {
        if (pattern.test(normalized)) {
          reasons.push(reason);
        }
      }

      if (reasons.length > 0) {
        return { classification: "risky" as const, reasons };
      }

      // Safe — only SELECT, WITH, EXPLAIN, SHOW, DESCRIBE
      const safePrefix = /^(select|with|explain|show|describe|table)\b/;
      if (safePrefix.test(normalized)) {
        return { classification: "safe" as const, reasons: ["Query is read-only (SELECT/WITH/EXPLAIN)."] };
      }

      return { classification: "blocked" as const, reasons: ["Unrecognized or unsupported query type."] };
    },
  });

  /**
   * Execute a read-only SQL query safely.
   * Only accepts SELECT, WITH, and EXPLAIN statements. Enforces row limits and timeouts.
   */
  const runReadOnlySql = tool({
    description:
      "Execute a read-only SQL query (SELECT, WITH, or EXPLAIN) and return the results. Only safe queries are allowed — DDL and DML are rejected. Use this when the AI needs to run custom SQL to answer a user's question.",
    inputSchema: z.object({
      sql: z.string().min(1).describe("The read-only SQL query to execute"),
      limit: z.number().int().min(1).max(500).optional().default(100).describe("Maximum rows to return (default 100, max 500)"),
      timeoutMs: z.number().int().min(1000).max(30000).optional().default(10000).describe("Query timeout in milliseconds (default 10s, max 30s)"),
    }),
    execute: async ({ sql, limit, timeoutMs }) => {
      const trimmed = sql.trim().toLowerCase().replace(/\s+/g, " ");

      // Allow only SELECT, WITH, EXPLAIN, SHOW, DESCRIBE, TABLE
      if (!/^(select|with|explain|show|describe|table)\b/.test(trimmed)) {
        return {
          error: "Only read-only queries (SELECT, WITH, EXPLAIN, SHOW, DESCRIBE, TABLE) are allowed.",
        };
      }

      // Reject dangerous sub-patterns even inside SELECT
      const dangerous = /\b(into\s+(outfile|dumpfile)|copy\s+.*\s+to|\\;\\s*\\w+)/;
      if (dangerous.test(trimmed)) {
        return {
          error: "Query contains dangerous patterns (INTO OUTFILE, COPY TO, or multiple statements).",
        };
      }

      const { driver, connStr } = await resolveConnection(connectionId);

      // Inject LIMIT if not present and query looks like a simple SELECT
      let finalSql = sql;
      const effectiveLimit = limit ?? 100;
      const hasLimit = /\blimit\s+\d+\b/.test(trimmed);
      const hasSemicolon = trimmed.endsWith(";");
      const baseSql = hasSemicolon ? sql.slice(0, -1) : sql;

      if (!hasLimit && trimmed.startsWith("select")) {
        finalSql = `${baseSql} LIMIT ${effectiveLimit}`;
      }

      try {
        const result = await driver.executeQuery(connStr, finalSql);
        return {
          columns: result.columns.map((c) => c.name),
          rows: result.rows,
          rowCount: result.row_count,
          limitApplied: !hasLimit && trimmed.startsWith("select") ? effectiveLimit : undefined,
        };
      } catch (err) {
        return {
          error: `Error executing query: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  });

  /**
   * Dry-run a mutation query (UPDATE or DELETE) to estimate impact before execution.
   * Converts the query to a SELECT COUNT(*) to show how many rows would be affected.
   */
  const dryRunMutation = tool({
    description:
      "Estimate the impact of an UPDATE or DELETE query before running it. Converts the query to a SELECT COUNT(*) to show how many rows would be affected, and returns a sample of rows that match the WHERE clause. Use this to preview mutations and avoid accidental mass updates or deletes.",
    inputSchema: z.object({
      sql: z.string().min(1).describe("The UPDATE or DELETE query to preview"),
      sampleSize: z.number().int().min(1).max(50).optional().default(5).describe("Number of sample rows to preview (default 5, max 50)"),
    }),
    execute: async ({ sql, sampleSize }) => {
      const normalized = sql.trim().toLowerCase().replace(/\s+/g, " ");
      const effectiveSample = Math.min(sampleSize ?? 5, 50);

      if (!/^(update|delete)\b/.test(normalized)) {
        return {
          error: "Only UPDATE and DELETE queries can be dry-run. For SELECT queries, use runReadOnlySql instead.",
        };
      }

      const { driver, connStr, dbType } = await resolveConnection(connectionId);

      try {
        // Extract WHERE clause
        const whereMatch = normalized.match(/\bwhere\b(.+?)(?:\blimit\b|\border\b|;|$)/i);
        const whereClause = whereMatch ? whereMatch[1].trim() : null;

        // Extract table reference
        let tableRef: string | null = null;
        let schemaName = "public";
        let tableName: string | null = null;

        if (normalized.startsWith("delete")) {
          // DELETE FROM schema.table ... or DELETE FROM table ...
          const deleteMatch = normalized.match(/delete\s+from\s+((?:[\"']?[a-zA-Z_][a-zA-Z0-9_$]*[\"']?\s*\.\s*)?[\"']?[a-zA-Z_][a-zA-Z0-9_$]*[\"']?)/);
          if (deleteMatch) {
            tableRef = deleteMatch[1].replace(/["']/g, "").trim();
          }
        } else if (normalized.startsWith("update")) {
          // UPDATE schema.table SET ... or UPDATE table SET ...
          const updateMatch = normalized.match(/update\s+((?:[\"']?[a-zA-Z_][a-zA-Z0-9_$]*[\"']?\s*\.\s*)?[\"']?[a-zA-Z_][a-zA-Z0-9_$]*[\"']?)/);
          if (updateMatch) {
            tableRef = updateMatch[1].replace(/["']/g, "").trim();
          }
        }

        if (!tableRef) {
          return { error: "Could not parse the table reference from the query." };
        }

        const parts = tableRef.split(".").map((p) => p.trim());
        if (parts.length === 2) {
          schemaName = parts[0];
          tableName = parts[1];
        } else {
          tableName = parts[0];
        }

        if (!isValidIdentifier(schemaName) || !isValidIdentifier(tableName)) {
          return { error: "Invalid schema or table name parsed from query." };
        }

        // Build count query
        const countSql = whereClause
          ? `SELECT COUNT(*) AS estimated_affected_rows FROM "${schemaName}"."${tableName}" WHERE ${whereClause}`
          : `SELECT COUNT(*) AS estimated_affected_rows FROM "${schemaName}"."${tableName}"`;

        const countResult = await driver.executeQuery(connStr, countSql);
        const estimatedAffectedRows = Number(countResult.rows[0]?.[0] ?? 0);

        // Build sample preview query
        let samplePreview = null;
        if (effectiveSample > 0) {
          const sampleSql = whereClause
            ? `SELECT * FROM "${schemaName}"."${tableName}" WHERE ${whereClause} LIMIT ${effectiveSample}`
            : `SELECT * FROM "${schemaName}"."${tableName}" LIMIT ${effectiveSample}`;

          const sampleResult = await driver.executeQuery(connStr, sampleSql);
          samplePreview = {
            columns: sampleResult.columns.map((c) => c.name),
            rows: sampleResult.rows,
          };
        }

        const warnings: string[] = [];
        if (!whereClause) {
          warnings.push("No WHERE clause detected — this would affect ALL rows in the table.");
        }
        if (estimatedAffectedRows > 10000) {
          warnings.push(`Large number of rows affected (${estimatedAffectedRows}) — consider narrowing the WHERE clause.`);
        }
        if (normalized.startsWith("delete") && !whereClause) {
          warnings.push("DELETE without WHERE will remove every row in the table.");
        }

        return {
          estimatedAffectedRows,
          samplePreview,
          warnings,
          originalQuery: sql.trim(),
        };
      } catch (err) {
        return {
          error: `Error analyzing query: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  });

  return {
    columns,
    enums,
    tables,
    select,
    indexes,
    constraints,
    tableStats,
    tableSample,
    explain,
    listSchemas,
    searchSchema,
    getRelationsGraph,
    validateSqlSafety,
    runReadOnlySql,
    dryRunMutation,
  };
}
