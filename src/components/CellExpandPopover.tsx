import Editor from "@monaco-editor/react";
import { AlertCircle, Check, Dices, Minus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import "@/lib/monaco-loader";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { SchemaColumn } from "@/ipc/db/types";

interface CellExpandPopoverProps {
  /** Trigger element (normalmente um botão pequeno no canto da célula). */
  trigger: React.ReactNode;
  /** Nome da coluna sendo editada — usado no header do popover. */
  columnName: string;
  /** Definição da coluna — usada para detectar o tipo e montar o editor adequado. */
  column: SchemaColumn | undefined;
  /** Valor atual (cru, como veio do backend). */
  initialValue: unknown;
  /** Chamado ao confirmar. Emite texto cru (ou a string literal "NULL"). */
  onSave: (rawText: string) => void;
  /** Desabilita edição (ex.: sem primary key). O popover ainda abre em read-only. */
  readOnly?: boolean;
}

// --------------------------------------------------------------------------------------
// Classificação de tipos
// --------------------------------------------------------------------------------------

type ColumnKind =
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
  | "text";

/** Classifica um `data_type` Postgres em um editor adequado. */
function classifyColumnKind(column: SchemaColumn | undefined): ColumnKind {
  if (!column) return "text";
  const t = column.data_type.toLowerCase();
  const udt = (column.udt_name ?? "").toLowerCase();

  // Arrays PG reais. `data_type` reporta "ARRAY"; `udt_name` tem prefixo `_`.
  if (t === "array" || udt.startsWith("_") || t.endsWith("[]")) return "array";

  if (t.includes("json")) return "json";

  // Ordem importa: checar timestamptz antes de timestamp.
  if (t.includes("timestamp with time zone") || t === "timestamptz") {
    return "timestamptz";
  }
  if (t.includes("timestamp")) return "timestamp";
  if (t === "date") return "date";
  if (t.startsWith("time ") || t === "time" || t.includes("time with")) {
    return "time";
  }

  if (t === "boolean" || t === "bool") return "bool";
  if (t === "uuid") return "uuid";
  if (t === "bytea") return "bytea";

  if (t === "interval") return "interval";
  if (t === "inet") return "inet";
  if (t === "cidr") return "cidr";
  if (t === "macaddr" || t === "macaddr8") return "macaddr";

  // Enums aparecem como `USER-DEFINED` com o nome real em `udt_name`.
  if (t === "user-defined") return "enum";

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

// --------------------------------------------------------------------------------------
// Helpers de valor <-> texto
// --------------------------------------------------------------------------------------

const NULL_SENTINEL = "NULL";

function valueToEditableText(value: unknown, kind: ColumnKind): string {
  if (value === null || value === undefined) return "";

  if (kind === "json" || kind === "array") {
    if (typeof value === "object") {
      try {
        return JSON.stringify(value, null, 2);
      } catch {
        return String(value);
      }
    }
    // String que já parece JSON — mantém.
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

/** Converte valor inicial em ISO-8601 (com `Z`) para timestamptz. */
function initialToUtcIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

/** ISO UTC -> string compatível com `<input type=datetime-local step=1>` em hora LOCAL. */
function utcIsoToDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}`;
}

/** datetime-local (hora local) -> ISO UTC (`Z`). */
function datetimeLocalToUtcIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** Timestamp sem TZ: extrai "YYYY-MM-DDTHH:MM:SS" cru (sem conversão). */
function timestampRawToDatetimeLocal(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value).trim();
  if (!s) return "";
  // Backend envia "YYYY-MM-DD HH:MM:SS[.fff]" para `NaiveDateTime`.
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)/);
  if (!m) return "";
  const datePart = m[1];
  const timePart = m[2].length === 5 ? `${m[2]}:00` : m[2];
  return `${datePart}T${timePart}`;
}

/** Volta um valor input type=datetime-local -> "YYYY-MM-DD HH:MM:SS" para `timestamp`. */
function datetimeLocalToTimestamp(local: string): string | null {
  if (!local) return null;
  const [d, t] = local.split("T");
  if (!d || !t) return null;
  const time = t.length === 5 ? `${t}:00` : t;
  return `${d} ${time}`;
}

function initialDate(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : "";
}

function initialTime(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value).trim();
  const m = s.match(/^(\d{2}:\d{2}(?::\d{2})?)/);
  if (!m) return "";
  return m[1].length === 5 ? `${m[1]}:00` : m[1];
}

function initialBool(value: unknown): "true" | "false" | "null" {
  if (value === true) return "true";
  if (value === false) return "false";
  if (value === "true" || value === "t" || value === "TRUE") return "true";
  if (value === "false" || value === "f" || value === "FALSE") return "false";
  return "null";
}

function initialNumeric(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  return String(value).trim();
}

// --------------------------------------------------------------------------------------
// Validação client-side
// --------------------------------------------------------------------------------------

type ValidationResult = { ok: true } | { ok: false; message: string };

/** Regex UUID canônico (8-4-4-4-12 hex, com hífens). */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * IPv4 / IPv6 sem prefixo. Aceita ambos formatos comuns.
 * Não é exaustivo (ex.: não valida todas as formas canônicas IPv6),
 * mas captura erros óbvios de digitação.
 */
const IPV4_RE =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const IPV6_RE =
  /^([0-9a-f]{1,4}:){1,7}[0-9a-f]{1,4}$|^::1$|^::$|^([0-9a-f]{1,4}:){1,7}:$|^:(:[0-9a-f]{1,4}){1,7}$|^([0-9a-f]{1,4}:){1,6}(:[0-9a-f]{1,4}){1,1}$/i;

/** MAC Address clássico ou macaddr8 (6 ou 8 octetos, com `:` ou `-`). */
const MACADDR_RE =
  /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$|^([0-9a-f]{2}[:-]){7}[0-9a-f]{2}$/i;

/** Interval Postgres no formato ISO-8601 (`P1Y2M...`) ou textual (`1 day 2 hours`). */
const INTERVAL_TEXT_RE =
  /^(\s*-?\d+(\.\d+)?\s+(year|years|month|months|week|weeks|day|days|hour|hours|minute|minutes|second|seconds|millisecond|milliseconds|microsecond|microseconds)\s*)+$/i;

/** Range seguro para tipos inteiros Postgres (usado como teto client-side). */
const INT_RANGE: Record<string, { min: bigint; max: bigint }> = {
  smallint: { min: -32768n, max: 32767n },
  int2: { min: -32768n, max: 32767n },
  integer: { min: -2147483648n, max: 2147483647n },
  int: { min: -2147483648n, max: 2147483647n },
  int4: { min: -2147483648n, max: 2147483647n },
  bigint: { min: -9223372036854775808n, max: 9223372036854775807n },
  int8: { min: -9223372036854775808n, max: 9223372036854775807n },
};

function intRangeFor(
  column: SchemaColumn | undefined,
): { min: bigint; max: bigint } | null {
  if (!column) return null;
  const t = column.data_type.toLowerCase();
  for (const [key, range] of Object.entries(INT_RANGE)) {
    if (t === key || t.includes(key)) return range;
  }
  return null;
}

/** Aceita endereços IP com CIDR opcional (`/N`). */
function isValidIp(raw: string, allowCidr: boolean): boolean {
  const [address, prefix] = raw.split("/");
  if (prefix !== undefined) {
    if (!allowCidr) return false;
    if (!/^\d+$/.test(prefix)) return false;
    const p = Number(prefix);
    if (Number.isNaN(p)) return false;
    // IPv4: 0..32, IPv6: 0..128. Checamos com base no formato do address.
    if (IPV4_RE.test(address)) return p >= 0 && p <= 32;
    if (IPV6_RE.test(address)) return p >= 0 && p <= 128;
    return false;
  }
  return IPV4_RE.test(address) || IPV6_RE.test(address);
}

/**
 * Validação superficial de literal array PG `{...}`. Aceita:
 *   {1,2,3}          -> numbers
 *   {"a","b,c"}      -> strings (com vírgula escapada entre aspas)
 *   {NULL,1}         -> NULL elements
 *   {{1,2},{3,4}}    -> aninhado
 *
 * Não resolve semântica — só confere balanceamento de chaves + aspas.
 */
function isValidPgArrayLiteral(raw: string): boolean {
  const s = raw.trim();
  if (!s.startsWith("{") || !s.endsWith("}")) return false;

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
    if (inQuotes) continue;
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0 && !inQuotes;
}

/** Valida o `draft` conforme o `kind`. Retorna a primeira falha encontrada. */
function validateDraft(
  draft: string,
  kind: ColumnKind,
  column: SchemaColumn | undefined,
): ValidationResult {
  const raw = draft;
  const trimmed = draft.trim();

  switch (kind) {
    case "uuid": {
      if (!trimmed) return { ok: false, message: "UUID required" };
      if (!UUID_RE.test(trimmed)) {
        return {
          ok: false,
          message: "Invalid UUID (expected 8-4-4-4-12 hex)",
        };
      }
      return { ok: true };
    }

    case "bytea": {
      if (!trimmed) return { ok: true };
      // Aceita "\x" ou "\\x" como prefixo (copiar do psql pode vir com uma ou outra barra)
      // seguido de número par de dígitos hex.
      const hexMatch = trimmed.match(/^\\?\\x([0-9a-f]*)$/i);
      if (!hexMatch) {
        return {
          ok: false,
          message: "Bytea must start with \\x followed by hex digits",
        };
      }
      const hex = hexMatch[1];
      if (hex.length % 2 !== 0) {
        return {
          ok: false,
          message: "Hex payload must have an even number of digits",
        };
      }
      return { ok: true };
    }

    case "json": {
      if (!trimmed) return { ok: false, message: "JSON required" };
      try {
        JSON.parse(raw);
        return { ok: true };
      } catch (err) {
        const detail = err instanceof Error ? err.message : "invalid JSON";
        return { ok: false, message: `Invalid JSON: ${detail}` };
      }
    }

    case "array": {
      if (!trimmed) return { ok: false, message: "Array required" };
      // Aceita ambas as formas: JSON `[...]` ou literal PG `{...}`.
      if (trimmed.startsWith("[")) {
        try {
          const parsed = JSON.parse(raw);
          if (!Array.isArray(parsed)) {
            return { ok: false, message: "JSON must be an array" };
          }
          return { ok: true };
        } catch (err) {
          const detail = err instanceof Error ? err.message : "invalid JSON";
          return { ok: false, message: `Invalid JSON array: ${detail}` };
        }
      }
      if (trimmed.startsWith("{")) {
        if (!isValidPgArrayLiteral(trimmed)) {
          return {
            ok: false,
            message: "Invalid Postgres array literal",
          };
        }
        return { ok: true };
      }
      return {
        ok: false,
        message: "Array must start with `[` (JSON) or `{` (Postgres literal)",
      };
    }

    case "integer": {
      if (!trimmed) return { ok: false, message: "Integer required" };
      if (!/^-?\d+$/.test(trimmed)) {
        return { ok: false, message: "Must be an integer (no decimals)" };
      }
      const range = intRangeFor(column);
      if (range) {
        try {
          const n = BigInt(trimmed);
          if (n < range.min || n > range.max) {
            return {
              ok: false,
              message: `Out of range for ${column?.data_type ?? "integer"} (${range.min}..${range.max})`,
            };
          }
        } catch {
          return { ok: false, message: "Invalid integer literal" };
        }
      }
      return { ok: true };
    }

    case "numeric": {
      if (!trimmed) return { ok: false, message: "Number required" };
      if (!/^-?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/.test(trimmed)) {
        return { ok: false, message: "Not a valid number" };
      }
      return { ok: true };
    }

    case "bool": {
      if (trimmed === "true" || trimmed === "false") return { ok: true };
      return { ok: false, message: "Pick TRUE or FALSE" };
    }

    case "timestamptz": {
      if (!trimmed) return { ok: false, message: "Timestamp required" };
      const ms = Date.parse(trimmed);
      if (Number.isNaN(ms)) return { ok: false, message: "Invalid timestamp" };
      return { ok: true };
    }

    case "timestamp": {
      if (!trimmed) return { ok: false, message: "Timestamp required" };
      if (
        !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(trimmed)
      ) {
        return { ok: false, message: "Expected YYYY-MM-DD HH:MM:SS" };
      }
      return { ok: true };
    }

    case "date": {
      if (!trimmed) return { ok: false, message: "Date required" };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        return { ok: false, message: "Expected YYYY-MM-DD" };
      }
      const ms = Date.parse(`${trimmed}T00:00:00Z`);
      if (Number.isNaN(ms)) return { ok: false, message: "Invalid date" };
      return { ok: true };
    }

    case "time": {
      if (!trimmed) return { ok: false, message: "Time required" };
      if (!/^\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(trimmed)) {
        return { ok: false, message: "Expected HH:MM[:SS]" };
      }
      const [h, m, s] = trimmed.split(":").map((v) => Number(v));
      if (h > 23 || m > 59 || (s !== undefined && s >= 60)) {
        return { ok: false, message: "Time components out of range" };
      }
      return { ok: true };
    }

    case "inet": {
      if (!trimmed) return { ok: false, message: "IP address required" };
      if (!isValidIp(trimmed, true)) {
        return {
          ok: false,
          message: "Expected IPv4/IPv6 with optional /prefix",
        };
      }
      return { ok: true };
    }

    case "cidr": {
      if (!trimmed) return { ok: false, message: "CIDR required" };
      if (!trimmed.includes("/")) {
        return { ok: false, message: "CIDR requires a /prefix" };
      }
      if (!isValidIp(trimmed, true)) {
        return {
          ok: false,
          message: "Expected network/prefix (e.g. 10.0.0.0/8)",
        };
      }
      return { ok: true };
    }

    case "macaddr": {
      if (!trimmed) return { ok: false, message: "MAC address required" };
      if (!MACADDR_RE.test(trimmed)) {
        return {
          ok: false,
          message: "Expected AA:BB:CC:DD:EE:FF",
        };
      }
      return { ok: true };
    }

    case "interval": {
      if (!trimmed) return { ok: false, message: "Interval required" };
      // Aceita ISO 8601 `P...` OU formato textual Postgres (`1 day 2 hours`, `-1 week`).
      if (
        /^P(?!$)(\d+Y)?(\d+M)?(\d+W)?(\d+D)?(T(\d+H)?(\d+M)?(\d+(\.\d+)?S)?)?$/i.test(
          trimmed,
        )
      ) {
        return { ok: true };
      }
      if (INTERVAL_TEXT_RE.test(trimmed)) return { ok: true };
      return {
        ok: false,
        message: "Expected `1 day 2 hours`, `P1DT2H`, etc.",
      };
    }

    case "enum": {
      // Não temos a lista de valores aqui (custaria uma query adicional).
      // Valida só que não está vazio — backend rejeita valores fora do enum.
      if (!trimmed) return { ok: false, message: "Enum value required" };
      return { ok: true };
    }

    case "text":
    default:
      return { ok: true };
  }
}

// --------------------------------------------------------------------------------------
// Componente
// --------------------------------------------------------------------------------------

export function CellExpandPopover({
  trigger,
  columnName,
  column,
  initialValue,
  onSave,
  readOnly = false,
}: CellExpandPopoverProps) {
  const kind = useMemo(() => classifyColumnKind(column), [column]);
  const nullable = column?.is_nullable ?? true;
  const isNullNow = initialValue === null || initialValue === undefined;

  const [open, setOpen] = useState(false);

  // `draft` guarda a representação textual que será devolvida ao grid.
  // Para a maioria dos tipos é exatamente o que o usuário vê;
  // para timestamptz, por exemplo, é sempre a string ISO UTC ("…Z").
  const initialDraft = useMemo(() => {
    if (isNullNow) return "";
    if (kind === "timestamptz") {
      return initialToUtcIso(initialValue) ?? "";
    }
    return valueToEditableText(initialValue, kind);
  }, [initialValue, kind, isNullNow]);

  const [draft, setDraft] = useState<string>(initialDraft);
  /** `true` quando o usuário explicitamente marcou "Set NULL". */
  const [isNullDraft, setIsNullDraft] = useState<boolean>(isNullNow);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Re-sincroniza o draft ao abrir.
  useEffect(() => {
    if (open) {
      setDraft(initialDraft);
      setIsNullDraft(isNullNow);
    }
  }, [open, initialDraft, isNullNow]);

  // Autofocus apenas no textarea.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  // --------------------------------------------------------------------------
  // Save / Cancel
  // --------------------------------------------------------------------------

  const hasChanges = useMemo(() => {
    if (isNullDraft !== isNullNow) return true;
    if (isNullDraft && isNullNow) return false;
    return draft !== initialDraft;
  }, [draft, initialDraft, isNullDraft, isNullNow]);

  // Valida o draft conforme o tipo (pulamos quando for NULL, que já é válido).
  const validation: ValidationResult = useMemo(() => {
    if (isNullDraft) return { ok: true };
    return validateDraft(draft, kind, column);
  }, [draft, kind, column, isNullDraft]);

  const canSave = !readOnly && hasChanges && validation.ok;

  const commit = () => {
    if (!canSave) {
      setOpen(false);
      return;
    }
    const finalText = isNullDraft ? NULL_SENTINEL : draft;
    onSave(finalText);
    setOpen(false);
  };

  const cancel = () => {
    setDraft(initialDraft);
    setIsNullDraft(isNullNow);
    setOpen(false);
  };

  const setToNull = () => {
    if (!nullable || readOnly) return;
    setIsNullDraft(true);
    setDraft("");
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      commit();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
  };

  // Quando o usuário edita o draft, qualquer tipo: sair do modo NULL.
  const updateDraft = (next: string) => {
    setIsNullDraft(false);
    setDraft(next);
  };

  // --------------------------------------------------------------------------
  // Body: escolhe o editor baseado no `kind`
  // --------------------------------------------------------------------------

  const body = (() => {
    if (isNullDraft) {
      return (
        <div className="flex h-[260px] items-center justify-center rounded-md border border-dashed bg-muted/30 text-xs italic text-muted-foreground">
          NULL
        </div>
      );
    }

    switch (kind) {
      case "json":
        return (
          <div className="overflow-hidden rounded-md border">
            <Editor
              height="260px"
              defaultLanguage="json"
              value={draft}
              onChange={(value) => updateDraft(value ?? "")}
              onMount={(editor) => {
                editor.onKeyDown((event) => {
                  const isCmdEnter =
                    (event.metaKey || event.ctrlKey) && event.keyCode === 3;
                  const isEsc = event.keyCode === 9;
                  if (isCmdEnter) {
                    event.preventDefault();
                    event.stopPropagation();
                    commit();
                  } else if (isEsc) {
                    event.preventDefault();
                    event.stopPropagation();
                    cancel();
                  }
                });
              }}
              options={{
                readOnly,
                minimap: { enabled: false },
                lineNumbers: "on",
                scrollBeyondLastLine: false,
                fontSize: 12,
                tabSize: 2,
                wordWrap: "on",
                automaticLayout: true,
              }}
            />
          </div>
        );

      case "array":
        return (
          <div className="flex flex-col gap-1">
            <div className="overflow-hidden rounded-md border">
              <Editor
                height="240px"
                // `plaintext` porque o valor pode ser literal PG `{1,2,3}`,
                // que não é JSON válido — syntax highlighting de JSON ficaria vermelho.
                defaultLanguage="plaintext"
                value={draft}
                onChange={(value) => updateDraft(value ?? "")}
                onMount={(editor) => {
                  editor.onKeyDown((event) => {
                    const isCmdEnter =
                      (event.metaKey || event.ctrlKey) && event.keyCode === 3;
                    const isEsc = event.keyCode === 9;
                    if (isCmdEnter) {
                      event.preventDefault();
                      event.stopPropagation();
                      commit();
                    } else if (isEsc) {
                      event.preventDefault();
                      event.stopPropagation();
                      cancel();
                    }
                  });
                }}
                options={{
                  readOnly,
                  minimap: { enabled: false },
                  lineNumbers: "on",
                  scrollBeyondLastLine: false,
                  fontSize: 12,
                  tabSize: 2,
                  wordWrap: "on",
                  automaticLayout: true,
                }}
              />
            </div>
            <p className="font-mono text-[10px] text-muted-foreground">
              JSON <code>[1,2,3]</code> or Postgres literal{" "}
              <code>{"{1,2,3}"}</code>
              {column?.udt_name && (
                <>
                  {" · element type: "}
                  <code>{column.udt_name.replace(/^_/, "")}</code>
                </>
              )}
            </p>
          </div>
        );

      case "timestamptz": {
        const localValue = utcIsoToDatetimeLocal(draft || null);
        return (
          <div className="flex flex-col gap-2">
            <input
              type="datetime-local"
              step={1}
              value={localValue}
              onChange={(event) => {
                const iso = datetimeLocalToUtcIso(event.target.value);
                updateDraft(iso ?? "");
              }}
              onKeyDown={handleKeyDown}
              readOnly={readOnly}
              className="w-full rounded-md border bg-background px-2 py-1.5 font-mono text-xs outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40"
            />
            <p className="font-mono text-[10px] text-muted-foreground">
              UTC: {draft || "—"}
            </p>
          </div>
        );
      }

      case "timestamp": {
        const localValue = timestampRawToDatetimeLocal(draft);
        return (
          <input
            type="datetime-local"
            step={1}
            value={localValue}
            onChange={(event) => {
              const ts = datetimeLocalToTimestamp(event.target.value);
              updateDraft(ts ?? "");
            }}
            onKeyDown={handleKeyDown}
            readOnly={readOnly}
            className="w-full rounded-md border bg-background px-2 py-1.5 font-mono text-xs outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40"
          />
        );
      }

      case "date":
        return (
          <input
            type="date"
            value={initialDate(draft)}
            onChange={(event) => updateDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            readOnly={readOnly}
            className="w-full rounded-md border bg-background px-2 py-1.5 font-mono text-xs outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40"
          />
        );

      case "time":
        return (
          <input
            type="time"
            step={1}
            value={initialTime(draft)}
            onChange={(event) => updateDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            readOnly={readOnly}
            className="w-full rounded-md border bg-background px-2 py-1.5 font-mono text-xs outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40"
          />
        );

      case "bool": {
        const current = isNullDraft ? "null" : initialBool(draft);
        const options: Array<{ label: string; value: "true" | "false" }> = [
          { label: "TRUE", value: "true" },
          { label: "FALSE", value: "false" },
        ];
        return (
          <div
            role="radiogroup"
            aria-label={columnName}
            className="flex gap-2"
            onKeyDown={handleKeyDown}
          >
            {options.map((option) => {
              const selected = current === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={readOnly}
                  onClick={() => updateDraft(option.value)}
                  className={`flex-1 rounded-md border px-3 py-2 font-mono text-xs transition-colors ${
                    selected
                      ? "border-primary bg-primary/10 text-primary"
                      : "bg-background text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        );
      }

      case "integer":
      case "numeric":
        return (
          <input
            type="number"
            inputMode={kind === "integer" ? "numeric" : "decimal"}
            step={kind === "integer" ? 1 : "any"}
            value={initialNumeric(draft)}
            onChange={(event) => updateDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            readOnly={readOnly}
            className="w-full rounded-md border bg-background px-2 py-1.5 font-mono text-xs outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40"
          />
        );

      case "uuid":
        return (
          <div className="flex gap-2">
            <input
              type="text"
              value={draft}
              onChange={(event) => updateDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              readOnly={readOnly}
              placeholder="00000000-0000-0000-0000-000000000000"
              spellCheck={false}
              className="flex-1 rounded-md border bg-background px-2 py-1.5 font-mono text-xs outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={readOnly}
              onClick={() => {
                // `crypto.randomUUID` existe em todos os navegadores modernos.
                if (typeof crypto !== "undefined" && crypto.randomUUID) {
                  updateDraft(crypto.randomUUID());
                }
              }}
              title="Generate UUID v4"
            >
              <Dices className="h-3.5 w-3.5" />
              Generate
            </Button>
          </div>
        );

      case "bytea":
        return (
          <div className="flex flex-col gap-1">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(event) => updateDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              readOnly={readOnly}
              spellCheck={false}
              placeholder="\x48656c6c6f"
              className="h-[260px] w-full resize-none rounded-md border bg-background p-2 font-mono text-xs leading-5 outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40"
            />
            <p className="font-mono text-[10px] text-muted-foreground">
              Hex string. Prefix with <code>\x</code>.
            </p>
          </div>
        );

      case "inet":
        return (
          <div className="flex flex-col gap-1">
            <input
              type="text"
              value={draft}
              onChange={(event) => updateDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              readOnly={readOnly}
              spellCheck={false}
              placeholder="192.168.0.1 or 2001:db8::1/64"
              className="w-full rounded-md border bg-background px-2 py-1.5 font-mono text-xs outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40"
            />
            <p className="font-mono text-[10px] text-muted-foreground">
              IPv4/IPv6 with optional /prefix.
            </p>
          </div>
        );

      case "cidr":
        return (
          <div className="flex flex-col gap-1">
            <input
              type="text"
              value={draft}
              onChange={(event) => updateDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              readOnly={readOnly}
              spellCheck={false}
              placeholder="10.0.0.0/8"
              className="w-full rounded-md border bg-background px-2 py-1.5 font-mono text-xs outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40"
            />
            <p className="font-mono text-[10px] text-muted-foreground">
              Network with required /prefix.
            </p>
          </div>
        );

      case "macaddr":
        return (
          <div className="flex flex-col gap-1">
            <input
              type="text"
              value={draft}
              onChange={(event) => updateDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              readOnly={readOnly}
              spellCheck={false}
              placeholder="AA:BB:CC:DD:EE:FF"
              className="w-full rounded-md border bg-background px-2 py-1.5 font-mono text-xs outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40"
            />
          </div>
        );

      case "interval":
        return (
          <div className="flex flex-col gap-1">
            <input
              type="text"
              value={draft}
              onChange={(event) => updateDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              readOnly={readOnly}
              spellCheck={false}
              placeholder="1 day 2 hours"
              className="w-full rounded-md border bg-background px-2 py-1.5 font-mono text-xs outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40"
            />
            <p className="font-mono text-[10px] text-muted-foreground">
              Postgres interval, e.g. <code>1 day 2 hours</code>,{" "}
              <code>-2 weeks</code>, or ISO <code>P1DT2H</code>.
            </p>
          </div>
        );

      case "enum":
        return (
          <div className="flex flex-col gap-1">
            <input
              type="text"
              value={draft}
              onChange={(event) => updateDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              readOnly={readOnly}
              spellCheck={false}
              placeholder={column?.udt_name ?? "enum value"}
              className="w-full rounded-md border bg-background px-2 py-1.5 font-mono text-xs outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40"
            />
            {column?.udt_name && (
              <p className="font-mono text-[10px] text-muted-foreground">
                Enum type: <code>{column.udt_name}</code>
              </p>
            )}
          </div>
        );

      case "text":
      default:
        return (
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => updateDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            readOnly={readOnly}
            spellCheck={false}
            className="h-[260px] w-full resize-none rounded-md border bg-background p-2 font-mono text-xs leading-5 outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40"
            placeholder="empty string"
          />
        );
    }
  })();

  // --------------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------------

  const statusText = readOnly
    ? "Read-only (no primary key)"
    : !hasChanges
      ? "No changes"
      : isNullDraft
        ? "Will be set to NULL"
        : "Unsaved changes";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={trigger as React.ReactElement} />
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={4}
        className="w-[min(560px,90vw)] gap-0 p-0"
      >
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate font-mono text-xs font-medium">
                {columnName}
              </span>
              {column?.data_type && (
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {column.data_type}
                  {!nullable && (
                    <span className="ml-1 text-destructive">NOT NULL</span>
                  )}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Kbd>⌘</Kbd>
              <Kbd>⏎</Kbd>
              <span>to save</span>
            </div>
          </div>

          <div className="px-3 pt-2">{body}</div>

          {/* Mensagem de validação inline — só aparece quando há input + erro. */}
          {!isNullDraft && !validation.ok && hasChanges && (
            <div
              role="alert"
              className="mx-3 flex items-start gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive"
            >
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
              <span className="font-mono leading-4">{validation.message}</span>
            </div>
          )}

          <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
            <span
              className={`text-[10px] ${
                !isNullDraft && !validation.ok && hasChanges
                  ? "text-destructive"
                  : "text-muted-foreground"
              }`}
            >
              {!isNullDraft && !validation.ok && hasChanges
                ? "Fix the error to save"
                : statusText}
            </span>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={setToNull}
                disabled={readOnly || !nullable || isNullDraft}
                title={
                  nullable ? "Set this value to NULL" : "Column is NOT NULL"
                }
              >
                <Minus className="h-3.5 w-3.5" />
                NULL
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={cancel}>
                <X className="h-3.5 w-3.5" />
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={commit}
                disabled={!canSave}
                title={
                  !validation.ok && hasChanges ? validation.message : undefined
                }
              >
                <Check className="h-3.5 w-3.5" />
                Save
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
