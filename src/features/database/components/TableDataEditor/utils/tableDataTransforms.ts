import { normalizeDisplay } from "./valueParsers";
import type { RowRecord } from "../types";

export type EffectiveRow = { row: RowRecord; rowKey: string; index: number };

export function rowKeyFromPk(
  pkColumns: string[],
  row: RowRecord,
  fallback: string,
): string {
  if (pkColumns.length === 0) return fallback;
  const parts = pkColumns.map((column) => normalizeDisplay(row[column]));
  return `pk:${parts.join("|")}`;
}

export function buildEffectiveRows(
  rows: RowRecord[],
  primaryKey: string[],
  draftDeletes: Record<string, unknown>,
): EffectiveRow[] {
  return rows.reduce<EffectiveRow[]>((acc, row, index) => {
    const key = rowKeyFromPk(primaryKey, row, `row:${index}`);
    if (!draftDeletes[key]) {
      acc.push({ row, rowKey: key, index });
    }
    return acc;
  }, []);
}

export function getGridCellIndex(
  rowIndex: number,
  columnIndex: number,
  columnsCount: number,
): number {
  return rowIndex * columnsCount + columnIndex;
}

