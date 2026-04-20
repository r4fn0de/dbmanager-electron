// Types migrated from dblocal - Database connection and schema types
export type SslMode =
  | "disable"
  | "prefer"
  | "require"
  | "verify_ca"
  | "verify_full";

export interface Connection {
  id: string;
  name: string;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl_mode: SslMode;
  url?: string;
  is_local?: boolean;
  connection_string?: string;
  postgres_version?: string;
  tag?: string;
  color?: string;
  local_auto_start?: boolean;
}

export type ConnectionInput = Omit<Connection, "id"> & {
  id?: string;
};

export interface LocalDbInfo {
  id: string;
  name: string;
  database_name: string;
  username: string;
  running: boolean;
  port: number | null;
  connection_string: string;
  postgres_version?: string;
  externally_connectable: boolean;
  external_host: string;
  external_port: number | null;
  auto_start: boolean;
}

export interface ColumnMeta {
  name: string;
  type_name: string;
}

export interface QueryResult {
  columns: ColumnMeta[];
  rows: unknown[][];
  row_count: number;
}

export interface SchemaColumn {
  name: string;
  data_type: string;
  udt_name?: string | null;
  is_nullable: boolean;
  column_default: string | null;
}

export interface SchemaIndex {
  name: string;
  is_unique: boolean;
  is_primary: boolean;
  column_names: string[];
}

export interface SchemaForeignKey {
  name: string;
  column_name: string;
  referenced_schema?: string;
  referenced_table: string;
  referenced_column: string;
}

export interface SchemaPolicy {
  name: string;
  kind: string;
  roles: string[];
  using_expr: string | null;
  with_check_expr: string | null;
}

export interface SchemaTable {
  name: string;
  schema: string;
  columns: SchemaColumn[];
  indexes: SchemaIndex[];
  foreign_keys: SchemaForeignKey[];
  has_rls: boolean;
  rls_policies: SchemaPolicy[];
}

export interface DatabaseSchema {
  schemas: string[];
  tables: SchemaTable[];
}

export interface SchemaTableSummary {
  name: string;
  schema: string;
  has_rls: boolean;
}

export interface SchemaSummary {
  schemas: string[];
  tables: SchemaTableSummary[];
}

export interface SchemaTableDetails {
  name: string;
  schema: string;
  has_rls: boolean;
  columns: SchemaColumn[];
  indexes: SchemaIndex[];
  foreign_keys: SchemaForeignKey[];
  rls_policies: SchemaPolicy[];
}

export interface TableRef {
  connectionId: string;
  schema: string;
  table: string;
}

export interface TableSort {
  column: string;
  direction: "asc" | "desc";
}

export interface TableFilter {
  column: string;
  operator:
    | "eq"
    | "neq"
    | "contains"
    | "starts_with"
    | "ends_with"
    | "gt"
    | "gte"
    | "lt"
    | "lte"
    | "is_null"
    | "is_not_null";
  value?: unknown;
}

export interface ListRowsInput {
  tableRef: TableRef;
  page: number;
  pageSize: number;
  sort: TableSort[];
  filters: TableFilter[];
}

export interface TablePageInfo {
  page: number;
  pageSize: number;
}

export interface TableForeignKeyMeta {
  name: string;
  column_name: string;
  referenced_schema: string;
  referenced_table: string;
  referenced_column: string;
}

export interface TableRowsResponse {
  columns: ColumnMeta[];
  rows: Record<string, unknown>[];
  primaryKey: string[];
  foreignKeys: TableForeignKeyMeta[];
  pageInfo: TablePageInfo;
  totalEstimate: number;
}

export interface TableUpdateChange {
  primaryKey: Record<string, unknown>;
  changes: Record<string, unknown>;
}

export interface TableDeleteChange {
  primaryKey: Record<string, unknown>;
}

export interface SaveChangesInput {
  tableRef: TableRef;
  inserts: Record<string, unknown>[];
  updates: TableUpdateChange[];
  deletes: TableDeleteChange[];
}

export interface SaveChangesResponse {
  inserted: number;
  updated: number;
  deleted: number;
}

