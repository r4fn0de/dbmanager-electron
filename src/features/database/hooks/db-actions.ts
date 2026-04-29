/**
 * Module-level IPC proxy functions for database operations.
 *
 * These are plain async functions — NOT React hooks — so they cause
 * **zero re-renders**. Use them anywhere: event handlers, effects,
 * queryFn callbacks, or even outside React components.
 *
 * For connection list data + mutations with cache invalidation,
 * use `useConnectionsList()` instead.
 */
import { ipc } from "@/ipc/manager";
import { queryClient } from "@/lib/query-client";
import { dbQueryKeys } from "@/lib/query-options";
import type {
  AddColumnInput,
  AlterColumnTypeInput,
  Connection,
  ConnectionInput,
  ConstraintInfo,
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
  IndexInfo,
  ListRowsInput,
  QueryResult,
  RenameColumnInput,
  RenameTableInput,
  SaveChangesInput,
  SaveChangesResponse,
  SchemaEnum,
  SchemaFunction,
  SchemaSummary,
  SchemaTableDetails,
  SchemaTrigger,
  SetColumnDefaultInput,
  SetColumnNullableInput,
  TableRef,
  TableRowsResponse,
} from "@/ipc/db/types";

function extractErrorMessage(
  err: unknown,
  fallback: string,
): string {
  const pickString = (value: unknown): string | null =>
    typeof value === "string" && value.trim() ? value.trim() : null;

  if (err instanceof Error && err.message.trim()) return err.message;
  if (typeof err === "string" && err.trim()) return err.trim();

  if (err && typeof err === "object") {
    const asRecord = err as Record<string, unknown>;

    const candidates: Array<unknown> = [
      asRecord.message,
      (asRecord.data as Record<string, unknown> | undefined)?.message,
      (asRecord.cause as Record<string, unknown> | undefined)?.message,
      (
        (asRecord.cause as Record<string, unknown> | undefined)?.data as
          | Record<string, unknown>
          | undefined
      )?.message,
      (asRecord.shape as Record<string, unknown> | undefined)?.message,
      (
        (asRecord.shape as Record<string, unknown> | undefined)?.data as
          | Record<string, unknown>
          | undefined
      )?.message,
      (asRecord.error as Record<string, unknown> | undefined)?.message,
      (asRecord.response as Record<string, unknown> | undefined)?.message,
    ];

    for (const candidate of candidates) {
      const picked = pickString(candidate);
      if (picked) return picked;
    }
  }

  return fallback;
}

// ── Connection operations ────────────────────────────────────────────

export async function testConnection(
  connection: ConnectionInput,
): Promise<boolean> {
  try {
    return await ipc.client.db.testConnection({ ...connection });
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : "Connection test failed",
    );
  }
}

export async function getConnection(
  id: string,
): Promise<Connection | null> {
  try {
    return await ipc.client.db.getConnection({ id });
  } catch {
    return null;
  }
}

// ── Query operations ─────────────────────────────────────────────────

export async function executeQuery(
  connectionId: string,
  sql: string,
  requestId?: string,
): Promise<QueryResult> {
  try {
    return await ipc.client.db.executeQuery({ connectionId, sql, requestId });
  } catch (err) {
    throw new Error(extractErrorMessage(err, "Query execution failed"));
  }
}

/**
 * Cancel a running query by requestId.
 * Sends an IPC message to the main process which aborts the AbortController
 * associated with the query, causing the driver to cancel the operation.
 */
export function cancelQuery(requestId: string): void {
  window.electron?.dbCancel?.cancelQuery(requestId);
}

// ── Schema operations ─────────────────────────────────────────────────

export async function getSchema(
  connectionId: string,
): Promise<DatabaseSchema> {
  try {
    return await ipc.client.db.getSchema({ id: connectionId });
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : "Failed to fetch schema",
    );
  }
}

export async function getSchemaSummary(
  connectionId: string,
): Promise<SchemaSummary> {
  try {
    return await ipc.client.db.getSchemaSummary({ id: connectionId });
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : "Failed to fetch schema summary",
    );
  }
}

export async function getTableDetails(
  connectionId: string,
  schema: string,
  table: string,
): Promise<SchemaTableDetails> {
  try {
    return await ipc.client.db.getTableDetails({ connectionId, schema, table });
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : "Failed to fetch table details",
    );
  }
}

export async function getDatabaseInfo(
  connectionId: string,
): Promise<DatabaseInfo> {
  try {
    return await ipc.client.db.getDatabaseInfo({ id: connectionId });
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : "Failed to fetch database info",
    );
  }
}

// ── Table data operations ────────────────────────────────────────────

export async function tableListRows(
  input: ListRowsInput,
): Promise<TableRowsResponse> {
  try {
    return await ipc.client.db.tableListRows({ ...input });
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : "Failed to list table rows",
    );
  }
}

export async function tableSaveChanges(
  input: SaveChangesInput,
): Promise<SaveChangesResponse> {
  try {
    return await ipc.client.db.tableSaveChanges({ ...input });
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : "Failed to save table changes",
    );
  }
}

export async function tableTruncate(tableRef: TableRef): Promise<void> {
  try {
    await ipc.client.db.tableTruncate({ tableRef });
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : "Failed to truncate table",
    );
  }
}

export async function tableFkLookup(
  input: FkLookupInput,
): Promise<FkLookupResponse> {
  try {
    return await ipc.client.db.tableFkLookup({ ...input });
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : "Failed to lookup foreign keys",
    );
  }
}

// ── DDL operations ───────────────────────────────────────────────────

