import { useState, useMemo, useEffect, useCallback } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { dbQueryKeys } from "@/lib/query-options";
import { setUnsavedChanges as setWindowUnsavedChanges } from "@/features/shell/actions/window";
import type {
  TableRef,
  SaveChangesInput,
  SaveChangesResponse,
  SchemaColumn,
} from "@/ipc/db/types";
import type { RowRecord, RowUpdateDraft, DeleteDraft } from "../types";

interface UseDraftChangesOptions {
  tableRef: TableRef;
  tableSaveChanges: (input: SaveChangesInput) => Promise<SaveChangesResponse>;
  queryClient: QueryClient;
  connectionId: string;
  tableSchema: string;
  tableName: string;
  tableColumns: SchemaColumn[];
  onDiscard?: () => void;
}

export function useDraftChanges(options: UseDraftChangesOptions) {
  const {
    tableRef,
    tableSaveChanges,
    queryClient,
    connectionId,
    tableSchema,
    tableName,
    tableColumns,
    onDiscard,
  } = options;

  const [draftInserts, setDraftInserts] = useState<RowRecord[]>([]);
  const [draftUpdates, setDraftUpdates] = useState<
    Record<string, RowUpdateDraft>
  >({});
  const [draftDeletes, setDraftDeletes] = useState<Record<string, DeleteDraft>>(
    {},
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirtyCounts = useMemo(
    () => ({
      inserts: draftInserts.length,
      updates: Object.keys(draftUpdates).length,
      deletes: Object.keys(draftDeletes).length,
    }),
    [draftDeletes, draftInserts.length, draftUpdates],
  );

  const hasDraftChanges =
    dirtyCounts.inserts + dirtyCounts.updates + dirtyCounts.deletes > 0;

  useEffect(() => {
    const scope = `table:${connectionId}:${tableSchema}.${tableName}`;
    void setWindowUnsavedChanges(scope, hasDraftChanges);
    return () => {
      void setWindowUnsavedChanges(scope, false);
    };
  }, [connectionId, tableSchema, tableName, hasDraftChanges]);

  const handleAddDraftRecord = useCallback(() => {
    const row: RowRecord = {};
    for (const column of tableColumns) {
      row[column.name] = null;
    }
    setDraftInserts((current) => [...current, row]);
  }, [tableColumns]);

  const discardDrafts = useCallback(() => {
    setDraftInserts([]);
    setDraftUpdates({});
    setDraftDeletes({});
    onDiscard?.();
  }, [onDiscard]);

  const saveAllChanges = useCallback(async () => {
    if (!hasDraftChanges) return;

    setIsSaving(true);
    setError(null);
    try {
      const inserts = draftInserts.map((row) => {
        const clean: RowRecord = {};
        for (const [key, value] of Object.entries(row)) {
          if (value !== undefined) clean[key] = value;
        }
        return clean;
      });

      const updates = Object.values(draftUpdates).map((entry) => ({
        primaryKey: entry.primaryKey,
        changes: entry.changes,
      }));

      const deletes = Object.values(draftDeletes).map((entry) => ({
        primaryKey: entry.primaryKey,
      }));

      await tableSaveChanges({ tableRef, inserts, updates, deletes });
      discardDrafts();
      await queryClient.invalidateQueries({
        queryKey: dbQueryKeys.tableRowsPrefix(
          connectionId,
          tableSchema,
          tableName,
        ),
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to save changes",
      );
    } finally {
      setIsSaving(false);
    }
  }, [
    hasDraftChanges,
    draftInserts,
    draftUpdates,
    draftDeletes,
    tableSaveChanges,
    tableRef,
    queryClient,
    connectionId,
    tableSchema,
    tableName,
    discardDrafts,
  ]);

  return {
    draftInserts,
    setDraftInserts,
    draftUpdates,
    setDraftUpdates,
    draftDeletes,
    setDraftDeletes,
    dirtyCounts,
    hasDraftChanges,
    discardDrafts,
    handleAddDraftRecord,
    saveAllChanges,
    isSaving,
    setIsSaving,
    error,
    setError,
  };
}
