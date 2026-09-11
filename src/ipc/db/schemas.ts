import z from "zod";
import type {
  ColumnDefinition,
  DatabaseType,
  SslMode,
  TableFilter,
  TableRef,
  TableSort,
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
  color: z.string().optional(),
  connection_string: z
    .string()
    .regex(
      /^(?:postgresql|postgres|mysql|mariadb|clickhouse|clickhouses|redis|rediss|sqlite):\/\/.+/,
      "Connection string must use a supported database protocol"
    )
    .optional(),
  database: z.string(),
  db_type: databaseTypeSchema.optional().default("postgresql"),
  engine_version: z.string().optional(),
  host: z.string(),
  id: z.string().optional(),
  is_local: z.boolean().optional(),
  local_auto_start: z.boolean().optional(),
  name: z.string(),
  password: z.string(),
  port: z.number(),
  postgres_version: z.string().optional(),
  ssl_mode: sslModeSchema,
  tag: z.string().optional(),
  url: z
    .string()
    .regex(
      /^(?:postgresql|postgres|mysql|mariadb|clickhouse|clickhouses|redis|rediss|sqlite):\/\/.+/,
      "URL must use a supported database protocol"
    )
    .optional(),
  username: z.string(),
});

export const connectionIdSchema = z.object({
  connectionId: z.string(),
});

export const idSchema = z.object({
  id: z.string(),
});

export const executeQuerySchema = z.object({
  connectionId: z.string(),
  requestId: z.string().optional(),
  sql: z.string(),
});
export const explainQuerySchema = z.object({
  analyze: z.boolean().optional(),
  connectionId: z.string(),
  sql: z.string(),
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
  cursor: z.string().optional(),
  exact: z.boolean().optional(),
  filters: z.array(tableFilterSchema),
  page: z.number(),
  pageSize: z.number(),
  sort: z.array(tableSortSchema),
  tableRef: tableRefSchema,
});

export const columnDefinitionSchema = z.object({
  dataType: z.string(),
  defaultExpr: z.string().optional(),
  isNullable: z.boolean(),
  isPrimaryKey: z.boolean().optional(),
  isUnique: z.boolean().optional(),
  name: z.string(),
  references: z.string().optional(),
}) as z.ZodType<ColumnDefinition>;

// DDL Schemas
export const createTableInputSchema = z.object({
  columns: z.array(columnDefinitionSchema),
  connectionId: z.string(),
  ifNotExists: z.boolean().optional(),
  name: z.string(),
  primaryKeyColumns: z.array(z.string()).optional(),
  schema: z.string(),
});

export const dropTableInputSchema = z.object({
  cascade: z.boolean().optional(),
  connectionId: z.string(),
  ifExists: z.boolean().optional(),
  name: z.string(),
  schema: z.string(),
});

export const renameTableInputSchema = z.object({
  connectionId: z.string(),
  newName: z.string(),
  oldName: z.string(),
  schema: z.string(),
});

export const addColumnInputSchema = z.object({
  column: columnDefinitionSchema,
  connectionId: z.string(),
  ifNotExists: z.boolean().optional(),
  schema: z.string(),
  table: z.string(),
});

export const dropColumnInputSchema = z.object({
  cascade: z.boolean().optional(),
  column: z.string(),
  connectionId: z.string(),
  ifExists: z.boolean().optional(),
  schema: z.string(),
  table: z.string(),
});

export const renameColumnInputSchema = z.object({
  connectionId: z.string(),
  newName: z.string(),
  oldName: z.string(),
  schema: z.string(),
  table: z.string(),
});

export const alterColumnTypeInputSchema = z.object({
  column: z.string(),
  connectionId: z.string(),
  newType: z.string(),
  schema: z.string(),
  table: z.string(),
  usingExpr: z.string().optional(),
});

export const setColumnNullableInputSchema = z.object({
  column: z.string(),
  connectionId: z.string(),
  isNullable: z.boolean(),
  schema: z.string(),
  table: z.string(),
});

export const setColumnDefaultInputSchema = z.object({
  column: z.string(),
  connectionId: z.string(),
  defaultExpr: z.string().optional(),
  schema: z.string(),
  table: z.string(),
});

export const createIndexInputSchema = z.object({
  columns: z.array(z.string()),
  connectionId: z.string(),
  ifNotExists: z.boolean().optional(),
  name: z.string().optional(),
  schema: z.string(),
  table: z.string(),
  unique: z.boolean().optional(),
});

export const dropIndexInputSchema = z.object({
  cascade: z.boolean().optional(),
  connectionId: z.string(),
  ifExists: z.boolean().optional(),
  name: z.string(),
  schema: z.string(),
});

export const createSchemaInputSchema = z.object({
  connectionId: z.string(),
  ifNotExists: z.boolean().optional(),
  name: z.string(),
});