export interface FkLookupInput {
  tableRef: TableRef;
  column: string;
  query: string;
  page: number;
  pageSize: number;
}

export interface FkLookupOption {
  value: unknown;
  label: string;
}

export interface FkLookupResponse {
  options: FkLookupOption[];
  hasMore: boolean;
}

export interface DatabaseInfo {
  version: string;
  encoding: string;
  timezone: string;
  size?: string;
}

// DDL Types
export interface ColumnDefinition {
  name: string;
  dataType: string;
  isNullable: boolean;
  isPrimaryKey?: boolean;
  isUnique?: boolean;
  defaultExpr?: string;
}

export interface CreateTableInput {
  connectionId: string;
  schema: string;
  name: string;
  columns: ColumnDefinition[];
  primaryKeyColumns?: string[];
  ifNotExists?: boolean;
}

export interface DropTableInput {
  connectionId: string;
  schema: string;
  name: string;
  cascade?: boolean;
  ifExists?: boolean;
}

export interface RenameTableInput {
  connectionId: string;
  schema: string;
  oldName: string;
  newName: string;
}

export interface AddColumnInput {
  connectionId: string;
  schema: string;
  table: string;
  column: ColumnDefinition;
  ifNotExists?: boolean;
}

export interface DropColumnInput {
  connectionId: string;
  schema: string;
  table: string;
  column: string;
  cascade?: boolean;
  ifExists?: boolean;
}

export interface RenameColumnInput {
  connectionId: string;
  schema: string;
  table: string;
  oldName: string;
  newName: string;
}

export interface AlterColumnTypeInput {
  connectionId: string;
  schema: string;
  table: string;
  column: string;
  newType: string;
  usingExpr?: string;
}

export interface SetColumnNullableInput {
  connectionId: string;
  schema: string;
  table: string;
  column: string;
  isNullable: boolean;
}

export interface SetColumnDefaultInput {
  connectionId: string;
  schema: string;
  table: string;
  column: string;
  defaultExpr?: string;
}

export interface CreateIndexInput {
  connectionId: string;
  schema: string;
  table: string;
  name?: string;
  columns: string[];
  unique?: boolean;
  ifNotExists?: boolean;
}

export interface DropIndexInput {
  connectionId: string;
  schema: string;
  name: string;
  cascade?: boolean;
  ifExists?: boolean;
}

export interface DdlResult {
  sql: string;
}

export interface CreateSchemaInput {
  connectionId: string;
  name: string;
  ifNotExists?: boolean;
}

// Clone to Local Types
export interface DdlScript {
  type: "schema" | "table" | "index" | "constraint" | "sequence";
  schema: string;
  name: string;
  sql: string;
  dependsOn?: string[];
}

export interface TableRowCount {
  schema: string;
  table: string;
  rowCount: number;
}

export interface ExportSchemaResult {
  scripts: DdlScript[];
  tableRowCounts: TableRowCount[];
}

export interface InsertBatch {
  tableRef: TableRef;
  rows: Record<string, unknown>[];
  columns: string[];
  isLastBatch: boolean;
}

export interface ExportTableDataInput {
  connectionId: string;
  schema: string;
  table: string;
  batchSize: number;
  offset: number;
}

export interface ExportTableDataResult {
  rows: Record<string, unknown>[];
  columns: string[];
  hasMore: boolean;
  totalExported: number;
}

export interface ExecuteBatchDdlInput {
  connectionId: string;
  statements: string[];
}

export interface ImportTableRowsInput {
  connectionId: string;
  schema: string;
  table: string;
  columns: string[];
  rows: Record<string, unknown>[];
}

export interface WaitForDatabaseInput {
  connectionString: string;
  maxRetries?: number;
  intervalMs?: number;
}

export interface CloneToLocalProgress {
  stage: "schema" | "data" | "indexes" | "constraints" | "complete";
  currentTable?: string;
  tablesProcessed: number;
  totalTables: number;
  rowsProcessed: number;
  message: string;
}

export interface CloneToLocalInput {
  sourceConnectionId: string;
  targetLocalDbName: string;
  selectedTables: { schema: string; table: string; importData: boolean }[];
  postgresVersion?: string;
}
