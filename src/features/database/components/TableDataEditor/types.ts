import type {
  FkLookupInput,
  FkLookupResponse,
  SaveChangesInput,
  SaveChangesResponse,
  SchemaColumn,
  SchemaTable,
  TableRef,
} from "@/ipc/db/types";

export interface TableDataEditorProps {
  connectionId: string;
  disableWindowUnsavedTracking?: boolean;
  isSidebarVisible?: boolean;
  isSwitchingTable?: boolean;
  onDirtyChange?: (tableKey: string, dirty: boolean) => void;
  onExportData?: () => void;
  onOpenRelatedTable?: (schema: string, table: string) => void;
  onRequestAddColumn?: () => void;
  onRequestAlterColumnType?: (column: SchemaColumn) => void;
  onRequestDropColumn?: (columnName: string) => void;
  onRequestRenameColumn?: (columnName: string) => void;
  onRequestSetColumnDefault?: (column: SchemaColumn) => void;
  onRequestSetColumnNullable?: (column: SchemaColumn) => void;
  onSeedData?: () => void;
  onToggleSidebar?: () => void;
  table: SchemaTable;
  tableFkLookup: (input: FkLookupInput) => Promise<FkLookupResponse>;
  tableKey?: string;
  tableSaveChanges: (input: SaveChangesInput) => Promise<SaveChangesResponse>;
  tableTruncate: (tableRef: TableRef) => Promise<void>;
}

export interface TableDataEditorHandle {
  discardAllChanges: () => void;
  hasDraftChanges: () => boolean;
  saveAllChanges: () => Promise<void>;
  saveAllDraftsAcrossTabs: () => Promise<void>;
}

export type RowRecord = Record<string, unknown>;

export interface RowUpdateDraft {
  primaryKey: RowRecord;
  changes: RowRecord;
}

export interface DeleteDraft {
  rowKey: string;
  primaryKey: RowRecord;
  sqlPreview: string;
}
