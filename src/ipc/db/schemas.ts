import z from "zod";
import type {
  DatabaseType,
  SslMode,
  ColumnDefinition,
  TableSort,
  TableFilter,
  TableRef,
} from "./types";

// Database type schema
export const databaseTypeSchema = z.enum([
  "postgresql",
  "mysql",
  "mariadb",
  "clickhouse",
  "sqlite",
]) as z.ZodType<DatabaseType>;

// Connection schemas
export const sslModeSchema = z.enum([
  "disable",
  "prefer",
  "require",
  "verify_ca",
  "verify_full",
]) as z.ZodType<SslMode>;

export const connectionInputSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  db_type: databaseTypeSchema.optional().default("postgresql"),
  host: z.string(),
  port: z.number(),
  database: z.string(),
  username: z.string(),
  password: z.string(),
  ssl_mode: sslModeSchema,
  url: z.string().regex(
    /^(?:postgresql|postgres|mysql|mariadb|clickhouse|clickhouses|redis|rediss|sqlite):\/\/.+/,
    "URL must use a supported database protocol",
  ).optional(),
  is_local: z.boolean().optional(),
  connection_string: z.string().regex(
    /^(?:postgresql|postgres|mysql|mariadb|clickhouse|clickhouses|redis|rediss|sqlite):\/\/.+/,
    "Connection string must use a supported database protocol",
  ).optional(),
  engine_version: z.string().optional(),
  postgres_version: z.string().optional(),
  tag: z.string().optional(),
  color: z.string().optional(),
  local_auto_start: z.boolean().optional(),
});

export const connectionIdSchema = z.object({
  connectionId: z.string(),
});

export const idSchema = z.object({
  id: z.string(),
});

export const executeQuerySchema = z.object({
  connectionId: z.string(),
  sql: z.string(),
  requestId: z.string().optional(),
});

export const tableRefSchema = z.object({
  connectionId: z.string(),
  schema: z.string(),
  table: z.string(),
}) as z.ZodType<TableRef>;

export const tableSortSchema = z.object({
  column: z.string(),
  direction: z.enum(["asc", "desc"]),
}) as z.ZodType<TableSort>;

export const tableFilterSchema = z.object({
  column: z.string(),
  operator: z.enum([
    "eq",
    "neq",
    "contains",
    "starts_with",
    "ends_with",
    "gt",
    "gte",
    "lt",
    "lte",
    "is_null",
    "is_not_null",
  ]),
  value: z.unknown().optional(),
}) as z.ZodType<TableFilter>;

export const listRowsInputSchema = z.object({
  tableRef: tableRefSchema,
  page: z.number(),
  pageSize: z.number(),
  sort: z.array(tableSortSchema),
  filters: z.array(tableFilterSchema),
});

export const columnDefinitionSchema = z.object({
  name: z.string(),
  dataType: z.string(),
  isNullable: z.boolean(),
  isPrimaryKey: z.boolean().optional(),
  isUnique: z.boolean().optional(),
  defaultExpr: z.string().optional(),
  references: z.string().optional(),
}) as z.ZodType<ColumnDefinition>;

// DDL Schemas
export const createTableInputSchema = z.object({
  connectionId: z.string(),
  schema: z.string(),
  name: z.string(),
  columns: z.array(columnDefinitionSchema),
  primaryKeyColumns: z.array(z.string()).optional(),
  ifNotExists: z.boolean().optional(),
});

export const dropTableInputSchema = z.object({
  connectionId: z.string(),
  schema: z.string(),
  name: z.string(),
  cascade: z.boolean().optional(),
  ifExists: z.boolean().optional(),
});

export const renameTableInputSchema = z.object({
  connectionId: z.string(),
  schema: z.string(),
  oldName: z.string(),
  newName: z.string(),
});

export const addColumnInputSchema = z.object({
  connectionId: z.string(),
  schema: z.string(),
  table: z.string(),
  column: columnDefinitionSchema,
  ifNotExists: z.boolean().optional(),
});

export const dropColumnInputSchema = z.object({
  connectionId: z.string(),
  schema: z.string(),
  table: z.string(),
  column: z.string(),
  cascade: z.boolean().optional(),
  ifExists: z.boolean().optional(),
});

export const renameColumnInputSchema = z.object({
  connectionId: z.string(),
  schema: z.string(),
  table: z.string(),
  oldName: z.string(),
  newName: z.string(),
});

export const alterColumnTypeInputSchema = z.object({
  connectionId: z.string(),
  schema: z.string(),
  table: z.string(),
  column: z.string(),
  newType: z.string(),
  usingExpr: z.string().optional(),
});

export const setColumnNullableInputSchema = z.object({
  connectionId: z.string(),
  schema: z.string(),
  table: z.string(),
  column: z.string(),
  isNullable: z.boolean(),
});

