/**
 * DatabaseDriver — abstract interface for multi-database support.
 *
 * Every database engine (PostgreSQL, MySQL, etc.) implements this interface
 * so the IPC handlers can delegate operations without knowing the engine.
 */
import type {
  ColumnMeta,
  ConnectionInput,
  DatabaseInfo,
  DatabaseSchema,
  DatabaseType,
  IndexInfo,
  ConstraintInfo,
  TableStats,
  QueryResult,
  QueryPlanResult,
  TableSampleResult,
  SchemaSummary,
  SchemaTableDetails,
  SslMode,
  TableRowsResponse,
} from "./types";

// ---------------------------------------------------------------------------
// Connection config — the subset of Connection fields a driver needs to
// establish a connection.  Derived from ConnectionInput at the handler layer.
// ---------------------------------------------------------------------------

export interface DriverConnectionConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl_mode: SslMode;
  url?: string;
}

// ---------------------------------------------------------------------------
// DatabaseDriver interface
// ---------------------------------------------------------------------------

export interface DatabaseDriver {
  /** The engine this driver handles. */
  readonly type: DatabaseType;

  /** Default port for this engine. */
  readonly defaultPort: number;

  /** Default database name for this engine. */
  readonly defaultDatabase: string;

  /** Default username for this engine. */
  readonly defaultUsername: string;

  /** SSL modes supported by this engine. */
  readonly sslModes: SslMode[];

  /**
   * Build a connection string from structured config.
   * If `url` is provided, return it directly.
   */
  buildConnectionString(config: DriverConnectionConfig): string;

  /** Test whether a connection can be established. */
  testConnection(config: DriverConnectionConfig): Promise<boolean>;

  /** Execute a raw SQL query and return results. */
  executeQuery(connectionString: string, sql: string): Promise<QueryResult>;

  /** Fetch database metadata (version, encoding, size, etc.). */
  getDatabaseInfo(connectionString: string): Promise<DatabaseInfo>;

  /** Fetch the full schema (all schemas, tables, columns, indexes, FKs). */
  getSchema(connectionString: string): Promise<DatabaseSchema>;

  /** Fetch a lightweight summary of the schema. */
  getSchemaSummary(connectionString: string): Promise<SchemaSummary>;

  /** Fetch details for a single table. */
  getTableDetails(
    connectionString: string,
    schema: string,
    table: string,
  ): Promise<SchemaTableDetails>;

  /** Fetch index details for a specific table. */
  getIndexes(
    connectionString: string,
    schema: string,
    table: string,
  ): Promise<IndexInfo[]>;

  /** Fetch constraint details for a specific table. */
  getConstraints(
    connectionString: string,
    schema: string,
    table: string,
  ): Promise<ConstraintInfo[]>;

  /** Fetch statistics for a specific table. */
  getTableStats(
    connectionString: string,
    schema: string,
    table: string,
  ): Promise<TableStats>;

  /**
   * Get query execution plan for a SQL query.
   * Uses EXPLAIN (or equivalent) to show how the database will execute the query.
   */
  explainQuery(
    connectionString: string,
    sql: string,
    analyze?: boolean,
  ): Promise<QueryPlanResult>;

  /**
   * Get a representative sample of table data with column statistics.
   * Returns distributed sample rows and statistical summaries for AI analysis.
   */
  getTableSample(
    connectionString: string,
    schema: string,
    table: string,
    sampleSize?: number,
  ): Promise<TableSampleResult>;

  /** List rows from a table with pagination, sorting and filtering. */
  listRows(
    connectionString: string,
    schema: string,
    table: string,
    page: number,
    pageSize: number,
    sort?: Array<{ column: string; direction: "asc" | "desc" }>,
    filters?: Array<{ column: string; operator: string; value?: unknown }>,
  ): Promise<TableRowsResponse>;

  // ── DDL operations ────────────────────────────────────────────────

