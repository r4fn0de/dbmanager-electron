/**
 * Monaco Editor setup for SQL — autocomplete, snippets, formatting, EXPLAIN.
 *
 * Registers a completion item provider that suggests table/column names
 * from the live database schema, plus common SQL snippet templates.
 */

import * as monaco from "monaco-editor";
import { format as sqlFormat } from "sql-formatter";

// ── Schema data types ────────────────────────────────────────────────

export interface SchemaCompletionTable {
  schema: string;
  name: string;
  columns: { name: string; dataType: string }[];
}

export interface SchemaCompletionData {
  schemas: string[];
  tables: SchemaCompletionTable[];
}

// ── Mutable schema store ─────────────────────────────────────────────
// Updated by the SqlEditor component when schema data changes.
// The Monaco completion provider reads from this store.

let currentSchemaData: SchemaCompletionData = { schemas: [], tables: [] };

export function updateSchemaData(data: SchemaCompletionData) {
  currentSchemaData = data;
}

// ── SQL Keywords ──────────────────────────────────────────────────────
// Comprehensive list so SELECT, FROM, WHERE etc. appear in autocomplete.
// Sort order: keywords come after tables/columns (0_x, 1_x) but before
// schema names (3_x), using sort prefix "2_".

const SQL_KEYWORDS: { label: string; detail?: string }[] = [
  // DML
  { label: "SELECT", detail: "Query data" },
  { label: "FROM", detail: "Data source" },
  { label: "WHERE", detail: "Filter rows" },
  { label: "INSERT", detail: "Insert rows" },
  { label: "INTO", detail: "Target table" },
  { label: "VALUES", detail: "Value list" },
  { label: "UPDATE", detail: "Update rows" },
  { label: "SET", detail: "Set columns" },
  { label: "DELETE", detail: "Delete rows" },
  // Join
  { label: "JOIN", detail: "Inner join" },
  { label: "INNER", detail: "Inner join" },
  { label: "LEFT", detail: "Left outer join" },
  { label: "RIGHT", detail: "Right outer join" },
  { label: "OUTER", detail: "Outer join" },
  { label: "FULL", detail: "Full outer join" },
  { label: "CROSS", detail: "Cross join" },
  { label: "ON", detail: "Join condition" },
  // Grouping / ordering
  { label: "GROUP", detail: "Group rows" },
  { label: "BY", detail: "Group / order by" },
  { label: "HAVING", detail: "Group filter" },
  { label: "ORDER", detail: "Sort rows" },
  { label: "ASC", detail: "Ascending" },
  { label: "DESC", detail: "Descending" },
  { label: "LIMIT", detail: "Limit rows" },
  { label: "OFFSET", detail: "Skip rows" },
  // Logical
  { label: "AND", detail: "Logical AND" },
  { label: "OR", detail: "Logical OR" },
  { label: "NOT", detail: "Logical NOT" },
  { label: "IN", detail: "In set" },
  { label: "IS", detail: "Is null / not null" },
  { label: "NULL", detail: "Null value" },
  { label: "LIKE", detail: "Pattern match" },
  { label: "BETWEEN", detail: "Range check" },
  { label: "EXISTS", detail: "Subquery exists" },
  { label: "ANY", detail: "Any in set" },
  { label: "ALL", detail: "All in set" },
  { label: "CASE", detail: "Conditional expression" },
  { label: "WHEN", detail: "Case branch" },
  { label: "THEN", detail: "Case result" },
  { label: "ELSE", detail: "Case fallback" },
  { label: "END", detail: "End block" },
  { label: "AS", detail: "Alias" },
  { label: "DISTINCT", detail: "Unique rows" },
  // DDL
  { label: "CREATE", detail: "Create object" },
  { label: "TABLE", detail: "Create table" },
  { label: "INDEX", detail: "Create index" },
  { label: "VIEW", detail: "Create view" },
  { label: "DROP", detail: "Drop object" },
  { label: "ALTER", detail: "Alter object" },
  { label: "ADD", detail: "Add column" },
  { label: "COLUMN", detail: "Column" },
  { label: "CONSTRAINT", detail: "Constraint" },
  { label: "PRIMARY", detail: "Primary key" },
  { label: "KEY", detail: "Key" },
  { label: "FOREIGN", detail: "Foreign key" },
  { label: "REFERENCES", detail: "References" },
  { label: "UNIQUE", detail: "Unique" },
  { label: "CHECK", detail: "Check constraint" },
  { label: "DEFAULT", detail: "Default value" },
  { label: "IF", detail: "Conditional" },
  { label: "REPLACE", detail: "Replace" },
  { label: "TEMP", detail: "Temporary" },
  { label: "TEMPORARY", detail: "Temporary" },
  // Data types
  { label: "INTEGER", detail: "Integer type" },
  { label: "INT", detail: "Integer type" },
  { label: "BIGINT", detail: "Big integer" },
  { label: "SERIAL", detail: "Auto-increment int" },
  { label: "BIGSERIAL", detail: "Auto-increment bigint" },
  { label: "VARCHAR", detail: "Variable-length text" },
  { label: "TEXT", detail: "Text type" },
  { label: "BOOLEAN", detail: "Boolean type" },
  { label: "BOOL", detail: "Boolean type" },
  { label: "DATE", detail: "Date type" },
  { label: "TIME", detail: "Time type" },
  { label: "TIMESTAMP", detail: "Timestamp type" },
  { label: "FLOAT", detail: "Float type" },
  { label: "DOUBLE", detail: "Double type" },
  { label: "DECIMAL", detail: "Decimal type" },
  { label: "NUMERIC", detail: "Numeric type" },
  { label: "JSON", detail: "JSON type" },
  { label: "JSONB", detail: "JSON binary" },
  { label: "UUID", detail: "UUID type" },
  { label: "BLOB", detail: "Binary large object" },
  { label: "BYTEA", detail: "Binary data (PG)" },
  // Functions
  { label: "COUNT", detail: "Count rows" },
  { label: "SUM", detail: "Sum values" },
  { label: "AVG", detail: "Average value" },
  { label: "MIN", detail: "Minimum value" },
  { label: "MAX", detail: "Maximum value" },
  { label: "COALESCE", detail: "First non-null" },
  { label: "NULLIF", detail: "Null if equal" },
  { label: "CAST", detail: "Type cast" },
  { label: "EXTRACT", detail: "Extract field" },
  { label: "NOW", detail: "Current timestamp" },
  { label: "CURRENT_DATE", detail: "Current date" },
  { label: "CURRENT_TIME", detail: "Current time" },
  { label: "CURRENT_TIMESTAMP", detail: "Current timestamp" },
  { label: "LENGTH", detail: "String length" },
  { label: "CONCAT", detail: "Concatenate" },
  { label: "TRIM", detail: "Trim whitespace" },
  { label: "UPPER", detail: "Uppercase" },
  { label: "LOWER", detail: "Lowercase" },
  { label: "SUBSTRING", detail: "Substring" },
  { label: "REPLACE", detail: "Replace string" },
  { label: "ROUND", detail: "Round number" },
  { label: "CEIL", detail: "Ceiling" },
  { label: "FLOOR", detail: "Floor" },
  { label: "ABS", detail: "Absolute value" },
  // Transaction / misc
  { label: "BEGIN", detail: "Begin transaction" },
  { label: "COMMIT", detail: "Commit transaction" },
  { label: "ROLLBACK", detail: "Rollback transaction" },
  { label: "TRANSACTION", detail: "Transaction" },
  { label: "EXPLAIN", detail: "Explain plan" },
  { label: "ANALYZE", detail: "Analyze / explain analyze" },
  { label: "VACUUM", detail: "Vacuum (PG)" },
  { label: "WITH", detail: "CTE / WITH clause" },
  { label: "RECURSIVE", detail: "Recursive CTE" },
  { label: "UNION", detail: "Union" },
  { label: "INTERSECT", detail: "Intersect" },
  { label: "EXCEPT", detail: "Except" },
  { label: "RETURNING", detail: "Returning (PG)" },
  { label: "OVER", detail: "Window function" },
  { label: "PARTITION", detail: "Window partition" },
  { label: "ROWS", detail: "Window frame rows" },
  { label: "RANGE", detail: "Window frame range" },
  { label: "WINDOW", detail: "Named window" },
  { label: "TRUNCATE", detail: "Truncate table" },
  { label: "SCHEMA", detail: "Schema" },
  { label: "DATABASE", detail: "Database" },
  { label: "GRANT", detail: "Grant privilege" },
  { label: "REVOKE", detail: "Revoke privilege" },
  { label: "TRUE", detail: "Boolean true" },
  { label: "FALSE", detail: "Boolean false" },
];

