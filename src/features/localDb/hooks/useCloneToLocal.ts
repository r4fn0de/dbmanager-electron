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
const PORT_START = 5432;
const PORT_ATTEMPTS = 20;

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function normalizeCloneError(err: unknown, step: string): string {
  const message = getErrorMessage(err);
  const lower = message.toLowerCase();

  if (lower.includes("not found")) {
    return `Failed at ${step}: required backend operation was not found. Please restart the app and try again.`;
  }

  return `Failed at ${step}: ${message}`;
}

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

      let createdLocalDbId: string | null = null;
      let savedLocalConnectionId: string | null = null;

      try {
        // Step 1: Export schema DDL from source
        let schemaResult: ExportSchemaResult;
        try {
          schemaResult = await ipc.client.db.exportSchemaDdl({
            id: sourceConnection.id,
          });
        } catch (err) {
          throw new Error(normalizeCloneError(err, "schema export"));
        }

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

        // Find an available port with fallback logic (avoids hard dependency on extra RPC endpoints)
        let localDb: Awaited<ReturnType<typeof ipc.client.db.createLocalDatabase>> | null = null;
        let lastCreateError: unknown = null;

        for (let i = 0; i < PORT_ATTEMPTS; i++) {
          const port = PORT_START + i;
          try {
            localDb = await ipc.client.db.createLocalDatabase({
              name: targetName,
              databaseName: "postgres",
              username: "postgres",
              password,
              port,
              postgresVersion: postgresVersion || "16.13.0",
              autoStart: true,
            });
            break;
          } catch (err) {
            lastCreateError = err;
            const message = getErrorMessage(err).toLowerCase();
            if (!message.includes("already in use")) {
              throw new Error(normalizeCloneError(err, "local database creation"));
            }
          }
        }

        if (!localDb) {
          throw new Error(
            normalizeCloneError(
              lastCreateError ?? "No available local port",
              "local database creation",
            ),
          );
        }
        createdLocalDbId = localDb.id;

        // Wait for database to be ready using polling with retry
        setProgress({
          stage: "schema",
          tablesProcessed: 0,
          totalTables: selectedTables.length,
          rowsProcessed: 0,
          message: "Waiting for local database to be ready...",
        });

        try {
          await ipc.client.db.waitForDatabase({
            connectionString: localDb.connection_string,
          });
        } catch (err) {
          throw new Error(normalizeCloneError(err, "waiting for local database"));
        }

        // Save the connection immediately so subsequent IPC calls can find it
        const localConnection: Connection = {
          id: localDb.id,
          name: localDb.name,
          db_type: "postgresql",
          host: "localhost",
          port: localDb.port ?? 5432,
          database: localDb.database_name || "postgres",
          username: localDb.username || "postgres",
          password,
          ssl_mode: "disable",
          url: localDb.connection_string,
          is_local: true,
          connection_string: localDb.connection_string,
          engine_version: localDb.postgres_version ?? postgresVersion ?? "16.13.0",
          postgres_version: localDb.postgres_version ?? postgresVersion ?? "16.13.0",
          local_auto_start: localDb.auto_start,
        };

        const connectionInput: ConnectionInput = {
          id: localConnection.id,
          name: localConnection.name,
          db_type: localConnection.db_type,
          host: localConnection.host,
          port: localConnection.port,
          database: localConnection.database,
          username: localConnection.username,
          password: localConnection.password,
          ssl_mode: localConnection.ssl_mode,
          url: localConnection.url,
          is_local: localConnection.is_local,
          connection_string: localConnection.connection_string,
          engine_version: localConnection.engine_version,
          postgres_version: localConnection.postgres_version,
          local_auto_start: localConnection.local_auto_start,
        };

        try {
          await ipc.client.db.saveConnection(connectionInput);
          savedLocalConnectionId = localConnection.id;
        } catch (err) {
          throw new Error(normalizeCloneError(err, "saving local connection"));
        }

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
        const typeScripts = schemaResult.scripts.filter(
          (s: DdlScript) => s.type === "type",
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

        // Execute in strict order and fail fast on base schema errors.
        const runBatch = async (
          scripts: DdlScript[],
          step: string,
          failOnError: boolean,
        ): Promise<void> => {
          if (scripts.length === 0) return;

          const result = await ipc.client.db.executeBatchDdl({
            connectionId: localDb.id,
            statements: scripts.map((s: DdlScript) => s.sql),
          });

          if (result.errors.length === 0) return;

          if (failOnError) {
            const first = result.errors[0];
            throw new Error(
              `Failed at ${step}: ${first.error}\nSQL: ${first.sql}`,
            );
          }

          console.warn(
            `[clone] ${result.errors.length} ${step} error(s):`,
            result.errors,
          );
        };

        await runBatch(schemaScripts, "creating schemas", true);
        await runBatch(typeScripts, "creating custom types", true);
        await runBatch(sequenceScripts, "creating sequences", true);
        await runBatch(tableScripts, "creating tables", true);
        await runBatch(indexScripts, "creating indexes", false);

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
            let dataResult: Awaited<ReturnType<typeof ipc.client.db.exportTableData>>;
            try {
              dataResult = await ipc.client.db.exportTableData({
                connectionId: sourceConnection.id,
                schema: table.schema,
                table: table.table,
                batchSize: BATCH_SIZE,
                offset,
              });
            } catch (err) {
              throw new Error(
                normalizeCloneError(
                  err,
                  `exporting table data (${table.schema}.${table.table})`,
                ),
              );
            }

            if (dataResult.rows.length === 0) {
              break;
            }

            // Import rows using parameterized queries (safe from SQL injection)
            let imported: number;
            try {
              imported = await ipc.client.db.importTableRows({
                connectionId: localDb.id,
                schema: table.schema,
                table: table.table,
                columns: dataResult.columns,
                rows: dataResult.rows,
              });
            } catch (err) {
              throw new Error(
                normalizeCloneError(
                  err,
                  `importing table rows (${table.schema}.${table.table})`,
                ),
              );
            }

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

          let constraintResult: Awaited<ReturnType<typeof ipc.client.db.executeBatchDdl>>;
          try {
            constraintResult = await ipc.client.db.executeBatchDdl({
              connectionId: localDb.id,
              statements: constraintScripts.map((s: DdlScript) => s.sql),
            });
          } catch (err) {
            throw new Error(normalizeCloneError(err, "applying constraints"));
          }

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
        // Best-effort cleanup for partially created local resources when clone fails.
        if (savedLocalConnectionId) {
          try {
            await ipc.client.db.deleteConnection({ id: savedLocalConnectionId });
          } catch (cleanupErr) {
            console.warn(
              "[clone] Failed to cleanup local connection:",
              cleanupErr,
            );
          }
        }
        if (createdLocalDbId) {
          try {
            await ipc.client.db.deleteLocalDatabase({ id: createdLocalDbId });
          } catch (cleanupErr) {
            console.warn("[clone] Failed to cleanup local database:", cleanupErr);
          }
        }

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
