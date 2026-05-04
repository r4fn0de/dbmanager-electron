import type { DatabaseType, SchemaColumn, SchemaIndex } from "@/ipc/db/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GeneratorFormat = "sql" | "ts" | "zod" | "kysely" | "drizzle" | "prisma";

export interface GroupedIndex {
  name: string;
  isUnique: boolean;
  isPrimary: boolean;
  columns: string[];
}

/** Which formats are available per database type. */
export const GENERATOR_COMPATIBILITY: Partial<Record<GeneratorFormat, DatabaseType[]>> = {
  sql: ["postgresql", "mysql", "mariadb", "clickhouse", "sqlite"],
  ts: ["postgresql", "mysql", "mariadb", "clickhouse", "sqlite"],
  zod: ["postgresql", "mysql", "mariadb", "clickhouse", "sqlite"],
  kysely: ["postgresql", "mysql", "mariadb", "clickhouse", "sqlite"],
  drizzle: ["postgresql", "mysql", "mariadb", "clickhouse"],
  prisma: ["postgresql", "mysql", "mariadb", "sqlite"],
};

// ---------------------------------------------------------------------------
// Identifier helpers
// ---------------------------------------------------------------------------

export function isValidIdentifier(name: string): boolean {
  return /^[a-z_$][\w$]*$/i.test(name);
}

export function toLiteralKey(name: string): string {
  return isValidIdentifier(name) ? name : `'${name}'`;
}

export function pascalCase(name: string): string {
  // snake_case or camelCase → PascalCase
  return name
    .replace(/[-_](\w)/g, (_, c: string) => c.toUpperCase())
    .replace(/^(\w)/, (_, c: string) => c.toUpperCase());
}

export function camelCase(name: string): string {
  return name
    .replace(/[-_](\w)/g, (_, c: string) => c.toUpperCase())
    .replace(/^(\w)/, (_, c: string) => c.toLowerCase());
}

// ---------------------------------------------------------------------------
// Type mapping
// ---------------------------------------------------------------------------

function tsMapper(t: string): string {
  if (/int|float|decimal|number|double|numeric|serial|bigserial/i.test(t))
    return "number";
  if (/bool|bit/i.test(t)) return "boolean";
  if (/date|time/i.test(t)) return "Date";
  if (/json/i.test(t)) return "unknown";
  return "string";
}

function zodMapper(t: string): string {
  if (/int|float|decimal|number|double|numeric|serial|bigserial/i.test(t))
    return "z.number()";
  if (/bool|bit/i.test(t)) return "z.boolean()";
  if (/date|time/i.test(t)) return "z.date()";
  if (/json/i.test(t)) return "z.record(z.string(), z.any())";
  return "z.string()";
}

function drizzlePostgresMapper(t: string): string {
  if (/serial/i.test(t)) return "serial";
  if (/bigserial/i.test(t)) return "bigserial";
  if (/bigint/i.test(t)) return "bigint";
  if (/int/i.test(t)) return "integer";
  if (/text/i.test(t)) return "text";
  if (/varchar|character varying/i.test(t)) return "varchar";
  if (/bool/i.test(t)) return "boolean";
  if (/timestamp/i.test(t)) return "timestamp";
  if (/date/i.test(t)) return "date";
  if (/decimal|numeric/i.test(t)) return "decimal";
  if (/double|float|real/i.test(t)) return "doublePrecision";
  if (/json/i.test(t)) return "json";
  if (/uuid/i.test(t)) return "uuid";
  return "text";
}

function drizzleMysqlMapper(t: string): string {
  if (/serial/i.test(t)) return "serial";
  if (/tinyint/i.test(t)) return "tinyint";
  if (/bigint/i.test(t)) return "bigint";
  if (/int/i.test(t)) return "int";
  if (/text/i.test(t)) return "text";
  if (/varchar/i.test(t)) return "varchar";
  if (/bool/i.test(t)) return "boolean";
  if (/timestamp/i.test(t)) return "timestamp";
  if (/datetime/i.test(t)) return "datetime";
  if (/date/i.test(t)) return "date";
  if (/decimal|numeric/i.test(t)) return "decimal";
  if (/double|float|real/i.test(t)) return "double";
  if (/json/i.test(t)) return "json";
  return "text";
}

function drizzleClickhouseMapper(t: string): string {
  if (/int/i.test(t)) return "integer";
  if (/text/i.test(t)) return "text";
  if (/bool/i.test(t)) return "boolean";
  if (/date/i.test(t)) return "date";
  if (/decimal/i.test(t)) return "decimal";
  if (/real|float/i.test(t)) return "real";
  if (/json/i.test(t)) return "json";
  return "text";
}

