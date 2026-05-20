import type {
  SchemaColumn,
  SchemaTable,
  ListRowsInput,
  SaveChangesInput,
  TableRef,
  SaveChangesResponse,
  FkLookupResponse,
  FkLookupInput,
  TableRowsResponse,
} from "@/ipc/db/types";

export interface TableDataEditorProps {
  connectionId: string;
  table: SchemaTable;
  tableSaveChanges: (input: SaveChangesInput) => Promise<SaveChangesResponse>;
  tableTruncate: (tableRef: TableRef) => Promise<void>;
  tableFkLookup: (input: FkLookupInput) => Promise<FkLookupResponse>;
  onOpenRelatedTable?: (schema: string, table: string) => void;
  isSwitchingTable?: boolean;
  onRequestAddColumn?: () => void;
  onRequestDropColumn?: (columnName: string) => void;
  onRequestRenameColumn?: (columnName: string) => void;
  onRequestAlterColumnType?: (column: SchemaColumn) => void;
  onRequestSetColumnDefault?: (column: SchemaColumn) => void;
  onRequestSetColumnNullable?: (column: SchemaColumn) => void;
  isSidebarVisible?: boolean;
  onToggleSidebar?: () => void;
  onSeedData?: () => void;
  onExportData?: () => void;
}

export type RowRecord = Record<string, unknown>;

export type RowUpdateDraft = {
  primaryKey: RowRecord;
  changes: RowRecord;
};

export type DeleteDraft = {
  rowKey: string;
  primaryKey: RowRecord;
  sqlPreview: string;
};
