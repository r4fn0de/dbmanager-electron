import type * as monaco from "monaco-editor";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/Icon";
import { JsonTreeViewer } from "@/components/ui/json-tree-viewer";
import { Kbd } from "@/components/ui/kbd";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { SchemaColumn } from "@/ipc/db/types";
import { LazyMonacoEditor } from "./LazyMonacoEditor";
import {
  classifyColumnKind,
  datetimeLocalToTimestamp,
  datetimeLocalToUtcIso,
  initialBool,
  initialDate,
  initialNumeric,
  initialTime,
  initialToUtcIso,
  NULL_SENTINEL,
  timestampRawToDatetimeLocal,
  utcIsoToDatetimeLocal,
  type ValidationResult,
  validateDraft,
  valueToEditableText,
} from "./table-editor-utils";

interface CellExpandPopoverProps {
  /** Definição da coluna — usada para detectar o tipo e montar o editor adequado. */
  column: SchemaColumn | undefined;
  /** Nome da coluna sendo editada — usado no header do popover. */
  columnName: string;
  /** Valor atual (cru, como veio do backend). */
  initialValue: unknown;
  /** Chamado ao confirmar. Emite texto cru (ou a string literal "NULL"). */
  onSave: (rawText: string) => void;
  /** Desabilita edição (ex.: sem primary key). O popover ainda abre em read-only. */
  readOnly?: boolean;
  /** Trigger element (normalmente um botão pequeno no canto da célula). */
  trigger: React.ReactNode;
}

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
    if (isNullNow) {
      return "";
    }
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
    if (!open) {
      return;
    }
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
    if (isNullDraft !== isNullNow) {
      return true;
    }
    if (isNullDraft && isNullNow) {
      return false;
    }
    return draft !== initialDraft;
  }, [draft, initialDraft, isNullDraft, isNullNow]);

  // Valida o draft conforme o tipo (pulamos quando for NULL, que já é válido).
  const validation: ValidationResult = useMemo(() => {
    if (isNullDraft) {
      return { ok: true };
    }
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
    if (!nullable || readOnly) {
      return;
    }
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
        <div className="flex h-[260px] items-center justify-center rounded-md border border-dashed bg-muted/30 text-muted-foreground text-xs italic">
          NULL
        </div>
      );
    }

    switch (kind) {
      case "json": {
        // Tente parsear para mostrar como tree
        let parsed: unknown;
        let isJsonValid = false;
        try {
          parsed = JSON.parse(draft);
          isJsonValid = typeof parsed === "object" && parsed !== null;
        } catch {
          isJsonValid = false;
        }

        if (isJsonValid && (readOnly || !readOnly)) {
          // Mostra tree view com toggle Tree/Text + editor Monaco abaixo para edição
          return (
            <div className="flex flex-col gap-2">
              <JsonTreeViewer
                maxHeight="200px"
                readOnly={readOnly}
                showViewToggle
                value={draft}
              />
              {!readOnly && (
                <div className="overflow-hidden rounded-md border">
                  <LazyMonacoEditor
                    defaultLanguage="json"
                    height="120px"
                    onChange={(value: string | undefined) =>
                      updateDraft(value ?? "")
                    }
                    onMount={(editor) => {
                      editor.onKeyDown((event: monaco.IKeyboardEvent) => {
                        const isCmdEnter =
                          (event.metaKey || event.ctrlKey) &&
                          event.keyCode === 3;
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
                      automaticLayout: true,
                      fontSize: 12,
                      lineNumbers: "on",
                      minimap: { enabled: false },
                      readOnly,
                      scrollBeyondLastLine: false,
                      tabSize: 2,
                      wordWrap: "on",
                    }}
                    value={draft}
                  />
                </div>
              )}
            </div>
          );
        }

        // JSON inválido ou primitivo — fallback pro Monaco
        return (
          <div className="overflow-hidden rounded-md border">
            <LazyMonacoEditor
              defaultLanguage="json"
              height="260px"
              onChange={(value: string | undefined) => updateDraft(value ?? "")}
              onMount={(editor) => {
                editor.onKeyDown((event: monaco.IKeyboardEvent) => {
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
                automaticLayout: true,
                fontSize: 12,
                lineNumbers: "on",
                minimap: { enabled: false },
                readOnly,
                scrollBeyondLastLine: false,
                tabSize: 2,
                wordWrap: "on",
              }}
              value={draft}
            />
          </div>
        );
      }

      case "array":
        return (
          <div className="flex flex-col gap-1">
            <div className="overflow-hidden rounded-md border">
              <LazyMonacoEditor
                // `plaintext` porque o valor pode ser literal PG `{1,2,3}`,
                // que não é JSON válido — syntax highlighting de JSON ficaria vermelho.
                defaultLanguage="plaintext"
                height="240px"
                onChange={(value: string | undefined) =>
                  updateDraft(value ?? "")
                }
                onMount={(editor) => {
                  editor.onKeyDown((event: monaco.IKeyboardEvent) => {
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
                  automaticLayout: true,
                  fontSize: 12,
                  lineNumbers: "on",
                  minimap: { enabled: false },
                  readOnly,
                  scrollBeyondLastLine: false,
                  tabSize: 2,
                  wordWrap: "on",
                }}
                value={draft}
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
              className="w-full rounded-md border bg-background px-2 py-1.5 font-mono text-xs outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40"
              onChange={(event) => {
                const iso = datetimeLocalToUtcIso(event.target.value);
                updateDraft(iso ?? "");
              }}
              onKeyDown={handleKeyDown}
              readOnly={readOnly}
              step={1}
              type="datetime-local"
              value={localValue}
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
            className="w-full rounded-md border bg-background px-2 py-1.5 font-mono text-xs outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40"
            onChange={(event) => {
              const ts = datetimeLocalToTimestamp(event.target.value);
              updateDraft(ts ?? "");
            }}
            onKeyDown={handleKeyDown}
            readOnly={readOnly}
            step={1}
            type="datetime-local"
            value={localValue}
          />
        );
      }

      case "date":
        return (
          <input
            className="w-full rounded-md border bg-background px-2 py-1.5 font-mono text-xs outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40"
            onChange={(event) => updateDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            readOnly={readOnly}
            type="date"
            value={initialDate(draft)}
          />
        );

      case "time":
        return (
          <input
            className="w-full rounded-md border bg-background px-2 py-1.5 font-mono text-xs outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40"
            onChange={(event) => updateDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            readOnly={readOnly}
            step={1}
            type="time"
            value={initialTime(draft)}
          />
        );

      case "bool": {
        const current = isNullDraft ? "null" : initialBool(draft);
        const isTrue = current === "true";
        const _isFalse = current === "false";
        return (
          <div className="flex items-center gap-3" onKeyDown={handleKeyDown}>
            {/* Checkbox estilizado */}
            <label className="flex cursor-pointer items-center gap-2">
              <button
                aria-checked={isTrue}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50 ${
                  isTrue ? "border-primary bg-primary" : "border-input bg-muted"
                }`}
                disabled={readOnly}
                onClick={() => updateDraft(isTrue ? "false" : "true")}
                role="switch"
                type="button"
              >
                <span
                  className={`pointer-events-none inline-block h-3.5 w-3.5 rounded-full bg-background shadow-sm ring-0 transition-transform ${
                    isTrue ? "translate-x-[18px]" : "translate-x-[2px]"
                  }`}
                />
              </button>
              <span
                className={`font-mono text-xs ${isTrue ? "font-medium text-primary" : "text-muted-foreground"}`}
              >
                {isTrue ? "TRUE" : "FALSE"}
              </span>
            </label>
            <button
              className="rounded-md border border-dashed px-2 py-1 font-mono text-[10px] text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
              disabled={readOnly}
              onClick={() => updateDraft(isTrue ? "false" : "true")}
              type="button"
            >
              Toggle
            </button>
          </div>
        );
      }

      case "integer":
      case "numeric":
        return (
          <input
            className="w-full rounded-md border bg-background px-2 py-1.5 font-mono text-xs outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40"
            inputMode={kind === "integer" ? "numeric" : "decimal"}
            onChange={(event) => updateDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            readOnly={readOnly}
            step={kind === "integer" ? 1 : "any"}
            type="number"
            value={initialNumeric(draft)}
          />
        );

      case "uuid":
        return (
          <div className="flex gap-2">
            <input
              className="flex-1 rounded-md border bg-background px-2 py-1.5 font-mono text-xs outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40"
              onChange={(event) => updateDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="00000000-0000-0000-0000-000000000000"
              readOnly={readOnly}
              spellCheck={false}
              type="text"
              value={draft}
            />
            <Button
              disabled={readOnly}
              onClick={() => {
                // `crypto.randomUUID` existe em todos os navegadores modernos.
                if (typeof crypto !== "undefined" && crypto.randomUUID) {
                  updateDraft(crypto.randomUUID());
                }
              }}
              size="sm"
              title="Generate UUID v4"
              type="button"
              variant="outline"
            >
              <Icon className="h-3.5 w-3.5" name="dice" />
              Generate
            </Button>
          </div>
        );

      case "bytea":
        return (
          <div className="flex flex-col gap-1">
            <textarea
              className="h-[260px] w-full resize-none rounded-md border bg-background p-2 font-mono text-xs leading-5 outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40"
              onChange={(event) => updateDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="\x48656c6c6f"
              readOnly={readOnly}
              ref={textareaRef}
              spellCheck={false}
              value={draft}
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
              className="w-full rounded-md border bg-background px-2 py-1.5 font-mono text-xs outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40"
              onChange={(event) => updateDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="192.168.0.1 or 2001:db8::1/64"
              readOnly={readOnly}
              spellCheck={false}
              type="text"
              value={draft}
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
              className="w-full rounded-md border bg-background px-2 py-1.5 font-mono text-xs outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40"
              onChange={(event) => updateDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="10.0.0.0/8"
              readOnly={readOnly}
              spellCheck={false}
              type="text"
              value={draft}
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
              className="w-full rounded-md border bg-background px-2 py-1.5 font-mono text-xs outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40"
              onChange={(event) => updateDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="AA:BB:CC:DD:EE:FF"
              readOnly={readOnly}
              spellCheck={false}
              type="text"
              value={draft}
            />
          </div>
        );

      case "interval":
        return (
          <div className="flex flex-col gap-1">
            <input
              className="w-full rounded-md border bg-background px-2 py-1.5 font-mono text-xs outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40"
              onChange={(event) => updateDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="1 day 2 hours"
              readOnly={readOnly}
              spellCheck={false}
              type="text"
              value={draft}
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
              className="w-full rounded-md border bg-background px-2 py-1.5 font-mono text-xs outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40"
              onChange={(event) => updateDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={column?.udt_name ?? "enum value"}
              readOnly={readOnly}
              spellCheck={false}
              type="text"
              value={draft}
            />
            {column?.udt_name && (
              <p className="font-mono text-[10px] text-muted-foreground">
                Enum type: <code>{column.udt_name}</code>
              </p>
            )}
          </div>
        );
      default: {
        // Detecta se parece uma cor hex para mostrar color picker
        const isHexColor = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(draft.trim());
        return (
          <div className="flex flex-col gap-2">
            {isHexColor && (
              <div className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5">
                <input
                  className="h-7 w-10 cursor-pointer rounded border-0 bg-transparent p-0"
                  disabled={readOnly}
                  onChange={(event) => updateDraft(event.target.value)}
                  type="color"
                  value={draft.trim()}
                />
                <span
                  className="h-5 w-5 rounded-full border shadow-xs"
                  style={{ backgroundColor: draft.trim() }}
                />
                <span className="font-mono text-muted-foreground text-xs">
                  {draft.trim()}
                </span>
              </div>
            )}
            <textarea
              className="h-[260px] w-full resize-none rounded-md border bg-background p-2 font-mono text-xs leading-5 outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40"
              onChange={(event) => updateDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="empty string"
              readOnly={readOnly}
              ref={textareaRef}
              spellCheck={false}
              value={draft}
            />
          </div>
        );
      }
    }
  })();

  // --------------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------------

  const statusText = readOnly
    ? "Read-only (no primary key)"
    : hasChanges
      ? isNullDraft
        ? "Will be set to NULL"
        : "Unsaved changes"
      : "No changes";

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger render={trigger as React.ReactElement} />
      <PopoverContent
        align="start"
        className="w-[min(560px,90vw)] gap-0 p-0"
        side="bottom"
        sideOffset={4}
      >
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate font-medium font-mono text-xs">
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
          {!(isNullDraft || validation.ok) && hasChanges && (
            <div
              className="mx-3 flex items-start gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive"
              role="alert"
            >
              <Icon className="mt-0.5 h-3 w-3 shrink-0" name="alert-circle" />
              <span className="font-mono leading-4">{validation.message}</span>
            </div>
          )}

          <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
            <span
              className={`text-[10px] ${
                !(isNullDraft || validation.ok) && hasChanges
                  ? "text-destructive"
                  : "text-muted-foreground"
              }`}
            >
              {!(isNullDraft || validation.ok) && hasChanges
                ? "Fix the error to save"
                : statusText}
            </span>
            <div className="flex items-center gap-1">
              <Button
                disabled={readOnly || !nullable || isNullDraft}
                onClick={setToNull}
                size="sm"
                title={
                  nullable ? "Set this value to NULL" : "Column is NOT NULL"
                }
                type="button"
                variant="ghost"
              >
                <Icon className="h-3.5 w-3.5" name="minus" />
                NULL
              </Button>
              <Button onClick={cancel} size="sm" type="button" variant="ghost">
                <Icon className="h-3.5 w-3.5" name="x" />
                Cancel
              </Button>
              <Button
                disabled={!canSave}
                onClick={commit}
                size="sm"
                title={
                  !validation.ok && hasChanges ? validation.message : undefined
                }
                type="button"
              >
                <Icon className="h-3.5 w-3.5" name="check" />
                Save
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
