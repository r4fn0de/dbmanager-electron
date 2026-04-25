export { generateSchemaSQL } from "./formats/sql";
export { generateSchemaTypeScript } from "./formats/typescript";
export { generateSchemaZod } from "./formats/zod";
export { generateSchemaKysely } from "./formats/kysely";
export { generateSchemaDrizzle } from "./formats/drizzle";
export {
  type GeneratorFormat,
  type GroupedIndex,
  GENERATOR_COMPATIBILITY,
  getColumnType,
  isValidIdentifier,
  toLiteralKey,
  pascalCase,
  camelCase,
  isEnumColumn,
  formatEnumAsUnionType,
  groupIndexes,
  filterExplicitIndexes,
  formatValue,
  quoteIdentifier,
  qualifiedName,
} from "./utils";

import type { DatabaseType, SchemaColumn, SchemaForeignKey, SchemaIndex } from "@/ipc/db/types";
import type { GeneratorFormat } from "./utils";
import { generateSchemaSQL } from "./formats/sql";
import { generateSchemaTypeScript } from "./formats/typescript";
import { generateSchemaZod } from "./formats/zod";
import { generateSchemaKysely } from "./formats/kysely";
import { generateSchemaDrizzle } from "./formats/drizzle";

export interface SchemaGeneratorParams {
  table: string;
  schema: string;
  columns: SchemaColumn[];
  indexes: SchemaIndex[];
  foreignKeys: SchemaForeignKey[];
  dialect: DatabaseType;
}

/** Generate schema code for a given format. */
export function generateSchema(
  format: GeneratorFormat,
  params: SchemaGeneratorParams,
): string {
  switch (format) {
    case "sql":
      return generateSchemaSQL(params);
    case "ts":
      return generateSchemaTypeScript(params);
    case "zod":
      return generateSchemaZod(params);
    case "kysely":
      return generateSchemaKysely(params);
    case "drizzle":
      return generateSchemaDrizzle(params);
  }
}

/** Human-readable labels for each format. */
export const FORMAT_LABELS: Record<GeneratorFormat, string> = {
  sql: "SQL",
  ts: "TypeScript",
  zod: "Zod",
  kysely: "Kysely",
  drizzle: "Drizzle",
};

/** Language identifier for syntax highlighting. */
export const FORMAT_LANGUAGES: Record<GeneratorFormat, string> = {
  sql: "sql",
  ts: "typescript",
  zod: "typescript",
  kysely: "typescript",
  drizzle: "typescript",
};
