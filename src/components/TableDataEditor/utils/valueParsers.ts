import type { SchemaColumn } from "@/ipc/db/types";

export function normalizeDisplay(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function getCellTitle(value: unknown): string | undefined {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

export function compareSortValues(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;

  if (typeof a === "number" && typeof b === "number") {
    return a - b;
  }

  if (typeof a === "boolean" && typeof b === "boolean") {
    return Number(a) - Number(b);
  }

  const aStr = normalizeDisplay(a);
  const bStr = normalizeDisplay(b);
  return aStr.localeCompare(bStr, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function parseByType(raw: string, column: SchemaColumn): unknown {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.toUpperCase() === "NULL") return null;

  const dataType = column.data_type.toLowerCase();

  if (/(^|[^a-z])bool/.test(dataType)) {
    if (trimmed.toLowerCase() === "true") return true;
    if (trimmed.toLowerCase() === "false") return false;
  }

  if (/(^|[^a-z])(int|serial|smallint|bigint)/.test(dataType)) {
    if (/^-?\d+$/.test(trimmed)) {
      const n = Number(trimmed);
      if (Number.isSafeInteger(n)) return n;
      return trimmed;
    }
  }

  if (/(double|real|float)/.test(dataType)) {
    const asNumber = Number(trimmed);
    if (Number.isFinite(asNumber)) return asNumber;
  }

  if (/(numeric|decimal)/.test(dataType)) {
    return trimmed;
  }

  // Arrays PG (ex.: int[], text[]). Aceita ambas formas:
  //   - JSON `[1,2,3]`        -> parse como JSON, backend emite literal PG array.
  //   - Literal PG `{1,2,3}`  -> enviado como string; backend faz cast ao tipo do elemento.
  const udt = (column as { udt_name?: string }).udt_name?.toLowerCase() ?? "";
  const isArrayColumn =
    dataType === "array" || udt.startsWith("_") || dataType.endsWith("[]");
  if (isArrayColumn) {
    if (trimmed.startsWith("[")) {
      try {
        return JSON.parse(raw);
      } catch {
        // JSON malformado cai no fallback string abaixo.
      }
    }
    if (trimmed.startsWith("{")) {
      // Literal PG. Mantém como string — backend trata ao montar o SQL.
      return trimmed;
    }
  }

  if (dataType.includes("json")) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const asDate = new Date(trimmed);
    if (!Number.isNaN(asDate.getTime())) {
      return asDate;
    }
  }

  // Demais tipos (text, uuid, timestamp/timestamptz, date, time, bytea, inet, …)
  // são enviados como string. O backend usa `typed_value_literal` e o Postgres
  // faz o cast implícito para o tipo da coluna.
  return raw;
}
