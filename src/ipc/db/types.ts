// Types migrated from dblocal - Database connection and schema types

// ---------------------------------------------------------------------------
// Branch types — for local DB branching (Phase 1: PostgreSQL only)
// ---------------------------------------------------------------------------

/** Metadata for a branch within a local database. */
export interface BranchMeta {
  /** Unique ID for this branch (UUID) */
  id: string;
  /** User-chosen branch name (e.g., "feature/add-uuid") */
  name: string;
  /** Sanitized branch name used in the PostgreSQL database name */
  dbName: string;
  /** The parent branch ID — "main" for branches off the main branch */
  parentId: string;
  /** ISO timestamp of branch creation */
  createdAt: string;
  /** ISO timestamp of last merge into this branch (if any) */
  lastMergedAt?: string;
  /** Whether this branch is the main/default branch */
  isMain: boolean;
  /** Description/notes for this branch (optional, user-editable) */
  description?: string;
}

/** Branch info returned to the renderer — includes runtime state. */
export interface BranchInfo {
  id: string;
  name: string;
  parentId: string;
  isMain: boolean;
  isActive: boolean;
  createdAt: string;
  lastMergedAt?: string;
  description?: string;
  /** The PostgreSQL database name for this branch */
  databaseName: string;
  /** Full connection string for this branch */
  connectionString: string;
}

export interface BranchDeletePreview {
  branchesToDelete: BranchInfo[];
  count: number;
}

export interface MergeBranchSchemaResult {
  statements: string[];
  applied: number;
  errors: Array<{ sql: string; error: string }>;
}

export type DatabaseType = "postgresql" | "mysql" | "mariadb" | "clickhouse" | "sqlite" | "redis";

export type SslMode =
  | "disable"
  | "prefer"
  | "require"
  | "verify_ca"
  | "verify_full";

/** Get the effective port for ClickHouse — switches 8123→8443 when SSL is required. */
export function getClickhouseEffectivePort(sslMode: SslMode, configuredPort: number): number {
  return sslMode === "require" && configuredPort === 8123 ? 8443 : configuredPort;
}

export interface Connection {
  id: string;
  name: string;
  db_type: DatabaseType;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl_mode: SslMode;
  url?: string;
  is_local?: boolean;
  connection_string?: string;
  engine_version?: string; // Renamed from postgres_version for multi-db support
  /** @deprecated Use engine_version instead */
  postgres_version?: string;
  tag?: string;
  color?: string;
  local_auto_start?: boolean;
}

export type ConnectionInput = Omit<Connection, "id"> & {
  id?: string;
  /** Optional — defaults to "postgresql" for backward compatibility */
  db_type?: DatabaseType;
};

/** Engine type for local databases — determines how the instance is managed. */
export type LocalDbEngine = "postgresql" | "sqlite";

export interface LocalDbInfo {
  id: string;
  name: string;
  database_name: string;
  username: string;
  running: boolean;
  port: number | null;
  connection_string: string;
  /** Which engine powers this local DB. */
  engine: LocalDbEngine;
  /** @deprecated Use engine instead. Kept for backward compat. */
  postgres_version?: string;
  /** SQLite-specific: absolute path to the .db file on disk. */
  file_path?: string;
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
  /** Whether the result set was truncated because it exceeded the safety limit */
  truncated?: boolean;
  /** Total row count before truncation (only present when truncated is true) */
  totalRowCount?: number;
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
  /** Estimated row count (approximate, from DB statistics). 0 means unknown/empty. */
  estimated_row_count: number;
  /** True when this table was matched by AI semantic search (not fuzzy). */
  aiMatch?: boolean;
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
  sortAppliedOnServer?: boolean;
  filtersAppliedOnServer?: boolean;
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
  /** Server uptime as a human-readable string (e.g. "3 days, 2:14:30") */
  uptime?: string;
  /** Number of currently active connections to this database */
  activeConnections?: number;
  /** Maximum allowed connections (if available) */
  maxConnections?: number;
  /** Cache hit ratio as a percentage (0–100), for buffer/cache efficiency */
  cacheHitRatio?: number;
  /** Number of committed transactions (for health monitoring) */
  xactCommit?: number;
  /** Number of rolled-back transactions */
  xactRollback?: number;
  /** Number of dead tuples across all user tables (indicates need for vacuum) */
  deadTuples?: number;
  /** Database name (useful when connection uses a default) */
  databaseName?: string;
}

