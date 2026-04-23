/**
 * kysely-types.ts — Kysely database type definitions for schema introspection.
 *
 * These types map to information_schema views and engine-specific system
 * tables so Kysely queries are type-safe during schema introspection.
 */

// ---------------------------------------------------------------------------
// PostgreSQL — information_schema + pg_catalog
// ---------------------------------------------------------------------------

export interface PgInformationSchema {
  schemata: PgSchemataTable;
  columns: PgColumnsTable;
  tables: PgTablesTable;
  table_constraints: PgTableConstraintsTable;
  key_column_usage: PgKeyColumnUsageTable;
  constraint_column_usage: PgConstraintColumnUsageTable;
  referential_constraints: PgReferentialConstraintsTable;
}

export interface PgSystemCatalog {
  pg_indexes: PgIndexesTable;
  pg_database: PgDatabaseTable;
  pg_type: PgTypeTable;
  pg_enum: PgEnumTable;
  pg_namespace: PgNamespaceTable;
  pg_class: PgClassTable;
  pg_policy: PgPolicyTable;
  pg_depend: PgDependTable;
  pg_attribute: PgAttributeTable;
}

export interface PgDatabase extends PgInformationSchema, PgSystemCatalog {}

interface PgSchemataTable {
  schema_name: string;
  catalog_name: string;
  schema_owner: string;
}

interface PgColumnsTable {
  table_schema: string;
  table_name: string;
  column_name: string;
  ordinal_position: number;
  data_type: string;
  udt_name: string | null;
  udt_schema: string | null;
  is_nullable: "YES" | "NO";
  column_default: string | null;
  character_maximum_length: number | null;
  numeric_precision: number | null;
  numeric_scale: number | null;
}

interface PgTablesTable {
  table_schema: string;
  table_name: string;
  table_type: "BASE TABLE" | "VIEW";
}

interface PgTableConstraintsTable {
  constraint_schema: string;
  constraint_name: string;
  constraint_type: string;
  table_schema: string;
  table_name: string;
}

interface PgKeyColumnUsageTable {
  constraint_schema: string;
  constraint_name: string;
  table_schema: string;
  table_name: string;
  column_name: string;
  ordinal_position: number;
}

interface PgConstraintColumnUsageTable {
  constraint_schema: string;
  constraint_name: string;
  table_schema: string;
  table_name: string;
  column_name: string;
}

interface PgReferentialConstraintsTable {
  constraint_schema: string;
  constraint_name: string;
  unique_constraint_schema: string | null;
  unique_constraint_name: string | null;
  match_option: string;
  update_rule: string;
  delete_rule: string;
}

interface PgIndexesTable {
  schemaname: string;
  tablename: string;
  indexname: string;
  indexdef: string;
}

interface PgDatabaseTable {
  datname: string;
  encoding: number;
}

interface PgTypeTable {
  oid: number;
  typname: string;
  typnamespace: number;
}

interface PgEnumTable {
  enumtypid: number;
  enumlabel: string;
  enumsortorder: number;
}

interface PgNamespaceTable {
  oid: number;
  nspname: string;
}

interface PgClassTable {
  oid: number;
  relname: string;
  relnamespace: number;
  relkind: string;
  relrowsecurity: boolean;
}

interface PgPolicyTable {
  oid: number;
  polname: string;
  polrelid: number;
  polcmd: string;
  polpermissive: boolean;
}

interface PgDependTable {
  objid: number;
  refobjid: number;
  refobjsubid: number;
}

interface PgAttributeTable {
  attrelid: number;
  attname: string;
  attnum: number;
  atttypid: number;
  atttypmod: number;
  attisdropped: boolean;
}

// ---------------------------------------------------------------------------
// MySQL / MariaDB — information_schema
// ---------------------------------------------------------------------------

export interface MysqlInformationSchema {
  schemata: MysqlSchemataTable;
  columns: MysqlColumnsTable;
  tables: MysqlTablesTable;
  statistics: MysqlStatisticsTable;
  key_column_usage: MysqlKeyColumnUsageTable;
  table_constraints: MysqlTableConstraintsTable;
  referential_constraints: MysqlReferentialConstraintsTable;
  views: MysqlViewsTable;
}

export interface MysqlDatabase extends MysqlInformationSchema {}

interface MysqlSchemataTable {
  CATALOG_NAME: string;
  SCHEMA_NAME: string;
}

interface MysqlColumnsTable {
  TABLE_SCHEMA: string;
  TABLE_NAME: string;
  COLUMN_NAME: string;
  ORDINAL_POSITION: number;
  COLUMN_TYPE: string;
  DATA_TYPE: string;
  IS_NULLABLE: "YES" | "NO";
  COLUMN_DEFAULT: string | null;
  EXTRA: string;
  EXPRESSION: string | null;
}

interface MysqlTablesTable {
  TABLE_SCHEMA: string;
  TABLE_NAME: string;
  TABLE_TYPE: string;
  ENGINE: string | null;
  TABLE_COLLATION: string | null;
  AUTO_INCREMENT: number | null;
  TABLE_ROWS: number | null;
}

interface MysqlStatisticsTable {
  TABLE_SCHEMA: string;
  TABLE_NAME: string;
  INDEX_NAME: string;
  COLUMN_NAME: string;
  SEQ_IN_INDEX: number;
  NON_UNIQUE: number;
}

interface MysqlKeyColumnUsageTable {
  CONSTRAINT_SCHEMA: string;
  CONSTRAINT_NAME: string;
  TABLE_SCHEMA: string;
  TABLE_NAME: string;
  COLUMN_NAME: string;
  ORDINAL_POSITION: number;
  REFERENCED_TABLE_SCHEMA: string | null;
  REFERENCED_TABLE_NAME: string | null;
  REFERENCED_COLUMN_NAME: string | null;
}

interface MysqlTableConstraintsTable {
  CONSTRAINT_SCHEMA: string;
  CONSTRAINT_NAME: string;
  TABLE_SCHEMA: string;
  TABLE_NAME: string;
  CONSTRAINT_TYPE: string;
}

interface MysqlReferentialConstraintsTable {
  CONSTRAINT_SCHEMA: string;
  CONSTRAINT_NAME: string;
  DELETE_RULE: string | null;
  UPDATE_RULE: string | null;
}

interface MysqlViewsTable {
  TABLE_SCHEMA: string;
  TABLE_NAME: string;
  VIEW_DEFINITION: string;
}

// ---------------------------------------------------------------------------
// ClickHouse — system tables
// ---------------------------------------------------------------------------

export interface ClickHouseSystem {
  databases: ChDatabasesTable;
  columns: ChColumnsTable;
  tables: ChTablesTable;
  parts: ChPartsTable;
  data_indexes: ChDataIndexesTable;
}

export interface ClickHouseDatabase extends ClickHouseSystem {}

interface ChDatabasesTable {
  name: string;
}

interface ChColumnsTable {
  database: string;
  table: string;
  name: string;
  type: string;
  position: number;
  default_kind: string;
  default_expression: string;
  is_in_primary_key: number;
}

interface ChTablesTable {
  database: string;
  name: string;
  engine: string;
  create_table_query: string;
}

interface ChPartsTable {
  database: string;
  table: string;
  rows: number;
  active: number;
  data_compressed_bytes: number;
}

interface ChDataIndexesTable {
  database: string;
  table: string;
  name: string;
}
