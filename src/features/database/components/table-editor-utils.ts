import type { SchemaColumn } from "@/ipc/db/types";

export type ColumnKind =
  | "json"
  | "array"
  | "timestamptz"
  | "timestamp"
  | "date"
  | "time"
  | "bool"
  | "numeric"
  | "integer"
  | "uuid"
  | "bytea"
  | "inet"
  | "cidr"
  | "macaddr"
  | "interval"
  | "enum"
  | "color"
  | "text";

export function classifyColumnKind(
  column: SchemaColumn | undefined
): ColumnKind {
  if (!column) {
    return "text";
  }
  const t = column.data_type.toLowerCase();
  const udt = (column.udt_name ?? "").toLowerCase();

  if (t === "array" || udt.startsWith("_") || t.endsWith("[]")) {
    return "array";
  }
  if (t.includes("json")) {
    return "json";
  }
  if (t.includes("timestamp with time zone") || t === "timestamptz") {
    return "timestamptz";
  }
  if (t.includes("timestamp")) {
    return "timestamp";
  }
  if (t === "date") {
    return "date";
  }
  if (t.startsWith("time ") || t === "time" || t.includes("time with")) {
    return "time";
  }
  if (t === "boolean" || t === "bool") {
    return "bool";
  }
  if (t === "uuid") {
    return "uuid";
  }
  if (t === "bytea") {
    return "bytea";
  }
  if (t === "interval") {
    return "interval";
  }
  if (t === "inet") {
    return "inet";
  }
  if (t === "cidr") {
    return "cidr";
  }
  if (t === "macaddr" || t === "macaddr8") {
    return "macaddr";
  }
  if (t === "user-defined") {
    return "enum";
  }

  if (
    t.includes("int") ||
    t.includes("serial") ||
    t === "smallint" ||
    t === "bigint"
  ) {
    return "integer";
  }
  if (
    t.includes("numeric") ||
    t.includes("decimal") ||
    t.includes("real") ||
    t.includes("double") ||
    t.includes("float")
  ) {
    return "numeric";
  }

  return "text";
}

export const NULL_SENTINEL = "NULL";

export function valueToEditableText(value: unknown, kind: ColumnKind): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (kind === "json" || kind === "array") {
    if (typeof value === "object") {
      try {
        return JSON.stringify(value, null, 2);
      } catch {
        return String(value);
      }
    }
    return String(value);
  }

  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export function initialToUtcIso(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const s = String(value).trim();
  if (!s) {
    return null;
  }
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) {
    return null;
  }
  return new Date(ms).toISOString();
}