// DDL Types
export interface ColumnDefinition {
  name: string;
  dataType: string;
  isNullable: boolean;
  isPrimaryKey?: boolean;
  isUnique?: boolean;
  defaultExpr?: string;
  /** Foreign key reference: schema.table(column) */
  references?: string;
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
  type: "schema" | "type" | "table" | "index" | "constraint" | "sequence";
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

export interface ImportColumnMeta {
  name: string;
  dataType: string;
  isNullable: boolean;
}

export interface ImportTableColumnsInput {
  connectionId: string;
  schema: string;
  table: string;
}

export interface ImportDryRunInput {
  connectionId: string;
  schema: string;
  table: string;
  columns: string[];
  rows: Record<string, unknown>[];
  batchSize?: number;
}

export interface ImportDryRunIssue {
  rowIndex: number;
  message: string;
}

export interface ImportDryRunResult {
  validRows: number;
  invalidRows: number;
  issues: ImportDryRunIssue[];
}

export interface CreateTableFromImportColumn {
  name: string;
  dataType: string;
  isNullable: boolean;
}

export interface CreateTableFromImportInput {
  connectionId: string;
  schema: string;
  table: string;
  ifNotExists?: boolean;
  columns: CreateTableFromImportColumn[];
  primaryKeyColumns?: string[];
}

export interface ExportScopeInput {
  connectionId: string;
  schema: string;
  table?: string;
}

export interface ExportSchemaIndexesResult {
  scripts: DdlScript[];
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

// ---------------------------------------------------------------------------
// Schema definition types — Constraints, Enums, Functions, Triggers
// ---------------------------------------------------------------------------

export interface SchemaEnum {
  name: string;
  schema: string;
  values: string[];
}

export interface SchemaFunction {
  name: string;
  schema: string;
  type: "function" | "procedure";
  language: string | null;
  return_type: string | null;
  argument_count: number;
  /** Full argument list as a string, e.g. "(a integer, b text)" */
  arguments: string | null;
  /** Source/body of the function, if available */
  definition: string | null;
}

export interface SchemaTrigger {
  name: string;
  schema: string;
  table: string;
  event: string;
  timing: string;
  /** Whether the trigger is currently enabled */
  enabled: boolean;
  /** The function/procedure called by the trigger */
  function_name: string | null;
  /** Full trigger definition statement */
  definition: string | null;
}

// ---------------------------------------------------------------------------
// AI Tool Types — for database introspection tools
// ---------------------------------------------------------------------------

export interface IndexInfo {
  name: string;
  schema: string;
  table: string;
  columns: string[];
  isUnique: boolean;
  isPrimary: boolean;
  type?: string;
}

export type ConstraintType = "primary_key" | "unique" | "foreign_key" | "check" | "exclude" | "not_null";

export interface ConstraintInfo {
  name: string;
  schema: string;
  table: string;
  type: ConstraintType;
  columns: string[];
  definition?: string;
  // For foreign keys
  referencedSchema?: string;
  referencedTable?: string;
  referencedColumns?: string[];
  updateRule?: string;
  deleteRule?: string;
}

export interface TableStats {
  schema: string;
  table: string;
  rowCount: number;
  sizeBytes: number;
  sizeFormatted: string;
  lastVacuum?: string | null;
  lastAnalyze?: string | null;
  lastAutoanalyze?: string | null;
}

/** Result of EXPLAIN/EXPLAIN ANALYZE query execution */
export interface QueryPlanResult {
  /** Raw query plan output (format varies by database) */
  plan: string;
  /** Whether the plan includes actual execution stats (ANALYZE) */
  hasExecutionStats: boolean;
  /** Estimated/actual cost if available */
  totalCost?: number;
  /** Estimated/actual row count if available */
  estimatedRows?: number;
  /** Execution time in ms if ANALYZE was used */
  executionTimeMs?: number;
}

/** Statistical sample of table data for AI analysis */
export interface TableSampleResult {
  /** Sample rows (distributed/stratified if possible) */
  rows: Record<string, unknown>[];
  /** Column statistics (min/max/avg for numeric, top values for categorical) */
  columnStats: ColumnStat[];
  /** Total row count in table */
  totalRows: number;
  /** Sample size */
  sampleSize: number;
}

/** Statistics for a single column */
export interface ColumnStat {
  columnName: string;
  dataType: string;
  /** For numeric columns */
  min?: number | string;
  max?: number | string;
  avg?: number;
  /** For string/categorical columns - top N most frequent values */
  topValues?: { value: string; count: number }[];
  /** Null percentage (0-100) */
  nullPercentage?: number;
  /** Unique value count (approximation for large tables) */
  uniqueCount?: number;
}
