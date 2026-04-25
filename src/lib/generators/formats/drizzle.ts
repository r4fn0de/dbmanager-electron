import type { DatabaseType, SchemaColumn, SchemaForeignKey, SchemaIndex } from "@/ipc/db/types";
import {
  getColumnType,
  toLiteralKey,
  isValidIdentifier,
  pascalCase,
  camelCase,
  groupIndexes,
  filterExplicitIndexes,
} from "../utils";
import type { GeneratorFormat } from "../utils";

// ---------------------------------------------------------------------------
// Dialect config — maps db type → Drizzle table function, imports, etc.
// ---------------------------------------------------------------------------

interface DrizzleDialectConfig {
  tableFunc: string;
  importPath: string;
  dialectImports: string[];
  enumType?: string;
}

const DIALECT_CONFIG: Record<string, DrizzleDialectConfig> = {
  postgresql: {
    tableFunc: "pgTable",
    importPath: "drizzle-orm/pg-core",
    dialectImports: ["pgTable", "pgEnum"],
    enumType: "pgEnum",
  },
  mysql: {
    tableFunc: "mysqlTable",
    importPath: "drizzle-orm/mysql-core",
    dialectImports: ["mysqlTable", "mysqlEnum"],
    enumType: "mysqlEnum",
  },
  mariadb: {
    tableFunc: "mysqlTable",
    importPath: "drizzle-orm/mysql-core",
    dialectImports: ["mysqlTable", "mysqlEnum"],
    enumType: "mysqlEnum",
  },
  clickhouse: {
    tableFunc: "clickhouseTable",
    importPath: "drizzle-orm/clickhouse-core",
    dialectImports: ["clickhouseTable"],
  },
};

export function generateSchemaDrizzle(params: {
  table: string;
  schema: string;
  columns: SchemaColumn[];
  indexes: SchemaIndex[];
  foreignKeys: SchemaForeignKey[];
  dialect: DatabaseType;
}): string {
  const { table, schema, columns, indexes, foreignKeys, dialect } = params;
  const config = DIALECT_CONFIG[dialect];
  if (!config) {
    return `// Drizzle schema generation is not supported for ${dialect}`;
  }

  const varName = camelCase(table);
  const pascalName = pascalCase(table);
  const primaryKey = indexes.find((i) => i.is_primary);
  const pkColumns = new Set(primaryKey?.column_names ?? []);

  // Track which core imports we need
  const coreImports = new Set<string>(["InferModel"]);

  // Column definitions
  const colLines: string[] = [];
  for (const col of columns) {
    const key = toLiteralKey(col.name);
    const drizzleType = getColumnType(col.data_type, "drizzle" as GeneratorFormat, dialect);

    // Build modifiers
    const modifiers: string[] = [];

    // Primary key
    if (pkColumns.has(col.name)) {
      if (/serial|bigserial/i.test(col.data_type)) {
        modifiers.push(".primaryKey()");
      } else {
        modifiers.push(".primaryKey()");
      }
    }

    // NOT NULL (Drizzle defaults to nullable, .notNull() makes it required)
    if (!col.is_nullable) {
      modifiers.push(".notNull()");
    }

    // Default value
    if (col.column_default !== null) {
      // Convert SQL defaults to Drizzle-compatible expressions
      const def = col.column_default;
      if (/^now\(\)$/i.test(def) || /^current_timestamp/i.test(def)) {
        modifiers.push(".default(sql`now()`)" );
        coreImports.add("sql");
      } else if (/^gen_random_uuid\(\)$/i.test(def)) {
        modifiers.push(".default(sql`gen_random_uuid()`)" );
        coreImports.add("sql");
      } else if (/^\d+$/.test(def)) {
        modifiers.push(`.default(${def})`);
      } else if (/^true|false$/i.test(def)) {
        modifiers.push(`.default(${def.toLowerCase()})`);
      } else if (/^'[^']*'$/.test(def)) {
        modifiers.push(`.default(${def})`);
      } else {
        // Complex default — use sql template
        modifiers.push(`.default(sql\`${def}\`)` );
        coreImports.add("sql");
      }
    }

    colLines.push(`  ${key}: ${drizzleType}("${col.name}"${modifiers.length > 0 ? modifiers.join("") : ""}),`);
  }

  // Extra config (indexes, unique constraints)
  const groupedIndexes = groupIndexes(indexes, table);
  const explicitIndexes = filterExplicitIndexes(groupedIndexes, columns, dialect);
  const configLines: string[] = [];

  for (const idx of explicitIndexes) {
    const allValid = idx.columns.every((c) => isValidIdentifier(c));
    if (idx.isUnique) {
      if (allValid) {
        const idxCols = idx.columns.map((c) => `${c}: t.${c}`).join(", ");
        configLines.push(`    .unique("${idx.name}", { ${idxCols} })`);
      } else {
        // Non-standard column names can't be used as Drizzle property refs — emit comment
        configLines.push(`    // unique("${idx.name}") on columns: ${idx.columns.join(", ")}`);
      }
    }
  }

  // Non-unique indexes
  const nonUniqueIndexes = explicitIndexes.filter((i) => !i.isUnique);
  for (const idx of nonUniqueIndexes) {
    const allValid = idx.columns.every((c) => isValidIdentifier(c));
    if (allValid) {
      const idxCols = idx.columns.map((c) => `t.${c}`).join(", ");
      configLines.push(`    .index("${idx.name}", [${idxCols}])`);
    } else {
      configLines.push(`    // index("${idx.name}") on columns: ${idx.columns.join(", ")}`);
    }
  }

  // Build imports
  const dialectImportsStr = config.dialectImports.join(", ");
  const coreImportsStr = [...coreImports].join(", ");
  const escapedTable = table.replace(/'/g, "\\'");

  // Build output
  const lines: string[] = [];
  lines.push(`import { ${coreImportsStr} } from "drizzle-orm";`);
  lines.push(`import { ${dialectImportsStr} } from "${config.importPath}";`);

  // Foreign key references need additional imports
  const referencedTables = new Set<string>();
  for (const fk of foreignKeys) {
    if (fk.referenced_table !== table) {
      referencedTables.add(fk.referenced_table);
    }
  }
  if (referencedTables.size > 0) {
    // Add relations import hint
    lines.push(`// Related tables: ${[...referencedTables].join(", ")}`);
  }

  lines.push("");

  // Table definition
  const extraConfig = configLines.length > 0
    ? `,\n  (t) => [\n${configLines.join("\n")}\n  ]`
    : "";

  lines.push(`export const ${varName} = ${config.tableFunc}("${escapedTable}", {`);
  lines.push(colLines.join("\n"));
  lines.push(`}${extraConfig});`);
  lines.push("");
  lines.push(`export type ${pascalName} = InferModel<typeof ${varName}>;`);

  return lines.join("\n");
}
