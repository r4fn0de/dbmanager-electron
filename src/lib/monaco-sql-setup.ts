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
  columns: { name: string; dataType: string }[];
  name: string;
  schema: string;
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
  { detail: "Query data", label: "SELECT" },
  { detail: "Data source", label: "FROM" },
  { detail: "Filter rows", label: "WHERE" },
  { detail: "Insert rows", label: "INSERT" },
  { detail: "Target table", label: "INTO" },
  { detail: "Value list", label: "VALUES" },
  { detail: "Update rows", label: "UPDATE" },
  { detail: "Set columns", label: "SET" },
  { detail: "Delete rows", label: "DELETE" },
  // Join
  { detail: "Inner join", label: "JOIN" },
  { detail: "Inner join", label: "INNER" },
  { detail: "Left outer join", label: "LEFT" },
  { detail: "Right outer join", label: "RIGHT" },
  { detail: "Outer join", label: "OUTER" },
  { detail: "Full outer join", label: "FULL" },
  { detail: "Cross join", label: "CROSS" },
  { detail: "Join condition", label: "ON" },
  // Grouping / ordering
  { detail: "Group rows", label: "GROUP" },
  { detail: "Group / order by", label: "BY" },
  { detail: "Group filter", label: "HAVING" },
  { detail: "Sort rows", label: "ORDER" },
  { detail: "Ascending", label: "ASC" },
  { detail: "Descending", label: "DESC" },
  { detail: "Limit rows", label: "LIMIT" },
  { detail: "Skip rows", label: "OFFSET" },
  // Logical
  { detail: "Logical AND", label: "AND" },
  { detail: "Logical OR", label: "OR" },
  { detail: "Logical NOT", label: "NOT" },
  { detail: "In set", label: "IN" },
  { detail: "Is null / not null", label: "IS" },
  { detail: "Null value", label: "NULL" },
  { detail: "Pattern match", label: "LIKE" },
  { detail: "Range check", label: "BETWEEN" },
  { detail: "Subquery exists", label: "EXISTS" },
  { detail: "Any in set", label: "ANY" },
  { detail: "All in set", label: "ALL" },
  { detail: "Conditional expression", label: "CASE" },
  { detail: "Case branch", label: "WHEN" },
  { detail: "Case result", label: "THEN" },
  { detail: "Case fallback", label: "ELSE" },
  { detail: "End block", label: "END" },
  { detail: "Alias", label: "AS" },
  { detail: "Unique rows", label: "DISTINCT" },
  // DDL
  { detail: "Create object", label: "CREATE" },
  { detail: "Create table", label: "TABLE" },
  { detail: "Create index", label: "INDEX" },
  { detail: "Create view", label: "VIEW" },
  { detail: "Drop object", label: "DROP" },
  { detail: "Alter object", label: "ALTER" },
  { detail: "Add column", label: "ADD" },
  { detail: "Column", label: "COLUMN" },
  { detail: "Constraint", label: "CONSTRAINT" },
  { detail: "Primary key", label: "PRIMARY" },
  { detail: "Key", label: "KEY" },
  { detail: "Foreign key", label: "FOREIGN" },
  { detail: "References", label: "REFERENCES" },
  { detail: "Unique", label: "UNIQUE" },
  { detail: "Check constraint", label: "CHECK" },
  { detail: "Default value", label: "DEFAULT" },
  { detail: "Conditional", label: "IF" },
  { detail: "Replace", label: "REPLACE" },
  { detail: "Temporary", label: "TEMP" },
  { detail: "Temporary", label: "TEMPORARY" },
  // Data types
  { detail: "Integer type", label: "INTEGER" },
  { detail: "Integer type", label: "INT" },
  { detail: "Big integer", label: "BIGINT" },
  { detail: "Auto-increment int", label: "SERIAL" },
  { detail: "Auto-increment bigint", label: "BIGSERIAL" },
  { detail: "Variable-length text", label: "VARCHAR" },
  { detail: "Text type", label: "TEXT" },
  { detail: "Boolean type", label: "BOOLEAN" },
  { detail: "Boolean type", label: "BOOL" },
  { detail: "Date type", label: "DATE" },
  { detail: "Time type", label: "TIME" },
  { detail: "Timestamp type", label: "TIMESTAMP" },
  { detail: "Float type", label: "FLOAT" },
  { detail: "Double type", label: "DOUBLE" },
  { detail: "Decimal type", label: "DECIMAL" },
  { detail: "Numeric type", label: "NUMERIC" },
  { detail: "JSON type", label: "JSON" },
  { detail: "JSON binary", label: "JSONB" },
  { detail: "UUID type", label: "UUID" },
  { detail: "Binary large object", label: "BLOB" },
  { detail: "Binary data (PG)", label: "BYTEA" },
  // Functions
  { detail: "Count rows", label: "COUNT" },
  { detail: "Sum values", label: "SUM" },
  { detail: "Average value", label: "AVG" },
  { detail: "Minimum value", label: "MIN" },
  { detail: "Maximum value", label: "MAX" },
  { detail: "First non-null", label: "COALESCE" },
  { detail: "Null if equal", label: "NULLIF" },
  { detail: "Type cast", label: "CAST" },
  { detail: "Extract field", label: "EXTRACT" },
  { detail: "Current timestamp", label: "NOW" },
  { detail: "Current date", label: "CURRENT_DATE" },
  { detail: "Current time", label: "CURRENT_TIME" },
  { detail: "Current timestamp", label: "CURRENT_TIMESTAMP" },
  { detail: "String length", label: "LENGTH" },
  { detail: "Concatenate", label: "CONCAT" },
  { detail: "Trim whitespace", label: "TRIM" },
  { detail: "Uppercase", label: "UPPER" },
  { detail: "Lowercase", label: "LOWER" },
  { detail: "Substring", label: "SUBSTRING" },
  { detail: "Replace string", label: "REPLACE" },
  { detail: "Round number", label: "ROUND" },
  { detail: "Ceiling", label: "CEIL" },
  { detail: "Floor", label: "FLOOR" },
  { detail: "Absolute value", label: "ABS" },
  // Transaction / misc
  { detail: "Begin transaction", label: "BEGIN" },
  { detail: "Commit transaction", label: "COMMIT" },
  { detail: "Rollback transaction", label: "ROLLBACK" },
  { detail: "Transaction", label: "TRANSACTION" },
  { detail: "Explain plan", label: "EXPLAIN" },
  { detail: "Analyze / explain analyze", label: "ANALYZE" },
  { detail: "Vacuum (PG)", label: "VACUUM" },
  { detail: "CTE / WITH clause", label: "WITH" },
  { detail: "Recursive CTE", label: "RECURSIVE" },
  { detail: "Union", label: "UNION" },
  { detail: "Intersect", label: "INTERSECT" },
  { detail: "Except", label: "EXCEPT" },
  { detail: "Returning (PG)", label: "RETURNING" },
  { detail: "Window function", label: "OVER" },
  { detail: "Window partition", label: "PARTITION" },
  { detail: "Window frame rows", label: "ROWS" },
  { detail: "Window frame range", label: "RANGE" },
  { detail: "Named window", label: "WINDOW" },
  { detail: "Truncate table", label: "TRUNCATE" },
  { detail: "Schema", label: "SCHEMA" },
  { detail: "Database", label: "DATABASE" },
  { detail: "Grant privilege", label: "GRANT" },
  { detail: "Revoke privilege", label: "REVOKE" },
  { detail: "Boolean true", label: "TRUE" },
  { detail: "Boolean false", label: "FALSE" },
];

