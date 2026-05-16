import { useState, useMemo, useCallback } from "react";
import type { SchemaColumn } from "@/ipc/db/types";
import type { RowRecord, RowUpdateDraft } from "../types";
import { normalizeDisplay } from "../utils/valueParsers";
import type { EffectiveRow } from "../utils/tableDataTransforms";

export function useExpandedRow(
  effectiveRows: EffectiveRow[],
  draftUpdates: Record<string, RowUpdateDraft>,
  tableColumns: SchemaColumn[],
  applyExpandedEditToInsert: (
    insertIndex: number,
    columnName: string,
    rawText: string,
  ) => void,
  applyExpandedEditToRow: (
    rowKey: string,
    baseRow: RowRecord,
    columnName: string,
    rawText: string,
  ) => void,
) {
  const [expandedRow, setExpandedRow] = useState<{
    rowKey: string;
    row: RowRecord;
    index: number;
  } | null>(null);
  const [expandedRowOutline, setExpandedRowOutline] = useState<null | {
    top: number;
    left: number;
    width: number;
    height: number;
  }>(null);

  const openRowDetails = useCallback(
    (rowKey: string, row: RowRecord, index: number) => {
      setExpandedRow({
        rowKey,
        row: { ...row },
        index,
      });
    },
    [],
  );

  const closeRowDetails = useCallback(() => {
    setExpandedRow(null);
    setExpandedRowOutline(null);
  }, []);

  const expandedRowFields = useMemo(() => {
    if (!expandedRow) return [];
    const sourceRow =
      effectiveRows.find((entry) => entry.rowKey === expandedRow.rowKey)?.row ??
      expandedRow.row;
    const isInsertRow = expandedRow.rowKey.startsWith("insert:");
    const pendingChanges = draftUpdates[expandedRow.rowKey]?.changes ?? {};
    return tableColumns.map((column) => {
      const value = sourceRow[column.name];
      return {
        name: column.name,
        type: column.data_type,
        value,
        textValue: normalizeDisplay(value),
        hasPendingChange: isInsertRow
          ? value !== null && value !== undefined
          : Object.prototype.hasOwnProperty.call(
              pendingChanges,
              column.name,
            ),
      };
    });
  }, [draftUpdates, effectiveRows, expandedRow, tableColumns]);

  const handleFieldSaveInOverlay = useCallback(
    (columnName: string, rawText: string) => {
      if (!expandedRow) return;
      if (expandedRow.rowKey.startsWith("insert:")) {
        const insertIndex = Number(expandedRow.rowKey.slice(7));
        if (!Number.isNaN(insertIndex)) {
          applyExpandedEditToInsert(insertIndex, columnName, rawText);
        }
        return;
      }

      const entry = effectiveRows.find(
        (rowEntry) => rowEntry.rowKey === expandedRow.rowKey,
      );
      if (!entry) return;
      applyExpandedEditToRow(expandedRow.rowKey, entry.row, columnName, rawText);
    },
    [
      applyExpandedEditToInsert,
      applyExpandedEditToRow,
      effectiveRows,
      expandedRow,
    ],
  );

  return {
    expandedRow,
    setExpandedRow,
    expandedRowOutline,
    setExpandedRowOutline,
    openRowDetails,
    closeRowDetails,
    expandedRowFields,
    handleFieldSaveInOverlay,
  };
}
