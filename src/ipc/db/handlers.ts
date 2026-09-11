import { randomUUID } from "node:crypto";
import { ORPCError, os } from "@orpc/server";
import {
  invalidateConnectionCache,
  invalidateSchemaCache,
  invalidateTableCache,
  recordDdlOperation,
} from "@/ipc/ai/schema-cache";
import { registerQuery, unregisterQuery } from "./active-queries";
import { loadConnections, saveConnections } from "./connection-store";
import { LOCAL_DB_DEFAULT_PASSWORD } from "./constants";
import type { DriverConnectionConfig } from "./driver";
import { localDbManager } from "./local-db-manager";
import { driverRegistry } from "./registry";
import {
  addColumnInputSchema,
  alterColumnTypeInputSchema,
  connectionInputSchema,
  createBranchSchema,
  createIndexInputSchema,
  createLocalDatabaseSchema,
  createSchemaInputSchema,
  createTableFromImportSchema,
  createTableInputSchema,
  deleteBranchSchema,
  dropColumnInputSchema,
  dropIndexInputSchema,
  dropTableInputSchema,
  executeBatchDdlSchema,
  executeQuerySchema,
  explainQuerySchema,
  exportSchemaIndexesSchema,
  exportTableDataSchema,
  fkLookupInputSchema,
  getBranchInfoSchema,
  getTableDetailsSchema,
  idSchema,
  importDryRunSchema,
  importTableColumnsSchema,
  importTableRowsSchema,
  listBranchesSchema,
  listRowsInputSchema,
  mergeBranchSchemaSchema,
  previewDeleteBranchSchema,
  renameBranchSchema,
  renameColumnInputSchema,
  renameTableInputSchema,
  saveChangesInputSchema,
  schemaDefinitionInputSchema,
  setColumnDefaultInputSchema,
  setColumnNullableInputSchema,
  switchBranchSchema,
  tableTruncateSchema,
  waitForDatabaseSchema,
} from "./schemas";
import {
  tableFkLookupRuntime,
  tableSaveChangesRuntime,
  tableTruncateRuntime,
} from "./table-data-runtime";
import type {
  BranchDeletePreview,
  BranchInfo,
  Connection,
  ConstraintInfo,
  DatabaseInfo,
  DatabaseSchema,
  DatabaseType,
  DdlResult,
  ExportSchemaIndexesResult,
  ExportSchemaResult,
  ExportTableDataResult,
  FkLookupResponse,
  ImportDryRunResult,
  IndexInfo,
  LocalDbInfo,
  MergeBranchSchemaResult,
  QueryPlanResult,
  QueryResult,
  SaveChangesResponse,
  SchemaEnum,
  SchemaFunction,
  SchemaSummary,
  SchemaTableDetails,
  SchemaTrigger,
  TableRowsResponse,
} from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve the db_type for a connection, defaulting to postgresql. */
function resolveDbType(connection: Partial<Connection>): DatabaseType {
  return (connection as Connection).db_type || "postgresql";
}

/** Strip credentials (passwords, connection strings) from error messages before sending to renderer. */
function sanitizeErrorMessage(err: unknown, fallback: string): string {
  if (!(err instanceof Error)) {
    return fallback;
  }
  let msg = err.message;
  // Remove postgresql://user:password@... patterns
  msg = msg.replace(
    /(?:postgresql|postgres|mysql|mariadb|clickhouse|redis):\/\/[^@\s]+@[\w.-]+:\d+/gi,
    "[CONNECTION_STRING]"
  );
  // Remove password=... patterns
  msg = msg.replace(/password\s*=\s*\S+/gi, "password=[REDACTED]");
  // Remove :password@ patterns that survived the first pass
  msg = msg.replace(/:\w+@/g, ":[REDACTED]@");
  return msg || fallback;
}

function maskSecretInUrl(value?: string): string | undefined {
  if (!value) {
    return value;
  }
  try {
    const parsed = new URL(value);
    if (parsed.password) {
      parsed.password = "****";
    }
    return parsed.toString();
  } catch {
    return value.replace(/:[^:@/]+@/, ":****@");
  }
}

function redactConnectionForRenderer(connection: Connection): Connection {
  return {
    ...connection,
    connection_string: maskSecretInUrl(connection.connection_string),
    password: "",
    url: maskSecretInUrl(connection.url),
  };
}

function isMaskedSecretUrl(value?: string): boolean {
  return typeof value === "string" && value.includes(":****@");
}

function formatDriverErrorMessage(err: unknown, fallback: string): string {
  if (!err || typeof err !== "object") {
    return sanitizeErrorMessage(err, fallback);
  }

  const e = err as {
    message?: unknown;
    code?: unknown;
    detail?: unknown;
    hint?: unknown;
    position?: unknown;
    errno?: unknown;
    sqlState?: unknown;
  };

  const message =
    typeof e.message === "string" && e.message.trim()
      ? e.message.trim()
      : fallback;
  const code =
    typeof e.code === "string"
      ? e.code
      : typeof e.sqlState === "string"
        ? e.sqlState
        : typeof e.errno === "number"
          ? String(e.errno)
          : null;
  const detail =
    typeof e.detail === "string" && e.detail.trim() ? e.detail.trim() : null;
  const hint =
    typeof e.hint === "string" && e.hint.trim() ? e.hint.trim() : null;
  const position =
    typeof e.position === "string" && e.position.trim()
      ? e.position.trim()
      : null;

  const parts: string[] = [];
  parts.push(code ? `[${code}] ${message}` : message);
  if (detail) {
    parts.push(`Detail: ${detail}`);
  }
  if (hint) {
    parts.push(`Hint: ${hint}`);
  }
  if (position) {
    parts.push(`Position: ${position}`);
  }

  return sanitizeErrorMessage(parts.join(" | "), fallback);
}

