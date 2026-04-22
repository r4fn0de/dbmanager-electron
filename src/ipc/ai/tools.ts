/**
 * AI Tools — database introspection tools that the AI model can invoke.
 *
 * These tools let the AI assistant inspect the user's database schema and
 * query data, enabling context-aware SQL generation.
 *
 * Uses a FACTORY PATTERN: `createAiTools(connectionId)` returns the tool set
 * with `connectionId` baked into the closure. The AI SDK's `ToolExecutionOptions`
 * does NOT forward `experimental_context` to tool execute functions, so we
 * cannot rely on the second parameter to carry custom data.
 */
import { tool } from "ai";
import { z } from "zod";
import { driverRegistry } from "@/ipc/db/registry";
import { loadConnections } from "@/ipc/db/connection-store";
import type { DatabaseType } from "@/ipc/db/types";
import type { DriverConnectionConfig } from "@/ipc/db/driver";

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

// ---------------------------------------------------------------------------
// Factory — creates tool set with connectionId in closure
// ---------------------------------------------------------------------------

/**
 * Create the AI tool set for a specific connection.
 *
 * MUST be called with the connectionId before passing to streamText/generateText.
 * The connectionId is captured in each tool's execute closure — the AI SDK does
 * NOT forward `experimental_context` to tool execute functions.
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
      const { driver, connStr } = await resolveConnection(connectionId);
      const details = await driver.getTableDetails(connStr, schemaName, tableName);
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
      const limit = Math.min(rawLimit ?? 10, 20);

      // Build column selection with validated identifiers
      const cols = selectColumns && selectColumns.length > 0
        ? selectColumns.map((c) => `"${c}"`).join(", ")
        : "*";

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

  return { columns, enums, tables, select };
}
