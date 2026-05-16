import { useState, useRef, useMemo, useCallback } from "react";
import type { DeleteDraft, RowRecord } from "../types";
import { quoteIdentifier, quoteValue } from "../utils/sqlHelpers";
import type { EffectiveRow } from "../utils/tableDataTransforms";

export function useRowSelection(
  effectiveRows: EffectiveRow[],
  primaryKey: string[],
  tableSchema: string,
  tableName: string,
  setDraftDeletes: React.Dispatch<
    React.SetStateAction<Record<string, DeleteDraft>>
  >,
  focusedCell: { rowKey: string; column: string } | null,
  setFocusedCell: React.Dispatch<
    React.SetStateAction<{ rowKey: string; column: string } | null>
  >,
) {
  const [selectedRowKeys, setSelectedRowKeys] = useState<Set<string>>(
    new Set(),
  );
  const lastClickedRowRef = useRef<{ rowKey: string; index: number } | null>(
    null,
  );

  const allVisibleRowKeys = useMemo(
    () => new Set(effectiveRows.map((r) => r.rowKey)),
    [effectiveRows],
  );

  const isAllSelected =
    allVisibleRowKeys.size > 0 &&
    [...allVisibleRowKeys].every((key) => selectedRowKeys.has(key));

  const isSomeSelected =
    !isAllSelected &&
    [...allVisibleRowKeys].some((key) => selectedRowKeys.has(key));

  const toggleSelectAll = useCallback(() => {
    if (isAllSelected) {
      setSelectedRowKeys(new Set());
    } else {
      setSelectedRowKeys(new Set(allVisibleRowKeys));
    }
  }, [isAllSelected, allVisibleRowKeys]);

  const handleRowClick = useCallback(
    (rowKey: string, index: number, event: React.MouseEvent) => {
      const target = event.target as HTMLElement;
      if (
        target.closest(
          "input,textarea,select,button,a,[contenteditable='true']",
        )
      ) {
        return;
      }
      if (event.shiftKey && lastClickedRowRef.current) {
        const start = Math.min(lastClickedRowRef.current.index, index);
        const end = Math.max(lastClickedRowRef.current.index, index);
        const rangeKeys = effectiveRows
          .slice(start, end + 1)
          .map((r) => r.rowKey);
        setSelectedRowKeys((prev) => {
          const next = new Set(prev);
          for (const key of rangeKeys) next.add(key);
          return next;
        });
      } else if (event.metaKey || event.ctrlKey) {
        setSelectedRowKeys((prev) => {
          const next = new Set(prev);
          if (next.has(rowKey)) next.delete(rowKey);
          else next.add(rowKey);
          return next;
        });
      } else {
        setSelectedRowKeys((prev) => {
          if (prev.size === 1 && prev.has(rowKey)) return new Set();
          return new Set([rowKey]);
        });
      }
      lastClickedRowRef.current = { rowKey, index };
    },
    [effectiveRows],
  );

  const clearSelectionOnOutsideClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      if (target.closest('[data-row-selection-scope="row"]')) return;
      if (!focusedCell) return;
      setFocusedCell(null);
    },
    [focusedCell, setFocusedCell],
  );

  const batchDeleteSelected = useCallback(() => {
    if (primaryKey.length === 0) return;
    const toDelete: Record<string, DeleteDraft> = {};
    const effectiveRowsByKey = new Map(
      effectiveRows.map((entry) => [entry.rowKey, entry]),
    );
    for (const rowKey of selectedRowKeys) {
      const entry = effectiveRowsByKey.get(rowKey);
      if (!entry) continue;
      const row = entry.row;
      const pk = Object.fromEntries(
        primaryKey.map((column) => [column, row[column]]),
      );
      const whereSql = primaryKey
        .map((column) => {
          const value = pk[column];
          return value === null || value === undefined
            ? `${quoteIdentifier(column)} IS NULL`
            : `${quoteIdentifier(column)} = ${quoteValue(value)}`;
        })
        .join(" AND ");
      toDelete[rowKey] = {
        rowKey,
        primaryKey: pk,
        sqlPreview: `DELETE FROM ${quoteIdentifier(tableSchema)}.${quoteIdentifier(tableName)} WHERE ${whereSql};`,
      };
    }
    setDraftDeletes((current) => ({ ...current, ...toDelete }));
    setSelectedRowKeys(new Set());
  }, [
    primaryKey,
    selectedRowKeys,
    effectiveRows,
    tableSchema,
    tableName,
    setDraftDeletes,
  ]);

  const toggleRowSelection = useCallback((rowKey: string) => {
    setSelectedRowKeys((prev) => {
      const next = new Set(prev);
      if (next.has(rowKey)) next.delete(rowKey);
      else next.add(rowKey);
      return next;
    });
  }, []);

  return {
    selectedRowKeys,
    setSelectedRowKeys,
    lastClickedRowRef,
    isAllSelected,
    isSomeSelected,
    toggleSelectAll,
    handleRowClick,
    toggleRowSelection,
    batchDeleteSelected,
    clearSelectionOnOutsideClick,
  };
}