function makeKeywords(
  range: monaco.IRange,
): monaco.languages.CompletionItem[] {
  return SQL_KEYWORDS.map((kw) => ({
    label: kw.label,
    kind: monaco.languages.CompletionItemKind.Keyword,
    insertText: kw.label,
    range,
    detail: kw.detail,
    sortText: `2_${kw.label}`,
  }));
}

// ── SQL Snippets ──────────────────────────────────────────────────────
// Labels use the full keyword (SELECT, INSERT, …) so they appear when the
// user types the keyword name. The snippet prefix is shown in detail.

function makeSnippets(
  range: monaco.IRange,
): monaco.languages.CompletionItem[] {
  return [
    {
      label: "SELECT",
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertText:
        "SELECT\n  ${1:columns}\nFROM\n  ${2:table_name}\nWHERE\n  ${3:condition};",
      insertTextRules:
        monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      documentation: "SELECT … FROM … WHERE",
      detail: "… FROM … WHERE template",
      sortText: "1_SELECT",
      range,
    },
    {
      label: "SELECT *",
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertText:
        "SELECT *\nFROM\n  ${1:table_name}\nLIMIT ${2:100};",
      insertTextRules:
        monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      documentation: "SELECT * FROM … LIMIT",
      detail: "… FROM … LIMIT template",
      sortText: "1_SELECT *",
      range,
    },
    {
      label: "INSERT",
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertText:
        "INSERT INTO ${1:table_name} (${2:columns})\nVALUES (${3:values});",
      insertTextRules:
        monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      documentation: "INSERT INTO … VALUES",
      detail: "… INTO … VALUES template",
      sortText: "1_INSERT",
      range,
    },
    {
      label: "UPDATE",
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertText:
        "UPDATE ${1:table_name}\nSET\n  ${2:column} = ${3:value}\nWHERE ${4:condition};",
      insertTextRules:
        monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      documentation: "UPDATE … SET … WHERE",
      detail: "… SET … WHERE template",
      sortText: "1_UPDATE",
      range,
    },
    {
      label: "DELETE",
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertText:
        "DELETE FROM ${1:table_name}\nWHERE ${2:condition};",
      insertTextRules:
        monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      documentation: "DELETE FROM … WHERE",
      detail: "… FROM … WHERE template",
      sortText: "1_DELETE",
      range,
    },
    {
      label: "CREATE TABLE",
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertText:
        "CREATE TABLE ${1:table_name} (\n  ${2:id} SERIAL PRIMARY KEY,\n  ${3:column_name} ${4:VARCHAR(255)}\n);",
      insertTextRules:
        monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      documentation: "CREATE TABLE …",
      detail: "… (columns) template",
      sortText: "1_CREATE TABLE",
      range,
    },
    {
      label: "INNER JOIN",
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertText:
        "INNER JOIN ${1:table_name} ON ${2:table1.column} = ${3:table2.column}",
      insertTextRules:
        monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      documentation: "INNER JOIN … ON",
      detail: "… ON … = … template",
      sortText: "1_INNER JOIN",
      range,
    },
    {
      label: "LEFT JOIN",
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertText:
        "LEFT JOIN ${1:table_name} ON ${2:table1.column} = ${3:table2.column}",
      insertTextRules:
        monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      documentation: "LEFT JOIN … ON",
      detail: "… ON … = … template",
      sortText: "1_LEFT JOIN",
      range,
    },
    {
      label: "RIGHT JOIN",
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertText:
        "RIGHT JOIN ${1:table_name} ON ${2:table1.column} = ${3:table2.column}",
      insertTextRules:
        monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      documentation: "RIGHT JOIN … ON",
      detail: "… ON … = … template",
      sortText: "1_RIGHT JOIN",
      range,
    },
    {
      label: "GROUP BY",
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertText:
        "GROUP BY ${1:column}\nHAVING ${2:condition}",
      insertTextRules:
        monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      documentation: "GROUP BY … HAVING",
      detail: "… HAVING … template",
      sortText: "1_GROUP BY",
      range,
    },
    {
      label: "ORDER BY",
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertText: "ORDER BY ${1:column} ${2|ASC,DESC|}",
      insertTextRules:
        monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      documentation: "ORDER BY … ASC/DESC",
      detail: "… ASC/DESC template",
      sortText: "1_ORDER BY",
      range,
    },
    {
      label: "CREATE INDEX",
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertText:
        "CREATE INDEX ${1:index_name} ON ${2:table_name} (${3:column});",
      insertTextRules:
        monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      documentation: "CREATE INDEX … ON",
      detail: "… ON … (col) template",
      sortText: "1_CREATE INDEX",
      range,
    },
    {
      label: "ALTER TABLE",
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertText:
        "ALTER TABLE ${1:table_name}\nADD COLUMN ${2:column_name} ${3:data_type};",
      insertTextRules:
        monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      documentation: "ALTER TABLE … ADD COLUMN",
      detail: "… ADD COLUMN … template",
      sortText: "1_ALTER TABLE",
      range,
    },
    {
      label: "WITH",
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertText:
        "WITH ${1:cte_name} AS (\n  ${2:SELECT}\n)\n${3:SELECT * FROM ${1:cte_name}};",
      insertTextRules:
        monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      documentation: "Common Table Expression (CTE)",
      detail: "CTE: … AS (…) SELECT template",
      sortText: "1_WITH",
      range,
    },
    {
      label: "SELECT FROM",
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertText:
        "SELECT *\nFROM (\n  ${1:SELECT}\n) AS ${2:subquery}",
      insertTextRules:
        monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      documentation: "SELECT FROM (subquery)",
      detail: "Subquery template",
      sortText: "1_SELECT FROM",
      range,
    },
  ];
}

