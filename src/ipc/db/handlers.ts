import { os } from "@orpc/server";
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
} from "./schemas";
import {
  loadConnections,
  saveConnections,
} from "./connection-store";
import {
  testConnection as testPgConnection,
  executeQuery as executePgQuery,
  getDatabaseInfo as getPgDatabaseInfo,
  getSchema as getPgSchema,
  getSchemaSummary as getPgSchemaSummary,
  getTableDetails as getPgTableDetails,
  listRows,
  buildConnectionString,
} from "./pg-client";
import { randomUUID } from "crypto";

export const listConnections = os.handler(async (): Promise<Connection[]> => {
  return await loadConnections();
});

export const saveConnection = os
  .input(connectionInputSchema)
  .handler(async ({ input }): Promise<void> => {
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
    console.log("Create table:", input);
    return { sql: "" };
  });

export const dropTable = os
  .input(dropTableInputSchema)
  .handler(async ({ input }): Promise<DdlResult> => {
    console.log("Drop table:", input);
    return { sql: "" };
  });

export const renameTable = os
  .input(renameTableInputSchema)
  .handler(async ({ input }): Promise<DdlResult> => {
    console.log("Rename table:", input);
    return { sql: "" };
  });

export const addColumn = os
  .input(addColumnInputSchema)
  .handler(async ({ input }): Promise<DdlResult> => {
    console.log("Add column:", input);
    return { sql: "" };
  });

export const dropColumn = os
  .input(dropColumnInputSchema)
  .handler(async ({ input }): Promise<DdlResult> => {
    console.log("Drop column:", input);
    return { sql: "" };
  });

export const renameColumn = os
  .input(renameColumnInputSchema)
  .handler(async ({ input }): Promise<DdlResult> => {
    console.log("Rename column:", input);
    return { sql: "" };
  });

export const alterColumnType = os
  .input(alterColumnTypeInputSchema)
  .handler(async ({ input }): Promise<DdlResult> => {
    console.log("Alter column type:", input);
    return { sql: "" };
  });

export const setColumnNullable = os
  .input(setColumnNullableInputSchema)
  .handler(async ({ input }): Promise<DdlResult> => {
    console.log("Set column nullable:", input);
    return { sql: "" };
  });

export const setColumnDefault = os
  .input(setColumnDefaultInputSchema)
  .handler(async ({ input }): Promise<DdlResult> => {
    console.log("Set column default:", input);
    return { sql: "" };
  });

export const createIndex = os
  .input(createIndexInputSchema)
  .handler(async ({ input }): Promise<DdlResult> => {
    console.log("Create index:", input);
    return { sql: "" };
  });

export const dropIndex = os
  .input(dropIndexInputSchema)
  .handler(async ({ input }): Promise<DdlResult> => {
    console.log("Drop index:", input);
    return { sql: "" };
  });

export const createSchema = os
  .input(createSchemaInputSchema)
  .handler(async ({ input }): Promise<DdlResult> => {
    console.log("Create schema:", input);
    return { sql: "" };
  });

// Local DB Handlers
export const listLocalDatabases = os.handler(async (): Promise<LocalDbInfo[]> => {
  return [];
});

export const createLocalDatabase = os
  .input(createLocalDatabaseSchema)
  .handler(async ({ input }): Promise<LocalDbInfo> => {
    console.log("Create local DB:", input);
    throw new Error("Not implemented");
  });

export const startLocalDatabase = os
  .input(idSchema)
  .handler(async ({ input }): Promise<void> => {
    console.log("Start local DB:", input.id);
  });

export const stopLocalDatabase = os
  .input(idSchema)
  .handler(async ({ input }): Promise<void> => {
    console.log("Stop local DB:", input.id);
  });

export const deleteLocalDatabase = os
  .input(idSchema)
  .handler(async ({ input }): Promise<void> => {
    console.log("Delete local DB:", input.id);
  });
