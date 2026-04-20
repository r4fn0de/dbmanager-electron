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
import {
  exportSchemaDdl as pgExportSchemaDdl,
  exportTableData as pgExportTableData,
  executeBatchDdl as pgExecuteBatchDdl,
  waitForDatabase as pgWaitForDatabase,
  importTableRows as pgImportTableRows,
} from "./pg-client";
import {
  testConnection as testPgConnection,
  executeQuery as executePgQuery,
  getDatabaseInfo as getPgDatabaseInfo,
  getSchema as getPgSchema,
  getSchemaSummary as getPgSchemaSummary,
  getTableDetails as getPgTableDetails,
  listRows,
  buildConnectionString,
  createTable as pgCreateTable,
  dropTable as pgDropTable,
  renameTable as pgRenameTable,
  addColumn as pgAddColumn,
  dropColumn as pgDropColumn,
  renameColumn as pgRenameColumn,
  alterColumnType as pgAlterColumnType,
  setColumnNullable as pgSetColumnNullable,
  setColumnDefault as pgSetColumnDefault,
  createIndex as pgCreateIndex,
  dropIndex as pgDropIndex,
  createSchema as pgCreateSchema,
} from "./pg-client";
import { localDbManager } from "./local-db-manager";
import { randomUUID } from "crypto";

export const listConnections = os.handler(async (): Promise<Connection[]> => {
  return await loadConnections();
});

