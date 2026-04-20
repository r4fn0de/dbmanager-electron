import { useCallback, useEffect, useState } from "react";
import { ipc } from "@/ipc/manager";
import type {
  AddColumnInput,
  AlterColumnTypeInput,
  Connection,
  ConnectionInput,
  CreateIndexInput,
  CreateSchemaInput,
  CreateTableInput,
  DatabaseInfo,
  DatabaseSchema,
  DdlResult,
  DropColumnInput,
  DropIndexInput,
  DropTableInput,
  FkLookupInput,
  FkLookupResponse,
  ListRowsInput,
  QueryResult,
  RenameColumnInput,
  RenameTableInput,
  SaveChangesInput,
  SaveChangesResponse,
  SchemaSummary,
  SchemaTableDetails,
  SetColumnDefaultInput,
  SetColumnNullableInput,
  TableRef,
  TableRowsResponse,
} from "@/ipc/db/types";

interface UseConnectionsReturn {
  connections: Connection[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  saveConnection: (connection: ConnectionInput) => Promise<void>;
  deleteConnection: (
    id: string,
    options?: { refresh?: boolean },
  ) => Promise<void>;
  testConnection: (connection: ConnectionInput) => Promise<boolean>;
  getConnection: (id: string) => Promise<Connection | null>;
  executeQuery: (connectionId: string, sql: string) => Promise<QueryResult>;
  getSchema: (connectionId: string) => Promise<DatabaseSchema>;
  getSchemaSummary: (connectionId: string) => Promise<SchemaSummary>;
  getTableDetails: (
    connectionId: string,
    schema: string,
    table: string,
  ) => Promise<SchemaTableDetails>;
  tableListRows: (input: ListRowsInput) => Promise<TableRowsResponse>;
  tableSaveChanges: (input: SaveChangesInput) => Promise<SaveChangesResponse>;
  tableTruncate: (tableRef: TableRef) => Promise<void>;
  tableFkLookup: (input: FkLookupInput) => Promise<FkLookupResponse>;
  getDatabaseInfo: (connectionId: string) => Promise<DatabaseInfo>;
  // DDL
  createTable: (input: CreateTableInput) => Promise<DdlResult>;
  dropTable: (input: DropTableInput) => Promise<DdlResult>;
  renameTable: (input: RenameTableInput) => Promise<DdlResult>;
  addColumn: (input: AddColumnInput) => Promise<DdlResult>;
  dropColumn: (input: DropColumnInput) => Promise<DdlResult>;
  renameColumn: (input: RenameColumnInput) => Promise<DdlResult>;
  alterColumnType: (input: AlterColumnTypeInput) => Promise<DdlResult>;
  setColumnNullable: (input: SetColumnNullableInput) => Promise<DdlResult>;
  setColumnDefault: (input: SetColumnDefaultInput) => Promise<DdlResult>;
  createIndex: (input: CreateIndexInput) => Promise<DdlResult>;
  dropIndex: (input: DropIndexInput) => Promise<DdlResult>;
  createSchema: (input: CreateSchemaInput) => Promise<DdlResult>;
}

export function useConnections(): UseConnectionsReturn {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchConnections = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await ipc.client.db.listConnections();
      setConnections(result);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to fetch connections",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConnections().catch((err: Error) => setError(err.message));
  }, [fetchConnections]);

  const saveConnection = useCallback(
    async (connection: ConnectionInput) => {
      try {
        await ipc.client.db.saveConnection({ ...connection });
        await fetchConnections();
      } catch (err) {
        throw new Error(
          err instanceof Error ? err.message : "Failed to save connection",
        );
      }
    },
    [fetchConnections],
  );

  const deleteConnection = useCallback(
    async (id: string, options?: { refresh?: boolean }) => {
      try {
        await ipc.client.db.deleteConnection({ id });
        if (options?.refresh ?? true) {
          await fetchConnections();
        }
      } catch (err) {
        throw new Error(
          err instanceof Error ? err.message : "Failed to delete connection",
        );
      }
    },
    [fetchConnections],
  );

  const testConnection = useCallback(
    async (connection: ConnectionInput): Promise<boolean> => {
      try {
        return await ipc.client.db.testConnection({ ...connection });
      } catch (err) {
        throw new Error(
          err instanceof Error ? err.message : "Connection test failed",
        );
      }
    },
    [],
  );

  const getConnection = useCallback(
    async (id: string): Promise<Connection | null> => {
      try {
        return await ipc.client.db.getConnection({ id });
      } catch {
        return null;
      }
    },
    [],
  );

  const executeQuery = useCallback(
    async (connectionId: string, sql: string): Promise<QueryResult> => {
      try {
        return await ipc.client.db.executeQuery({ connectionId, sql });
      } catch (err) {
        throw new Error(
          err instanceof Error ? err.message : "Query execution failed",
        );
      }
    },
    [],
  );

  const getSchema = useCallback(
    async (connectionId: string): Promise<DatabaseSchema> => {
      try {
        return await ipc.client.db.getSchema({ id: connectionId });
      } catch (err) {
        throw new Error(
          err instanceof Error ? err.message : "Failed to fetch schema",
        );
      }
    },
    [],
  );

  const getSchemaSummary = useCallback(
    async (connectionId: string): Promise<SchemaSummary> => {
      try {
        return await ipc.client.db.getSchemaSummary({ id: connectionId });
      } catch (err) {
        throw new Error(
          err instanceof Error ? err.message : "Failed to fetch schema summary",
        );
      }
    },
    [],
  );

  const getTableDetails = useCallback(
    async (
      connectionId: string,
      schema: string,
      table: string,
    ): Promise<SchemaTableDetails> => {
      try {
        return await ipc.client.db.getTableDetails({ connectionId, schema, table });
      } catch (err) {
        throw new Error(
          err instanceof Error ? err.message : "Failed to fetch table details",
        );
      }
    },
    [],
  );

  const tableListRows = useCallback(
    async (input: ListRowsInput): Promise<TableRowsResponse> => {
      try {
        return await ipc.client.db.tableListRows({ ...input });
      } catch (err) {
        throw new Error(
          err instanceof Error ? err.message : "Failed to list table rows",
        );
      }
    },
    [],
  );

  const tableSaveChanges = useCallback(
    async (input: SaveChangesInput): Promise<SaveChangesResponse> => {
      try {
        return await ipc.client.db.tableSaveChanges({ ...input });
      } catch (err) {
        throw new Error(
          err instanceof Error ? err.message : "Failed to save table changes",
        );
      }
    },
    [],
  );

  const tableTruncate = useCallback(
    async (tableRef: TableRef): Promise<void> => {
      try {
        await ipc.client.db.tableTruncate({ tableRef });
      } catch (err) {
        throw new Error(
          err instanceof Error ? err.message : "Failed to truncate table",
        );
      }
    },
    [],
  );

  const tableFkLookup = useCallback(
    async (input: FkLookupInput): Promise<FkLookupResponse> => {
      try {
        return await ipc.client.db.tableFkLookup({ ...input });
      } catch (err) {
        throw new Error(
          err instanceof Error ? err.message : "Failed to lookup foreign keys",
        );
      }
    },
    [],
  );

  const getDatabaseInfo = useCallback(
    async (connectionId: string): Promise<DatabaseInfo> => {
      try {
        return await ipc.client.db.getDatabaseInfo({ id: connectionId });
      } catch (err) {
        throw new Error(
          err instanceof Error ? err.message : "Failed to fetch database info",
        );
      }
    },
    [],
  );

  // DDL wrappers
  const createTable = useCallback(
    async (input: CreateTableInput): Promise<DdlResult> => {
      try {
        return await ipc.client.db.createTable({ ...input });
      } catch (err) {
        throw new Error(
          err instanceof Error ? err.message : "Failed to create table",
        );
      }
    },
    [],
  );

  const dropTable = useCallback(
    async (input: DropTableInput): Promise<DdlResult> => {
      try {
        return await ipc.client.db.dropTable({ ...input });
      } catch (err) {
        throw new Error(
          err instanceof Error ? err.message : "Failed to drop table",
        );
      }
    },
    [],
  );

  const renameTable = useCallback(
    async (input: RenameTableInput): Promise<DdlResult> => {
      try {
        return await ipc.client.db.renameTable({ ...input });
      } catch (err) {
        throw new Error(
          err instanceof Error ? err.message : "Failed to rename table",
        );
      }
    },
    [],
  );

  const addColumn = useCallback(
    async (input: AddColumnInput): Promise<DdlResult> => {
      try {
        return await ipc.client.db.addColumn({ ...input });
      } catch (err) {
        throw new Error(
          err instanceof Error ? err.message : "Failed to add column",
        );
      }
    },
    [],
  );

  const dropColumn = useCallback(
    async (input: DropColumnInput): Promise<DdlResult> => {
      try {
        return await ipc.client.db.dropColumn({ ...input });
      } catch (err) {
        throw new Error(
          err instanceof Error ? err.message : "Failed to drop column",
        );
      }
    },
    [],
  );

  const renameColumn = useCallback(
    async (input: RenameColumnInput): Promise<DdlResult> => {
      try {
        return await ipc.client.db.renameColumn({ ...input });
      } catch (err) {
        throw new Error(
          err instanceof Error ? err.message : "Failed to rename column",
        );
      }
    },
    [],
  );

  const alterColumnType = useCallback(
    async (input: AlterColumnTypeInput): Promise<DdlResult> => {
      try {
        return await ipc.client.db.alterColumnType({ ...input });
      } catch (err) {
        throw new Error(
          err instanceof Error ? err.message : "Failed to alter column type",
        );
      }
    },
    [],
  );

  const setColumnNullable = useCallback(
    async (input: SetColumnNullableInput): Promise<DdlResult> => {
      try {
        return await ipc.client.db.setColumnNullable({ ...input });
      } catch (err) {
        throw new Error(
          err instanceof Error
            ? err.message
            : "Failed to update column nullable constraint",
        );
      }
    },
    [],
  );

  const setColumnDefault = useCallback(
    async (input: SetColumnDefaultInput): Promise<DdlResult> => {
      try {
        return await ipc.client.db.setColumnDefault({ ...input });
      } catch (err) {
        throw new Error(
          err instanceof Error
            ? err.message
            : "Failed to update column default",
        );
      }
    },
    [],
  );

  const createIndex = useCallback(
    async (input: CreateIndexInput): Promise<DdlResult> => {
      try {
        return await ipc.client.db.createIndex({ ...input });
      } catch (err) {
        throw new Error(
          err instanceof Error ? err.message : "Failed to create index",
        );
      }
    },
    [],
  );

  const dropIndex = useCallback(
    async (input: DropIndexInput): Promise<DdlResult> => {
      try {
        return await ipc.client.db.dropIndex({ ...input });
      } catch (err) {
        throw new Error(
          err instanceof Error ? err.message : "Failed to drop index",
        );
      }
    },
    [],
  );

  const createSchema = useCallback(
    async (input: CreateSchemaInput): Promise<DdlResult> => {
      try {
        return await ipc.client.db.createSchema({ ...input });
      } catch (err) {
        throw new Error(
          err instanceof Error ? err.message : "Failed to create schema",
        );
      }
    },
    [],
  );

  return {
    connections,
    isLoading,
    error,
    refetch: fetchConnections,
    saveConnection,
    deleteConnection,
    testConnection,
    getConnection,
    executeQuery,
    getSchema,
    getSchemaSummary,
    getTableDetails,
    tableListRows,
    tableSaveChanges,
    tableTruncate,
    tableFkLookup,
    getDatabaseInfo,
    createTable,
    dropTable,
    renameTable,
    addColumn,
    dropColumn,
    renameColumn,
    alterColumnType,
    setColumnNullable,
    setColumnDefault,
    createIndex,
    dropIndex,
    createSchema,
  };
}