export const setColumnDefaultInputSchema = z.object({
  connectionId: z.string(),
  schema: z.string(),
  table: z.string(),
  column: z.string(),
  defaultExpr: z.string().optional(),
});

export const createIndexInputSchema = z.object({
  connectionId: z.string(),
  schema: z.string(),
  table: z.string(),
  name: z.string().optional(),
  columns: z.array(z.string()),
  unique: z.boolean().optional(),
  ifNotExists: z.boolean().optional(),
});

export const dropIndexInputSchema = z.object({
  connectionId: z.string(),
  schema: z.string(),
  name: z.string(),
  cascade: z.boolean().optional(),
  ifExists: z.boolean().optional(),
});

export const createSchemaInputSchema = z.object({
  connectionId: z.string(),
  name: z.string(),
  ifNotExists: z.boolean().optional(),
});

export const getTableDetailsSchema = z.object({
  connectionId: z.string(),
  schema: z.string(),
  table: z.string(),
});

// Table changes schemas
export const tableUpdateChangeSchema = z.object({
  primaryKey: z.record(z.string(), z.unknown()),
  changes: z.record(z.string(), z.unknown()),
});

export const tableDeleteChangeSchema = z.object({
  primaryKey: z.record(z.string(), z.unknown()),
});

export const saveChangesInputSchema = z.object({
  tableRef: tableRefSchema,
  inserts: z.array(z.record(z.string(), z.unknown())),
  updates: z.array(tableUpdateChangeSchema),
  deletes: z.array(tableDeleteChangeSchema),
});

export const fkLookupInputSchema = z.object({
  tableRef: tableRefSchema,
  column: z.string(),
  query: z.string(),
  page: z.number(),
  pageSize: z.number(),
});

export const tableTruncateSchema = z.object({
  tableRef: tableRefSchema,
});

// Local DB schemas
export const localDbEngineSchema = z.enum(["postgresql", "sqlite"]) as z.ZodType<import("./types").LocalDbEngine>;

export const createLocalDatabaseSchema = z.object({
  name: z.string(),
  databaseName: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  port: z.number().optional(),
  postgresVersion: z.string().optional(),
  autoStart: z.boolean().optional(),
  /** Engine type for the local DB. Defaults to "postgresql" for backward compat. */
  engine: localDbEngineSchema.optional().default("postgresql"),
});

// Clone to Local schemas
export const exportTableDataSchema = z.object({
  connectionId: z.string(),
  schema: z.string(),
  table: z.string(),
  batchSize: z.number().min(1).max(5000).default(500),
  offset: z.number().min(0).default(0),
});

export const executeBatchDdlSchema = z.object({
  connectionId: z.string(),
  statements: z.array(z.string()),
});

export const importTableRowsSchema = z.object({
  connectionId: z.string(),
  schema: z.string(),
  table: z.string(),
  columns: z.array(z.string()),
  rows: z.array(z.record(z.string(), z.unknown())),
});

export const waitForDatabaseSchema = z.object({
  connectionString: z.string(),
  maxRetries: z.number().optional(),
  intervalMs: z.number().optional(),
});

// Schema definition browsers — enums, functions, triggers
export const schemaDefinitionInputSchema = z.object({
  connectionId: z.string(),
  schema: z.string(),
});

// ---------------------------------------------------------------------------
// Branch schemas — for local DB branching (Phase 1: PostgreSQL only)
// ---------------------------------------------------------------------------

export const createBranchSchema = z.object({
  /** The local DB instance ID to create a branch on */
  localDbId: z.string(),
  /** The branch to branch from (defaults to active branch) */
  parentBranchId: z.string().optional(),
  /** User-chosen branch name */
  name: z.string().min(1).max(63),
  /** Optional description */
  description: z.string().optional(),
  /** Tables to include data for (schema-only for all others) */
  dataTables: z.array(z.object({
    schema: z.string(),
    table: z.string(),
  })).optional(),
});

export const deleteBranchSchema = z.object({
  localDbId: z.string(),
  branchId: z.string(),
});

export const switchBranchSchema = z.object({
  localDbId: z.string(),
  branchId: z.string(),
});

export const listBranchesSchema = z.object({
  localDbId: z.string(),
});

export const renameBranchSchema = z.object({
  localDbId: z.string(),
  branchId: z.string(),
  newName: z.string().min(1).max(63),
});

export const getBranchInfoSchema = z.object({
  localDbId: z.string(),
  branchId: z.string(),
});

export const previewDeleteBranchSchema = z.object({
  localDbId: z.string(),
  branchId: z.string(),
});

export const mergeBranchSchemaSchema = z.object({
  localDbId: z.string(),
  sourceBranchId: z.string(),
  targetBranchId: z.string(),
  dryRun: z.boolean().optional(),
});
