import type { SchemaCompletionData } from "@/lib/monaco-sql-setup";

export interface SqlSidebarItemColumn {
  name: string;
  dataType: string;
}

export interface SqlSidebarItemTable {
  schema: string;
  name: string;
  columns: SqlSidebarItemColumn[];
}

export interface SqlSidebarItemSchema {
  name: string;
  tables: SqlSidebarItemTable[];
}

export interface ParsedColumnRef {
  schema: string;
  table: string;
  column: string;
  qualified: string;
}

interface JoinEdge {
  fromTableKey: string;
  fromColumn: string;
  toTableKey: string;
  toColumn: string;
}

export function buildItemsTree(data?: SchemaCompletionData): SqlSidebarItemSchema[] {
  if (!data || data.tables.length === 0) return [];

  const grouped = new Map<string, SqlSidebarItemTable[]>();
  for (const table of data.tables) {
    const tables = grouped.get(table.schema) ?? [];
    tables.push({
      schema: table.schema,
      name: table.name,
      columns: table.columns.map((column) => ({
        name: column.name,
        dataType: column.dataType,
      })),
    });
    grouped.set(table.schema, tables);
  }

  return [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, tables]) => ({
      name,
      tables: tables.sort((a, b) => a.name.localeCompare(b.name)),
    }));
}

export function filterItemsTree(
  itemsTree: SqlSidebarItemSchema[],
  searchText: string,
): SqlSidebarItemSchema[] {
  const needle = searchText.trim().toLowerCase();
  if (!needle) return itemsTree;

  return itemsTree
    .map((schema) => {
      const schemaMatches = schema.name.toLowerCase().includes(needle);
      if (schemaMatches) return schema;

      const tables = schema.tables
        .map((table) => {
          const tableMatches = table.name.toLowerCase().includes(needle);
          if (tableMatches) return table;

          const columns = table.columns.filter(
            (column) =>
              column.name.toLowerCase().includes(needle) ||
              column.dataType.toLowerCase().includes(needle),
          );
          return columns.length > 0 ? { ...table, columns } : null;
        })
        .filter((table): table is SqlSidebarItemTable => table !== null);

      return tables.length > 0 ? { ...schema, tables } : null;
    })
    .filter((schema): schema is SqlSidebarItemSchema => schema !== null);
}

export function makeTableSelectSql(schema: string, table: string): string {
  return `SELECT *\nFROM ${schema}.${table}\nLIMIT 100;`;
}

export function makeQualifiedColumnRef(
  schema: string,
  table: string,
  column: string,
): string {
  return `${schema}.${table}.${column}`;
}

export function parseColumnRef(ref: string): ParsedColumnRef | null {
  const trimmed = ref.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(".");
  if (parts.length < 3) return null;
  const schema = parts[0]?.trim();
  const table = parts[1]?.trim();
  const column = parts.slice(2).join(".").trim();
  if (!schema || !table || !column) return null;
  return {
    schema,
    table,
    column,
    qualified: makeQualifiedColumnRef(schema, table, column),
  };
}

export function normalizeColumnRefs(refs: string[]): ParsedColumnRef[] {
  const out: ParsedColumnRef[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const parsed = parseColumnRef(ref);
    if (!parsed) continue;
    if (seen.has(parsed.qualified)) continue;
    seen.add(parsed.qualified);
    out.push(parsed);
  }
  return out;
}

function groupColumnsByTable(parsed: ParsedColumnRef[]): Map<string, ParsedColumnRef[]> {
  const grouped = new Map<string, ParsedColumnRef[]>();
  for (const item of parsed) {
    const key = `${item.schema}.${item.table}`;
    const curr = grouped.get(key) ?? [];
    curr.push(item);
    grouped.set(key, curr);
  }
  return grouped;
}