export const getTableDetailsSchema = z.object({
  connectionId: z.string(),
  schema: z.string(),
  table: z.string(),
});

// Table changes schemas
export const tableUpdateChangeSchema = z.object({
  changes: z.record(z.string(), z.unknown()),
  primaryKey: z.record(z.string(), z.unknown()),
});

export const tableDeleteChangeSchema = z.object({
  primaryKey: z.record(z.string(), z.unknown()),
});

export const saveChangesInputSchema = z.object({
  deletes: z.array(tableDeleteChangeSchema),
  inserts: z.array(z.record(z.string(), z.unknown())),
  tableRef: tableRefSchema,
  updates: z.array(tableUpdateChangeSchema),
});

export const fkLookupInputSchema = z.object({
  column: z.string(),
  page: z.number(),
  pageSize: z.number(),
  query: z.string(),
  tableRef: tableRefSchema,
});

export const tableTruncateSchema = z.object({
  tableRef: tableRefSchema,
});

// Local DB schemas
export const localDbEngineSchema = z.enum([
  "postgresql",
  "sqlite",
]) as z.ZodType<import("./types").LocalDbEngine>;

export const createLocalDatabaseSchema = z.object({
  autoStart: z.boolean().optional(),
  databaseName: z.string().optional(),
  /** Engine type for the local DB. Defaults to "postgresql" for backward compat. */
  engine: localDbEngineSchema.optional().default("postgresql"),
  name: z.string().trim().min(1, "Local database name is required"),
  password: z.string().optional(),
  port: z.number().optional(),
  postgresVersion: z.string().optional(),
  username: z.string().optional(),
});

// Clone to Local schemas
export const exportTableDataSchema = z.object({
  batchSize: z.number().min(1).max(5000).default(500),
  connectionId: z.string(),
  offset: z.number().min(0).default(0),
  schema: z.string(),
  table: z.string(),
});

export const executeBatchDdlSchema = z.object({
  connectionId: z.string(),
  statements: z.array(z.string()),
});

export const importTableRowsSchema = z.object({
  columns: z.array(z.string()),
  connectionId: z.string(),
  rows: z.array(z.record(z.string(), z.unknown())),
  schema: z.string(),
  table: z.string(),
});

export const importTableColumnsSchema = z.object({
  connectionId: z.string(),
  schema: z.string(),
  table: z.string(),
});

export const importDryRunSchema = z.object({
  batchSize: z.number().min(1).max(2000).default(250),
  columns: z.array(z.string()),
  connectionId: z.string(),
  rows: z.array(z.record(z.string(), z.unknown())),
  schema: z.string(),
  table: z.string(),
});

export const createTableFromImportSchema = z.object({
  columns: z
    .array(
      z.object({
        dataType: z.string().min(1),
        isNullable: z.boolean(),
        name: z.string().min(1),
      })
    )
    .min(1),
  connectionId: z.string(),
  ifNotExists: z.boolean().optional().default(true),
  primaryKeyColumns: z.array(z.string()).optional(),
  schema: z.string(),
  table: z.string(),
});

export const exportSchemaIndexesSchema = z.object({
  connectionId: z.string(),
  schema: z.string(),
  table: z.string().optional(),
});

export const waitForDatabaseSchema = z.object({
  connectionString: z.string(),
  intervalMs: z.number().optional(),
  maxRetries: z.number().optional(),
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
  /** Tables to include data for (schema-only for all others) */
  dataTables: z
    .array(
      z.object({
        schema: z.string(),
        table: z.string(),
      })
    )
    .optional(),
  /** Optional description */
  description: z.string().optional(),
  /** The local DB instance ID to create a branch on */
  localDbId: z.string(),
  /** User-chosen branch name */
  name: z.string().min(1).max(63),
  /** The branch to branch from (defaults to active branch) */
  parentBranchId: z.string().optional(),
});

export const deleteBranchSchema = z.object({
  branchId: z.string(),
  localDbId: z.string(),
});

export const switchBranchSchema = z.object({
  branchId: z.string(),
  localDbId: z.string(),
});

export const listBranchesSchema = z.object({
  localDbId: z.string(),
});

export const renameBranchSchema = z.object({
  branchId: z.string(),
  localDbId: z.string(),
  newName: z.string().min(1).max(63),
});

export const getBranchInfoSchema = z.object({
  branchId: z.string(),
  localDbId: z.string(),
});

export const previewDeleteBranchSchema = z.object({
  branchId: z.string(),
  localDbId: z.string(),
});

export const mergeBranchSchemaSchema = z.object({
  dryRun: z.boolean().optional(),
  localDbId: z.string(),
  sourceBranchId: z.string(),
  targetBranchId: z.string(),
});
