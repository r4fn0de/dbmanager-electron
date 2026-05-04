import type { DatabaseType, SchemaColumn, SchemaForeignKey, SchemaIndex } from "@/ipc/db/types";
import { getColumnType, pascalCase, isValidIdentifier, toLiteralKey } from "../utils";
import type { GeneratorFormat } from "../utils";

function sanitizeModelName(table: string): string {
  const name = pascalCase(table);
  return /^[A-Za-z][A-Za-z0-9_]*$/.test(name) ? name : `Model_${name.replace(/[^A-Za-z0-9_]/g, "_")}`;
}

function buildFieldLine(
  col: SchemaColumn,
  indexes: SchemaIndex[],
  dialect: DatabaseType,
): string {
  const fieldName = isValidIdentifier(col.name) ? col.name : toLiteralKey(col.name);
  let prismaType = getColumnType(col.data_type, "prisma" as GeneratorFormat, dialect);

  const attrs: string[] = [];
  const isPrimary = indexes.some((idx) => idx.is_primary && idx.column_names.includes(col.name));
  const isUnique = indexes.some((idx) => idx.is_unique && idx.column_names.length === 1 && idx.column_names[0] === col.name);

  if (isPrimary) attrs.push("@id");
  if (isUnique && !isPrimary) attrs.push("@unique");

  if (col.column_default) {
    const d = col.column_default.toLowerCase();
    if (d.includes("now()") || d.includes("current_timestamp")) {
      attrs.push("@default(now())");
    } else if (d.includes("gen_random_uuid()") || d.includes("uuid()")) {
      attrs.push("@default(uuid())");
    } else if (/^\d+$/.test(col.column_default)) {
      attrs.push(`@default(${col.column_default})`);
    } else if (d === "true" || d === "false") {
      attrs.push(`@default(${d})`);
    }
  }

  if (col.is_nullable && !prismaType.includes("?")) {
    prismaType += "?";
  }

  const mappedNameAttr = col.name !== fieldName ? ` @map("${col.name}")` : "";
  const attrsSuffix = attrs.length ? ` ${attrs.join(" ")}` : "";

  return `  ${fieldName} ${prismaType}${attrsSuffix}${mappedNameAttr}`;
}

export function generateSchemaPrisma(params: {
  table: string;
  schema: string;
  columns: SchemaColumn[];
  indexes: SchemaIndex[];
  foreignKeys: SchemaForeignKey[];
  dialect: DatabaseType;
}): string {
  const { table, schema, columns, indexes, dialect } = params;

  if (dialect === "clickhouse") {
    return "// Prisma schema generation is not supported for ClickHouse.";
  }

  const modelName = sanitizeModelName(table);
  const fieldLines = columns.map((col) => buildFieldLine(col, indexes, dialect));

  const modelAttrs: string[] = [];
  if (table !== modelName) {
    modelAttrs.push(`@@map(\"${table}\")`);
  }
  if (schema && dialect === "postgresql") {
    modelAttrs.push(`@@schema(\"${schema}\")`);
  }

  const lines: string[] = [];
  lines.push(`model ${modelName} {`);
  lines.push(...fieldLines);
  if (modelAttrs.length > 0) {
    lines.push("");
    for (const attr of modelAttrs) lines.push(`  ${attr}`);
  }
  lines.push("}");

  return lines.join("\n");
}