function prismaMapper(t: string): string {
  if (/bigint/i.test(t)) return "BigInt";
  if (/serial|int|integer|smallint/i.test(t)) return "Int";
  if (/decimal|numeric/i.test(t)) return "Decimal";
  if (/double|float|real/i.test(t)) return "Float";
  if (/bool|bit/i.test(t)) return "Boolean";
  if (/timestamp|datetime/i.test(t)) return "DateTime";
  if (/date|time/i.test(t)) return "DateTime";
  if (/json/i.test(t)) return "Json";
  if (/uuid/i.test(t)) return "String @db.Uuid";
  if (/char|varchar|text|citext/i.test(t)) return "String";
  if (/bytea|blob|binary|varbinary/i.test(t)) return "Bytes";
  return "String";
}

export const TYPE_MAPPINGS: Record<
  GeneratorFormat,
  Record<string, (type: string) => string>
> = {
  ts: {
    postgresql: tsMapper,
    mysql: tsMapper,
    mariadb: tsMapper,
    clickhouse: tsMapper,
    sqlite: tsMapper,
  },
  zod: {
    postgresql: zodMapper,
    mysql: zodMapper,
    mariadb: zodMapper,
    clickhouse: zodMapper,
    sqlite: zodMapper,
  },
  kysely: {
    // Kysely uses the raw DB type name as-is (it maps at query time)
    postgresql: tsMapper,
    mysql: tsMapper,
    mariadb: tsMapper,
    clickhouse: tsMapper,
    sqlite: tsMapper,
  },
  sql: {
    // SQL uses the raw type name
    postgresql: (t) => t,
    mysql: (t) => t,
    mariadb: (t) => t,
    clickhouse: (t) => t,
    sqlite: (t) => t,
  },
  drizzle: {
    postgresql: drizzlePostgresMapper,
    mysql: drizzleMysqlMapper,
    mariadb: drizzleMysqlMapper,
    clickhouse: drizzleClickhouseMapper,
    sqlite: () => "text", // Drizzle doesn't support SQLite schema gen well
  },
  prisma: {
    postgresql: prismaMapper,
    mysql: prismaMapper,
    mariadb: prismaMapper,
    clickhouse: () => "String", // Prisma does not support ClickHouse
    sqlite: prismaMapper,
  },
};

export function getColumnType(
  type: string,
  format: GeneratorFormat,
  dialect: DatabaseType,
): string {
  return TYPE_MAPPINGS[format][dialect](type);
}

// ---------------------------------------------------------------------------
// Enum helpers
// ---------------------------------------------------------------------------

/** Detect if a column is an enum type (PostgreSQL USER-DEFINED or MySQL enum). */
export function isEnumColumn(col: SchemaColumn): boolean {
  return (
    /enum/i.test(col.data_type) ||
    (col.data_type === "USER-DEFINED" &&
      !!col.udt_name &&
      !/^(bool|int|float|numeric|text|varchar|timestamp|date|json|uuid|bytea)/i.test(col.udt_name))
  );
}

export function formatEnumAsUnionType(values: string[]): string {
  return values.map((v) => `'${v}'`).join(" | ");
}

// ---------------------------------------------------------------------------
// Index helpers
// ---------------------------------------------------------------------------

export function groupIndexes(
  indexes: SchemaIndex[],
  table: string,
): GroupedIndex[] {
  const grouped = new Map<string, GroupedIndex>();

  for (const idx of indexes) {
    const key = `${idx.name}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.columns.push(...idx.column_names);
    } else {
      grouped.set(key, {
        name: idx.name,
        isUnique: idx.is_unique,
        isPrimary: idx.is_primary,
        columns: [...idx.column_names],
      });
    }
  }

  return [...grouped.values()];
}

export function filterExplicitIndexes(
  grouped: GroupedIndex[],
  columns: SchemaColumn[],
  _dialect?: DatabaseType,
): GroupedIndex[] {
  return grouped.filter((idx) => {
    if (idx.isPrimary) return false;
    // Remove redundant unique indexes where the column itself is unique
    const isRedundantUnique =
      idx.isUnique &&
      idx.columns.length === 1 &&
      columns.some((c) => c.name === idx.columns[0] && c.data_type.includes("unique"));
    if (isRedundantUnique) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Value formatting
// ---------------------------------------------------------------------------

export function formatValue(value: unknown): string {
  if (value === null) return "NULL";
  if (typeof value === "string")
    return `'${value.replace(/'/g, "''")}'`;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return `'${value.toISOString()}'`;
  return `'${String(value)}'`;
}

// ---------------------------------------------------------------------------
// Identifier quoting (reuses ddl-sql logic concept)
// ---------------------------------------------------------------------------

export function quoteIdentifier(name: string, dialect: DatabaseType): string {
  switch (dialect) {
    case "mysql":
    case "mariadb":
      return `\`${name}\``;
    case "clickhouse":
      return `\`${name}\``;
    case "sqlite":
      return `"${name}"`;
    case "postgresql":
    default:
      return `"${name}"`;
  }
}

export function qualifiedName(
  schema: string,
  table: string,
  dialect: DatabaseType,
): string {
  return `${quoteIdentifier(schema, dialect)}.${quoteIdentifier(table, dialect)}`;
}