function makeKeywords(range: monaco.IRange): monaco.languages.CompletionItem[] {
  return SQL_KEYWORDS.map((kw) => ({
    detail: kw.detail,
    insertText: kw.label,
    kind: monaco.languages.CompletionItemKind.Keyword,
    label: kw.label,
    range,
    sortText: `2_${kw.label}`,
  }));
}

// ── SQL Snippets ──────────────────────────────────────────────────────
// Labels use the full keyword (SELECT, INSERT, …) so they appear when the
// user types the keyword name. The snippet prefix is shown in detail.

function makeSnippets(range: monaco.IRange): monaco.languages.CompletionItem[] {
  return [
    {
      detail: "… FROM … WHERE template",
      documentation: "SELECT … FROM … WHERE",
      insertText:
        "SELECT\n  ${1:columns}\nFROM\n  ${2:table_name}\nWHERE\n  ${3:condition};",
      insertTextRules:
        monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      kind: monaco.languages.CompletionItemKind.Snippet,
      label: "SELECT",
      range,
      sortText: "1_SELECT",
    },
    {
      detail: "… FROM … LIMIT template",
      documentation: "SELECT * FROM … LIMIT",
      insertText: "SELECT *\nFROM\n  ${1:table_name}\nLIMIT ${2:100};",
      insertTextRules:
        monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      kind: monaco.languages.CompletionItemKind.Snippet,
      label: "SELECT *",
      range,
      sortText: "1_SELECT *",
    },
    {
      detail: "… INTO … VALUES template",
      documentation: "INSERT INTO … VALUES",
      insertText:
        "INSERT INTO ${1:table_name} (${2:columns})\nVALUES (${3:values});",
      insertTextRules:
        monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      kind: monaco.languages.CompletionItemKind.Snippet,
      label: "INSERT",
      range,
      sortText: "1_INSERT",
    },
    {
      detail: "… SET … WHERE template",
      documentation: "UPDATE … SET … WHERE",
      insertText:
        "UPDATE ${1:table_name}\nSET\n  ${2:column} = ${3:value}\nWHERE ${4:condition};",
      insertTextRules:
        monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      kind: monaco.languages.CompletionItemKind.Snippet,
      label: "UPDATE",
      range,
      sortText: "1_UPDATE",
    },
    {
      detail: "… FROM … WHERE template",
      documentation: "DELETE FROM … WHERE",
      insertText: "DELETE FROM ${1:table_name}\nWHERE ${2:condition};",
      insertTextRules:
        monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      kind: monaco.languages.CompletionItemKind.Snippet,
      label: "DELETE",
      range,
      sortText: "1_DELETE",
    },
    {
      detail: "… (columns) template",
      documentation: "CREATE TABLE …",
      insertText:
        "CREATE TABLE ${1:table_name} (\n  ${2:id} SERIAL PRIMARY KEY,\n  ${3:column_name} ${4:VARCHAR(255)}\n);",
      insertTextRules:
        monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      kind: monaco.languages.CompletionItemKind.Snippet,
      label: "CREATE TABLE",
      range,
      sortText: "1_CREATE TABLE",
    },
    {
      detail: "… ON … = … template",
      documentation: "INNER JOIN … ON",
      insertText:
        "INNER JOIN ${1:table_name} ON ${2:table1.column} = ${3:table2.column}",
      insertTextRules:
        monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      kind: monaco.languages.CompletionItemKind.Snippet,
      label: "INNER JOIN",
      range,
      sortText: "1_INNER JOIN",
    },
    {
      detail: "… ON … = … template",
      documentation: "LEFT JOIN … ON",
      insertText:
        "LEFT JOIN ${1:table_name} ON ${2:table1.column} = ${3:table2.column}",
      insertTextRules:
        monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      kind: monaco.languages.CompletionItemKind.Snippet,
      label: "LEFT JOIN",
      range,
      sortText: "1_LEFT JOIN",
    },
    {
      detail: "… ON … = … template",
      documentation: "RIGHT JOIN … ON",
      insertText:
        "RIGHT JOIN ${1:table_name} ON ${2:table1.column} = ${3:table2.column}",
      insertTextRules:
        monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      kind: monaco.languages.CompletionItemKind.Snippet,
      label: "RIGHT JOIN",
      range,
      sortText: "1_RIGHT JOIN",
    },
    {
      detail: "… HAVING … template",
      documentation: "GROUP BY … HAVING",
      insertText: "GROUP BY ${1:column}\nHAVING ${2:condition}",
      insertTextRules:
        monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      kind: monaco.languages.CompletionItemKind.Snippet,
      label: "GROUP BY",
      range,
      sortText: "1_GROUP BY",
    },
    {
      detail: "… ASC/DESC template",
      documentation: "ORDER BY … ASC/DESC",
      insertText: "ORDER BY ${1:column} ${2|ASC,DESC|}",
      insertTextRules:
        monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      kind: monaco.languages.CompletionItemKind.Snippet,
      label: "ORDER BY",
      range,
      sortText: "1_ORDER BY",
    },
    {
      detail: "… ON … (col) template",
      documentation: "CREATE INDEX … ON",
      insertText:
        "CREATE INDEX ${1:index_name} ON ${2:table_name} (${3:column});",
      insertTextRules:
        monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      kind: monaco.languages.CompletionItemKind.Snippet,
      label: "CREATE INDEX",
      range,
      sortText: "1_CREATE INDEX",
    },
    {
      detail: "… ADD COLUMN … template",
      documentation: "ALTER TABLE … ADD COLUMN",
      insertText:
        "ALTER TABLE ${1:table_name}\nADD COLUMN ${2:column_name} ${3:data_type};",
      insertTextRules:
        monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      kind: monaco.languages.CompletionItemKind.Snippet,
      label: "ALTER TABLE",
      range,
      sortText: "1_ALTER TABLE",
    },
    {
      detail: "CTE: … AS (…) SELECT template",
      documentation: "Common Table Expression (CTE)",
      insertText:
        "WITH ${1:cte_name} AS (\n  ${2:SELECT}\n)\n${3:SELECT * FROM ${1:cte_name}};",
      insertTextRules:
        monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      kind: monaco.languages.CompletionItemKind.Snippet,
      label: "WITH",
      range,
      sortText: "1_WITH",
    },
    {
      detail: "Subquery template",
      documentation: "SELECT FROM (subquery)",
      insertText: "SELECT *\nFROM (\n  ${1:SELECT}\n) AS ${2:subquery}",
      insertTextRules:
        monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      kind: monaco.languages.CompletionItemKind.Snippet,
      label: "SELECT FROM",
      range,
      sortText: "1_SELECT FROM",
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
      provideCompletionItems(model, position) {
        const word = model.getWordUntilPosition(position);
        const range: monaco.IRange = {
          endColumn: word.endColumn,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          startLineNumber: position.lineNumber,
        };

        const lineContent = model.getLineContent(position.lineNumber);
        const textBefore = lineContent.substring(0, position.column - 1);

        const suggestions: monaco.languages.CompletionItem[] = [];

        // ── Column completion after dot ─────────────────────────
        const dotMatch = textBefore.match(/(\b\w+)\.\s*$/);
        if (dotMatch) {
          const ref = dotMatch[1];
          const table = currentSchemaData.tables.find(
            (t) => t.name === ref || `${t.schema}.${t.name}` === ref
          );
          if (table) {
            for (const col of table.columns) {
              suggestions.push({
                detail: col.dataType,
                insertText: col.name,
                kind: monaco.languages.CompletionItemKind.Field,
                label: col.name,
                range,
                sortText: `0_${col.name}`,
              });
            }
            if (suggestions.length > 0) {
              return { suggestions };
            }
          }
        }

        // ── Table names ────────────────────────────────────────
        const seen = new Set<string>();
        for (const table of currentSchemaData.tables) {
          // Unqualified name
          if (!seen.has(table.name)) {
            seen.add(table.name);
            suggestions.push({
              detail: `Table · ${table.schema}`,
              documentation:
                table.columns.length > 0
                  ? `Columns: ${table.columns.map((c) => c.name).join(", ")}`
                  : undefined,
              insertText: table.name,
              kind: monaco.languages.CompletionItemKind.Class,
              label: table.name,
              range,
              sortText: `1_${table.name}`,
            });
          }
          // Qualified name (schema.table) — show when multi-schema or non-default
          const qualified = `${table.schema}.${table.name}`;
          if (!seen.has(qualified)) {
            seen.add(qualified);
            suggestions.push({
              detail: "Table · qualified",
              documentation:
                table.columns.length > 0
                  ? `Columns: ${table.columns.map((c) => c.name).join(", ")}`
                  : undefined,
              insertText: qualified,
              kind: monaco.languages.CompletionItemKind.Class,
              label: qualified,
              range,
              sortText: `2_${qualified}`,
            });
          }
        }

        // ── Schema names ───────────────────────────────────────
        for (const schema of currentSchemaData.schemas) {
          suggestions.push({
            detail: "Schema",
            insertText: schema,
            kind: monaco.languages.CompletionItemKind.Module,
            label: schema,
            range,
            sortText: `3_${schema}`,
          });
        }

        // ── SQL Keywords ────────────────────────────────────────
        suggestions.push(...makeKeywords(range));

        // ── Snippets ───────────────────────────────────────────
        suggestions.push(...makeSnippets(range));

        return { suggestions };
      },
      triggerCharacters: [".", " ", '"'],
    }
  );
}

export function disposeSqlCompletion() {
  if (completionDisposable) {
    completionDisposable.dispose();
    completionDisposable = null;
  }
}

// ── SQL Formatter ─────────────────────────────────────────────────────

type FormatterLanguage = "sql" | "mysql" | "postgresql" | "mariadb" | "sqlite";

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
      keywordCase: "upper",
      language: getFormatterLanguage(dbType),
      logicalOperatorNewline: "before",
      tabWidth: 2,
    });
  } catch {
    return sql; // Return original on parse error
  }
}

// ── EXPLAIN utility ───────────────────────────────────────────────────

export function buildExplainSql(
  sql: string,
  dbType: string,
  analyze = false
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
  return (
    dbType === "postgresql" ||
    dbType === "mysql" ||
    dbType === "mariadb" ||
    dbType === "clickhouse"
  );
}
