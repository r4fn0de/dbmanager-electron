import { ORPCError, os } from "@orpc/server";
import type {
  Connection,
  LocalDbInfo,
  QueryResult,
  DatabaseSchema,
  SchemaSummary,
  SchemaTableDetails,
  TableRowsResponse,
  SaveChangesResponse,
  FkLookupResponse,
  DatabaseInfo,
  DdlResult,
  ExportSchemaResult,
  ExportTableDataResult,
} from "./types";
import {
  connectionInputSchema,
  executeQuerySchema,
  getTableDetailsSchema,
  listRowsInputSchema,
  saveChangesInputSchema,
  fkLookupInputSchema,
  tableTruncateSchema,
  createTableInputSchema,
  dropTableInputSchema,
  renameTableInputSchema,
  addColumnInputSchema,
  dropColumnInputSchema,
  renameColumnInputSchema,
  alterColumnTypeInputSchema,
  setColumnNullableInputSchema,
  setColumnDefaultInputSchema,
  createIndexInputSchema,
  dropIndexInputSchema,
  createSchemaInputSchema,
  idSchema,
  createLocalDatabaseSchema,
  exportTableDataSchema,
  executeBatchDdlSchema,
  importTableRowsSchema,
  waitForDatabaseSchema,
} from "./schemas";
import {
  loadConnections,
  saveConnections,
} from "./connection-store";
import { LOCAL_DB_DEFAULT_PASSWORD } from "./constants";
import { driverRegistry } from "./registry";
import { localDbManager } from "./local-db-manager";
import { randomUUID } from "crypto";
import type { DriverConnectionConfig } from "./driver";
import type { DatabaseType } from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve the db_type for a connection, defaulting to postgresql. */
function resolveDbType(connection: Partial<Connection>): DatabaseType {
  return (connection as Connection).db_type || "postgresql";
}

/** Derive a DriverConnectionConfig from a Connection. */
function toDriverConfig(connection: Partial<Connection>): DriverConnectionConfig {
  const dbType = resolveDbType(connection);
  const driver = driverRegistry.get(dbType);
  return {
    host: connection.host ?? "",
    port: connection.port ?? driver.defaultPort,
    database: connection.database ?? driver.defaultDatabase,
    username: connection.username ?? driver.defaultUsername,
    password: connection.password ?? "",
    ssl_mode: connection.ssl_mode ?? "prefer",
    url: connection.url,
  };
}

/** Load a connection by ID and build its connection string via the driver. */
async function resolveConnectionString(connectionId: string): Promise<{ connection: Connection; connStr: string }> {
  const connections = await loadConnections();
  const connection = connections.find((c) => c.id === connectionId);
  if (!connection) {
    throw new Error("Connection not found");
  }
  const dbType = resolveDbType(connection);
  const driver = driverRegistry.get(dbType);
  const connStr = driver.buildConnectionString(toDriverConfig(connection));
  return { connection, connStr };
}

// ---------------------------------------------------------------------------
// Connection handlers
// ---------------------------------------------------------------------------

export const listConnections = os.handler(async (): Promise<Connection[]> => {
  return await loadConnections();
});

export const saveConnection = os
  .input(connectionInputSchema)
  .handler(async ({ input }): Promise<void> => {
    try {
      const connections = await loadConnections();
      const existingIndex = connections.findIndex((c) => c.id === input.id);

      const dbType: DatabaseType = input.db_type || "postgresql";
      const driver = driverRegistry.get(dbType);

      const connection: Connection = {
        id: input.id || randomUUID(),
        name: input.name,
        db_type: dbType,
        host: input.host,
        port: input.port,
        database: input.database,
        username: input.username,
        password: input.password,
        ssl_mode: input.ssl_mode,
        url: input.url,
        is_local: input.is_local,
        connection_string: input.connection_string,
        engine_version: input.engine_version,
        // Backward compat: persist postgres_version if it was provided
        postgres_version: input.postgres_version,
        tag: input.tag,
        color: input.color,
        local_auto_start: input.local_auto_start,
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
        message:
          err instanceof Error
            ? err.message
            : "Failed to save connection",
      });
    }
  });

export const deleteConnection = os
  .input(idSchema)
  .handler(async ({ input }): Promise<void> => {
    const connections = await loadConnections();
    const filtered = connections.filter((c) => c.id !== input.id);
    await saveConnections(filtered);
  });