// ── Completion provider ───────────────────────────────────────────────

let completionDisposable: monaco.IDisposable | null = null;

export function registerSqlCompletion() {
  if (completionDisposable) {
    completionDisposable.dispose();
  }

  completionDisposable = monaco.languages.registerCompletionItemProvider(
    "sql",
    {
      triggerCharacters: [".", " ", '"'],
      provideCompletionItems(model, position) {
        const word = model.getWordUntilPosition(position);
        const range: monaco.IRange = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };

        const lineContent = model.getLineContent(position.lineNumber);
        const textBefore = lineContent.substring(0, position.column - 1);

        const suggestions: monaco.languages.CompletionItem[] = [];

        // ── Column completion after dot ─────────────────────────
        const dotMatch = textBefore.match(/(\b\w+)\.\s*$/);
        if (dotMatch) {
          const ref = dotMatch[1];
          const table = currentSchemaData.tables.find(
            (t) => t.name === ref || `${t.schema}.${t.name}` === ref,
          );
          if (table) {
            for (const col of table.columns) {
              suggestions.push({
                label: col.name,
                kind: monaco.languages.CompletionItemKind.Field,
                insertText: col.name,
                range,
                detail: col.dataType,
                sortText: `0_${col.name}`,
              });
            }
            if (suggestions.length > 0) return { suggestions };
          }
        }

        // ── Table names ────────────────────────────────────────
        const seen = new Set<string>();
        for (const table of currentSchemaData.tables) {
          // Unqualified name
          if (!seen.has(table.name)) {
            seen.add(table.name);
            suggestions.push({
              label: table.name,
              kind: monaco.languages.CompletionItemKind.Class,
              insertText: table.name,
              range,
              detail: `Table · ${table.schema}`,
              documentation:
                table.columns.length > 0
                  ? `Columns: ${table.columns.map((c) => c.name).join(", ")}`
                  : undefined,
              sortText: `1_${table.name}`,
            });
          }
          // Qualified name (schema.table) — show when multi-schema or non-default
          const qualified = `${table.schema}.${table.name}`;
          if (!seen.has(qualified)) {
            seen.add(qualified);
            suggestions.push({
              label: qualified,
              kind: monaco.languages.CompletionItemKind.Class,
              insertText: qualified,
              range,
              detail: "Table · qualified",
              documentation:
                table.columns.length > 0
                  ? `Columns: ${table.columns.map((c) => c.name).join(", ")}`
                  : undefined,
              sortText: `2_${qualified}`,
            });
          }
        }

        // ── Schema names ───────────────────────────────────────
        for (const schema of currentSchemaData.schemas) {
          suggestions.push({
            label: schema,
            kind: monaco.languages.CompletionItemKind.Module,
            insertText: schema,
            range,
            detail: "Schema",
            sortText: `3_${schema}`,
          });
        }

        // ── SQL Keywords ────────────────────────────────────────
        suggestions.push(...makeKeywords(range));

        // ── Snippets ───────────────────────────────────────────
        suggestions.push(...makeSnippets(range));

        return { suggestions };
      },
    },
  );
}

