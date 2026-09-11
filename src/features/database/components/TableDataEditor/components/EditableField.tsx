import type * as monaco from "monaco-editor";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/Icon";
import { JsonTreeViewer } from "@/components/ui/json-tree-viewer";
import { LazyMonacoEditor } from "@/features/database/components/LazyMonacoEditor";
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
} from "@/features/database/components/table-editor-utils";
import type { SchemaColumn } from "@/ipc/db/types";
import { getCellTitle, normalizeDisplay } from "../utils/valueParsers";

interface EditableFieldProps {
  column: SchemaColumn;
  hasPendingChange?: boolean;
  onSave: (rawText: string) => void;
  readOnly?: boolean;
  value: unknown;
}

export function EditableField({
  column,
  value,
  readOnly = false,
  hasPendingChange = false,
  onSave,
}: EditableFieldProps) {
  const kind = useMemo(() => classifyColumnKind(column), [column]);
  const nullable = column.is_nullable ?? true;
  const isNullNow = value === null || value === undefined;
  const [isEditing, setIsEditing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const initialDraft = useMemo(() => {
    if (isNullNow) {
      return "";
    }
    if (kind === "timestamptz") {
      return initialToUtcIso(value) ?? "";
    }
    return valueToEditableText(value, kind);
  }, [isNullNow, kind, value]);

  const [draft, setDraft] = useState(initialDraft);
  const [isNullDraft, setIsNullDraft] = useState(isNullNow);

  useEffect(() => {
    if (!isEditing) {
      setDraft(initialDraft);
      setIsNullDraft(isNullNow);
    }
  }, [initialDraft, isEditing, isNullNow]);

  useEffect(() => {
    if (!isEditing) {
      return;
    }
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
      textareaRef.current?.focus();
      textareaRef.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, [isEditing]);

  const hasChanges = useMemo(() => {
    if (isNullDraft !== isNullNow) {
      return true;
    }
    if (isNullDraft && isNullNow) {
      return false;
    }
    return draft !== initialDraft;
  }, [draft, initialDraft, isNullDraft, isNullNow]);

  const validation = useMemo(() => {
    if (isNullDraft) {
      return { ok: true } as const;
    }
    return validateDraft(draft, kind, column);
  }, [column, draft, isNullDraft, kind]);

  const canSave = !readOnly && hasChanges && validation.ok;

  const cancel = () => {
    setDraft(initialDraft);
    setIsNullDraft(isNullNow);
    setIsEditing(false);
  };

  const commit = () => {
    if (!canSave) {
      return;
    }
    onSave(isNullDraft ? NULL_SENTINEL : draft);
    setIsEditing(false);
  };

  const setToNull = () => {
    if (!nullable || readOnly) {
      return;
    }
    setIsNullDraft(true);
    setDraft("");
  };

  const updateDraft = (next: string) => {
    setIsNullDraft(false);
    setDraft(next);
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

  if (!isEditing) {
    return (
      <div className="space-y-2 rounded-lg border border-border/40 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-medium text-xs">{column.name}</span>
          <div className="flex items-center gap-2">
            {hasPendingChange && (
              <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-600">
                Pending
              </span>
            )}
            <span className="truncate text-[10px] text-muted-foreground">
              {column.data_type}
            </span>
          </div>
        </div>

        <div
          className={`max-h-40 overflow-auto rounded border bg-background px-2 py-1.5 font-mono text-xs ${
            isNullNow ? "text-muted-foreground/70 italic" : ""
          }`}
          title={getCellTitle(value)}
        >
          {normalizeDisplay(value)}
        </div>

        {!readOnly && (
          <div className="flex justify-end">
            <Button
              onClick={() => setIsEditing(true)}
              size="sm"
              type="button"
              variant="outline"
            >
              Edit
            </Button>
          </div>
        )}
      </div>
    );
  }

  const body = (() => {
    if (isNullDraft) {
      return (
        <div className="flex h-[180px] items-center justify-center rounded-md border border-dashed bg-muted/30 text-muted-foreground text-xs italic">
          NULL
        </div>
      );
    }

    switch (kind) {
      case "json": {
        let isJsonValid = false;
        try {
          const parsed = JSON.parse(draft);
          isJsonValid = typeof parsed === "object" && parsed !== null;
        } catch {
          isJsonValid = false;
        }

        if (isJsonValid) {
          return (
            <div className="flex flex-col gap-2">
              <JsonTreeViewer
                maxHeight="140px"
                readOnly={readOnly}
                showViewToggle
                value={draft}
              />
              {!readOnly && (
                <div className="overflow-hidden rounded-md border">
                  <LazyMonacoEditor
                    defaultLanguage="json"
                    height="100px"
                    onChange={(next) => updateDraft(next ?? "")}
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

        // JSON inválido — fallback ao Monaco editor
        return (
          <div className="overflow-hidden rounded-md border">
            <LazyMonacoEditor
              defaultLanguage="json"
              height="180px"
              onChange={(next) => updateDraft(next ?? "")}
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
          <div className="overflow-hidden rounded-md border">
            <LazyMonacoEditor
              defaultLanguage="plaintext"
              height="180px"
              onChange={(next) => updateDraft(next ?? "")}
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
      case "timestamptz":
        return (
          <input
            className="w-full rounded-md border bg-background px-2 py-1.5 font-mono text-xs outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40"
            onChange={(event) =>
              updateDraft(datetimeLocalToUtcIso(event.target.value) ?? "")
            }
            onKeyDown={handleKeyDown}
            readOnly={readOnly}
            ref={inputRef}
            step={1}
            type="datetime-local"
            value={utcIsoToDatetimeLocal(draft || null)}
          />
        );
      case "timestamp":
        return (
          <input
            className="w-full rounded-md border bg-background px-2 py-1.5 font-mono text-xs outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40"
            onChange={(event) =>
              updateDraft(datetimeLocalToTimestamp(event.target.value) ?? "")
            }
            onKeyDown={handleKeyDown}
            readOnly={readOnly}
            ref={inputRef}
            step={1}
            type="datetime-local"
            value={timestampRawToDatetimeLocal(draft)}
          />
        );
      case "date":
        return (
          <input
            className="w-full rounded-md border bg-background px-2 py-1.5 font-mono text-xs outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40"
            onChange={(event) => updateDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            readOnly={readOnly}
            ref={inputRef}
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
            ref={inputRef}
            step={1}
            type="time"
            value={initialTime(draft)}
          />
        );
      case "bool": {
        const current = isNullDraft ? "null" : initialBool(draft);
        const isTrue = current === "true";
        return (
          <div className="flex items-center gap-3" onKeyDown={handleKeyDown}>
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
            ref={inputRef}
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
              ref={inputRef}
              spellCheck={false}
              type="text"
              value={draft}
            />
            <Button
              disabled={readOnly}
              onClick={() => {
                if (typeof crypto !== "undefined" && crypto.randomUUID) {
                  updateDraft(crypto.randomUUID());
                }
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              <Icon className="h-3.5 w-3.5" name="dice" />
              Generate
            </Button>
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
              className="h-[180px] w-full resize-none rounded-md border bg-background p-2 font-mono text-xs leading-5 outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40"
              onChange={(event) => updateDraft(event.target.value)}
              onKeyDown={handleKeyDown}
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

  return (
    <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/[0.02] px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium text-xs">{column.name}</span>
        <span className="truncate text-[10px] text-muted-foreground">
          {column.data_type}
        </span>
      </div>
      {body}
      {!(isNullDraft || validation.ok) && hasChanges && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
          {validation.message}
        </div>
      )}
      <div className="flex items-center justify-end gap-1">
        <Button
          disabled={readOnly || !nullable || isNullDraft}
          onClick={setToNull}
          size="sm"
          type="button"
          variant="ghost"
        >
          NULL
        </Button>
        <Button onClick={cancel} size="sm" type="button" variant="ghost">
          Cancel
        </Button>
        <Button disabled={!canSave} onClick={commit} size="sm" type="button">
          Save
        </Button>
      </div>
    </div>
  );
}