/** Derive a DriverConnectionConfig from a Connection. */
function toDriverConfig(
  connection: Partial<Connection>
): DriverConnectionConfig {
  const dbType = resolveDbType(connection);
  const driver = driverRegistry.get(dbType);
  return {
    database: connection.database ?? driver.defaultDatabase,
    host: connection.host ?? "",
    password: connection.password ?? "",
    port: connection.port ?? driver.defaultPort,
    ssl_mode: connection.ssl_mode ?? "prefer",
    url: connection.url,
    username: connection.username ?? driver.defaultUsername,
  };
}

/** Load a connection by ID and build its connection string via the driver. */
async function resolveConnectionString(
  connectionId: string
): Promise<{ connection: Connection; connStr: string }> {
  const connections = await loadConnections();
  const connection = connections.find((c) => c.id === connectionId);
  if (!connection) {
    throw new Error("Connection not found");
  }

  if (connection.is_local) {
    const localStatus = await localDbManager.getStatus(connection.id);
    if (!localStatus) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Local database was not found. Recreate it and try again.",
      });
    }
    if (!localStatus.running) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Local database "${connection.name}" is not running. Start it before connecting.`,
      });
    }
  }

  const dbType = resolveDbType(connection);
  let connStr: string;

  if (connection.is_local && dbType === "postgresql") {
    connStr = await localDbManager.getActiveBranchConnectionString(
      connection.id
    );
  } else {
    const driver = driverRegistry.get(dbType);
    connStr = driver.buildConnectionString(toDriverConfig(connection));
  }
  return { connection, connStr };
}

// ---------------------------------------------------------------------------
// Connection handlers
// ---------------------------------------------------------------------------

export const listConnections = os.handler(async (): Promise<Connection[]> => {
  const connections = await loadConnections();
  return connections.map(redactConnectionForRenderer);
});

export const saveConnection = os
  .input(connectionInputSchema)
  .handler(async ({ input }): Promise<void> => {
    try {
      const connections = await loadConnections();
      const existingIndex = connections.findIndex((c) => c.id === input.id);

      const dbType: DatabaseType = input.db_type || "postgresql";
      const _driver = driverRegistry.get(dbType);

      const existing = existingIndex >= 0 ? connections[existingIndex] : null;
      const nextPassword =
        input.password.trim().length > 0
          ? input.password
          : (existing?.password ?? "");
      const nextUrl = isMaskedSecretUrl(input.url) ? existing?.url : input.url;
      const nextConnectionString = isMaskedSecretUrl(input.connection_string)
        ? existing?.connection_string
        : input.connection_string;

      const connection: Connection = {
        color: input.color,
        connection_string: nextConnectionString,
        database: input.database,
        db_type: dbType,
        engine_version: input.engine_version,
        host: input.host,
        id: input.id || randomUUID(),
        is_local: input.is_local,
        local_auto_start: input.local_auto_start,
        name: input.name,
        password: nextPassword,
        port: input.port,
        // Backward compat: persist postgres_version if it was provided
        postgres_version: input.postgres_version,
        ssl_mode: input.ssl_mode,
        tag: input.tag,
        url: nextUrl,
        username: input.username,
      };

      if (existingIndex >= 0) {
        connections[existingIndex] = connection;
      } else {
        connections.push(connection);
      }

      await saveConnections(connections);
    } catch (err) {
      console.error("[db] saveConnection failed:", err);
      throw new ORPCError("BAD_REQUEST", {
        message: sanitizeErrorMessage(err, "Failed to save connection"),
      });
    }
  });

export const deleteConnection = os
  .input(idSchema)
  .handler(async ({ input }): Promise<void> => {
    const connections = await loadConnections();
    const filtered = connections.filter((c) => c.id !== input.id);
    await saveConnections(filtered);
    // Invalidate all cache for the deleted connection
    invalidateConnectionCache(input.id);
  });

export const testConnection = os
  .input(connectionInputSchema)
  .handler(async ({ input }): Promise<boolean> => {
    const dbType: DatabaseType = input.db_type || "postgresql";
    const driver = driverRegistry.get(dbType);

    // Resolve real credentials from store when renderer sends redacted fields
    // (password blanked, url masked), but keep current form values for host/port/ssl.
    let resolvedConfig = toDriverConfig(input);
    if (input.id) {
      const connections = await loadConnections();
      const stored = connections.find((c) => c.id === input.id);
      if (stored) {
        const providedPassword = input.password?.trim();
        const password =
          providedPassword && providedPassword.length > 0
            ? input.password
            : stored.password;

        // Only use URL when the current payload explicitly provides a valid,
        // non-masked URL. Otherwise, test the structured host/port fields.
        const providedUrl =
          typeof input.url === "string" ? input.url.trim() : "";
        const url =
          providedUrl.length > 0 && !isMaskedSecretUrl(providedUrl)
            ? providedUrl
            : undefined;

        resolvedConfig = toDriverConfig({
          ...stored,
          ...input,
          password,
          url,
        });
      }
    }

    try {
      const ok = await driver.testConnection(resolvedConfig);
      if (!ok) {
        console.warn("[db] testConnection returned false", {
          database: resolvedConfig.database,
          dbType,
          hasUrl: Boolean(resolvedConfig.url),
          host: resolvedConfig.host,
          isLocal: Boolean(input.is_local),
          port: resolvedConfig.port,
          sslMode: resolvedConfig.ssl_mode,
        });
        if (dbType === "clickhouse") {
          const sslMode = resolvedConfig.ssl_mode;
          const port = Number(resolvedConfig.port) || 0;
          const hint =
            sslMode === "disable"
              ? "ClickHouse test failed. If your server uses TLS, set SSL Mode to 'Require' and use HTTPS port (usually 8443 or provider-specific)."
              : "ClickHouse test failed with SSL required. Verify host, port and credentials, and confirm the server accepts HTTPS/native HTTP endpoint.";

          throw new ORPCError("BAD_REQUEST", {
            message: `${hint} Current config: ssl_mode=${sslMode}, port=${port}.`,
          });
        }

        throw new ORPCError("BAD_REQUEST", {
          message: "Connection test failed",
        });
      }
      return true;
    } catch (err) {
      if (err instanceof ORPCError) {
        throw err;
      }
      const message = sanitizeErrorMessage(err, "Connection test failed");
      console.error("[db] testConnection threw", {
        database: resolvedConfig.database,
        dbType,
        hasUrl: Boolean(resolvedConfig.url),
        host: resolvedConfig.host,
        isLocal: Boolean(input.is_local),
        message,
        port: resolvedConfig.port,
        sslMode: resolvedConfig.ssl_mode,
      });
      throw new ORPCError("BAD_REQUEST", { message });
    }
  });

export const getConnection = os
  .input(idSchema)
  .handler(async ({ input }): Promise<Connection | null> => {
    const connections = await loadConnections();
    return connections.find((c) => c.id === input.id) || null;
  });

// ---------------------------------------------------------------------------
// Query / Schema handlers (use registry)
// ---------------------------------------------------------------------------

const MAX_QUERY_ROWS = 50_000;
const MAX_PAGE_SIZE = 1000;

export const executeQuery = os
  .input(executeQuerySchema)
  .handler(async ({ input }): Promise<QueryResult> => {
    const { connStr, connection } = await resolveConnectionString(
      input.connectionId
    );
    const driver = driverRegistry.get(resolveDbType(connection));

    // If requestId is provided, register the query for cancellation support
    let signal: AbortSignal | undefined;
    if (input.requestId) {
      const ac = registerQuery(input.requestId, input.connectionId);
      signal = ac.signal;
    }

    try {
      const result = await driver.executeQuery(connStr, input.sql, signal);

      // Truncate large result sets to prevent renderer OOM
      if (result.rows.length > MAX_QUERY_ROWS) {
        const totalRowCount = result.rows.length;
        return {
          ...result,
          row_count: MAX_QUERY_ROWS,
          rows: result.rows.slice(0, MAX_QUERY_ROWS),
          totalRowCount,
          truncated: true,
        };
      }
      return result;
    } catch (err) {
      throw new ORPCError("BAD_REQUEST", {
        message: formatDriverErrorMessage(err, "Failed to execute query"),
      });
    } finally {
      if (input.requestId) {
        unregisterQuery(input.requestId);
      }
    }
  });

export const explainQuery = os
  .input(explainQuerySchema)
  .handler(async ({ input }): Promise<QueryPlanResult> => {
    const { connStr, connection } = await resolveConnectionString(
      input.connectionId
    );
    const driver = driverRegistry.get(resolveDbType(connection));

    try {
      return await driver.explainQuery(connStr, input.sql, input.analyze);
    } catch (err) {
      throw new ORPCError("BAD_REQUEST", {
        message: formatDriverErrorMessage(err, "Failed to explain query"),
      });
    }
  });
export const getSchema = os
  .input(idSchema)
  .handler(async ({ input }): Promise<DatabaseSchema> => {
    const { connStr, connection } = await resolveConnectionString(input.id);
    const driver = driverRegistry.get(resolveDbType(connection));
    return await driver.getSchema(connStr);
  });

export const getSchemaSummary = os
  .input(idSchema)
  .handler(async ({ input }): Promise<SchemaSummary> => {
    try {
      const { connStr, connection } = await resolveConnectionString(input.id);
      const driver = driverRegistry.get(resolveDbType(connection));
      return await driver.getSchemaSummary(connStr);
    } catch (err) {
      throw new ORPCError("BAD_REQUEST", {
        message: sanitizeErrorMessage(err, "Failed to fetch schema summary"),
      });
    }
  });

export const getTableDetails = os
  .input(getTableDetailsSchema)
  .handler(async ({ input }): Promise<SchemaTableDetails> => {
    const { connStr, connection } = await resolveConnectionString(
      input.connectionId
    );
    const driver = driverRegistry.get(resolveDbType(connection));
    return await driver.getTableDetails(connStr, input.schema, input.table);
  });

export const tableListRows = os
  .input(listRowsInputSchema)
  .handler(async ({ input }): Promise<TableRowsResponse> => {
    const { connStr, connection } = await resolveConnectionString(
      input.tableRef.connectionId
    );
    const driver = driverRegistry.get(resolveDbType(connection));
    // Clamp pageSize to prevent fetching too many rows at once
    const safePageSize = Math.min(input.pageSize, MAX_PAGE_SIZE);
    const response = await driver.listRows(
      connStr,
      input.tableRef.schema,
      input.tableRef.table,
      input.page,
      safePageSize,
      input.sort,
      input.filters,
      input.cursor,
      input.exact
    );
    return {
      ...response,
      filtersAppliedOnServer: input.filters.length > 0,
      sortAppliedOnServer: input.sort.length > 0,
    };
  });

export const tableSaveChanges = os
  .input(saveChangesInputSchema)
  .handler(async ({ input }): Promise<SaveChangesResponse> => {
    const { connStr, connection } = await resolveConnectionString(
      input.tableRef.connectionId
    );
    const dbType = resolveDbType(connection);
    return await tableSaveChangesRuntime(dbType, connStr, input);
  });

export const tableTruncate = os
  .input(tableTruncateSchema)
  .handler(async ({ input }): Promise<void> => {
    const { connStr, connection } = await resolveConnectionString(
      input.tableRef.connectionId
    );
    const dbType = resolveDbType(connection);
    await tableTruncateRuntime(
      dbType,
      connStr,
      input.tableRef.schema,
      input.tableRef.table
    );
  });

export const tableFkLookup = os
  .input(fkLookupInputSchema)
  .handler(async ({ input }): Promise<FkLookupResponse> => {
    const { connStr, connection } = await resolveConnectionString(
      input.tableRef.connectionId
    );
    const dbType = resolveDbType(connection);
    const driver = driverRegistry.get(dbType);
    return await tableFkLookupRuntime({
      connectionString: connStr,
      dbType,
      getTableDetails: (connectionString, schema, table) =>
        driver.getTableDetails(connectionString, schema, table),
      input,
      listRows: (
        connectionString,
        schema,
        table,
        page,
        pageSize,
        sort,
        filters
      ) =>
        driver.listRows(
          connectionString,
          schema,
          table,
          page,
          pageSize,
          sort,
          filters
        ),
    });
  });

export const getDatabaseInfo = os
  .input(idSchema)
  .handler(async ({ input }): Promise<DatabaseInfo> => {
    const { connStr, connection } = await resolveConnectionString(input.id);
    const driver = driverRegistry.get(resolveDbType(connection));
    return await driver.getDatabaseInfo(connStr);
  });

// ---------------------------------------------------------------------------
// DDL handlers (use registry)
// ---------------------------------------------------------------------------

export const createTable = os
  .input(createTableInputSchema)
  .handler(async ({ input }): Promise<DdlResult> => {
    const { connStr, connection } = await resolveConnectionString(
      input.connectionId
    );
    const driver = driverRegistry.get(resolveDbType(connection));
    const sql = await driver.createTable(
      connStr,
      input.schema,
      input.name,
      input.columns,
      input.primaryKeyColumns,
      input.ifNotExists
    );
    return { sql };
  });

export const dropTable = os
  .input(dropTableInputSchema)
  .handler(async ({ input }): Promise<DdlResult> => {
    const { connStr, connection } = await resolveConnectionString(
      input.connectionId
    );
    const driver = driverRegistry.get(resolveDbType(connection));
    const sql = await driver.dropTable(
      connStr,
      input.schema,
      input.name,
      input.cascade,
      input.ifExists
    );
    // Invalidate cache for the dropped table
    invalidateTableCache(input.connectionId, input.schema, input.name);
    recordDdlOperation(input.connectionId, input.schema, input.name);
    return { sql };
  });

export const renameTable = os
  .input(renameTableInputSchema)
  .handler(async ({ input }): Promise<DdlResult> => {
    const { connStr, connection } = await resolveConnectionString(
      input.connectionId
    );
    const driver = driverRegistry.get(resolveDbType(connection));
    const sql = await driver.renameTable(
      connStr,
      input.schema,
      input.oldName,
      input.newName
    );
    // Invalidate cache for both old and new table names
    invalidateTableCache(input.connectionId, input.schema, input.oldName);
    invalidateTableCache(input.connectionId, input.schema, input.newName);
    recordDdlOperation(input.connectionId, input.schema, input.oldName);
    recordDdlOperation(input.connectionId, input.schema, input.newName);
    return { sql };
  });

export const addColumn = os
  .input(addColumnInputSchema)
  .handler(async ({ input }): Promise<DdlResult> => {
    const { connStr, connection } = await resolveConnectionString(
      input.connectionId
    );
    const driver = driverRegistry.get(resolveDbType(connection));
    const sql = await driver.addColumn(
      connStr,
      input.schema,
      input.table,
      input.column.name,
      input.column.dataType,
      input.column.isNullable,
      input.column.defaultExpr,
      input.ifNotExists
    );
    // Invalidate cache for the modified table
    invalidateTableCache(input.connectionId, input.schema, input.table);
    recordDdlOperation(input.connectionId, input.schema, input.table);
    return { sql };
  });

export const dropColumn = os
  .input(dropColumnInputSchema)
  .handler(async ({ input }): Promise<DdlResult> => {
    const { connStr, connection } = await resolveConnectionString(
      input.connectionId
    );
    const driver = driverRegistry.get(resolveDbType(connection));
    const sql = await driver.dropColumn(
      connStr,
      input.schema,
      input.table,
      input.column,
      input.cascade,
      input.ifExists
    );
    // Invalidate cache for the modified table
    invalidateTableCache(input.connectionId, input.schema, input.table);
    recordDdlOperation(input.connectionId, input.schema, input.table);
    return { sql };
  });

export const renameColumn = os
  .input(renameColumnInputSchema)
  .handler(async ({ input }): Promise<DdlResult> => {
    const { connStr, connection } = await resolveConnectionString(
      input.connectionId
    );
    const driver = driverRegistry.get(resolveDbType(connection));
    const sql = await driver.renameColumn(
      connStr,
      input.schema,
      input.table,
      input.oldName,
      input.newName
    );
    // Invalidate cache for the modified table
    invalidateTableCache(input.connectionId, input.schema, input.table);
    recordDdlOperation(input.connectionId, input.schema, input.table);
    return { sql };
  });

export const alterColumnType = os
  .input(alterColumnTypeInputSchema)
  .handler(async ({ input }): Promise<DdlResult> => {
    const { connStr, connection } = await resolveConnectionString(
      input.connectionId
    );
    const driver = driverRegistry.get(resolveDbType(connection));
    const sql = await driver.alterColumnType(
      connStr,
      input.schema,
      input.table,
      input.column,
      input.newType,
      input.usingExpr
    );
    // Invalidate cache for the modified table
    invalidateTableCache(input.connectionId, input.schema, input.table);
    recordDdlOperation(input.connectionId, input.schema, input.table);
    return { sql };
  });

export const setColumnNullable = os
  .input(setColumnNullableInputSchema)
  .handler(async ({ input }): Promise<DdlResult> => {
    const { connStr, connection } = await resolveConnectionString(
      input.connectionId
    );
    const driver = driverRegistry.get(resolveDbType(connection));
    const sql = await driver.setColumnNullable(
      connStr,
      input.schema,
      input.table,
      input.column,
      input.isNullable
    );
    // Invalidate cache for the modified table
    invalidateTableCache(input.connectionId, input.schema, input.table);
    recordDdlOperation(input.connectionId, input.schema, input.table);
    return { sql };
  });

export const setColumnDefault = os
  .input(setColumnDefaultInputSchema)
  .handler(async ({ input }): Promise<DdlResult> => {
    const { connStr, connection } = await resolveConnectionString(
      input.connectionId
    );
    const driver = driverRegistry.get(resolveDbType(connection));
    const sql = await driver.setColumnDefault(
      connStr,
      input.schema,
      input.table,
      input.column,
      input.defaultExpr
    );
    // Invalidate cache for the modified table
    invalidateTableCache(input.connectionId, input.schema, input.table);
    recordDdlOperation(input.connectionId, input.schema, input.table);
    return { sql };
  });

export const createIndex = os
  .input(createIndexInputSchema)
  .handler(async ({ input }): Promise<DdlResult> => {
    const { connStr, connection } = await resolveConnectionString(
      input.connectionId
    );
    const driver = driverRegistry.get(resolveDbType(connection));
    const indexName =
      input.name || `${input.table}_${input.columns.join("_")}_idx`;
    const sql = await driver.createIndex(
      connStr,
      input.schema,
      input.table,
      indexName,
      input.columns,
      input.unique,
      input.ifNotExists
    );
    // Invalidate cache for the modified table (indexes changed)
    invalidateTableCache(input.connectionId, input.schema, input.table);
    recordDdlOperation(input.connectionId, input.schema, input.table);
    return { sql };
  });

export const dropIndex = os
  .input(dropIndexInputSchema)
  .handler(async ({ input }): Promise<DdlResult> => {
    const { connStr, connection } = await resolveConnectionString(
      input.connectionId
    );
    const driver = driverRegistry.get(resolveDbType(connection));
    const sql = await driver.dropIndex(
      connStr,
      input.schema,
      input.name,
      input.cascade,
      input.ifExists
    );
    // Invalidate cache for the schema (index might be on any table)
    invalidateSchemaCache(input.connectionId, input.schema);
    recordDdlOperation(input.connectionId, input.schema);
    return { sql };
  });

export const createSchema = os
  .input(createSchemaInputSchema)
  .handler(async ({ input }): Promise<DdlResult> => {
    const { connStr, connection } = await resolveConnectionString(
      input.connectionId
    );
    const driver = driverRegistry.get(resolveDbType(connection));
    const sql = await driver.createSchema(
      connStr,
      input.name,
      input.ifNotExists
    );
    return { sql };
  });

// ---------------------------------------------------------------------------
// Local DB handlers (PostgreSQL-only, unchanged)
// ---------------------------------------------------------------------------

export const listLocalDatabases = os.handler(
  async (): Promise<LocalDbInfo[]> => await localDbManager.list()
);

export const createLocalDatabase = os
  .input(createLocalDatabaseSchema)
  .handler(async ({ input }): Promise<LocalDbInfo> => {
    try {
      const normalizedName = input.name.trim();
      const engine = input.engine ?? "postgresql";
      const isSqlite = engine === "sqlite";
      const password = isSqlite
        ? ""
        : input.password?.trim() || LOCAL_DB_DEFAULT_PASSWORD;
      const info = await localDbManager.create({
        autoStart: input.autoStart ?? true,
        databaseName: input.databaseName || (isSqlite ? "main" : "postgres"),
        engine,
        name: normalizedName,
        password,
        port: isSqlite ? 0 : input.port || 5432,
        postgresVersion: isSqlite ? "" : input.postgresVersion || "16.13.0",
        username: isSqlite ? "" : input.username || "postgres",
      });
      return info;
    } catch (err) {
      console.error("[db] createLocalDatabase failed:", err);
      throw new ORPCError("BAD_REQUEST", {
        message: sanitizeErrorMessage(err, "Failed to create local database"),
      });
    }
  });

export const startLocalDatabase = os
  .input(idSchema)
  .handler(async ({ input }): Promise<void> => {
    try {
      await localDbManager.start(input.id);
    } catch (err) {
      throw new ORPCError("BAD_REQUEST", {
        message: sanitizeErrorMessage(err, "Failed to start local database"),
      });
    }
  });

export const stopLocalDatabase = os
  .input(idSchema)
  .handler(async ({ input }): Promise<void> => {
    try {
      await localDbManager.stop(input.id);
    } catch (err) {
      throw new ORPCError("BAD_REQUEST", {
        message: sanitizeErrorMessage(err, "Failed to stop local database"),
      });
    }
  });

export const deleteLocalDatabase = os
  .input(idSchema)
  .handler(async ({ input }): Promise<void> => {
    try {
      await localDbManager.delete(input.id);
    } catch (err) {
      throw new ORPCError("BAD_REQUEST", {
        message: sanitizeErrorMessage(err, "Failed to delete local database"),
      });
    }
  });

export const findAvailablePort = os.handler(
  async (): Promise<number> => await localDbManager.findAvailablePort()
);

// ---------------------------------------------------------------------------
// Clone to Local handlers (PostgreSQL-only, delegated to driver/runtime layer)
// ---------------------------------------------------------------------------

export const exportSchemaDdl = os
  .input(idSchema)
  .handler(async ({ input }): Promise<ExportSchemaResult> => {
    const { connStr, connection } = await resolveConnectionString(input.id);
    const driver = driverRegistry.get(resolveDbType(connection));
    const result = await driver.exportSchemaDdl(connStr);
    return {
      scripts: result.scripts as ExportSchemaResult["scripts"],
      tableRowCounts: result.tableRowCounts,
    };
  });

export const exportTableData = os
  .input(exportTableDataSchema)
  .handler(async ({ input }): Promise<ExportTableDataResult> => {
    const { connStr, connection } = await resolveConnectionString(
      input.connectionId
    );
    const driver = driverRegistry.get(resolveDbType(connection));
    return await driver.exportTableData(
      connStr,
      input.schema,
      input.table,
      input.batchSize,
      input.offset
    );
  });

export const executeBatchDdl = os
  .input(executeBatchDdlSchema)
  .handler(
    async ({
      input,
    }): Promise<{ errors: Array<{ sql: string; error: string }> }> => {
      const { connStr, connection } = await resolveConnectionString(
        input.connectionId
      );
      const driver = driverRegistry.get(resolveDbType(connection));
      return await driver.executeBatchDdl(connStr, input.statements);
    }
  );

export const waitForDatabase = os
  .input(waitForDatabaseSchema)
  .handler(async ({ input }): Promise<void> => {
    // waitForDatabase uses a connection string directly — resolve the driver from it
    let dbType: DatabaseType = "postgresql";
    try {
      const protocol = new URL(input.connectionString).protocol.toLowerCase();
      if (protocol === "mysql:") {
        dbType = "mysql";
      } else if (protocol === "mariadb:") {
        dbType = "mariadb";
      } else if (protocol === "clickhouse:" || protocol === "clickhouses:") {
        dbType = "clickhouse";
      }
    } catch {
      // default to postgresql
    }
    const driver = driverRegistry.get(dbType);
    await driver.waitForDatabase(
      input.connectionString,
      input.maxRetries,
      input.intervalMs
    );
  });

export const importTableRows = os
  .input(importTableRowsSchema)
  .handler(async ({ input }): Promise<number> => {
    const { connStr, connection } = await resolveConnectionString(
      input.connectionId
    );
    const driver = driverRegistry.get(resolveDbType(connection));
    return await driver.importTableRows(
      connStr,
      input.schema,
      input.table,
      input.columns,
      input.rows
    );
  });
export const importTableColumns = os
  .input(importTableColumnsSchema)
  .handler(async ({ input }) => {
    const { connStr, connection } = await resolveConnectionString(
      input.connectionId
    );
    const driver = driverRegistry.get(resolveDbType(connection));
    const details = await driver.getTableDetails(
      connStr,
      input.schema,
      input.table
    );
    return details.columns.map((column) => ({
      dataType: column.data_type,
      isNullable: column.is_nullable,
      name: column.name,
    }));
  });

export const importDryRun = os
  .input(importDryRunSchema)
  .handler(async ({ input }): Promise<ImportDryRunResult> => {
    const { connStr, connection } = await resolveConnectionString(
      input.connectionId
    );
    const driver = driverRegistry.get(resolveDbType(connection));
    const tableDetails = await driver.getTableDetails(
      connStr,
      input.schema,
      input.table
    );
    const tableColumns = new Map(
      tableDetails.columns.map((column) => [column.name, column])
    );
    const issues: ImportDryRunResult["issues"] = [];
    let validRows = 0;

    for (const [rowIndex, row] of input.rows.entries()) {
      let isValid = true;
      for (const columnName of input.columns) {
        const column = tableColumns.get(columnName);
        if (!column) {
          issues.push({
            message: `Unknown target column: ${columnName}`,
            rowIndex,
          });
          isValid = false;
          continue;
        }
        const value = row[columnName];
        if (
          !column.is_nullable &&
          (value === null || value === undefined || value === "")
        ) {
          issues.push({
            message: `Column ${columnName} cannot be null`,
            rowIndex,
          });
          isValid = false;
        }
      }
      if (isValid) {
        validRows += 1;
      }
    }

    return {
      invalidRows: input.rows.length - validRows,
      issues,
      validRows,
    };
  });

export const createTableFromImport = os
  .input(createTableFromImportSchema)
  .handler(async ({ input }): Promise<DdlResult> => {
    const { connStr, connection } = await resolveConnectionString(
      input.connectionId
    );
    const driver = driverRegistry.get(resolveDbType(connection));
    const sql = await driver.createTable(
      connStr,
      input.schema,
      input.table,
      input.columns.map((column) => ({
        ...column,
        isPrimaryKey: input.primaryKeyColumns?.includes(column.name),
      })),
      input.primaryKeyColumns,
      input.ifNotExists
    );
    invalidateTableCache(input.connectionId, input.schema, input.table);
    recordDdlOperation(input.connectionId, input.schema, input.table);
    return { sql };
  });

export const exportSchemaIndexes = os
  .input(exportSchemaIndexesSchema)
  .handler(async ({ input }): Promise<ExportSchemaIndexesResult> => {
    const { connStr, connection } = await resolveConnectionString(
      input.connectionId
    );
    const driver = driverRegistry.get(resolveDbType(connection));
    const schemaSummary = await driver.getSchemaSummary(connStr);
    const scopedTables = schemaSummary.tables.filter((table) => {
      if (table.schema !== input.schema) {
        return false;
      }
      return input.table ? table.name === input.table : true;
    });

    const scripts: ExportSchemaIndexesResult["scripts"] = [];
    for (const table of scopedTables) {
      const indexes = await driver.getIndexes(
        connStr,
        table.schema,
        table.name
      );
      for (const index of indexes) {
        const quotedColumns = index.columns
          .map((columnName) => `"${columnName}"`)
          .join(", ");
        const createPrefix = index.isUnique
          ? "CREATE UNIQUE INDEX"
          : "CREATE INDEX";
        const sql = `${createPrefix} "${index.name}" ON "${table.schema}"."${table.name}" (${quotedColumns});`;
        scripts.push({
          name: index.name,
          schema: table.schema,
          sql,
          type: "index",
        });
      }
    }

    return { scripts };
  });

// ---------------------------------------------------------------------------
// Schema definition handlers (enums, functions, triggers)
// ---------------------------------------------------------------------------

export const getEnums = os
  .input(schemaDefinitionInputSchema)
  .handler(async ({ input }): Promise<SchemaEnum[]> => {
    const { connStr, connection } = await resolveConnectionString(
      input.connectionId
    );
    const driver = driverRegistry.get(resolveDbType(connection));
    return await driver.getEnums(connStr, input.schema);
  });

export const getFunctions = os
  .input(schemaDefinitionInputSchema)
  .handler(async ({ input }): Promise<SchemaFunction[]> => {
    const { connStr, connection } = await resolveConnectionString(
      input.connectionId
    );
    const driver = driverRegistry.get(resolveDbType(connection));
    return await driver.getFunctions(connStr, input.schema);
  });

export const getTriggers = os
  .input(schemaDefinitionInputSchema)
  .handler(async ({ input }): Promise<SchemaTrigger[]> => {
    const { connStr, connection } = await resolveConnectionString(
      input.connectionId
    );
    const driver = driverRegistry.get(resolveDbType(connection));
    return await driver.getTriggers(connStr, input.schema);
  });

export const getSchemaConstraints = os
  .input(schemaDefinitionInputSchema)
  .handler(async ({ input }): Promise<ConstraintInfo[]> => {
    const { connStr, connection } = await resolveConnectionString(
      input.connectionId
    );
    const driver = driverRegistry.get(resolveDbType(connection));
    // Get table list for the schema, then aggregate per-table constraints
    const summary = await driver.getSchemaSummary(connStr);
    const schemaTables = summary.tables.filter(
      (t) => t.schema === input.schema
    );
    const results = await Promise.allSettled(
      schemaTables.map((t) =>
        driver.getConstraints(connStr, input.schema, t.name)
      )
    );
    return results
      .filter(
        (r): r is PromiseFulfilledResult<ConstraintInfo[]> =>
          r.status === "fulfilled"
      )
      .flatMap((r) => r.value);
  });

export const getSchemaIndexes = os
  .input(schemaDefinitionInputSchema)
  .handler(async ({ input }): Promise<IndexInfo[]> => {
    const { connStr, connection } = await resolveConnectionString(
      input.connectionId
    );
    const driver = driverRegistry.get(resolveDbType(connection));
    const summary = await driver.getSchemaSummary(connStr);
    const schemaTables = summary.tables.filter(
      (t) => t.schema === input.schema
    );
    const results = await Promise.allSettled(
      schemaTables.map((t) => driver.getIndexes(connStr, input.schema, t.name))
    );
    return results
      .filter(
        (r): r is PromiseFulfilledResult<IndexInfo[]> =>
          r.status === "fulfilled"
      )
      .flatMap((r) => r.value);
  });

// ---------------------------------------------------------------------------
// Branch handlers — local DB branching (Phase 1: PostgreSQL only)
// ---------------------------------------------------------------------------

export const listBranches = os
  .input(listBranchesSchema)
  .handler(async ({ input }): Promise<BranchInfo[]> => {
    try {
      return await localDbManager.listBranches(input.localDbId);
    } catch (err) {
      throw new ORPCError("BAD_REQUEST", {
        message: sanitizeErrorMessage(err, "Failed to list branches"),
      });
    }
  });

export const createBranch = os
  .input(createBranchSchema)
  .handler(async ({ input }): Promise<BranchInfo> => {
    try {
      return await localDbManager.createBranch({
        dataTables: input.dataTables,
        description: input.description,
        localDbId: input.localDbId,
        name: input.name,
        parentBranchId: input.parentBranchId,
      });
    } catch (err) {
      throw new ORPCError("BAD_REQUEST", {
        message: sanitizeErrorMessage(err, "Failed to create branch"),
      });
    }
  });

export const deleteBranch = os
  .input(deleteBranchSchema)
  .handler(async ({ input }): Promise<void> => {
    try {
      await localDbManager.deleteBranch(input.localDbId, input.branchId);
    } catch (err) {
      throw new ORPCError("BAD_REQUEST", {
        message: sanitizeErrorMessage(err, "Failed to delete branch"),
      });
    }
  });

export const switchBranch = os
  .input(switchBranchSchema)
  .handler(async ({ input }): Promise<BranchInfo> => {
    try {
      return await localDbManager.switchBranch(input.localDbId, input.branchId);
    } catch (err) {
      throw new ORPCError("BAD_REQUEST", {
        message: sanitizeErrorMessage(err, "Failed to switch branch"),
      });
    }
  });

export const getBranchInfo = os
  .input(getBranchInfoSchema)
  .handler(async ({ input }): Promise<BranchInfo> => {
    try {
      return await localDbManager.getBranchInfo(
        input.localDbId,
        input.branchId
      );
    } catch (err) {
      throw new ORPCError("BAD_REQUEST", {
        message: sanitizeErrorMessage(err, "Failed to get branch info"),
      });
    }
  });

export const renameBranch = os
  .input(renameBranchSchema)
  .handler(async ({ input }): Promise<BranchInfo> => {
    try {
      return await localDbManager.renameBranch(
        input.localDbId,
        input.branchId,
        input.newName
      );
    } catch (err) {
      throw new ORPCError("BAD_REQUEST", {
        message: sanitizeErrorMessage(err, "Failed to rename branch"),
      });
    }
  });

export const previewDeleteBranch = os
  .input(previewDeleteBranchSchema)
  .handler(async ({ input }): Promise<BranchDeletePreview> => {
    try {
      return await localDbManager.previewDeleteBranch(
        input.localDbId,
        input.branchId
      );
    } catch (err) {
      throw new ORPCError("BAD_REQUEST", {
        message: sanitizeErrorMessage(err, "Failed to preview branch delete"),
      });
    }
  });

export const mergeBranchSchema = os
  .input(mergeBranchSchemaSchema)
  .handler(async ({ input }): Promise<MergeBranchSchemaResult> => {
    try {
      return await localDbManager.mergeBranchSchema({
        dryRun: input.dryRun ?? false,
        localDbId: input.localDbId,
        sourceBranchId: input.sourceBranchId,
        targetBranchId: input.targetBranchId,
      });
    } catch (err) {
      throw new ORPCError("BAD_REQUEST", {
        message: sanitizeErrorMessage(err, "Failed to merge branch schema"),
      });
    }
  });
