import type * as monaco from "monaco-editor";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/Icon";
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
  value: unknown;
  readOnly?: boolean;
  hasPendingChange?: boolean;
  onSave: (rawText: string) => void;
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
    if (isNullNow) return "";
    if (kind === "timestamptz") return initialToUtcIso(value) ?? "";
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
    if (!isEditing) return;
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
      textareaRef.current?.focus();
      textareaRef.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, [isEditing]);

  const hasChanges = useMemo(() => {
    if (isNullDraft !== isNullNow) return true;
    if (isNullDraft && isNullNow) return false;
    return draft !== initialDraft;
  }, [draft, initialDraft, isNullDraft, isNullNow]);

  const validation = useMemo(() => {
    if (isNullDraft) return { ok: true } as const;
    return validateDraft(draft, kind, column);
  }, [column, draft, isNullDraft, kind]);

  const canSave = !readOnly && hasChanges && validation.ok;

  const cancel = () => {
    setDraft(initialDraft);
    setIsNullDraft(isNullNow);
    setIsEditing(false);
  };

  const commit = () => {
    if (!canSave) return;
    onSave(isNullDraft ? NULL_SENTINEL : draft);
    setIsEditing(false);
  };

  const setToNull = () => {
    if (!nullable || readOnly) return;
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
          <span className="truncate text-xs font-medium">{column.name}</span>
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
            isNullNow ? "italic text-muted-foreground/70" : ""
          }`}
          title={getCellTitle(value)}
        >
          {normalizeDisplay(value)}
        </div>

        {!readOnly && (
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsEditing(true)}
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
        <div className="flex h-[180px] items-center justify-center rounded-md border border-dashed bg-muted/30 text-xs italic text-muted-foreground">
          NULL
        </div>
      );
    }

    switch (kind) {
      case "json":
        return (
          <div className="overflow-hidden rounded-md border">
            <LazyMonacoEditor
              height="180px"
              defaultLanguage="json"
              value={draft}
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
          <div className="overflow-hidden rounded-md border">
            <LazyMonacoEditor
              height="180px"
              defaultLanguage="plaintext"
              value={draft}
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
      case "timestamptz":
        return (
          <input
            ref={inputRef}
            type="datetime-local"
            step={1}
            value={utcIsoToDatetimeLocal(draft || null)}
            onChange={(event) => updateDraft(datetimeLocalToUtcIso(event.target.value) ?? "")}
            onKeyDown={handleKeyDown}
            readOnly={readOnly}
            className="w-full rounded-md border bg-background px-2 py-1.5 font-mono text-xs outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40"
          />
        );
      case "timestamp":
        return (
          <input
            ref={inputRef}
            type="datetime-local"
            step={1}
            value={timestampRawToDatetimeLocal(draft)}
            onChange={(event) => updateDraft(datetimeLocalToTimestamp(event.target.value) ?? "")}
            onKeyDown={handleKeyDown}
            readOnly={readOnly}
            className="w-full rounded-md border bg-background px-2 py-1.5 font-mono text-xs outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40"
          />
        );
      case "date":
        return (
          <input
            ref={inputRef}
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
            ref={inputRef}
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
          <div className="flex gap-2" onKeyDown={handleKeyDown}>
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
            ref={inputRef}
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
              ref={inputRef}
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
                if (typeof crypto !== "undefined" && crypto.randomUUID) {
                  updateDraft(crypto.randomUUID());
                }
              }}
            >
              <Icon name="dice" className="h-3.5 w-3.5" />
              Generate
            </Button>
          </div>
        );
      default:
        return (
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => updateDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            readOnly={readOnly}
            spellCheck={false}
            className="h-[180px] w-full resize-none rounded-md border bg-background p-2 font-mono text-xs leading-5 outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40"
          />
        );
    }
  })();

  return (
    <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/[0.02] px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-medium">{column.name}</span>
        <span className="truncate text-[10px] text-muted-foreground">{column.data_type}</span>
      </div>
      {body}
      {!isNullDraft && !validation.ok && hasChanges && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
          {validation.message}
        </div>
      )}
      <div className="flex items-center justify-end gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={setToNull}
          disabled={readOnly || !nullable || isNullDraft}
        >
          NULL
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={cancel}>
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={commit} disabled={!canSave}>
          Save
        </Button>
      </div>
    </div>
  );
}
