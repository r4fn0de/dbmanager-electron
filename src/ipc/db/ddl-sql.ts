/**
 * ddl-sql.ts — Shared DDL SQL builder functions.
 *
 * Each builder takes a `DatabaseType` as the first argument and returns
 * engine-appropriate SQL.  Drivers call the builder to get the SQL string,
 * execute it, then return it — so the executed SQL and the displayed SQL
 * are always identical.
 */
import type { DatabaseType } from "./types";

// ---------------------------------------------------------------------------
// Identifier quoting helpers
// ---------------------------------------------------------------------------

/** Quote a single identifier. PostgreSQL/ClickHouse/SQLite → "id", MySQL/MariaDB → `id`. */
export function qi(dbType: DatabaseType, identifier: string): string {
  return dbType === "mysql" || dbType === "mariadb"
    ? `\`${identifier}\``
    : `"${identifier}"`;
}

/** Quote a qualified name: schema.table */
export function qt(dbType: DatabaseType, schema: string, table: string): string {
  return `${qi(dbType, schema)}.${qi(dbType, table)}`;
}

// ---------------------------------------------------------------------------
// DDL builder functions — synchronous, no DB lookups required
// ---------------------------------------------------------------------------

export function buildCreateTableSql(
  dbType: DatabaseType,
  schema: string,
  tableName: string,
  columns: Array<{
    name: string;
    dataType: string;
    isNullable: boolean;
    defaultExpr?: string;
  }>,
  primaryKeyColumns: string[],
  ifNotExists: boolean,
): string {
  const columnDefs: string[] = [];
  for (const col of columns) {
    let def = `${qi(dbType, col.name)} ${col.dataType}`;
    if (!col.isNullable) def += " NOT NULL";
    if (col.defaultExpr) def += ` DEFAULT ${col.defaultExpr}`;
    columnDefs.push(def);
  }
  if (primaryKeyColumns.length > 0) {
    columnDefs.push(
      `PRIMARY KEY (${primaryKeyColumns.map((c) => qi(dbType, c)).join(", ")})`,
    );
  }
  const ifNotExistsClause = ifNotExists ? "IF NOT EXISTS " : "";
  return `CREATE TABLE ${ifNotExistsClause}${qt(dbType, schema, tableName)} (${columnDefs.join(", ")})`;
}

export function buildDropTableSql(
  dbType: DatabaseType,
  schema: string,
  tableName: string,
  cascade: boolean,
  ifExists: boolean,
): string {
  const ifExistsClause = ifExists ? "IF EXISTS " : "";
  // MySQL/SQLite don't support CASCADE in DROP TABLE
  const cascadeClause = cascade && dbType === "postgresql" ? " CASCADE" : "";
  return `DROP TABLE ${ifExistsClause}${qt(dbType, schema, tableName)}${cascadeClause}`;
}

export function buildRenameTableSql(
  dbType: DatabaseType,
  schema: string,
  oldName: string,
  newName: string,
): string {
  // MySQL uses RENAME TABLE; PostgreSQL/SQLite use ALTER TABLE ... RENAME TO
  if (dbType === "mysql" || dbType === "mariadb") {
    return `RENAME TABLE ${qt(dbType, schema, oldName)} TO ${qt(dbType, schema, newName)}`;
  }
  return `ALTER TABLE ${qt(dbType, schema, oldName)} RENAME TO ${qi(dbType, newName)}`;
}

export function buildAddColumnSql(
  dbType: DatabaseType,
  schema: string,
  table: string,
  columnName: string,
  dataType: string,
  isNullable: boolean,
  defaultExpr: string | undefined,
  ifNotExists: boolean,
): string {
  let def = `${qi(dbType, columnName)} ${dataType}`;
  if (!isNullable) def += " NOT NULL";
  if (defaultExpr) def += ` DEFAULT ${defaultExpr}`;
  // IF NOT EXISTS support varies by engine and version:
  //   PostgreSQL: always supported
  //   MariaDB 10.0.2+: supported
  //   MySQL 8.0.29+: supported
  // The driver layer is responsible for passing ifNotExists=false
  // when the server doesn't support it.
  const ifNotExistsClause = ifNotExists ? "IF NOT EXISTS " : "";
  return `ALTER TABLE ${qt(dbType, schema, table)} ADD COLUMN ${ifNotExistsClause}${def}`;
}

export function buildDropColumnSql(
  dbType: DatabaseType,
  schema: string,
  table: string,
  columnName: string,
  cascade: boolean,
  ifExists: boolean,
): string {
  const ifExistsClause = ifExists ? "IF EXISTS " : "";
  // MySQL/SQLite don't support CASCADE for DROP COLUMN
  const cascadeClause = cascade && dbType === "postgresql" ? " CASCADE" : "";
  return `ALTER TABLE ${qt(dbType, schema, table)} DROP COLUMN ${ifExistsClause}${qi(dbType, columnName)}${cascadeClause}`;
}

export function buildRenameColumnSql(
  dbType: DatabaseType,
  schema: string,
  table: string,
  oldName: string,
  newName: string,
  /** Required for MariaDB — column metadata for CHANGE COLUMN. Ignored for PostgreSQL/MySQL. */
  columnInfo?: { columnType: string; isNullable: boolean; defaultExpr?: string | null },
): string {
  // MariaDB < 10.5 doesn't support RENAME COLUMN — use CHANGE COLUMN instead,
  // which works in all MySQL/MariaDB versions but requires the full column definition.
  if (dbType === "mariadb") {
    const type = columnInfo?.columnType ?? "TEXT";
    const parts = [type];
    if (!columnInfo?.isNullable) parts.push("NOT NULL");
    if (columnInfo?.defaultExpr) parts.push(`DEFAULT ${columnInfo.defaultExpr}`);
    return `ALTER TABLE ${qt(dbType, schema, table)} CHANGE COLUMN ${qi(dbType, oldName)} ${qi(dbType, newName)} ${parts.join(" ")}`;
  }
  return `ALTER TABLE ${qt(dbType, schema, table)} RENAME COLUMN ${qi(dbType, oldName)} TO ${qi(dbType, newName)}`;
}

