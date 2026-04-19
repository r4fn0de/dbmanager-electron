import z from "zod";
import type {
  SslMode,
  ColumnDefinition,
  TableSort,
  TableFilter,
  TableRef,
} from "./types";

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
  host: z.string(),
  port: z.number(),
  database: z.string(),
  username: z.string(),
  password: z.string(),
  ssl_mode: sslModeSchema,
  url: z.string().optional(),
  is_local: z.boolean().optional(),
  connection_string: z.string().optional(),
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
export const createLocalDatabaseSchema = z.object({
  name: z.string(),
  postgresVersion: z.string().optional(),
});