export function disposeSqlCompletion() {
  if (completionDisposable) {
    completionDisposable.dispose();
    completionDisposable = null;
  }
}

// ── SQL Formatter ─────────────────────────────────────────────────────

type FormatterLanguage =
  | "sql"
  | "mysql"
  | "postgresql"
  | "mariadb"
  | "sqlite";

function getFormatterLanguage(dbType: string): FormatterLanguage {
  switch (dbType) {
    case "postgresql":
      return "postgresql";
    case "mysql":
      return "mysql";
    case "mariadb":
      return "mariadb";
    case "sqlite":
      return "sqlite";
    default:
      return "sql";
  }
}

export function formatSql(sql: string, dbType: string): string {
  try {
    return sqlFormat(sql, {
      language: getFormatterLanguage(dbType),
      tabWidth: 2,
      keywordCase: "upper",
      logicalOperatorNewline: "before",
    });
  } catch {
    return sql; // Return original on parse error
  }
}

// ── EXPLAIN utility ───────────────────────────────────────────────────

export function buildExplainSql(
  sql: string,
  dbType: string,
  analyze: boolean = false,
): string {
  switch (dbType) {
    case "sqlite":
      return `EXPLAIN QUERY PLAN ${sql}`;
    case "postgresql":
      return analyze ? `EXPLAIN ANALYZE ${sql}` : `EXPLAIN ${sql}`;
    case "mysql":
    case "mariadb":
      return analyze ? `EXPLAIN ANALYZE ${sql}` : `EXPLAIN ${sql}`;
    case "clickhouse":
      return `EXPLAIN ${analyze ? "PIPELINE" : "PLAN"} ${sql}`;
    default:
      return `EXPLAIN ${sql}`;
  }
}

export function supportsExplainAnalyze(dbType: string): boolean {
  // ClickHouse also supports a deeper EXPLAIN mode (PIPELINE vs PLAN)
  return dbType === "postgresql" || dbType === "mysql" || dbType === "mariadb" || dbType === "clickhouse";
}