export async function createTable(
  input: CreateTableInput,
): Promise<DdlResult> {
  try {
    return await ipc.client.db.createTable({ ...input });
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : "Failed to create table",
    );
  }
}

export async function dropTable(input: DropTableInput): Promise<DdlResult> {
  try {
    return await ipc.client.db.dropTable({ ...input });
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : "Failed to drop table",
    );
  }
}

export async function renameTable(
  input: RenameTableInput,
): Promise<DdlResult> {
  try {
    return await ipc.client.db.renameTable({ ...input });
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : "Failed to rename table",
    );
  }
}

export async function addColumn(input: AddColumnInput): Promise<DdlResult> {
  try {
    return await ipc.client.db.addColumn({ ...input });
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : "Failed to add column",
    );
  }
}

export async function dropColumn(input: DropColumnInput): Promise<DdlResult> {
  try {
    return await ipc.client.db.dropColumn({ ...input });
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : "Failed to drop column",
    );
  }
}

export async function renameColumn(
  input: RenameColumnInput,
): Promise<DdlResult> {
  try {
    return await ipc.client.db.renameColumn({ ...input });
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : "Failed to rename column",
    );
  }
}

export async function alterColumnType(
  input: AlterColumnTypeInput,
): Promise<DdlResult> {
  try {
    return await ipc.client.db.alterColumnType({ ...input });
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : "Failed to alter column type",
    );
  }
}

export async function setColumnNullable(
  input: SetColumnNullableInput,
): Promise<DdlResult> {
  try {
    return await ipc.client.db.setColumnNullable({ ...input });
  } catch (err) {
    throw new Error(
      err instanceof Error
        ? err.message
        : "Failed to update column nullable constraint",
    );
  }
}

export async function setColumnDefault(
  input: SetColumnDefaultInput,
): Promise<DdlResult> {
  try {
    return await ipc.client.db.setColumnDefault({ ...input });
  } catch (err) {
    throw new Error(
      err instanceof Error
        ? err.message
        : "Failed to update column default",
    );
  }
}

export async function createIndex(
  input: CreateIndexInput,
): Promise<DdlResult> {
  try {
    return await ipc.client.db.createIndex({ ...input });
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : "Failed to create index",
    );
  }
}

export async function dropIndex(input: DropIndexInput): Promise<DdlResult> {
  try {
    return await ipc.client.db.dropIndex({ ...input });
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : "Failed to drop index",
    );
  }
}

export async function createSchema(
  input: CreateSchemaInput,
): Promise<DdlResult> {
  try {
    return await ipc.client.db.createSchema({ ...input });
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : "Failed to create schema",
    );
  }
}

// ── Schema definition operations ──────────────────────────────────────

export async function getEnums(
  connectionId: string,
  schema: string,
): Promise<SchemaEnum[]> {
  try {
    return await ipc.client.db.getEnums({ connectionId, schema });
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : "Failed to fetch enums",
    );
  }
}

export async function getFunctions(
  connectionId: string,
  schema: string,
): Promise<SchemaFunction[]> {
  try {
    return await ipc.client.db.getFunctions({ connectionId, schema });
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : "Failed to fetch functions",
    );
  }
}

export async function getTriggers(
  connectionId: string,
  schema: string,
): Promise<SchemaTrigger[]> {
  try {
    return await ipc.client.db.getTriggers({ connectionId, schema });
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : "Failed to fetch triggers",
    );
  }
}

export async function getSchemaConstraints(
  connectionId: string,
  schema: string,
): Promise<ConstraintInfo[]> {
  try {
    return await ipc.client.db.getSchemaConstraints({ connectionId, schema });
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : "Failed to fetch schema constraints",
    );
  }
}

export async function getSchemaIndexes(
  connectionId: string,
  schema: string,
): Promise<IndexInfo[]> {
  try {
    return await ipc.client.db.getSchemaIndexes({ connectionId, schema });
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : "Failed to fetch schema indexes",
    );
  }
}

// Cache invalidation — callable from non-React code (e.g. DDL success callbacks)
// Uses the singleton queryClient so any component will refetch on next render.
/**
 * Invalidate all cached data for a connection after a DDL operation.
 * This ensures schema summary, table details, and row caches are refreshed.
 */
export function invalidateDdlCache(connectionId: string, schema?: string, table?: string): void {
  // Schema summary (table list)
  queryClient.invalidateQueries({ queryKey: dbQueryKeys.schemaSummary(connectionId) });
  // Table details
  if (schema && table) {
    queryClient.invalidateQueries({ queryKey: dbQueryKeys.tableDetails(connectionId, schema, table) });
  } else {
    queryClient.invalidateQueries({ queryKey: dbQueryKeys.tableDetailsAll(connectionId) });
  }
  // Schema details batch (visualizer/AI)
  queryClient.invalidateQueries({ queryKey: dbQueryKeys.selectedSchemaDetailsPrefix(connectionId) });
  // Table rows
  if (schema && table) {
    queryClient.invalidateQueries({ queryKey: dbQueryKeys.tableRowsPrefix(connectionId, schema, table) });
  }
  // Definitions browser
  if (schema) {
    queryClient.invalidateQueries({ queryKey: dbQueryKeys.schemaConstraints(connectionId, schema) });
    queryClient.invalidateQueries({ queryKey: dbQueryKeys.schemaEnums(connectionId, schema) });
    queryClient.invalidateQueries({ queryKey: dbQueryKeys.schemaFunctions(connectionId, schema) });
    queryClient.invalidateQueries({ queryKey: dbQueryKeys.schemaIndexes(connectionId, schema) });
    queryClient.invalidateQueries({ queryKey: dbQueryKeys.schemaTriggers(connectionId, schema) });
  }
}
