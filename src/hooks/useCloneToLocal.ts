import { useCallback, useRef, useState } from "react";
import { ipc } from "@/ipc/manager";
import type {
  Connection,
  ConnectionInput,
  DdlScript,
  ExportSchemaResult,
  TableRowCount,
} from "@/ipc/db/types";
import { LOCAL_DB_DEFAULT_PASSWORD } from "@/ipc/db/constants";

export interface CloneToLocalTableSelection {
  schema: string;
  table: string;
  importData: boolean;
  rowCount?: number;
}

export interface CloneToLocalProgress {
  stage: "schema" | "data" | "indexes" | "constraints" | "complete" | "error";
  currentTable?: string;
  tablesProcessed: number;
  totalTables: number;
  rowsProcessed: number;
  message: string;
}

interface UseCloneToLocalReturn {
  isLoading: boolean;
  progress: CloneToLocalProgress | null;
  error: string | null;
  exportSchema: (connectionId: string) => Promise<ExportSchemaResult | null>;
  cloneToLocal: (
    sourceConnection: Connection,
    targetName: string,
    selectedTables: CloneToLocalTableSelection[],
    postgresVersion?: string,
  ) => Promise<Connection | null>;
  cancelClone: () => void;
  reset: () => void;
}

const BATCH_SIZE = 500;

