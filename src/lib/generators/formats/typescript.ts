import type { DatabaseType, SchemaColumn, SchemaIndex } from "@/ipc/db/types";
import {
  getColumnType,
  toLiteralKey,
  pascalCase,
  isEnumColumn,
  formatEnumAsUnionType,
} from "../utils";
import type { GeneratorFormat } from "../utils";

export function generateSchemaTypeScript(params: {
  table: string;
  columns: SchemaColumn[];
  indexes: SchemaIndex[];
  dialect: DatabaseType;
}): string {
  const { table, columns, indexes, dialect } = params;
  const pascalName = pascalCase(table);

  const colLines: string[] = [];
  const enumTypes: string[] = [];

  for (const col of columns) {
    const key = toLiteralKey(col.name);
    let tsType = getColumnType(col.data_type, "ts" as GeneratorFormat, dialect);

    // Detect enum columns and use the enum type name as a hint
    if (isEnumColumn(col) && col.udt_name) {
      const enumName = pascalCase(col.udt_name);
      tsType = enumName;
      if (!enumTypes.includes(enumName)) {
        enumTypes.push(enumName);
      }
    }

    // Handle nullable: use optional + null union
    const optional = col.is_nullable ? "?" : "";
    const nullSuffix = col.is_nullable ? " | null" : "";

    colLines.push(`  ${key}${optional}: ${tsType}${nullSuffix};`);
  }

  // Emit enum type placeholders when detected (uses formatEnumAsUnionType for valid TS syntax)
  const enumLines = enumTypes.map((e) => `// TODO: replace with actual enum values\n// export type ${e} = ${formatEnumAsUnionType(["value1", "value2"])};`).join("\n");
  const header = enumLines ? `${enumLines}\n\n` : "";

  return `${header}export interface ${pascalName} {\n${colLines.join("\n")}\n}`;
}
