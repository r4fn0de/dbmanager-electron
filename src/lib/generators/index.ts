export { generateSchemaDrizzle } from "./formats/drizzle";
export { generateSchemaKysely } from "./formats/kysely";
export { generateSchemaPrisma } from "./formats/prisma";
export { generateSchemaSQL } from "./formats/sql";
export { generateSchemaTypeScript } from "./formats/typescript";
export { generateSchemaZod } from "./formats/zod";
export {
  camelCase,
  filterExplicitIndexes,
  formatEnumAsUnionType,
  formatValue,
  GENERATOR_COMPATIBILITY,
  type GeneratorFormat,
  type GroupedIndex,
  getColumnType,
  groupIndexes,
  isEnumColumn,
  isValidIdentifier,
  pascalCase,
  qualifiedName,
  quoteIdentifier,
  toLiteralKey,
} from "./utils";

import type {
  DatabaseType,
  SchemaColumn,
  SchemaForeignKey,
  SchemaIndex,
} from "@/ipc/db/types";
import { generateSchemaDrizzle } from "./formats/drizzle";
import { generateSchemaKysely } from "./formats/kysely";
import { generateSchemaPrisma } from "./formats/prisma";
import { generateSchemaSQL } from "./formats/sql";
import { generateSchemaTypeScript } from "./formats/typescript";
import { generateSchemaZod } from "./formats/zod";
import type { GeneratorFormat } from "./utils";

export interface SchemaGeneratorParams {
  columns: SchemaColumn[];
  dialect: DatabaseType;
  foreignKeys: SchemaForeignKey[];
  indexes: SchemaIndex[];
  schema: string;
  table: string;
}

/** Generate schema code for a given format. */
export function generateSchema(
  format: GeneratorFormat,
  params: SchemaGeneratorParams
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
    case "prisma":
      return generateSchemaPrisma(params);
  }
}

/** Human-readable labels for each format. */
export const FORMAT_LABELS: Record<GeneratorFormat, string> = {
  drizzle: "Drizzle",
  kysely: "Kysely",
  prisma: "Prisma",
  sql: "SQL",
  ts: "TypeScript",
  zod: "Zod",
};

/** Language identifier for syntax highlighting. */
export const FORMAT_LANGUAGES: Record<GeneratorFormat, string> = {
  drizzle: "typescript",
  kysely: "typescript",
  prisma: "prisma",
  sql: "sql",
  ts: "typescript",
  zod: "typescript",
};
