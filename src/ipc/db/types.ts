// Types migrated from dblocal - Database connection and schema types

// ---------------------------------------------------------------------------
// Branch types — for local DB branching (Phase 1: PostgreSQL only)
// ---------------------------------------------------------------------------

/** Metadata for a branch within a local database. */
export interface BranchMeta {
  /** ISO timestamp of branch creation */
  createdAt: string;
  /** Sanitized branch name used in the PostgreSQL database name */
  dbName: string;
  /** Description/notes for this branch (optional, user-editable) */
  description?: string;
  /** Unique ID for this branch (UUID) */
  id: string;
  /** Whether this branch is the main/default branch */
  isMain: boolean;
  /** ISO timestamp of last merge into this branch (if any) */
  lastMergedAt?: string;
  /** User-chosen branch name (e.g., "feature/add-uuid") */
  name: string;
  /** The parent branch ID — "main" for branches off the main branch */
  parentId: string;
}

/** Branch info returned to the renderer — includes runtime state. */
export interface BranchInfo {
  /** Full connection string for this branch */
  connectionString: string;
  createdAt: string;
  /** The PostgreSQL database name for this branch */
  databaseName: string;
  description?: string;
  id: string;
  isActive: boolean;
  isMain: boolean;
  lastMergedAt?: string;
  name: string;
  parentId: string;
}

export interface BranchDeletePreview {
  branchesToDelete: BranchInfo[];
  count: number;
}

export interface MergeBranchSchemaResult {
  applied: number;
  errors: Array<{ sql: string; error: string }>;
  statements: string[];
}

export type DatabaseType =
  | "postgresql"
  | "mysql"
  | "mariadb"
  | "clickhouse"
  | "sqlite"
  | "redis";

export type SslMode =
  | "disable"
  | "prefer"
  | "require"
  | "verify_ca"
  | "verify_full";

/** Get the effective port for ClickHouse.
 *
 * `@clickhouse/client` uses HTTP protocol, so it needs the HTTP(S) port
 * (8123 or 8443), not the native protocol port (9000 or 9440).
 *
 * Conversions:
 *   - Port 9000 (native) → 8123 (HTTP) or 8443 (HTTPS)
 *   - Port 9440 (native TLS) → 8443 (HTTPS)
 *   - Port 8123 with SSL require → 8443 (HTTPS)
 *   - Any other port → returned as-is
 */
export function getClickhouseEffectivePort(
  sslMode: SslMode,
  configuredPort: number
): number {
  // SSL require with default HTTP port → HTTPS port
  if (sslMode === "require" && configuredPort === 8123) {
    return 8443;
  }
  // Native protocol port (9000) → HTTP (8123) or HTTPS (8443)
  if (configuredPort === 9000) {
    return sslMode === "require" ? 8443 : 8123;
  }
  // Native TLS protocol port (9440) → HTTPS (8443)
  if (configuredPort === 9440) {
    return 8443;
  }
  return configuredPort;
}

export interface Connection {
  color?: string;
  connection_string?: string;
  database: string;
  db_type: DatabaseType;
  engine_version?: string; // Renamed from postgres_version for multi-db support
  host: string;
  id: string;
  is_local?: boolean;
  local_auto_start?: boolean;
  name: string;
  password: string;
  port: number;
  /** @deprecated Use engine_version instead */
  postgres_version?: string;
  ssl_mode: SslMode;
  tag?: string;
  url?: string;
  username: string;
}

export type ConnectionInput = Omit<Connection, "id"> & {
  id?: string;
  /** Optional — defaults to "postgresql" for backward compatibility */
  db_type?: DatabaseType;
};

/** Engine type for local databases — determines how the instance is managed. */
export type LocalDbEngine = "postgresql" | "sqlite";

export interface LocalDbInfo {
  auto_start: boolean;
  connection_string: string;
  database_name: string;
  /** Which engine powers this local DB. */
  engine: LocalDbEngine;
  external_host: string;
  external_port: number | null;
  externally_connectable: boolean;
  /** SQLite-specific: absolute path to the .db file on disk. */
  file_path?: string;
  id: string;
  name: string;
  port: number | null;
  /** @deprecated Use engine instead. Kept for backward compat. */
  postgres_version?: string;
  running: boolean;
  username: string;
}

