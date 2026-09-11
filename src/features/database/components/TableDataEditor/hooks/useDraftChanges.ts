import type { QueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { setUnsavedChanges as setWindowUnsavedChanges } from "@/features/shell/actions/window";
import type {
  SaveChangesInput,
  SaveChangesResponse,
  SchemaColumn,
  TableRef,
} from "@/ipc/db/types";
import { dbQueryKeys } from "@/lib/query-options";
import type { DeleteDraft, RowRecord, RowUpdateDraft } from "../types";

interface UseDraftChangesOptions {
  connectionId: string;
  onDiscard?: () => void;
  queryClient: QueryClient;
  tableColumns: SchemaColumn[];
  tableName: string;
  tableRef: TableRef;
  tableSaveChanges: (input: SaveChangesInput) => Promise<SaveChangesResponse>;
  tableSchema: string;
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
    {}
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirtyCounts = useMemo(
    () => ({
      deletes: Object.keys(draftDeletes).length,
      inserts: draftInserts.length,
      updates: Object.keys(draftUpdates).length,
    }),
    [draftDeletes, draftInserts.length, draftUpdates]
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
    if (!hasDraftChanges) {
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const inserts = draftInserts.map((row) => {
        const clean: RowRecord = {};
        for (const [key, value] of Object.entries(row)) {
          if (value !== undefined) {
            clean[key] = value;
          }
        }
        return clean;
      });

      const updates = Object.values(draftUpdates).map((entry) => ({
        changes: entry.changes,
        primaryKey: entry.primaryKey,
      }));

      const deletes = Object.values(draftDeletes).map((entry) => ({
        primaryKey: entry.primaryKey,
      }));

      await tableSaveChanges({ deletes, inserts, tableRef, updates });
      discardDrafts();
      await queryClient.invalidateQueries({
        queryKey: dbQueryKeys.tableRowsPrefix(
          connectionId,
          tableSchema,
          tableName
        ),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save changes");
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
    dirtyCounts,
    discardDrafts,
    draftDeletes,
    draftInserts,
    draftUpdates,
    error,
    handleAddDraftRecord,
    hasDraftChanges,
    isSaving,
    saveAllChanges,
    setDraftDeletes,
    setDraftInserts,
    setDraftUpdates,
    setError,
    setIsSaving,
  };
}
