import type { DatabaseType, SchemaColumn, SchemaIndex } from "@/ipc/db/types";
import {
  getColumnType,
  toLiteralKey,
  pascalCase,
  camelCase,
  isEnumColumn,
} from "../utils";
import type { GeneratorFormat } from "../utils";

function buildZodType(
  col: SchemaColumn,
  dialect: DatabaseType,
): string {
  let zodType = getColumnType(col.data_type, "zod" as GeneratorFormat, dialect);

  // Integer-specific: use z.int() for int types
  if (/int|serial|bigserial/i.test(col.data_type)) {
    zodType = "z.number().int()";
  }

  // Enum columns: use z.enum() placeholder
  if (isEnumColumn(col) && col.udt_name) {
    zodType = `z.enum(['value1', 'value2']) // TODO: replace with actual ${col.udt_name} enum values`;
  }

  // Nullable wrapper
  if (col.is_nullable) {
    zodType = `${zodType}.nullable()`;
  }

  // Max length constraint for varchar/char types
  const lengthMatch = col.data_type.match(/\((\d+)\)/);
  if (lengthMatch && /varchar|char|text/i.test(col.data_type)) {
    const maxLen = Number.parseInt(lengthMatch[1], 10);
    // Insert .max() before .nullable()
    if (col.is_nullable) {
      zodType = zodType.replace(".nullable()", `.max(${maxLen}).nullable()`);
    } else {
      zodType = `${zodType}.max(${maxLen})`;
    }
  }

  return zodType;
}

export function generateSchemaZod(params: {
  table: string;
  columns: SchemaColumn[];
  indexes: SchemaIndex[];
  dialect: DatabaseType;
}): string {
  const { table, columns, indexes, dialect } = params;
  const pascalName = pascalCase(table);
  const camelName = camelCase(table);

  const colLines: string[] = [];

  for (const col of columns) {
    const key = toLiteralKey(col.name);
    const zodType = buildZodType(col, dialect);
    colLines.push(`  ${key}: ${zodType},`);
  }

  return `import { z } from "zod";\n\nexport const ${camelName}Schema = z.object({\n${colLines.join("\n")}\n});\n\nexport type ${pascalName} = z.infer<typeof ${camelName}Schema>;`;
}