export interface ColumnMeta {
  name: string;
  type_name: string;
}

export interface QueryResult {
  columns: ColumnMeta[];
  row_count: number;
  rows: unknown[][];
  /** Total row count before truncation (only present when truncated is true) */
  totalRowCount?: number;
  /** Whether the result set was truncated because it exceeded the safety limit */
  truncated?: boolean;
}

export interface SchemaColumn {
  column_default: string | null;
  data_type: string;
  is_nullable: boolean;
  name: string;
  udt_name?: string | null;
}

export interface SchemaIndex {
  column_names: string[];
  is_primary: boolean;
  is_unique: boolean;
  name: string;
}

export interface SchemaForeignKey {
  column_name: string;
  name: string;
  referenced_column: string;
  referenced_schema?: string;
  referenced_table: string;
}

export interface SchemaPolicy {
  kind: string;
  name: string;
  roles: string[];
  using_expr: string | null;
  with_check_expr: string | null;
}

export interface SchemaTable {
  columns: SchemaColumn[];
  foreign_keys: SchemaForeignKey[];
  has_rls: boolean;
  indexes: SchemaIndex[];
  name: string;
  rls_policies: SchemaPolicy[];
  schema: string;
}

export interface DatabaseSchema {
  schemas: string[];
  tables: SchemaTable[];
}

export interface SchemaTableSummary {
  /** True when this table was matched by AI semantic search (not fuzzy). */
  aiMatch?: boolean;
  /** Estimated row count (approximate, from DB statistics). 0 means unknown/empty. */
  estimated_row_count: number;
  has_rls: boolean;
  name: string;
  schema: string;
}

export interface SchemaSummary {
  schemas: string[];
  tables: SchemaTableSummary[];
}

export interface SchemaTableDetails {
  columns: SchemaColumn[];
  foreign_keys: SchemaForeignKey[];
  has_rls: boolean;
  indexes: SchemaIndex[];
  name: string;
  rls_policies: SchemaPolicy[];
  schema: string;
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
  cursor?: string;
  exact?: boolean;
  filters: TableFilter[];
  page: number;
  pageSize: number;
  sort: TableSort[];
  tableRef: TableRef;
}

export interface TablePageInfo {
  hasNextPage?: boolean;
  nextCursor?: string;
  page: number;
  pageSize: number;
}

export interface TableForeignKeyMeta {
  column_name: string;
  name: string;
  referenced_column: string;
  referenced_schema: string;
  referenced_table: string;
}

export interface TableRowsResponse {
  columns: ColumnMeta[];
  filtersAppliedOnServer?: boolean;
  foreignKeys: TableForeignKeyMeta[];
  pageInfo: TablePageInfo;
  primaryKey: string[];
  rows: Record<string, unknown>[];
  sortAppliedOnServer?: boolean;
  totalEstimate: number;
  totalIsEstimated?: boolean;
}

export interface TableUpdateChange {
  changes: Record<string, unknown>;
  primaryKey: Record<string, unknown>;
}

export interface TableDeleteChange {
  primaryKey: Record<string, unknown>;
}

export interface SaveChangesInput {
  deletes: TableDeleteChange[];
  inserts: Record<string, unknown>[];
  tableRef: TableRef;
  updates: TableUpdateChange[];
}

export interface SaveChangesResponse {
  deleted: number;
  inserted: number;
  updated: number;
}

export interface FkLookupInput {
  column: string;
  page: number;
  pageSize: number;
  query: string;
  tableRef: TableRef;
}

export interface FkLookupOption {
  label: string;
  value: unknown;
}

export interface FkLookupResponse {
  hasMore: boolean;
  options: FkLookupOption[];
}

