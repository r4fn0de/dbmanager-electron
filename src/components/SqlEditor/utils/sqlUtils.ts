import type { QueryResult } from "@/ipc/db/types";

const MAX_HISTORY_PREVIEW = 140;
const MAX_HISTORY_RESULT_ROWS = 50;
const MAX_HISTORY_RESULT_COLUMNS = 30;
const DANGEROUS_SQL_KEYWORDS = ["DELETE", "UPDATE", "DROP", "RENAME", "TRUNCATE", "ALTER"] as const;

export function previewSql(sql: string): string {
  const normalized = sql.replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_HISTORY_PREVIEW) return normalized;
  return `${normalized.slice(0, MAX_HISTORY_PREVIEW)}...`;
}

export function hasDangerousSqlKeywords(sql: string): boolean {
  const uncommentedLines = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  const dangerousKeywordsPattern = DANGEROUS_SQL_KEYWORDS
    .map((keyword) => `\\b${keyword}\\b`)
    .join("|");
  return new RegExp(dangerousKeywordsPattern, "gi").test(uncommentedLines);
}

export function truncateForContext(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n...[truncated]`;
}

export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;
  let dollarTag: string | null = null;

  const pushCurrent = () => {
    const trimmed = current.trim();
    if (trimmed) statements.push(trimmed);
    current = "";
  };

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = i + 1 < sql.length ? sql[i + 1] : "";

    if (inLineComment) {
      current += ch;
      if (ch === "\n") inLineComment = false;
      continue;
    }

    if (inBlockComment) {
      current += ch;
      if (ch === "*" && next === "/") {
        current += next;
        i++;
        inBlockComment = false;
      }
      continue;
    }

    if (dollarTag) {
      if (sql.startsWith(dollarTag, i)) {
        current += dollarTag;
        i += dollarTag.length - 1;
        dollarTag = null;
      } else {
        current += ch;
      }
      continue;
    }

    if (inSingleQuote) {
      current += ch;
      if (ch === "'" && next === "'") {
        current += next;
        i++;
      } else if (ch === "'") {
        inSingleQuote = false;
      }
      continue;
    }

    if (inDoubleQuote) {
      current += ch;
      if (ch === '"' && next === '"') {
        current += next;
        i++;
      } else if (ch === '"') {
        inDoubleQuote = false;
      }
      continue;
    }

    if (inBacktick) {
      current += ch;
      if (ch === "`") inBacktick = false;
      continue;
    }

    if (ch === "-" && next === "-") {
      current += ch + next;
      i++;
      inLineComment = true;
      continue;
    }

    if (ch === "/" && next === "*") {
      current += ch + next;
      i++;
      inBlockComment = true;
      continue;
    }

    if (ch === "$") {
      const match = sql.slice(i).match(/^\$[a-z_]\w*\$|^\$\$/i);
      if (match) {
        const tag = match[0];
        current += tag;
        i += tag.length - 1;
        dollarTag = tag;
        continue;
      }
    }

    if (ch === "'") {
      current += ch;
      inSingleQuote = true;
      continue;
    }

    if (ch === '"') {
      current += ch;
      inDoubleQuote = true;
      continue;
    }

    if (ch === "`") {
      current += ch;
      inBacktick = true;
      continue;
    }

    if (ch === ";") {
      pushCurrent();
      continue;
    }

    current += ch;
  }

  pushCurrent();
  return statements;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function toHistoryResultPreview(result: QueryResult): {
  columns: { name: string; type_name: string }[];
  rows: unknown[][];
  row_count: number;
} {
  const columns = result.columns.slice(0, MAX_HISTORY_RESULT_COLUMNS);
  const rows = result.rows
    .slice(0, MAX_HISTORY_RESULT_ROWS)
    .map((row) => row.slice(0, MAX_HISTORY_RESULT_COLUMNS));

  return {
    columns,
    rows,
    row_count: result.row_count,
  };
}
