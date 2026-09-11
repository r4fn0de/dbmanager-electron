import type { VirtualItem } from "@tanstack/react-virtual";
import type { SchemaColumn, SchemaForeignKey, TableSort } from "@/ipc/db/types";
import type { RowRecord, RowUpdateDraft } from "../types";

export interface EditingCell {
  column: string;
  insertIndex?: number;
  rowKey: string;
  source: "existing" | "insert";
}

export interface TableEditorGridHeaderProps {
  columnMap: Record<string, SchemaColumn>;
  handleResizeMouseDown: (column: string, event: React.MouseEvent) => void;
  isAllSelected: boolean;
  isSomeSelected: boolean;
  onSortColumn: (columnName: string) => void;
  resolveColumnWidth: (columnName: string) => number;
  sort: TableSort[];
  toggleSelectAll: () => void;
  totalColumnWidth: number;
  virtualColumns: VirtualItem[];
  visibleColumns: string[];
}

export interface TableEditorGridRowsProps {
  applyExpandedEditToInsert: (
    insertIndex: number,
    columnName: string,
    rawText: string
  ) => void;
  applyExpandedEditToRow: (
    rowKey: string,
    baseRow: RowRecord,
    columnName: string,
    rawText: string
  ) => void;
  beginEditExistingCell: (
    rowKey: string,
    row: RowRecord,
    columnName: string,
    options?: { selectAllOnFocus?: boolean }
  ) => void;
  beginEditInsertCell: (insertIndex: number, columnName: string) => void;
  cancelEditing: () => void;
  cancelPendingHoverClear: () => void;
  columnMap: Record<string, SchemaColumn>;
  draftInsertCount: number;
  draftUpdates: Record<string, RowUpdateDraft>;
  editingCell: EditingCell | null;
  editingValue: string;
  effectiveRowIndexByKey: Map<string, number>;
  effectiveRowsRef: React.RefObject<
    Array<{ row: RowRecord; rowKey: string; index: number }>
  >;
  findFkForColumn: (column: string) => SchemaForeignKey | undefined;
  fkOptions: { options: Array<{ label: string; value: unknown }> } | null;
  focusedCell: { rowKey: string; column: string } | null;
  handleRowClick: (
    rowKey: string,
    index: number,
    event: React.MouseEvent
  ) => void;
  isLoadingFk: boolean;
  keepCaretNavigationInsideInlineInput: (
    event: React.KeyboardEvent<HTMLInputElement>
  ) => void;
  loadFkOptionsDebounced: (columnName: string, query: string) => void;
  onOpenRelatedTable?: (schema: string, table: string) => void;
  onToggleRowSelection: (rowKey: string) => void;
  persistEditing: (baseRow?: RowRecord) => void;
  primaryKey: string[];
  resolveColumnWidth: (columnName: string) => number;
  scheduleHoverClear: () => void;
  selectedRowKeys: Set<string>;
  setEditingValue: React.Dispatch<React.SetStateAction<string>>;
  setFocusedCell: React.Dispatch<
    React.SetStateAction<{ rowKey: string; column: string } | null>
  >;
  showFloatingRowButton: (payload: {
    rowKey: string;
    row: RowRecord;
    index: number;
    top: number;
    left: number;
    width: number;
    height: number;
  }) => void;
  suppressInlineEditorMouseUpRef: React.RefObject<boolean>;
  tableSchema: string;
  totalColumnWidth: number;
  totalRowHeight: number;
  totalVirtualRows: number;
  virtualColumns: VirtualItem[];
  virtualRows: VirtualItem[];
  visibleColumns: string[];
  visibleDraftInserts: Array<{ row: RowRecord; insertIndex: number }>;
  visibleEffectiveRows: Array<{
    row: RowRecord;
    rowKey: string;
    index: number;
    virtualIndex: number;
  }>;
}
