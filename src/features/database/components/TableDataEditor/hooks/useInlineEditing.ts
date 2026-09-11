import { useCallback, useRef, useState } from "react";
import type {
  FkLookupInput,
  FkLookupResponse,
  SchemaColumn,
  SchemaForeignKey,
  TableRef,
} from "@/ipc/db/types";
import type { RowRecord, RowUpdateDraft } from "../types";
import type { createTableEditorPerfTracker } from "../utils/performance";
import { normalizeDisplay, parseByType } from "../utils/valueParsers";

export interface InlineEditingOptions {
  columnMap: Record<string, SchemaColumn>;
  draftInserts: RowRecord[];
  draftUpdates: Record<string, RowUpdateDraft>;
  findFkForColumn: (column: string) => SchemaForeignKey | undefined;
  perfTrackerRef?: React.RefObject<
    ReturnType<typeof createTableEditorPerfTracker>
  >;
  primaryKey: string[];
  setDraftInserts: React.Dispatch<React.SetStateAction<RowRecord[]>>;
  setDraftUpdates: React.Dispatch<
    React.SetStateAction<Record<string, RowUpdateDraft>>
  >;
  tableFkLookup: (input: FkLookupInput) => Promise<FkLookupResponse>;
  tableRef: TableRef;
}

export function useInlineEditing(options: InlineEditingOptions) {
  const {
    columnMap,
    primaryKey,
    draftInserts,
    setDraftInserts,
    draftUpdates,
    setDraftUpdates,
    findFkForColumn,
    tableFkLookup,
    tableRef,
    perfTrackerRef,
  } = options;

  const [editingCell, setEditingCell] = useState<{
    rowKey: string;
    column: string;
    source: "existing" | "insert";
    insertIndex?: number;
  } | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [fkOptions, setFkOptions] = useState<FkLookupResponse | null>(null);
  const [isLoadingFk, setIsLoadingFk] = useState(false);
  const fkLookupRequestIdRef = useRef(0);
  const fkDebounceTimeoutRef = useRef<
    ReturnType<typeof setTimeout> | undefined
  >(undefined);
  const pendingEditPerfRowKeyRef = useRef<string | null>(null);

  const loadFkOptions = useCallback(
    async (columnName: string, query: string) => {
      const fk = findFkForColumn(columnName);
      if (!fk) {
        setFkOptions(null);
        setIsLoadingFk(false);
        return;
      }

      const requestId = ++fkLookupRequestIdRef.current;
      setIsLoadingFk(true);
      try {
        const response = await tableFkLookup({
          column: columnName,
          page: 0,
          pageSize: 8,
          query,
          tableRef,
        });
        if (requestId === fkLookupRequestIdRef.current) {
          setFkOptions(response);
        }
      } catch {
        if (requestId === fkLookupRequestIdRef.current) {
          setFkOptions(null);
        }
      } finally {
        if (requestId === fkLookupRequestIdRef.current) {
          setIsLoadingFk(false);
        }
      }
    },
    [findFkForColumn, tableFkLookup, tableRef]
  );

  const loadFkOptionsDebounced = useCallback(
    (columnName: string, query: string) => {
      if (fkDebounceTimeoutRef.current) {
        clearTimeout(fkDebounceTimeoutRef.current);
      }
      fkDebounceTimeoutRef.current = setTimeout(() => {
        void loadFkOptions(columnName, query);
      }, 180);
    },
    [loadFkOptions]
  );

  const cancelEditing = useCallback(() => {
    if (fkDebounceTimeoutRef.current) {
      clearTimeout(fkDebounceTimeoutRef.current);
    }
    fkLookupRequestIdRef.current += 1;
    setEditingCell(null);
    setEditingValue("");
    setFkOptions(null);
    setIsLoadingFk(false);
  }, []);

  const beginEditExistingCell = useCallback(
    (
      rowKey: string,
      row: RowRecord,
      columnName: string,
      _options?: { selectAllOnFocus?: boolean }
    ) => {
      if (primaryKey.length === 0) {
        return;
      }

      const draftedValue = draftUpdates[rowKey]?.changes[columnName];
      const currentValue = draftedValue ?? row[columnName];
      setEditingCell({ column: columnName, rowKey, source: "existing" });
      setEditingValue(normalizeDisplay(currentValue));
      void loadFkOptions(columnName, normalizeDisplay(currentValue));
    },
    [primaryKey, draftUpdates, loadFkOptions]
  );

  const beginEditInsertCell = useCallback(
    (
      insertIndex: number,
      columnName: string,
      _options?: { selectAllOnFocus?: boolean }
    ) => {
      const value = draftInserts[insertIndex]?.[columnName];
      setEditingCell({
        column: columnName,
        insertIndex,
        rowKey: `insert:${insertIndex}`,
        source: "insert",
      });
      setEditingValue(normalizeDisplay(value ?? ""));
      void loadFkOptions(columnName, normalizeDisplay(value ?? ""));
    },
    [draftInserts, loadFkOptions]
  );

  const keepCaretNavigationInsideInlineInput = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (
        event.key !== "ArrowLeft" &&
        event.key !== "ArrowRight" &&
        event.key !== "ArrowUp" &&
        event.key !== "ArrowDown"
      ) {
        return;
      }

      event.stopPropagation();

      const input = event.currentTarget;
      const start = input.selectionStart ?? 0;
      const end = input.selectionEnd ?? 0;
      const hasSelection = start !== end;

      if (event.key === "ArrowLeft" && !hasSelection && start === 0) {
        event.preventDefault();
      }

      if (
        event.key === "ArrowRight" &&
        !hasSelection &&
        end >= input.value.length
      ) {
        event.preventDefault();
      }

      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
      }
    },
    []
  );

  const persistEditing = useCallback(
    (baseRow?: RowRecord) => {
      if (!editingCell) {
        return;
      }
      const column = columnMap[editingCell.column];
      if (!column) {
        return;
      }
      const parsed = parseByType(editingValue, column);

      if (editingCell.source === "insert") {
        pendingEditPerfRowKeyRef.current = editingCell.rowKey;
        perfTrackerRef?.current?.start("edit_confirm_to_draft_updated");
        const insertIndex = editingCell.insertIndex ?? 0;
        setDraftInserts((current) => {
          const next = [...current];
          const row = { ...(next[insertIndex] ?? {}) };
          row[editingCell.column] = parsed;
          next[insertIndex] = row;
          return next;
        });
        cancelEditing();
        return;
      }

      if (!baseRow) {
        return;
      }

      const originalValue = baseRow[editingCell.column];
      const unchanged =
        JSON.stringify(originalValue) === JSON.stringify(parsed);

      pendingEditPerfRowKeyRef.current = editingCell.rowKey;
      perfTrackerRef?.current?.start("edit_confirm_to_draft_updated");
      setDraftUpdates((current) => {
        const next = { ...current };
        const existing = next[editingCell.rowKey] ?? {
          changes: {},
          primaryKey: Object.fromEntries(
            primaryKey.map((pk) => [pk, baseRow[pk]])
          ),
        };

        const changes = { ...existing.changes };
        if (unchanged) {
          delete changes[editingCell.column];
        } else {
          changes[editingCell.column] = parsed;
        }

        if (Object.keys(changes).length === 0) {
          delete next[editingCell.rowKey];
        } else {
          next[editingCell.rowKey] = { ...existing, changes };
        }

        return next;
      });

      cancelEditing();
    },
    [
      editingCell,
      columnMap,
      editingValue,
      primaryKey,
      setDraftInserts,
      setDraftUpdates,
      cancelEditing,
      perfTrackerRef,
    ]
  );

  return {
    beginEditExistingCell,
    beginEditInsertCell,
    cancelEditing,
    editingCell,
    editingValue,
    fkDebounceTimeoutRef,
    fkLookupRequestIdRef,
    fkOptions,
    isLoadingFk,
    keepCaretNavigationInsideInlineInput,
    loadFkOptions,
    loadFkOptionsDebounced,
    pendingEditPerfRowKeyRef,
    persistEditing,
    setEditingCell,
    setEditingValue,
    setFkOptions,
    setIsLoadingFk,
  };
}