export interface DatabaseInfo {
  /** Number of currently active connections to this database */
  activeConnections?: number;
  /** Cache hit ratio as a percentage (0–100), for buffer/cache efficiency */
  cacheHitRatio?: number;
  /** Database name (useful when connection uses a default) */
  databaseName?: string;
  /** Number of dead tuples across all user tables (indicates need for vacuum) */
  deadTuples?: number;
  encoding: string;
  /** Maximum allowed connections (if available) */
  maxConnections?: number;
  size?: string;
  timezone: string;
  /** Server uptime as a human-readable string (e.g. "3 days, 2:14:30") */
  uptime?: string;
  version: string;
  /** Number of committed transactions (for health monitoring) */
  xactCommit?: number;
  /** Number of rolled-back transactions */
  xactRollback?: number;
}

// DDL Types
export interface ColumnDefinition {
  dataType: string;
  defaultExpr?: string;
  isNullable: boolean;
  isPrimaryKey?: boolean;
  isUnique?: boolean;
  name: string;
  /** Foreign key reference: schema.table(column) */
  references?: string;
}

export interface CreateTableInput {
  columns: ColumnDefinition[];
  connectionId: string;
  ifNotExists?: boolean;
  name: string;
  primaryKeyColumns?: string[];
  schema: string;
}

export interface DropTableInput {
  cascade?: boolean;
  connectionId: string;
  ifExists?: boolean;
  name: string;
  schema: string;
}

export interface RenameTableInput {
  connectionId: string;
  newName: string;
  oldName: string;
  schema: string;
}

export interface AddColumnInput {
  column: ColumnDefinition;
  connectionId: string;
  ifNotExists?: boolean;
  schema: string;
  table: string;
}

export interface DropColumnInput {
  cascade?: boolean;
  column: string;
  connectionId: string;
  ifExists?: boolean;
  schema: string;
  table: string;
}

export interface RenameColumnInput {
  connectionId: string;
  newName: string;
  oldName: string;
  schema: string;
  table: string;
}

export interface AlterColumnTypeInput {
  column: string;
  connectionId: string;
  newType: string;
  schema: string;
  table: string;
  usingExpr?: string;
}

export interface SetColumnNullableInput {
  column: string;
  connectionId: string;
  isNullable: boolean;
  schema: string;
  table: string;
}

export interface SetColumnDefaultInput {
  column: string;
  connectionId: string;
  defaultExpr?: string;
  schema: string;
  table: string;
}

export interface CreateIndexInput {
  columns: string[];
  connectionId: string;
  ifNotExists?: boolean;
  name?: string;
  schema: string;
  table: string;
  unique?: boolean;
}

export interface DropIndexInput {
  cascade?: boolean;
  connectionId: string;
  ifExists?: boolean;
  name: string;
  schema: string;
}

export interface DdlResult {
  sql: string;
}

export interface CreateSchemaInput {
  connectionId: string;
  ifNotExists?: boolean;
  name: string;
}

// Clone to Local Types
export interface DdlScript {
  dependsOn?: string[];
  name: string;
  schema: string;
  sql: string;
  type: "schema" | "type" | "table" | "index" | "constraint" | "sequence";
}

export interface TableRowCount {
  rowCount: number;
  schema: string;
  table: string;
}

export interface ExportSchemaResult {
  scripts: DdlScript[];
  tableRowCounts: TableRowCount[];
}

export interface InsertBatch {
  columns: string[];
  isLastBatch: boolean;
  rows: Record<string, unknown>[];
  tableRef: TableRef;
}

export interface ExportTableDataInput {
  batchSize: number;
  connectionId: string;
  offset: number;
  schema: string;
  table: string;
}

export interface ExportTableDataResult {
  columns: string[];
  hasMore: boolean;
  rows: Record<string, unknown>[];
  totalExported: number;
}

export interface ExecuteBatchDdlInput {
  connectionId: string;
  statements: string[];
}

export interface ImportTableRowsInput {
  columns: string[];
  connectionId: string;
  rows: Record<string, unknown>[];
  schema: string;
  table: string;
}

export interface ImportColumnMeta {
  dataType: string;
  isNullable: boolean;
  name: string;
}

export interface ImportTableColumnsInput {
  connectionId: string;
  schema: string;
  table: string;
}

export interface ImportDryRunInput {
  batchSize?: number;
  columns: string[];
  connectionId: string;
  rows: Record<string, unknown>[];
  schema: string;
  table: string;
}

