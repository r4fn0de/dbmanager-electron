import type { SchemaColumn, SchemaForeignKey, TableSort } from "@/ipc/db/types";
import type { RowRecord, RowUpdateDraft } from "../types";

export interface EditingCell {
  rowKey: string;
  column: string;
  source: "existing" | "insert";
  insertIndex?: number;
}

export interface TableEditorGridHeaderProps {
  isAllSelected: boolean;
  isSomeSelected: boolean;
  toggleSelectAll: () => void;
  visibleColumns: string[];
  sort: TableSort[];
  columnMap: Record<string, SchemaColumn>;
  resolveColumnWidth: (columnName: string) => number;
  onSortColumn: (columnName: string) => void;
  handleResizeMouseDown: (column: string, event: React.MouseEvent) => void;
}

export interface TableEditorGridRowsProps {
  topSpacerHeight: number;
  bottomSpacerHeight: number;
  visibleColumns: string[];
  visibleDraftInserts: Array<{ row: RowRecord; insertIndex: number }>;
  editingCell: EditingCell | null;
  focusedCell: { rowKey: string; column: string } | null;
  beginEditInsertCell: (insertIndex: number, columnName: string) => void;
  setFocusedCell: React.Dispatch<
    React.SetStateAction<{ rowKey: string; column: string } | null>
  >;
  editingValue: string;
  setEditingValue: React.Dispatch<React.SetStateAction<string>>;
  loadFkOptionsDebounced: (columnName: string, query: string) => void;
  persistEditing: (baseRow?: RowRecord) => void;
  suppressInlineEditorMouseUpRef: React.RefObject<boolean>;
  keepCaretNavigationInsideInlineInput: (
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => void;
  cancelEditing: () => void;
  applyExpandedEditToInsert: (
    insertIndex: number,
    columnName: string,
    rawText: string,
  ) => void;
  visibleEffectiveRows: Array<{ row: RowRecord; rowKey: string; index: number }>;
  selectedRowKeys: Set<string>;
  draftUpdates: Record<string, RowUpdateDraft>;
  handleRowClick: (
    rowKey: string,
    index: number,
    event: React.MouseEvent,
  ) => void;
  cancelPendingHoverClear: () => void;
  showFloatingRowButton: (payload: {
    rowKey: string;
    row: RowRecord;
    index: number;
    top: number;
    left: number;
    width: number;
    height: number;
  }) => void;
  scheduleHoverClear: () => void;
  onToggleRowSelection: (rowKey: string) => void;
  findFkForColumn: (column: string) => SchemaForeignKey | undefined;
  beginEditExistingCell: (
    rowKey: string,
    row: RowRecord,
    columnName: string,
    options?: { selectAllOnFocus?: boolean },
  ) => void;
  resolveColumnWidth: (columnName: string) => number;
  effectiveRowIndexByKey: Map<string, number>;
  effectiveRowsRef: React.RefObject<
    Array<{ row: RowRecord; rowKey: string; index: number }>
  >;
  isLoadingFk: boolean;
  fkOptions: { options: Array<{ label: string; value: unknown }> } | null;
  onOpenRelatedTable?: (schema: string, table: string) => void;
  tableSchema: string;
  primaryKey: string[];
  applyExpandedEditToRow: (
    rowKey: string,
    baseRow: RowRecord,
    columnName: string,
    rawText: string,
  ) => void;
  columnMap: Record<string, SchemaColumn>;
  totalVirtualRows: number;
}