export const testConnection = os
  .input(connectionInputSchema)
  .handler(async ({ input }): Promise<boolean> => {
    const dbType: DatabaseType = input.db_type || "postgresql";
    const driver = driverRegistry.get(dbType);
    return await driver.testConnection(toDriverConfig(input));
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

export const executeQuery = os
  .input(executeQuerySchema)
  .handler(async ({ input }): Promise<QueryResult> => {
    const { connStr, connection } = await resolveConnectionString(input.connectionId);
    const driver = driverRegistry.get(resolveDbType(connection));
    return await driver.executeQuery(connStr, input.sql);
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
    const { connStr, connection } = await resolveConnectionString(input.id);
    const driver = driverRegistry.get(resolveDbType(connection));
    return await driver.getSchemaSummary(connStr);
  });

export const getTableDetails = os
  .input(getTableDetailsSchema)
  .handler(async ({ input }): Promise<SchemaTableDetails> => {
    const { connStr, connection } = await resolveConnectionString(input.connectionId);
    const driver = driverRegistry.get(resolveDbType(connection));
    return await driver.getTableDetails(connStr, input.schema, input.table);
  });

export const tableListRows = os
  .input(listRowsInputSchema)
  .handler(async ({ input }): Promise<TableRowsResponse> => {
    const { connStr, connection } = await resolveConnectionString(input.tableRef.connectionId);
    const driver = driverRegistry.get(resolveDbType(connection));
    return await driver.listRows(
      connStr,
      input.tableRef.schema,
      input.tableRef.table,
      input.page,
      input.pageSize,
      input.sort,
      input.filters,
    );
  });

export const tableSaveChanges = os
  .input(saveChangesInputSchema)
  .handler(async ({ input }): Promise<SaveChangesResponse> => {
    console.log("Save changes:", input);
    return { inserted: 0, updated: 0, deleted: 0 };
  });

export const tableTruncate = os
  .input(tableTruncateSchema)
  .handler(async ({ input }): Promise<void> => {
    console.log("Truncate table:", input.tableRef);
  });

export const tableFkLookup = os
  .input(fkLookupInputSchema)
  .handler(async ({ input }): Promise<FkLookupResponse> => {
    console.log("FK lookup:", input);
    return { options: [], hasMore: false };
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
    const { connStr, connection } = await resolveConnectionString(input.connectionId);
    const driver = driverRegistry.get(resolveDbType(connection));
    const sql = await driver.createTable(
      connStr,
      input.schema,
      input.name,
      input.columns,
      input.primaryKeyColumns,
      input.ifNotExists,
    );
    return { sql };
  });

export const dropTable = os
  .input(dropTableInputSchema)
  .handler(async ({ input }): Promise<DdlResult> => {
    const { connStr, connection } = await resolveConnectionString(input.connectionId);
    const driver = driverRegistry.get(resolveDbType(connection));
    const sql = await driver.dropTable(connStr, input.schema, input.name, input.cascade, input.ifExists);
    return { sql };
  });

export const renameTable = os
  .input(renameTableInputSchema)
  .handler(async ({ input }): Promise<DdlResult> => {
    const { connStr, connection } = await resolveConnectionString(input.connectionId);
    const driver = driverRegistry.get(resolveDbType(connection));
    const sql = await driver.renameTable(connStr, input.schema, input.oldName, input.newName);
    return { sql };
  });

export const addColumn = os
  .input(addColumnInputSchema)
  .handler(async ({ input }): Promise<DdlResult> => {
    const { connStr, connection } = await resolveConnectionString(input.connectionId);
    const driver = driverRegistry.get(resolveDbType(connection));
    const sql = await driver.addColumn(
      connStr,
      input.schema,
      input.table,
      input.column.name,
      input.column.dataType,
      input.column.isNullable,
      input.column.defaultExpr,
      input.ifNotExists,
    );
    return { sql };
  });

export const dropColumn = os
  .input(dropColumnInputSchema)
  .handler(async ({ input }): Promise<DdlResult> => {
    const { connStr, connection } = await resolveConnectionString(input.connectionId);
    const driver = driverRegistry.get(resolveDbType(connection));
    const sql = await driver.dropColumn(connStr, input.schema, input.table, input.column, input.cascade, input.ifExists);
    return { sql };
  });

export const renameColumn = os
  .input(renameColumnInputSchema)
  .handler(async ({ input }): Promise<DdlResult> => {
    const { connStr, connection } = await resolveConnectionString(input.connectionId);
    const driver = driverRegistry.get(resolveDbType(connection));
    const sql = await driver.renameColumn(connStr, input.schema, input.table, input.oldName, input.newName);
    return { sql };
  });

export const alterColumnType = os
  .input(alterColumnTypeInputSchema)
  .handler(async ({ input }): Promise<DdlResult> => {
    const { connStr, connection } = await resolveConnectionString(input.connectionId);
    const driver = driverRegistry.get(resolveDbType(connection));
    const sql = await driver.alterColumnType(connStr, input.schema, input.table, input.column, input.newType, input.usingExpr);
    return { sql };
  });

export const setColumnNullable = os
  .input(setColumnNullableInputSchema)
  .handler(async ({ input }): Promise<DdlResult> => {
    const { connStr, connection } = await resolveConnectionString(input.connectionId);
    const driver = driverRegistry.get(resolveDbType(connection));
    const sql = await driver.setColumnNullable(connStr, input.schema, input.table, input.column, input.isNullable);
    return { sql };
  });

export const setColumnDefault = os
  .input(setColumnDefaultInputSchema)
  .handler(async ({ input }): Promise<DdlResult> => {
    const { connStr, connection } = await resolveConnectionString(input.connectionId);
    const driver = driverRegistry.get(resolveDbType(connection));
    const sql = await driver.setColumnDefault(connStr, input.schema, input.table, input.column, input.defaultExpr);
    return { sql };
  });

export const createIndex = os
  .input(createIndexInputSchema)
  .handler(async ({ input }): Promise<DdlResult> => {
    const { connStr, connection } = await resolveConnectionString(input.connectionId);
    const driver = driverRegistry.get(resolveDbType(connection));
    const indexName = input.name || `${input.table}_${input.columns.join("_")}_idx`;
    const sql = await driver.createIndex(connStr, input.schema, input.table, indexName, input.columns, input.unique, input.ifNotExists);
    return { sql };
  });

export const dropIndex = os
  .input(dropIndexInputSchema)
  .handler(async ({ input }): Promise<DdlResult> => {
    const { connStr, connection } = await resolveConnectionString(input.connectionId);
    const driver = driverRegistry.get(resolveDbType(connection));
    const sql = await driver.dropIndex(connStr, input.schema, input.name, input.cascade, input.ifExists);
    return { sql };
  });

export const createSchema = os
  .input(createSchemaInputSchema)
  .handler(async ({ input }): Promise<DdlResult> => {
    const { connStr, connection } = await resolveConnectionString(input.connectionId);
    const driver = driverRegistry.get(resolveDbType(connection));
    const sql = await driver.createSchema(connStr, input.name, input.ifNotExists);
    return { sql };
  });

// ---------------------------------------------------------------------------
// Local DB handlers (PostgreSQL-only, unchanged)
// ---------------------------------------------------------------------------

export const listLocalDatabases = os.handler(async (): Promise<LocalDbInfo[]> => {
  return await localDbManager.list();
});

export const createLocalDatabase = os
  .input(createLocalDatabaseSchema)
  .handler(async ({ input }): Promise<LocalDbInfo> => {
    try {
      const password = input.password?.trim() || LOCAL_DB_DEFAULT_PASSWORD;
      return await localDbManager.create({
        name: input.name,
        databaseName: input.databaseName || "postgres",
        username: input.username || "postgres",
        password,
        port: input.port || 5432,
        postgresVersion: input.postgresVersion || "16.13.0",
        autoStart: input.autoStart ?? true,
      });
    } catch (err) {
      console.error("[db] createLocalDatabase failed:", err);
      throw new ORPCError("BAD_REQUEST", {
        message:
          err instanceof Error
            ? err.message
            : "Failed to create local database",
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
        message:
          err instanceof Error
            ? err.message
            : "Failed to start local database",
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
        message:
          err instanceof Error
            ? err.message
            : "Failed to stop local database",
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
        message:
          err instanceof Error
            ? err.message
            : "Failed to delete local database",
      });
    }
  });

export const findAvailablePort = os.handler(async (): Promise<number> => {
  return await localDbManager.findAvailablePort();
});

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
    const { connStr, connection } = await resolveConnectionString(input.connectionId);
    const driver = driverRegistry.get(resolveDbType(connection));
    return await driver.exportTableData(
      connStr,
      input.schema,
      input.table,
      input.batchSize,
      input.offset,
    );
  });