export const saveConnection = os
  .input(connectionInputSchema)
  .handler(async ({ input }): Promise<void> => {
    try {
      const connections = await loadConnections();
      const existingIndex = connections.findIndex((c) => c.id === input.id);

      const connection: Connection = {
        id: input.id || randomUUID(),
        name: input.name,
        host: input.host,
        port: input.port,
        database: input.database,
        username: input.username,
        password: input.password,
        ssl_mode: input.ssl_mode,
        url: input.url,
        is_local: input.is_local,
        connection_string: input.connection_string,
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
    return await testPgConnection({
      host: input.host,
      port: input.port,
      database: input.database,
      username: input.username,
      password: input.password,
      ssl_mode: input.ssl_mode,
      url: input.url,
    });
  });

export const getConnection = os
  .input(idSchema)
  .handler(async ({ input }): Promise<Connection | null> => {
    const connections = await loadConnections();
    return connections.find((c) => c.id === input.id) || null;
  });

export const executeQuery = os
  .input(executeQuerySchema)
  .handler(async ({ input }): Promise<QueryResult> => {
    const connections = await loadConnections();
    const connection = connections.find((c) => c.id === input.connectionId);
    if (!connection) {
      throw new Error("Connection not found");
    }
    const connStr = buildConnectionString({
      host: connection.host,
      port: connection.port,
      database: connection.database,
      username: connection.username,
      password: connection.password,
      ssl_mode: connection.ssl_mode,
      url: connection.url,
    });
    return await executePgQuery(connStr, input.sql);
  });

export const getSchema = os
  .input(idSchema)
  .handler(async ({ input }): Promise<DatabaseSchema> => {
    const connections = await loadConnections();
    const connection = connections.find((c) => c.id === input.id);
    if (!connection) {
      throw new Error("Connection not found");
    }
    const connStr = buildConnectionString({
      host: connection.host,
      port: connection.port,
      database: connection.database,
      username: connection.username,
      password: connection.password,
      ssl_mode: connection.ssl_mode,
      url: connection.url,
    });
    return await getPgSchema(connStr);
  });

export const getSchemaSummary = os
  .input(idSchema)
  .handler(async ({ input }): Promise<SchemaSummary> => {
    const connections = await loadConnections();
    const connection = connections.find((c) => c.id === input.id);
    if (!connection) {
      throw new Error("Connection not found");
    }
    const connStr = buildConnectionString({
      host: connection.host,
      port: connection.port,
      database: connection.database,
      username: connection.username,
      password: connection.password,
      ssl_mode: connection.ssl_mode,
      url: connection.url,
    });
    return await getPgSchemaSummary(connStr);
  });

export const getTableDetails = os
  .input(getTableDetailsSchema)
  .handler(async ({ input }): Promise<SchemaTableDetails> => {
    const connections = await loadConnections();
    const connection = connections.find((c) => c.id === input.connectionId);
    if (!connection) {
      throw new Error("Connection not found");
    }
    const connStr = buildConnectionString({
      host: connection.host,
      port: connection.port,
      database: connection.database,
      username: connection.username,
      password: connection.password,
      ssl_mode: connection.ssl_mode,
      url: connection.url,
    });
    return await getPgTableDetails(connStr, input.schema, input.table);
  });

export const tableListRows = os
  .input(listRowsInputSchema)
  .handler(async ({ input }): Promise<TableRowsResponse> => {
    const connections = await loadConnections();
    const connection = connections.find((c) => c.id === input.tableRef.connectionId);
    if (!connection) {
      throw new Error("Connection not found");
    }
    const connStr = buildConnectionString({
      host: connection.host,
      port: connection.port,
      database: connection.database,
      username: connection.username,
      password: connection.password,
      ssl_mode: connection.ssl_mode,
      url: connection.url,
    });
    return await listRows(
      connStr,
      input.tableRef.schema,
      input.tableRef.table,
      input.page,
      input.pageSize,
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
    const connections = await loadConnections();
    const connection = connections.find((c) => c.id === input.id);
    if (!connection) {
      throw new Error("Connection not found");
    }
    const connStr = buildConnectionString({
      host: connection.host,
      port: connection.port,
      database: connection.database,
      username: connection.username,
      password: connection.password,
      ssl_mode: connection.ssl_mode,
      url: connection.url,
    });
    return await getPgDatabaseInfo(connStr);
  });

// DDL Handlers
export const createTable = os
  .input(createTableInputSchema)
  .handler(async ({ input }): Promise<DdlResult> => {
    const connections = await loadConnections();
    const connection = connections.find((c) => c.id === input.connectionId);
    if (!connection) {
      throw new Error("Connection not found");
    }
    const connStr = buildConnectionString({
      host: connection.host,
      port: connection.port,
      database: connection.database,
      username: connection.username,
      password: connection.password,
      ssl_mode: connection.ssl_mode,
      url: connection.url,
    });
    const sql = await pgCreateTable(
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
    const connections = await loadConnections();
    const connection = connections.find((c) => c.id === input.connectionId);
    if (!connection) {
      throw new Error("Connection not found");
    }
    const connStr = buildConnectionString({
      host: connection.host,
      port: connection.port,
      database: connection.database,
      username: connection.username,
      password: connection.password,
      ssl_mode: connection.ssl_mode,
      url: connection.url,
    });
    await pgDropTable(connStr, input.schema, input.name, input.cascade, input.ifExists);
    return { sql: `DROP TABLE "${input.schema}"."${input.name}"` };
  });

export const renameTable = os
  .input(renameTableInputSchema)
  .handler(async ({ input }): Promise<DdlResult> => {
    const connections = await loadConnections();
    const connection = connections.find((c) => c.id === input.connectionId);
    if (!connection) {
      throw new Error("Connection not found");
    }
    const connStr = buildConnectionString({
      host: connection.host,
      port: connection.port,
      database: connection.database,
      username: connection.username,
      password: connection.password,
      ssl_mode: connection.ssl_mode,
      url: connection.url,
    });
    await pgRenameTable(connStr, input.schema, input.oldName, input.newName);
    return { sql: `ALTER TABLE "${input.schema}"."${input.oldName}" RENAME TO "${input.newName}"` };
  });

export const addColumn = os
  .input(addColumnInputSchema)
  .handler(async ({ input }): Promise<DdlResult> => {
    const connections = await loadConnections();
    const connection = connections.find((c) => c.id === input.connectionId);
    if (!connection) {
      throw new Error("Connection not found");
    }
    const connStr = buildConnectionString({
      host: connection.host,
      port: connection.port,
      database: connection.database,
      username: connection.username,
      password: connection.password,
      ssl_mode: connection.ssl_mode,
      url: connection.url,
    });
    await pgAddColumn(
      connStr,
      input.schema,
      input.table,
      input.column.name,
      input.column.dataType,
      input.column.isNullable,
      input.column.defaultExpr,
      input.ifNotExists,
    );
    return { sql: `ALTER TABLE "${input.schema}"."${input.table}" ADD COLUMN "${input.column.name}" ${input.column.dataType}` };
  });

export const dropColumn = os
  .input(dropColumnInputSchema)
  .handler(async ({ input }): Promise<DdlResult> => {
    const connections = await loadConnections();
    const connection = connections.find((c) => c.id === input.connectionId);
    if (!connection) {
      throw new Error("Connection not found");
    }
    const connStr = buildConnectionString({
      host: connection.host,
      port: connection.port,
      database: connection.database,
      username: connection.username,
      password: connection.password,
      ssl_mode: connection.ssl_mode,
      url: connection.url,
    });
    await pgDropColumn(connStr, input.schema, input.table, input.column, input.cascade, input.ifExists);
    return { sql: `ALTER TABLE "${input.schema}"."${input.table}" DROP COLUMN "${input.column}"` };
  });

export const renameColumn = os
  .input(renameColumnInputSchema)
  .handler(async ({ input }): Promise<DdlResult> => {
    const connections = await loadConnections();
    const connection = connections.find((c) => c.id === input.connectionId);
    if (!connection) {
      throw new Error("Connection not found");
    }
    const connStr = buildConnectionString({
      host: connection.host,
      port: connection.port,
      database: connection.database,
      username: connection.username,
      password: connection.password,
      ssl_mode: connection.ssl_mode,
      url: connection.url,
    });
    await pgRenameColumn(connStr, input.schema, input.table, input.oldName, input.newName);
    return { sql: `ALTER TABLE "${input.schema}"."${input.table}" RENAME COLUMN "${input.oldName}" TO "${input.newName}"` };
  });

export const alterColumnType = os
  .input(alterColumnTypeInputSchema)
  .handler(async ({ input }): Promise<DdlResult> => {
    const connections = await loadConnections();
    const connection = connections.find((c) => c.id === input.connectionId);
    if (!connection) {
      throw new Error("Connection not found");
    }
    const connStr = buildConnectionString({
      host: connection.host,
      port: connection.port,
      database: connection.database,
      username: connection.username,
      password: connection.password,
      ssl_mode: connection.ssl_mode,
      url: connection.url,
    });
    await pgAlterColumnType(connStr, input.schema, input.table, input.column, input.newType, input.usingExpr);
    return { sql: `ALTER TABLE "${input.schema}"."${input.table}" ALTER COLUMN "${input.column}" TYPE ${input.newType}` };
  });

export const setColumnNullable = os
  .input(setColumnNullableInputSchema)
  .handler(async ({ input }): Promise<DdlResult> => {
    const connections = await loadConnections();
    const connection = connections.find((c) => c.id === input.connectionId);
    if (!connection) {
      throw new Error("Connection not found");
    }
    const connStr = buildConnectionString({
      host: connection.host,
      port: connection.port,
      database: connection.database,
      username: connection.username,
      password: connection.password,
      ssl_mode: connection.ssl_mode,
      url: connection.url,
    });
    await pgSetColumnNullable(connStr, input.schema, input.table, input.column, input.isNullable);
    return { sql: `ALTER TABLE "${input.schema}"."${input.table}" ALTER COLUMN "${input.column}" ${input.isNullable ? "DROP NOT NULL" : "SET NOT NULL"}` };
  });

export const setColumnDefault = os
  .input(setColumnDefaultInputSchema)
  .handler(async ({ input }): Promise<DdlResult> => {
    const connections = await loadConnections();
    const connection = connections.find((c) => c.id === input.connectionId);
    if (!connection) {
      throw new Error("Connection not found");
    }
    const connStr = buildConnectionString({
      host: connection.host,
      port: connection.port,
      database: connection.database,
      username: connection.username,
      password: connection.password,
      ssl_mode: connection.ssl_mode,
      url: connection.url,
    });
    await pgSetColumnDefault(connStr, input.schema, input.table, input.column, input.defaultExpr);
    return { sql: input.defaultExpr
      ? `ALTER TABLE "${input.schema}"."${input.table}" ALTER COLUMN "${input.column}" SET DEFAULT ${input.defaultExpr}`
      : `ALTER TABLE "${input.schema}"."${input.table}" ALTER COLUMN "${input.column}" DROP DEFAULT`
    };
  });

export const createIndex = os
  .input(createIndexInputSchema)
  .handler(async ({ input }): Promise<DdlResult> => {
    const connections = await loadConnections();
    const connection = connections.find((c) => c.id === input.connectionId);
    if (!connection) {
      throw new Error("Connection not found");
    }
    const connStr = buildConnectionString({
      host: connection.host,
      port: connection.port,
      database: connection.database,
      username: connection.username,
      password: connection.password,
      ssl_mode: connection.ssl_mode,
      url: connection.url,
    });
    const indexName = input.name || `${input.table}_${input.columns.join("_")}_idx`;
    await pgCreateIndex(connStr, input.schema, input.table, indexName, input.columns, input.unique, input.ifNotExists);
    return { sql: `CREATE INDEX ${indexName} ON "${input.schema}"."${input.table}" (${input.columns.join(", ")})` };
  });

export const dropIndex = os
  .input(dropIndexInputSchema)
  .handler(async ({ input }): Promise<DdlResult> => {
    const connections = await loadConnections();
    const connection = connections.find((c) => c.id === input.connectionId);
    if (!connection) {
      throw new Error("Connection not found");
    }
    const connStr = buildConnectionString({
      host: connection.host,
      port: connection.port,
      database: connection.database,
      username: connection.username,
      password: connection.password,
      ssl_mode: connection.ssl_mode,
      url: connection.url,
    });
    await pgDropIndex(connStr, input.schema, input.name, input.cascade, input.ifExists);
    return { sql: `DROP INDEX "${input.schema}"."${input.name}"` };
  });

export const createSchema = os
  .input(createSchemaInputSchema)
  .handler(async ({ input }): Promise<DdlResult> => {
    const connections = await loadConnections();
    const connection = connections.find((c) => c.id === input.connectionId);
    if (!connection) {
      throw new Error("Connection not found");
    }
    const connStr = buildConnectionString({
      host: connection.host,
      port: connection.port,
      database: connection.database,
      username: connection.username,
      password: connection.password,
      ssl_mode: connection.ssl_mode,
      url: connection.url,
    });
    await pgCreateSchema(connStr, input.name, input.ifNotExists);
    return { sql: `CREATE SCHEMA "${input.name}"` };
  });

// Local DB Handlers
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
    await localDbManager.start(input.id);
  });

export const stopLocalDatabase = os
  .input(idSchema)
  .handler(async ({ input }): Promise<void> => {
    await localDbManager.stop(input.id);
  });

export const deleteLocalDatabase = os
  .input(idSchema)
  .handler(async ({ input }): Promise<void> => {
    await localDbManager.delete(input.id);
  });

export const findAvailablePort = os.handler(async (): Promise<number> => {
  return await localDbManager.findAvailablePort();
});

// Clone to Local Handlers
export const exportSchemaDdl = os
  .input(idSchema)
  .handler(async ({ input }): Promise<ExportSchemaResult> => {
    const connections = await loadConnections();
    const connection = connections.find((c) => c.id === input.id);
    if (!connection) {
      throw new Error("Connection not found");
    }
    const connStr = buildConnectionString({
      host: connection.host,
      port: connection.port,
      database: connection.database,
      username: connection.username,
      password: connection.password,
      ssl_mode: connection.ssl_mode,
      url: connection.url,
    });
    const result = await pgExportSchemaDdl(connStr);
    return {
      scripts: result.scripts as ExportSchemaResult["scripts"],
      tableRowCounts: result.tableRowCounts,
    };
  });

export const exportTableData = os
  .input(exportTableDataSchema)
  .handler(async ({ input }): Promise<ExportTableDataResult> => {
    const connections = await loadConnections();
    const connection = connections.find((c) => c.id === input.connectionId);
    if (!connection) {
      throw new Error("Connection not found");
    }
    const connStr = buildConnectionString({
      host: connection.host,
      port: connection.port,
      database: connection.database,
      username: connection.username,
      password: connection.password,
      ssl_mode: connection.ssl_mode,
      url: connection.url,
    });
    return await pgExportTableData(
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
    const connections = await loadConnections();
    const connection = connections.find((c) => c.id === input.connectionId);
    if (!connection) {
      throw new Error("Connection not found");
    }
    const connStr = buildConnectionString({
      host: connection.host,
      port: connection.port,
      database: connection.database,
      username: connection.username,
      password: connection.password,
      ssl_mode: connection.ssl_mode,
      url: connection.url,
    });
    return await pgExecuteBatchDdl(connStr, input.statements);
  });

export const waitForDatabase = os
  .input(waitForDatabaseSchema)
  .handler(async ({ input }): Promise<void> => {
    await pgWaitForDatabase(
      input.connectionString,
      input.maxRetries,
      input.intervalMs,
    );
  });

export const importTableRows = os
  .input(importTableRowsSchema)
  .handler(async ({ input }): Promise<number> => {
    const connections = await loadConnections();
    const connection = connections.find((c) => c.id === input.connectionId);
    if (!connection) {
      throw new Error("Connection not found");
    }
    const connStr = buildConnectionString({
      host: connection.host,
      port: connection.port,
      database: connection.database,
      username: connection.username,
      password: connection.password,
      ssl_mode: connection.ssl_mode,
      url: connection.url,
    });
    return await pgImportTableRows(
      connStr,
      input.schema,
      input.table,
      input.columns,
      input.rows,
    );
  });