export function useCloneToLocal(): UseCloneToLocalReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState<CloneToLocalProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef(false);

  const reset = useCallback(() => {
    setIsLoading(false);
    setProgress(null);
    setError(null);
    cancelRef.current = false;
  }, []);

  const cancelClone = useCallback(() => {
    cancelRef.current = true;
  }, []);

  const exportSchema = useCallback(
    async (connectionId: string): Promise<ExportSchemaResult | null> => {
      try {
        return await ipc.client.db.exportSchemaDdl({ id: connectionId });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to export schema");
        return null;
      }
    },
    [],
  );

  const cloneToLocal = useCallback(
    async (
      sourceConnection: Connection,
      targetName: string,
      selectedTables: CloneToLocalTableSelection[],
      postgresVersion?: string,
    ): Promise<Connection | null> => {
      cancelRef.current = false;
      setIsLoading(true);
      setError(null);
      setProgress({
        stage: "schema",
        tablesProcessed: 0,
        totalTables: selectedTables.length,
        rowsProcessed: 0,
        message: "Exporting schema from source database...",
      });

      try {
        // Step 1: Export schema DDL from source
        const schemaResult = await ipc.client.db.exportSchemaDdl({
          id: sourceConnection.id,
        });

        if (!schemaResult) {
          throw new Error("Failed to export schema");
        }

        if (cancelRef.current) {
          throw new Error("Clone cancelled by user");
        }

        // Step 2: Create local database
        setProgress({
          stage: "schema",
          tablesProcessed: 0,
          totalTables: selectedTables.length,
          rowsProcessed: 0,
          message: "Creating local database...",
        });

        const password = LOCAL_DB_DEFAULT_PASSWORD;

        // Find an available port automatically
        const port = await ipc.client.db.findAvailablePort();

        const localDb = await ipc.client.db.createLocalDatabase({
          name: targetName,
          databaseName: "postgres",
          username: "postgres",
          password,
          port,
          postgresVersion: postgresVersion || "16.13.0",
          autoStart: true,
        });

        // Wait for database to be ready using polling with retry
        setProgress({
          stage: "schema",
          tablesProcessed: 0,
          totalTables: selectedTables.length,
          rowsProcessed: 0,
          message: "Waiting for local database to be ready...",
        });

        await ipc.client.db.waitForDatabase({
          connectionString: localDb.connection_string,
        });

        // Save the connection immediately so subsequent IPC calls can find it
        const localConnection: Connection = {
          id: localDb.id,
          name: localDb.name,
          host: "localhost",
          port: localDb.port ?? 5432,
          database: localDb.database_name || "postgres",
          username: localDb.username || "postgres",
          password,
          ssl_mode: "disable",
          url: localDb.connection_string,
          is_local: true,
          connection_string: localDb.connection_string,
          postgres_version: localDb.postgres_version ?? postgresVersion ?? "16.13.0",
          local_auto_start: localDb.auto_start,
        };

        const connectionInput: ConnectionInput = {
          id: localConnection.id,
          name: localConnection.name,
          host: localConnection.host,
          port: localConnection.port,
          database: localConnection.database,
          username: localConnection.username,
          password: localConnection.password,
          ssl_mode: localConnection.ssl_mode,
          url: localConnection.url,
          is_local: localConnection.is_local,
          connection_string: localConnection.connection_string,
          postgres_version: localConnection.postgres_version,
          local_auto_start: localConnection.local_auto_start,
        };

        await ipc.client.db.saveConnection(connectionInput);

        if (cancelRef.current) {
          throw new Error("Clone cancelled by user");
        }

        // Step 3: Execute schema DDL on local database
        setProgress({
          stage: "schema",
          tablesProcessed: 0,
          totalTables: selectedTables.length,
          rowsProcessed: 0,
          message: "Creating schema structure...",
        });

        // Separate scripts by type for proper execution order
        const sequenceScripts = schemaResult.scripts.filter(
          (s: DdlScript) => s.type === "sequence",
        );
        const schemaScripts = schemaResult.scripts.filter(
          (s: DdlScript) => s.type === "schema",
        );
        const tableScripts = schemaResult.scripts.filter(
          (s: DdlScript) => s.type === "table",
        );
        const indexScripts = schemaResult.scripts.filter(
          (s: DdlScript) => s.type === "index",
        );
        const constraintScripts = schemaResult.scripts.filter(
          (s: DdlScript) => s.type === "constraint",
        );

        // Execute in order: schemas -> sequences -> tables -> indexes
        const allInitialScripts = [
          ...schemaScripts,
          ...sequenceScripts,
          ...tableScripts,
          ...indexScripts,
        ];

        if (allInitialScripts.length > 0) {
          const result = await ipc.client.db.executeBatchDdl({
            connectionId: localDb.id,
            statements: allInitialScripts.map((s: DdlScript) => s.sql),
          });

          if (result.errors.length > 0) {
            console.warn(
              `[clone] ${result.errors.length} DDL statement(s) had errors during schema creation:`,
              result.errors,
            );
          }
        }

        if (cancelRef.current) {
          throw new Error("Clone cancelled by user");
        }

        // Step 4: Import data for selected tables using parameterized queries
        const tablesWithData = selectedTables.filter((t) => t.importData);
        let rowsProcessed = 0;

        for (let i = 0; i < tablesWithData.length; i++) {
          if (cancelRef.current) {
            throw new Error("Clone cancelled by user");
          }

          const table = tablesWithData[i];

          setProgress({
            stage: "data",
            currentTable: `${table.schema}.${table.table}`,
            tablesProcessed: i,
            totalTables: tablesWithData.length,
            rowsProcessed,
            message: `Importing data for ${table.schema}.${table.table}...`,
          });

          // Export data in batches and import using parameterized queries
          let hasMore = true;
          let offset = 0;

          while (hasMore && !cancelRef.current) {
            const dataResult = await ipc.client.db.exportTableData({
              connectionId: sourceConnection.id,
              schema: table.schema,
              table: table.table,
              batchSize: BATCH_SIZE,
              offset,
            });

            if (dataResult.rows.length === 0) {
              break;
            }

            // Import rows using parameterized queries (safe from SQL injection)
            const imported = await ipc.client.db.importTableRows({
              connectionId: localDb.id,
              schema: table.schema,
              table: table.table,
              columns: dataResult.columns,
              rows: dataResult.rows,
            });

            rowsProcessed += imported;
            hasMore = dataResult.hasMore;
            offset += dataResult.rows.length;

            setProgress({
              stage: "data",
              currentTable: `${table.schema}.${table.table}`,
              tablesProcessed: i,
              totalTables: tablesWithData.length,
              rowsProcessed,
              message: `Imported ${rowsProcessed} rows into ${table.schema}.${table.table}...`,
            });
          }
        }

        if (cancelRef.current) {
          throw new Error("Clone cancelled by user");
        }

        // Step 5: Apply foreign key constraints last (after all data is imported)
        if (constraintScripts.length > 0) {
          setProgress({
            stage: "constraints",
            tablesProcessed: tablesWithData.length,
            totalTables: tablesWithData.length,
            rowsProcessed,
            message: "Applying foreign key constraints...",
          });

          const constraintResult = await ipc.client.db.executeBatchDdl({
            connectionId: localDb.id,
            statements: constraintScripts.map((s: DdlScript) => s.sql),
          });

          if (constraintResult.errors.length > 0) {
            console.warn(
              `[clone] ${constraintResult.errors.length} constraint error(s):`,
              constraintResult.errors,
            );
          }
        }

        // Step 6: Done
        setProgress({
          stage: "complete",
          tablesProcessed: tablesWithData.length,
          totalTables: tablesWithData.length,
          rowsProcessed,
          message: "Clone completed successfully!",
        });

        return localConnection;
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Clone to local failed";
        setError(errorMessage);
        setProgress({
          stage: "error",
          tablesProcessed: 0,
          totalTables: selectedTables.length,
          rowsProcessed: 0,
          message: errorMessage,
        });
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  return {
    isLoading,
    progress,
    error,
    exportSchema,
    cloneToLocal,
    cancelClone,
    reset,
  };
}
