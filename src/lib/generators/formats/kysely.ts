import type { DatabaseType, SchemaColumn, SchemaIndex } from "@/ipc/db/types";
import {
  getColumnType,
  toLiteralKey,
  pascalCase,
  isValidIdentifier,
} from "../utils";
import type { GeneratorFormat } from "../utils";

export function generateSchemaKysely(params: {
  table: string;
  columns: SchemaColumn[];
  indexes: SchemaIndex[];
  dialect: DatabaseType;
}): string {
  const { table, columns, indexes, dialect } = params;
  const pascalTable = pascalCase(table);
  const primaryKey = indexes.find((i) => i.is_primary);
  const pkColumns = new Set(primaryKey?.column_names ?? []);

  const colLines: string[] = [];

  for (const col of columns) {
    const key = toLiteralKey(col.name);
    let tsType = getColumnType(col.data_type, "kysely" as GeneratorFormat, dialect);

    // Wrap primary key columns with Generated<>
    if (pkColumns.has(col.name)) {
      tsType = `Generated<${tsType}>`;
    }

    // Nullable
    if (col.is_nullable && !pkColumns.has(col.name)) {
      tsType = `${tsType} | null`;
    }

    colLines.push(`  ${key}: ${tsType};`);
  }

  // Use the table name as the key (safe identifier or quoted)
  const tableKey = isValidIdentifier(table) ? table : `'${table}'`;

  return `import type { Generated } from "kysely";\n\nexport interface ${pascalTable}Table {\n${colLines.join("\n")}\n}\n\nexport interface Database {\n  ${tableKey}: ${pascalTable}Table;\n}`;
}