export function buildAlterColumnTypeSql(
  dbType: DatabaseType,
  schema: string,
  table: string,
  columnName: string,
  newType: string,
  usingExpr: string | undefined,
): string {
  // PostgreSQL: ALTER COLUMN ... TYPE ... USING ...
  // MySQL: MODIFY COLUMN ... (no USING clause)
  if (dbType === "mysql" || dbType === "mariadb") {
    return `ALTER TABLE ${qt(dbType, schema, table)} MODIFY COLUMN ${qi(dbType, columnName)} ${newType}`;
  }
  const usingClause = usingExpr ? ` USING ${usingExpr}` : "";
  return `ALTER TABLE ${qt(dbType, schema, table)} ALTER COLUMN ${qi(dbType, columnName)} TYPE ${newType}${usingClause}`;
}

export function buildSetColumnNullableSql(
  dbType: DatabaseType,
  schema: string,
  table: string,
  columnName: string,
  isNullable: boolean,
  /** Required for MySQL — the current COLUMN_TYPE (e.g. "varchar(255)"). Ignored for PostgreSQL. */
  columnType?: string,
): string {
  if (dbType === "mysql" || dbType === "mariadb") {
    const type = columnType ?? "TEXT";
    const nullClause = isNullable ? "NULL" : "NOT NULL";
    return `ALTER TABLE ${qt(dbType, schema, table)} MODIFY COLUMN ${qi(dbType, columnName)} ${type} ${nullClause}`;
  }
  const action = isNullable ? "DROP NOT NULL" : "SET NOT NULL";
  return `ALTER TABLE ${qt(dbType, schema, table)} ALTER COLUMN ${qi(dbType, columnName)} ${action}`;
}

export function buildSetColumnDefaultSql(
  dbType: DatabaseType,
  schema: string,
  table: string,
  columnName: string,
  defaultExpr: string | undefined,
  /** Required for MySQL — the current COLUMN_TYPE. Ignored for PostgreSQL. */
  columnType?: string,
  /** Required for MySQL — whether the column is nullable. Ignored for PostgreSQL. */
  isNullable?: boolean,
): string {
  if (dbType === "mysql" || dbType === "mariadb") {
    const type = columnType ?? "TEXT";
    const nullClause = isNullable ? "NULL" : "NOT NULL";
    const defaultClause = defaultExpr ? `DEFAULT ${defaultExpr}` : "";
    const parts = [type, nullClause, defaultClause].filter(Boolean);
    return `ALTER TABLE ${qt(dbType, schema, table)} MODIFY COLUMN ${qi(dbType, columnName)} ${parts.join(" ")}`;
  }
  return defaultExpr
    ? `ALTER TABLE ${qt(dbType, schema, table)} ALTER COLUMN ${qi(dbType, columnName)} SET DEFAULT ${defaultExpr}`
    : `ALTER TABLE ${qt(dbType, schema, table)} ALTER COLUMN ${qi(dbType, columnName)} DROP DEFAULT`;
}

export function buildCreateIndexSql(
  dbType: DatabaseType,
  schema: string,
  table: string,
  indexName: string,
  columns: string[],
  unique: boolean,
  ifNotExists: boolean,
): string {
  const uniqueKeyword = unique ? "UNIQUE " : "";
  // IF NOT EXISTS support varies by engine and version:
  //   PostgreSQL: always supported
  //   MariaDB 10.5.2+: supported
  //   MySQL: not supported in any version
  // The driver layer is responsible for passing ifNotExists=false
  // when the server doesn't support it.
  const ifNotExistsClause = ifNotExists ? "IF NOT EXISTS " : "";
  const cols = columns.map((c) => qi(dbType, c)).join(", ");
  return `CREATE ${uniqueKeyword}INDEX ${ifNotExistsClause}${qi(dbType, indexName)} ON ${qt(dbType, schema, table)} (${cols})`;
}

export function buildDropIndexSql(
  dbType: DatabaseType,
  schema: string,
  indexName: string,
  cascade: boolean,
  ifExists: boolean,
  /** Required for MySQL — the table the index belongs to. Ignored for PostgreSQL. */
  tableName?: string,
): string {
  const ifExistsClause = ifExists ? "IF EXISTS " : "";
  if (dbType === "mysql" || dbType === "mariadb") {
    // MySQL requires: DROP INDEX `name` ON `schema`.`table`
    if (tableName) {
      return `DROP INDEX ${ifExistsClause}${qi(dbType, indexName)} ON ${qt(dbType, schema, tableName)}`;
    }
    // Fallback when table not resolved (ifExists path)
    return `DROP INDEX ${ifExistsClause}${qi(dbType, indexName)}`;
  }
  const cascadeClause = cascade ? " CASCADE" : "";
  return `DROP INDEX ${ifExistsClause}${qt(dbType, schema, indexName)}${cascadeClause}`;
}

export function buildCreateSchemaSql(
  dbType: DatabaseType,
  schemaName: string,
  ifNotExists: boolean,
): string {
  const ifNotExistsClause = ifNotExists ? "IF NOT EXISTS " : "";
  // MySQL maps "schema" to "database"
  const keyword = dbType === "mysql" || dbType === "mariadb" ? "DATABASE" : "SCHEMA";
  return `CREATE ${keyword} ${ifNotExistsClause}${qi(dbType, schemaName)}`;
}