export interface ImportDryRunIssue {
  message: string;
  rowIndex: number;
}

export interface ImportDryRunResult {
  invalidRows: number;
  issues: ImportDryRunIssue[];
  validRows: number;
}

export interface CreateTableFromImportColumn {
  dataType: string;
  isNullable: boolean;
  name: string;
}

export interface CreateTableFromImportInput {
  columns: CreateTableFromImportColumn[];
  connectionId: string;
  ifNotExists?: boolean;
  primaryKeyColumns?: string[];
  schema: string;
  table: string;
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
  intervalMs?: number;
  maxRetries?: number;
}

export interface CloneToLocalProgress {
  currentTable?: string;
  message: string;
  rowsProcessed: number;
  stage: "schema" | "data" | "indexes" | "constraints" | "complete";
  tablesProcessed: number;
  totalTables: number;
}

export interface CloneToLocalInput {
  postgresVersion?: string;
  selectedTables: { schema: string; table: string; importData: boolean }[];
  sourceConnectionId: string;
  targetLocalDbName: string;
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
  argument_count: number;
  /** Full argument list as a string, e.g. "(a integer, b text)" */
  arguments: string | null;
  /** Source/body of the function, if available */
  definition: string | null;
  language: string | null;
  name: string;
  return_type: string | null;
  schema: string;
  type: "function" | "procedure";
}

export interface SchemaTrigger {
  /** Full trigger definition statement */
  definition: string | null;
  /** Whether the trigger is currently enabled */
  enabled: boolean;
  event: string;
  /** The function/procedure called by the trigger */
  function_name: string | null;
  name: string;
  schema: string;
  table: string;
  timing: string;
}

// ---------------------------------------------------------------------------
// AI Tool Types — for database introspection tools
// ---------------------------------------------------------------------------

export interface IndexInfo {
  columns: string[];
  isPrimary: boolean;
  isUnique: boolean;
  name: string;
  schema: string;
  table: string;
  type?: string;
}

export type ConstraintType =
  | "primary_key"
  | "unique"
  | "foreign_key"
  | "check"
  | "exclude"
  | "not_null";

export interface ConstraintInfo {
  columns: string[];
  definition?: string;
  deleteRule?: string;
  name: string;
  referencedColumns?: string[];
  // For foreign keys
  referencedSchema?: string;
  referencedTable?: string;
  schema: string;
  table: string;
  type: ConstraintType;
  updateRule?: string;
}

export interface TableStats {
  lastAnalyze?: string | null;
  lastAutoanalyze?: string | null;
  lastVacuum?: string | null;
  rowCount: number;
  schema: string;
  sizeBytes: number;
  sizeFormatted: string;
  table: string;
}

/** Result of EXPLAIN/EXPLAIN ANALYZE query execution */
export interface QueryPlanResult {
  /** Estimated/actual row count if available */
  estimatedRows?: number;
  /** Execution time in ms if ANALYZE was used */
  executionTimeMs?: number;
  /** Whether the plan includes actual execution stats (ANALYZE) */
  hasExecutionStats: boolean;
  /** Raw query plan output (format varies by database) */
  plan: string;
  /** Estimated/actual cost if available */
  totalCost?: number;
}

/** Statistical sample of table data for AI analysis */
export interface TableSampleResult {
  /** Column statistics (min/max/avg for numeric, top values for categorical) */
  columnStats: ColumnStat[];
  /** Sample rows (distributed/stratified if possible) */
  rows: Record<string, unknown>[];
  /** Sample size */
  sampleSize: number;
  /** Total row count in table */
  totalRows: number;
}

/** Statistics for a single column */
export interface ColumnStat {
  avg?: number;
  columnName: string;
  dataType: string;
  max?: number | string;
  /** For numeric columns */
  min?: number | string;
  /** Null percentage (0-100) */
  nullPercentage?: number;
  /** For string/categorical columns - top N most frequent values */
  topValues?: { value: string; count: number }[];
  /** Unique value count (approximation for large tables) */
  uniqueCount?: number;
}