  createTable(
    connectionString: string,
    schema: string,
    tableName: string,
    columns: Array<{
      name: string;
      dataType: string;
      isNullable: boolean;
      isPrimaryKey?: boolean;
      isUnique?: boolean;
      defaultExpr?: string;
    }>,
    primaryKeyColumns?: string[],
    ifNotExists?: boolean,
  ): Promise<string>;

  /** Execute DROP TABLE and return the display SQL string. */
  dropTable(
    connectionString: string,
    schema: string,
    tableName: string,
    cascade?: boolean,
    ifExists?: boolean,
  ): Promise<string>;

  /** Execute RENAME TABLE and return the display SQL string. */
  renameTable(
    connectionString: string,
    schema: string,
    oldName: string,
    newName: string,
  ): Promise<string>;

  /** Execute ADD COLUMN and return the display SQL string. */
  addColumn(
    connectionString: string,
    schema: string,
    table: string,
    columnName: string,
    dataType: string,
    isNullable?: boolean,
    defaultExpr?: string,
    ifNotExists?: boolean,
  ): Promise<string>;

  /** Execute DROP COLUMN and return the display SQL string. */
  dropColumn(
    connectionString: string,
    schema: string,
    table: string,
    columnName: string,
    cascade?: boolean,
    ifExists?: boolean,
  ): Promise<string>;

  /** Execute RENAME COLUMN and return the display SQL string. */
  renameColumn(
    connectionString: string,
    schema: string,
    table: string,
    oldName: string,
    newName: string,
  ): Promise<string>;

  /** Execute ALTER COLUMN TYPE and return the display SQL string. */
  alterColumnType(
    connectionString: string,
    schema: string,
    table: string,
    columnName: string,
    newType: string,
    usingExpr?: string,
  ): Promise<string>;

  /** Execute SET/DROP NOT NULL and return the display SQL string. */
  setColumnNullable(
    connectionString: string,
    schema: string,
    table: string,
    columnName: string,
    isNullable: boolean,
  ): Promise<string>;

  /** Execute SET/DROP DEFAULT and return the display SQL string. */
  setColumnDefault(
    connectionString: string,
    schema: string,
    table: string,
    columnName: string,
    defaultExpr?: string,
  ): Promise<string>;

  /** Execute CREATE INDEX and return the display SQL string. */
  createIndex(
    connectionString: string,
    schema: string,
    table: string,
    indexName: string,
    columns: string[],
    unique?: boolean,
    ifNotExists?: boolean,
  ): Promise<string>;

  /** Execute DROP INDEX and return the display SQL string. */
  dropIndex(
    connectionString: string,
    schema: string,
    indexName: string,
    cascade?: boolean,
    ifExists?: boolean,
  ): Promise<string>;

  /** Execute CREATE SCHEMA/DATABASE and return the display SQL string. */
  createSchema(
    connectionString: string,
    schemaName: string,
    ifNotExists?: boolean,
  ): Promise<string>;

  // ── Clone / Export operations ──────────────────────────────────────

  exportSchemaDdl(
    connectionString: string,
  ): Promise<{
    scripts: Array<{
      type: string;
      schema: string;
      name: string;
      sql: string;
      dependsOn?: string[];
    }>;
    tableRowCounts: Array<{ schema: string; table: string; rowCount: number }>;
  }>;

  exportTableData(
    connectionString: string,
    schema: string,
    table: string,
    batchSize: number,
    offset: number,
  ): Promise<{
    rows: Record<string, unknown>[];
    columns: string[];
    hasMore: boolean;
    totalExported: number;
  }>;

  executeBatchDdl(
    connectionString: string,
    statements: string[],
    throwOnError?: boolean,
  ): Promise<{ errors: Array<{ sql: string; error: string }> }>;

  waitForDatabase(
    connectionString: string,
    maxRetries?: number,
    intervalMs?: number,
  ): Promise<void>;

  importTableRows(
    connectionString: string,
    schema: string,
    table: string,
    columns: string[],
    rows: Record<string, unknown>[],
  ): Promise<number>;
}
