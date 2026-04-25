import type { DatabaseType, SchemaColumn, SchemaForeignKey, SchemaIndex } from "@/ipc/db/types";
import {
  getColumnType,
  groupIndexes,
  filterExplicitIndexes,
  quoteIdentifier,
  qualifiedName,
} from "../utils";
import type { GeneratorFormat } from "../utils";

// ---------------------------------------------------------------------------
// SQL Schema Generator
// ---------------------------------------------------------------------------

function buildColumnParts(
  col: SchemaColumn,
  dialect: DatabaseType,
  primaryKeyColumns: string[],
): string {
  const parts: string[] = [];
  const typeDef = getColumnType(col.data_type, "sql" as GeneratorFormat, dialect);
  parts.push(`${quoteIdentifier(col.name, dialect)} ${typeDef}`);

  // Auto-increment detection
  const isSerial = /serial|bigserial/i.test(col.data_type);
  const isAutoIncrement =
    isSerial ||
    (col.column_default &&
      (/nextval/i.test(col.column_default) || /auto_increment/i.test(col.column_default)));

  if (!col.is_nullable && !isSerial) {
    parts.push("NOT NULL");
  }

  if (isAutoIncrement) {
    if (dialect === "mysql" || dialect === "mariadb") {
      parts.push("AUTO_INCREMENT");
    }
  } else if (col.column_default !== null) {
    parts.push(`DEFAULT ${col.column_default}`);
  }

  return parts.join(" ");
}

function buildForeignKeyLine(
  fk: SchemaForeignKey,
  dialect: DatabaseType,
): string {
  const ref = fk.referenced_schema
    ? qualifiedName(fk.referenced_schema, fk.referenced_table, dialect)
    : quoteIdentifier(fk.referenced_table, dialect);
  return `FOREIGN KEY (${quoteIdentifier(fk.column_name, dialect)}) REFERENCES ${ref}(${quoteIdentifier(fk.referenced_column, dialect)})`;
}

function appendIndexStatements(
  indexes: SchemaIndex[],
  schema: string,
  table: string,
  dialect: DatabaseType,
): string[] {
  const lines: string[] = [];
  const nonUnique = indexes.filter((i) => !i.is_unique && !i.is_primary);

  for (const idx of nonUnique) {
    const cols = idx.column_names.map((c) => quoteIdentifier(c, dialect)).join(", ");
    lines.push(
      `CREATE INDEX ${quoteIdentifier(idx.name, dialect)} ON ${qualifiedName(schema, table, dialect)} (${cols});`,
    );
  }

  return lines;
}

export function generateSchemaSQL(params: {
  table: string;
  schema: string;
  columns: SchemaColumn[];
  indexes: SchemaIndex[];
  foreignKeys: SchemaForeignKey[];
  dialect: DatabaseType;
}): string {
  const { table, schema, columns, indexes, foreignKeys, dialect } = params;

  const primaryKey = indexes.find((i) => i.is_primary);
  const pkColumns = primaryKey?.column_names ?? [];

  const colLines: string[] = [];

  for (const col of columns) {
    colLines.push(`  ${buildColumnParts(col, dialect, pkColumns)}`);
  }

  // Primary key constraint
  if (primaryKey && primaryKey.column_names.length > 0) {
    const pkCols = primaryKey.column_names.map((c) => quoteIdentifier(c, dialect)).join(", ");
    colLines.push(`  PRIMARY KEY (${pkCols})`);
  }

  // Unique constraints (non-primary)
  const groupedIndexes = groupIndexes(indexes, table);
  const explicitIndexes = filterExplicitIndexes(groupedIndexes, columns, dialect);
  for (const idx of explicitIndexes) {
    if (idx.isUnique) {
      const idxCols = idx.columns.map((c) => quoteIdentifier(c, dialect)).join(", ");
      colLines.push(`  UNIQUE (${idxCols})`);
    }
  }

  // Foreign keys
  for (const fk of foreignKeys) {
    colLines.push(`  ${buildForeignKeyLine(fk, dialect)}`);
  }

  const qTable = qualifiedName(schema, table, dialect);
  const lines: string[] = [];
  lines.push(`CREATE TABLE ${qTable} (`);
  lines.push(colLines.join(",\n"));
  lines.push(");");

  // Index statements
  const indexStatements = appendIndexStatements(indexes, schema, table, dialect);
  if (indexStatements.length > 0) {
    lines.push("");
    lines.push(...indexStatements);
  }

  return lines.join("\n");
}
