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
  columns: PgColumnsTable;
  constraint_column_usage: PgConstraintColumnUsageTable;
  key_column_usage: PgKeyColumnUsageTable;
  referential_constraints: PgReferentialConstraintsTable;
  schemata: PgSchemataTable;
  table_constraints: PgTableConstraintsTable;
  tables: PgTablesTable;
}

export interface PgSystemCatalog {
  pg_attribute: PgAttributeTable;
  pg_class: PgClassTable;
  pg_database: PgDatabaseTable;
  pg_depend: PgDependTable;
  pg_enum: PgEnumTable;
  pg_indexes: PgIndexesTable;
  pg_namespace: PgNamespaceTable;
  pg_policy: PgPolicyTable;
  pg_type: PgTypeTable;
}

export interface PgDatabase extends PgInformationSchema, PgSystemCatalog {}

interface PgSchemataTable {
  catalog_name: string;
  schema_name: string;
  schema_owner: string;
}

interface PgColumnsTable {
  character_maximum_length: number | null;
  column_default: string | null;
  column_name: string;
  data_type: string;
  is_nullable: "YES" | "NO";
  numeric_precision: number | null;
  numeric_scale: number | null;
  ordinal_position: number;
  table_name: string;
  table_schema: string;
  udt_name: string | null;
  udt_schema: string | null;
}

interface PgTablesTable {
  table_name: string;
  table_schema: string;
  table_type: "BASE TABLE" | "VIEW";
}

interface PgTableConstraintsTable {
  constraint_name: string;
  constraint_schema: string;
  constraint_type: string;
  table_name: string;
  table_schema: string;
}

interface PgKeyColumnUsageTable {
  column_name: string;
  constraint_name: string;
  constraint_schema: string;
  ordinal_position: number;
  table_name: string;
  table_schema: string;
}

interface PgConstraintColumnUsageTable {
  column_name: string;
  constraint_name: string;
  constraint_schema: string;
  table_name: string;
  table_schema: string;
}

interface PgReferentialConstraintsTable {
  constraint_name: string;
  constraint_schema: string;
  delete_rule: string;
  match_option: string;
  unique_constraint_name: string | null;
  unique_constraint_schema: string | null;
  update_rule: string;
}

interface PgIndexesTable {
  indexdef: string;
  indexname: string;
  schemaname: string;
  tablename: string;
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
  enumlabel: string;
  enumsortorder: number;
  enumtypid: number;
}

interface PgNamespaceTable {
  nspname: string;
  oid: number;
}

interface PgClassTable {
  oid: number;
  relkind: string;
  relname: string;
  relnamespace: number;
  relrowsecurity: boolean;
}

interface PgPolicyTable {
  oid: number;
  polcmd: string;
  polname: string;
  polpermissive: boolean;
  polrelid: number;
}

interface PgDependTable {
  objid: number;
  refobjid: number;
  refobjsubid: number;
}

interface PgAttributeTable {
  attisdropped: boolean;
  attname: string;
  attnum: number;
  attrelid: number;
  atttypid: number;
  atttypmod: number;
}

// ---------------------------------------------------------------------------
// MySQL / MariaDB — information_schema
// ---------------------------------------------------------------------------

export interface MysqlInformationSchema {
  columns: MysqlColumnsTable;
  key_column_usage: MysqlKeyColumnUsageTable;
  referential_constraints: MysqlReferentialConstraintsTable;
  schemata: MysqlSchemataTable;
  statistics: MysqlStatisticsTable;
  table_constraints: MysqlTableConstraintsTable;
  tables: MysqlTablesTable;
  views: MysqlViewsTable;
}

export interface MysqlDatabase extends MysqlInformationSchema {}

interface MysqlSchemataTable {
  CATALOG_NAME: string;
  SCHEMA_NAME: string;
}

interface MysqlColumnsTable {
  COLUMN_DEFAULT: string | null;
  COLUMN_NAME: string;
  COLUMN_TYPE: string;
  DATA_TYPE: string;
  EXPRESSION: string | null;
  EXTRA: string;
  IS_NULLABLE: "YES" | "NO";
  ORDINAL_POSITION: number;
  TABLE_NAME: string;
  TABLE_SCHEMA: string;
}

interface MysqlTablesTable {
  AUTO_INCREMENT: number | null;
  ENGINE: string | null;
  TABLE_COLLATION: string | null;
  TABLE_NAME: string;
  TABLE_ROWS: number | null;
  TABLE_SCHEMA: string;
  TABLE_TYPE: string;
}

interface MysqlStatisticsTable {
  COLUMN_NAME: string;
  INDEX_NAME: string;
  NON_UNIQUE: number;
  SEQ_IN_INDEX: number;
  TABLE_NAME: string;
  TABLE_SCHEMA: string;
}

interface MysqlKeyColumnUsageTable {
  COLUMN_NAME: string;
  CONSTRAINT_NAME: string;
  CONSTRAINT_SCHEMA: string;
  ORDINAL_POSITION: number;
  REFERENCED_COLUMN_NAME: string | null;
  REFERENCED_TABLE_NAME: string | null;
  REFERENCED_TABLE_SCHEMA: string | null;
  TABLE_NAME: string;
  TABLE_SCHEMA: string;
}

interface MysqlTableConstraintsTable {
  CONSTRAINT_NAME: string;
  CONSTRAINT_SCHEMA: string;
  CONSTRAINT_TYPE: string;
  TABLE_NAME: string;
  TABLE_SCHEMA: string;
}

interface MysqlReferentialConstraintsTable {
  CONSTRAINT_NAME: string;
  CONSTRAINT_SCHEMA: string;
  DELETE_RULE: string | null;
  UPDATE_RULE: string | null;
}

interface MysqlViewsTable {
  TABLE_NAME: string;
  TABLE_SCHEMA: string;
  VIEW_DEFINITION: string;
}

// ---------------------------------------------------------------------------
// ClickHouse — system tables
// ---------------------------------------------------------------------------

export interface ClickHouseSystem {
  columns: ChColumnsTable;
  data_indexes: ChDataIndexesTable;
  databases: ChDatabasesTable;
  parts: ChPartsTable;
  tables: ChTablesTable;
}

export interface ClickHouseDatabase extends ClickHouseSystem {}

interface ChDatabasesTable {
  name: string;
}

interface ChColumnsTable {
  database: string;
  default_expression: string;
  default_kind: string;
  is_in_primary_key: number;
  name: string;
  position: number;
  table: string;
  type: string;
}

interface ChTablesTable {
  create_table_query: string;
  database: string;
  engine: string;
  name: string;
}

interface ChPartsTable {
  active: number;
  data_compressed_bytes: number;
  database: string;
  rows: number;
  table: string;
}

interface ChDataIndexesTable {
  database: string;
  name: string;
  table: string;
}