function detectJoinEdges(baseTable: string, targetTable: string): JoinEdge[] {
  const [baseSchema, baseName] = baseTable.split(".");
  const [targetSchema, targetName] = targetTable.split(".");
  if (!baseSchema || !baseName || !targetSchema || !targetName) return [];

  const singular = (name: string) => (name.endsWith("s") ? name.slice(0, -1) : name);
  const baseCandidates = [singular(baseName), baseName];
  const targetCandidates = [singular(targetName), targetName];
  const out: JoinEdge[] = [];

  for (const candidate of baseCandidates) {
    if (candidate) {
      out.push({
        fromTableKey: targetTable,
        fromColumn: `${candidate}_id`,
        toTableKey: baseTable,
        toColumn: "id",
      });
    }
  }
  for (const candidate of targetCandidates) {
    if (candidate) {
      out.push({
        fromTableKey: baseTable,
        fromColumn: `${candidate}_id`,
        toTableKey: targetTable,
        toColumn: "id",
      });
    }
  }
  return out;
}

function buildTableColumnLookup(schemaData?: SchemaCompletionData): Map<string, Set<string>> {
  const lookup = new Map<string, Set<string>>();
  if (!schemaData) return lookup;
  for (const table of schemaData.tables) {
    lookup.set(
      `${table.schema}.${table.name}`,
      new Set(table.columns.map((column) => column.name)),
    );
  }
  return lookup;
}

function hasColumnInSchema(
  lookup: Map<string, Set<string>>,
  tableKey: string,
  column: string,
): boolean {
  return lookup.get(tableKey)?.has(column) ?? false;
}

function buildJoinEdges(
  schemaData: SchemaCompletionData | undefined,
  orderedTables: string[],
): JoinEdge[] | null {
  const [baseTable, ...others] = orderedTables;
  if (!baseTable) return null;
  const lookup = buildTableColumnLookup(schemaData);
  const edges: JoinEdge[] = [];
  const usedTargets = new Set<string>();

  for (const tableKey of others) {
    const candidates = detectJoinEdges(baseTable, tableKey);
    if (candidates.length === 0) return null;

    const edge = candidates.find((candidate) =>
      hasColumnInSchema(lookup, candidate.fromTableKey, candidate.fromColumn) &&
      hasColumnInSchema(lookup, candidate.toTableKey, candidate.toColumn),
    );
    if (!edge) return null;

    if (usedTargets.has(tableKey)) return null;
    usedTargets.add(tableKey);
    edges.push(edge);
  }

  return edges;
}

function buildJoinSql(
  grouped: Map<string, ParsedColumnRef[]>,
  orderedTables: string[],
  edges: JoinEdge[],
): string {
  const aliasByTable = new Map<string, string>();
  orderedTables.forEach((table, index) => aliasByTable.set(table, `t${index + 1}`));
  const projection = orderedTables.flatMap((table) => {
    const alias = aliasByTable.get(table) ?? "t1";
    return (grouped.get(table) ?? []).map((item) => `${alias}.${item.column} AS ${alias}_${item.column}`);
  });

  const [baseTable] = orderedTables;
  const baseAlias = aliasByTable.get(baseTable) ?? "t1";
  const joins = edges.map((edge) => {
    const fromAlias = aliasByTable.get(edge.fromTableKey) ?? "t1";
    const toAlias = aliasByTable.get(edge.toTableKey) ?? "t1";
    return `JOIN ${edge.fromTableKey} ${fromAlias} ON ${fromAlias}.${edge.fromColumn} = ${toAlias}.${edge.toColumn}`;
  });

  return `SELECT ${projection.join(", ")}\nFROM ${baseTable} ${baseAlias}\n${joins.join("\n")}\nLIMIT 100;`;
}

function buildPerTableSql(grouped: Map<string, ParsedColumnRef[]>, orderedTables: string[]): string {
  const chunks = orderedTables.map((tableKey) => {
    const cols = (grouped.get(tableKey) ?? []).map((item) => item.column);
    return `SELECT ${cols.join(", ")}\nFROM ${tableKey}\nLIMIT 100;`;
  });
  return chunks.join("\n\n");
}

export function buildSmartSqlFromColumnRefs(
  refs: string[],
  schemaData?: SchemaCompletionData,
): string | null {
  const parsed = normalizeColumnRefs(refs);
  if (parsed.length === 0) return null;
  const grouped = groupColumnsByTable(parsed);
  const orderedTables = [...grouped.keys()];
  if (orderedTables.length === 1) {
    return buildPerTableSql(grouped, orderedTables);
  }

  const edges = buildJoinEdges(schemaData, orderedTables);
  if (!edges) {
    return buildPerTableSql(grouped, orderedTables);
  }
  return buildJoinSql(grouped, orderedTables, edges);
}
