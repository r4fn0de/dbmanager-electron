import type * as monaco from "monaco-editor";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/Icon";
import { JsonTreeViewer } from "@/components/ui/json-tree-viewer";
import { Kbd } from "@/components/ui/kbd";
import { LazyMonacoEditor } from "./LazyMonacoEditor";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { SchemaColumn } from "@/ipc/db/types";
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
  validateDraft,
  valueToEditableText,
  type ValidationResult,
} from "./table-editor-utils";

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
                value={draft}
                maxHeight="200px"
                showViewToggle
                readOnly={readOnly}
              />
              {!readOnly && (
                <div className="overflow-hidden rounded-md border">
                  <LazyMonacoEditor
                    height="120px"
                    defaultLanguage="json"
                    value={draft}
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
              )}
            </div>
          );
        }

        // JSON inválido ou primitivo — fallback pro Monaco
        return (
          <div className="overflow-hidden rounded-md border">
            <LazyMonacoEditor
              height="260px"
              defaultLanguage="json"
              value={draft}
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
      }

      case "array":
        return (
          <div className="flex flex-col gap-1">
            <div className="overflow-hidden rounded-md border">
              <LazyMonacoEditor
                height="240px"
                // `plaintext` porque o valor pode ser literal PG `{1,2,3}`,
                // que não é JSON válido — syntax highlighting de JSON ficaria vermelho.
                defaultLanguage="plaintext"
                value={draft}
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
        const isTrue = current === "true";
        const isFalse = current === "false";
        return (
          <div className="flex items-center gap-3" onKeyDown={handleKeyDown}>
            {/* Checkbox estilizado */}
            <label className="flex items-center gap-2 cursor-pointer">
              <button
                type="button"
                role="switch"
                aria-checked={isTrue}
                disabled={readOnly}
                onClick={() => updateDraft(isTrue ? "false" : "true")}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50 ${
                  isTrue
                    ? "border-primary bg-primary"
                    : "border-input bg-muted"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-3.5 w-3.5 rounded-full bg-background shadow-sm ring-0 transition-transform ${
                    isTrue ? "translate-x-[18px]" : "translate-x-[2px]"
                  }`}
                />
              </button>
              <span className={`font-mono text-xs ${isTrue ? "text-primary font-medium" : "text-muted-foreground"}`}>
                {isTrue ? "TRUE" : "FALSE"}
              </span>
            </label>
            <button
              type="button"
              onClick={() => updateDraft(isTrue ? "false" : "true")}
              disabled={readOnly}
              className="rounded-md border border-dashed px-2 py-1 font-mono text-[10px] text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50"
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
              <Icon name="dice" className="h-3.5 w-3.5" />
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
      default: {
        // Detecta se parece uma cor hex para mostrar color picker
        const isHexColor = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(draft.trim());
        return (
          <div className="flex flex-col gap-2">
            {isHexColor && (
              <div className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5">
                <input
                  type="color"
                  value={draft.trim()}
                  onChange={(event) => updateDraft(event.target.value)}
                  disabled={readOnly}
                  className="h-7 w-10 cursor-pointer rounded border-0 bg-transparent p-0"
                />
                <span
                  className="h-5 w-5 rounded-full border shadow-xs"
                  style={{ backgroundColor: draft.trim() }}
                />
                <span className="font-mono text-xs text-muted-foreground">{draft.trim()}</span>
              </div>
            )}
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
              <Icon name="alert-circle" className="mt-0.5 h-3 w-3 shrink-0" />
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
                <Icon name="minus" className="h-3.5 w-3.5" />
                NULL
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={cancel}>
                <Icon name="x" className="h-3.5 w-3.5" />
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
                <Icon name="check" className="h-3.5 w-3.5" />
                Save
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