export const executeBatchDdl = os
  .input(executeBatchDdlSchema)
  .handler(async ({ input }): Promise<{ errors: Array<{ sql: string; error: string }> }> => {
    const { connStr, connection } = await resolveConnectionString(input.connectionId);
    const driver = driverRegistry.get(resolveDbType(connection));
    return await driver.executeBatchDdl(connStr, input.statements);
  });

export const waitForDatabase = os
  .input(waitForDatabaseSchema)
  .handler(async ({ input }): Promise<void> => {
    // waitForDatabase uses a connection string directly — resolve the driver from it
    let dbType: DatabaseType = "postgresql";
    try {
      const protocol = new URL(input.connectionString).protocol.toLowerCase();
      if (protocol === "mysql:") dbType = "mysql";
      else if (protocol === "mariadb:") dbType = "mariadb";
      else if (protocol === "clickhouse:" || protocol === "clickhouses:") dbType = "clickhouse";
    } catch {
      // default to postgresql
    }
    const driver = driverRegistry.get(dbType);
    await driver.waitForDatabase(
      input.connectionString,
      input.maxRetries,
      input.intervalMs,
    );
  });

export const importTableRows = os
  .input(importTableRowsSchema)
  .handler(async ({ input }): Promise<number> => {
    const { connStr, connection } = await resolveConnectionString(input.connectionId);
    const driver = driverRegistry.get(resolveDbType(connection));
    return await driver.importTableRows(
      connStr,
      input.schema,
      input.table,
      input.columns,
      input.rows,
    );
  });
