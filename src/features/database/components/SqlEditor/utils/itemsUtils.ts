import type { SchemaCompletionData } from "@/lib/monaco-sql-setup";
import { Parser } from "node-sql-parser";

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

export interface SqlStatementRange {
  start: number;
  end: number;
  text: string;
}

const sqlAstParser = new Parser();

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

export function getStatementRangeAtOffset(sql: string, offset: number): SqlStatementRange | null {
  const clamped = Math.max(0, Math.min(offset, sql.length));
  let start = 0;
  let end = sql.length;

  for (let i = clamped - 1; i >= 0; i--) {
    if (sql[i] === ";") {
      start = i + 1;
      break;
    }
  }
  for (let i = clamped; i < sql.length; i++) {
    if (sql[i] === ";") {
      end = i;
      break;
    }
  }

  const text = sql.slice(start, end).trim();
  if (!text) return null;
  return { start, end, text };
}

function inferJoinClause(
  baseTableKey: string,
  targetTableKey: string,
  baseAlias: string | null,
  nextAlias: string,
  schemaData?: SchemaCompletionData,
): string | null {
  const edge = buildJoinEdges(schemaData, [baseTableKey, targetTableKey])?.[0];
  if (!edge) return null;
  const leftAlias = edge.fromTableKey === targetTableKey ? nextAlias : (baseAlias ?? baseTableKey);
  const rightAlias = edge.toTableKey === baseTableKey ? (baseAlias ?? baseTableKey) : nextAlias;
  const joinTable = targetTableKey;
  return `JOIN ${joinTable} ${nextAlias} ON ${leftAlias}.${edge.fromColumn} = ${rightAlias}.${edge.toColumn}`;
}

function toTableKey(item: { db?: string | null; table?: string | null }): string | null {
  if (!item.table) return null;
  if (item.db) return `${item.db}.${item.table}`;
  return item.table.includes(".") ? item.table : null;
}

function readColumnName(expr: unknown): string | null {
  if (!expr || typeof expr !== "object") return null;
  const col = (expr as { column?: unknown }).column;
  if (typeof col === "string") return col;
  if (col && typeof col === "object") {
    const value = (col as { expr?: { value?: string } }).expr?.value;
    return typeof value === "string" ? value : null;
  }
  return null;
}

export function mergeDroppedColumnsIntoStatement(
  statement: string,
  droppedRefs: string[],
  schemaData?: SchemaCompletionData,
): { sql: string; merged: boolean } {
  const normalized = normalizeColumnRefs(droppedRefs);
  if (normalized.length === 0) return { sql: statement, merged: false };

  let astRaw: unknown;
  try {
    astRaw = sqlAstParser.astify(statement, { database: "Postgresql" });
  } catch {
    return { sql: statement, merged: false };
  }
  const ast = Array.isArray(astRaw) ? astRaw[0] : astRaw;
  if (!ast || typeof ast !== "object") return { sql: statement, merged: false };
  const selectAst = ast as {
    type?: string;
    columns?: Array<{ expr?: unknown; as?: string | null }>;
    from?: Array<{ db?: string | null; table?: string | null; as?: string | null; join?: string; on?: unknown }>;
  };
  if (selectAst.type !== "select" || !Array.isArray(selectAst.from) || selectAst.from.length === 0) {
    return { sql: statement, merged: false };
  }

  const baseFrom = selectAst.from[0];
  const baseTableKey = toTableKey(baseFrom);
  if (!baseTableKey) return { sql: statement, merged: false };
  const tableAliases = new Map<string, string | null>();
  for (const item of selectAst.from) {
    const key = toTableKey(item);
    if (!key) continue;
    tableAliases.set(key, item.as ?? null);
  }

  const existingProjection = new Set<string>();
  for (const col of selectAst.columns ?? []) {
    const expr = col.expr as { type?: string; table?: string | null } | undefined;
    if (!expr || expr.type !== "column_ref") continue;
    const colName = readColumnName(expr);
    if (!colName) continue;
    const alias = typeof expr.table === "string" ? expr.table : null;
    existingProjection.add(`${alias ?? ""}.${colName}`);
  }

  let aliasCounter = Math.max(2, tableAliases.size + 1);
  const fallbackRefs: string[] = [];
  let changed = false;

  for (const ref of normalized) {
    const tableKey = `${ref.schema}.${ref.table}`;
    if (!tableAliases.has(tableKey)) {
      const alias = `t${aliasCounter++}`;
      const joinEdge = buildJoinEdges(schemaData, [baseTableKey, tableKey])?.[0];
      const joinClause = inferJoinClause(
        baseTableKey,
        tableKey,
        baseFrom.as ?? null,
        alias,
        schemaData,
      );
      if (!joinClause || !joinEdge) {
        fallbackRefs.push(ref.qualified);
        continue;
      }
      tableAliases.set(tableKey, alias);
      const leftAlias = joinEdge.fromTableKey === tableKey
        ? alias
        : (baseFrom.as ?? baseTableKey);
      const rightAlias = joinEdge.toTableKey === baseTableKey
        ? (baseFrom.as ?? baseTableKey)
        : alias;
      selectAst.from.push({
        db: ref.schema,
        table: ref.table,
        as: alias,
        join: "INNER JOIN",
        on: {
          type: "binary_expr",
          operator: "=",
          left: {
            type: "column_ref",
            table: leftAlias,
            column: joinEdge.fromColumn,
          },
          right: {
            type: "column_ref",
            table: rightAlias,
            column: joinEdge.toColumn,
          },
        },
      });
      changed = true;
    }

    const alias = tableAliases.get(tableKey);
    const key = `${alias ?? ""}.${ref.column}`;
    if (!existingProjection.has(key)) {
      existingProjection.add(key);
      (selectAst.columns ??= []).push({
        type: "expr",
        expr: {
          type: "column_ref",
          table: alias ?? tableKey,
          column: ref.column,
          collate: null,
        },
        as: null,
      });
      changed = true;
    }
  }
  let mergedSql = statement;
  if (changed) {
    try {
      mergedSql = sqlAstParser.sqlify(selectAst as object, { database: "Postgresql" });
    } catch {
      mergedSql = statement;
      changed = false;
    }
  }

  if (fallbackRefs.length > 0) {
    const fallbackSql = buildSmartSqlFromColumnRefs(fallbackRefs, schemaData);
    if (fallbackSql) {
      mergedSql = `${mergedSql.trimEnd()}\n\n${fallbackSql}`;
      changed = true;
    }
  }

  if (!changed) return { sql: statement, merged: false };
  return { sql: mergedSql, merged: true };
}