export function utcIsoToDatetimeLocal(iso: string | null): string {
  if (!iso) {
    return "";
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return "";
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}`;
}

export function datetimeLocalToUtcIso(local: string): string | null {
  if (!local) {
    return null;
  }
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  return d.toISOString();
}

export function timestampRawToDatetimeLocal(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  const s = String(value).trim();
  if (!s) {
    return "";
  }
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)/);
  if (!m) {
    return "";
  }
  const datePart = m[1];
  const timePart = m[2].length === 5 ? `${m[2]}:00` : m[2];
  return `${datePart}T${timePart}`;
}

export function datetimeLocalToTimestamp(local: string): string | null {
  if (!local) {
    return null;
  }
  const [d, t] = local.split("T");
  if (!(d && t)) {
    return null;
  }
  const time = t.length === 5 ? `${t}:00` : t;
  return `${d} ${time}`;
}

export function initialDate(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  const s = String(value).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : "";
}

export function initialTime(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  const s = String(value).trim();
  const m = s.match(/^(\d{2}:\d{2}(?::\d{2})?)/);
  if (!m) {
    return "";
  }
  return m[1].length === 5 ? `${m[1]}:00` : m[1];
}

export function initialBool(value: unknown): "true" | "false" | "null" {
  if (value === true) {
    return "true";
  }
  if (value === false) {
    return "false";
  }
  if (value === "true" || value === "t" || value === "TRUE") {
    return "true";
  }
  if (value === "false" || value === "f" || value === "FALSE") {
    return "false";
  }
  return "null";
}

export function initialNumeric(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "number") {
    return String(value);
  }
  return String(value).trim();
}

export type ValidationResult = { ok: true } | { ok: false; message: string };

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const IPV4_RE =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
export const IPV6_RE =
  /^([0-9a-f]{1,4}:){1,7}[0-9a-f]{1,4}$|^::1$|^::$|^([0-9a-f]{1,4}:){1,7}:$|^:(:[0-9a-f]{1,4}){1,7}$|^([0-9a-f]{1,4}:){1,6}(:[0-9a-f]{1,4}){1,1}$/i;
export const MACADDR_RE =
  /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$|^([0-9a-f]{2}[:-]){7}[0-9a-f]{2}$/i;
export const INTERVAL_TEXT_RE =
  /^(\s*-?\d+(\.\d+)?\s+(year|years|month|months|week|weeks|day|days|hour|hours|minute|minutes|second|seconds|millisecond|milliseconds|microsecond|microseconds)\s*)+$/i;

export const INT_RANGE: Record<string, { min: bigint; max: bigint }> = {
  bigint: { max: 9223372036854775807n, min: -9223372036854775808n },
  int: { max: 2147483647n, min: -2147483648n },
  int2: { max: 32767n, min: -32768n },
  int4: { max: 2147483647n, min: -2147483648n },
  int8: { max: 9223372036854775807n, min: -9223372036854775808n },
  integer: { max: 2147483647n, min: -2147483648n },
  smallint: { max: 32767n, min: -32768n },
};

export function intRangeFor(
  column: SchemaColumn | undefined
): { min: bigint; max: bigint } | null {
  if (!column) {
    return null;
  }
  const t = column.data_type.toLowerCase();
  for (const [key, range] of Object.entries(INT_RANGE)) {
    if (t === key || t.indexOf(key) !== -1) {
      return range;
    }
  }
  return null;
}

export function isValidIp(raw: string, allowCidr: boolean): boolean {
  const [address, prefix] = raw.split("/");
  if (prefix !== undefined) {
    if (!allowCidr) {
      return false;
    }
    if (!/^\d+$/.test(prefix)) {
      return false;
    }
    const p = Number(prefix);
    if (Number.isNaN(p)) {
      return false;
    }
    if (IPV4_RE.test(address)) {
      return p >= 0 && p <= 32;
    }
    if (IPV6_RE.test(address)) {
      return p >= 0 && p <= 128;
    }
    return false;
  }
  return IPV4_RE.test(address) || IPV6_RE.test(address);
}

export function isValidPgArrayLiteral(raw: string): boolean {
  const s = raw.trim();
  if (!(s.startsWith("{") && s.endsWith("}"))) {
    return false;
  }

  let depth = 0;
  let inQuotes = false;
  let escaped = false;
  for (const ch of s) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (inQuotes) {
      continue;
    }
    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
    }
    if (depth < 0) {
      return false;
    }
  }
  return depth === 0 && !inQuotes;
}

export function validateDraft(
  draft: string,
  kind: ColumnKind,
  column: SchemaColumn | undefined
): ValidationResult {
  const raw = draft;
  const trimmed = draft.trim();

  switch (kind) {
    case "uuid":
      if (!trimmed) {
        return { message: "UUID required", ok: false };
      }
      if (!UUID_RE.test(trimmed)) {
        return { message: "Invalid UUID (expected 8-4-4-4-12 hex)", ok: false };
      }
      return { ok: true };
    case "bytea": {
      if (!trimmed) {
        return { ok: true };
      }
      const hexMatch = trimmed.match(/^\\?\\x([0-9a-f]*)$/i);
      if (!hexMatch) {
        return {
          message: "Bytea must start with \\x followed by hex digits",
          ok: false,
        };
      }
      const hex = hexMatch[1];
      if (hex.length % 2 !== 0) {
        return {
          message: "Hex payload must have an even number of digits",
          ok: false,
        };
      }
      return { ok: true };
    }
    case "json":
      if (!trimmed) {
        return { message: "JSON required", ok: false };
      }
      try {
        JSON.parse(raw);
        return { ok: true };
      } catch (err) {
        const detail = err instanceof Error ? err.message : "invalid JSON";
        return { message: `Invalid JSON: ${detail}`, ok: false };
      }
    case "array":
      if (!trimmed) {
        return { message: "Array required", ok: false };
      }
      if (trimmed.startsWith("[")) {
        try {
          const parsed = JSON.parse(raw);
          if (!Array.isArray(parsed)) {
            return { message: "JSON must be an array", ok: false };
          }
          return { ok: true };
        } catch (err) {
          const detail = err instanceof Error ? err.message : "invalid JSON";
          return { message: `Invalid JSON array: ${detail}`, ok: false };
        }
      }
      if (trimmed.startsWith("{")) {
        if (!isValidPgArrayLiteral(trimmed)) {
          return { message: "Invalid Postgres array literal", ok: false };
        }
        return { ok: true };
      }
      return {
        message: "Array must start with `[` (JSON) or `{` (Postgres literal)",
        ok: false,
      };
    case "integer": {
      if (!trimmed) {
        return { message: "Integer required", ok: false };
      }
      if (!/^-?\d+$/.test(trimmed)) {
        return { message: "Must be an integer (no decimals)", ok: false };
      }
      const range = intRangeFor(column);
      if (range) {
        try {
          const n = BigInt(trimmed);
          if (n < range.min || n > range.max) {
            return {
              message: `Out of range for ${column?.data_type ?? "integer"} (${range.min}..${range.max})`,
              ok: false,
            };
          }
        } catch {
          return { message: "Invalid integer literal", ok: false };
        }
      }
      return { ok: true };
    }
    case "numeric":
      if (!trimmed) {
        return { message: "Number required", ok: false };
      }
      if (!/^-?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/.test(trimmed)) {
        return { message: "Not a valid number", ok: false };
      }
      return { ok: true };
    case "bool":
      if (trimmed === "true" || trimmed === "false") {
        return { ok: true };
      }
      return { message: "Pick TRUE or FALSE", ok: false };
    case "timestamptz": {
      if (!trimmed) {
        return { message: "Timestamp required", ok: false };
      }
      const ms = Date.parse(trimmed);
      if (Number.isNaN(ms)) {
        return { message: "Invalid timestamp", ok: false };
      }
      return { ok: true };
    }
    case "timestamp":
      if (!trimmed) {
        return { message: "Timestamp required", ok: false };
      }
      if (
        !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(trimmed)
      ) {
        return { message: "Expected YYYY-MM-DD HH:MM:SS", ok: false };
      }
      return { ok: true };
    case "date": {
      if (!trimmed) {
        return { message: "Date required", ok: false };
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        return { message: "Expected YYYY-MM-DD", ok: false };
      }
      const ms = Date.parse(`${trimmed}T00:00:00Z`);
      if (Number.isNaN(ms)) {
        return { message: "Invalid date", ok: false };
      }
      return { ok: true };
    }
    case "time": {
      if (!trimmed) {
        return { message: "Time required", ok: false };
      }
      if (!/^\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(trimmed)) {
        return { message: "Expected HH:MM[:SS]", ok: false };
      }
      const [h, m, s] = trimmed.split(":").map((v) => Number(v));
      if (h > 23 || m > 59 || (s !== undefined && s >= 60)) {
        return { message: "Time components out of range", ok: false };
      }
      return { ok: true };
    }
    case "inet":
      if (!trimmed) {
        return { message: "IP address required", ok: false };
      }
      if (!isValidIp(trimmed, true)) {
        return {
          message: "Expected IPv4/IPv6 with optional /prefix",
          ok: false,
        };
      }
      return { ok: true };
    case "cidr":
      if (!trimmed) {
        return { message: "CIDR required", ok: false };
      }
      if (!trimmed.includes("/")) {
        return { message: "CIDR requires a /prefix", ok: false };
      }
      if (!isValidIp(trimmed, true)) {
        return {
          message: "Expected network/prefix (e.g. 10.0.0.0/8)",
          ok: false,
        };
      }
      return { ok: true };
    case "macaddr":
      if (!trimmed) {
        return { message: "MAC address required", ok: false };
      }
      if (!MACADDR_RE.test(trimmed)) {
        return { message: "Expected AA:BB:CC:DD:EE:FF", ok: false };
      }
      return { ok: true };
    case "interval":
      if (!trimmed) {
        return { message: "Interval required", ok: false };
      }
      if (
        /^P(?!$)(\d+Y)?(\d+M)?(\d+W)?(\d+D)?(T(\d+H)?(\d+M)?(\d+(\.\d+)?S)?)?$/i.test(
          trimmed
        )
      ) {
        return { ok: true };
      }
      if (INTERVAL_TEXT_RE.test(trimmed)) {
        return { ok: true };
      }
      return { message: "Expected `1 day 2 hours`, `P1DT2H`, etc.", ok: false };
    case "enum":
      if (!trimmed) {
        return { message: "Enum value required", ok: false };
      }
      return { ok: true };
    default:
      return { ok: true };
  }
}
