import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { useEffect, useRef } from "react";
import { Icon } from "@/components/ui/Icon";
import type { SchemaColumn } from "@/ipc/db/types";
import { cn } from "@/lib/utils";
import {
  classifyColumnKind,
  draftToTemporalInput,
  getInlineHelperKind,
  getTemporalPresets,
  type InlineHelperKind,
  initialBool,
  NULL_SENTINEL,
  resolveTemporalPreset,
  temporalInputToDraft,
} from "../../table-editor-utils";

/**
 * Marks the helper popup so the outside-press handler can tell a press inside
 * the helper apart from a press that ends the edit session.
 */
export const INLINE_HELPER_ATTR = "data-inline-cell-helper";

const PRESET_LABELS = {
  now: "now",
  today: "today",
  tomorrow: "tomorrow",
  yesterday: "yesterday",
} as const;

const PRESET_BUTTON_CLASS =
  "rounded px-2 py-1 text-left text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40";

const CHIP_CLASS =
  "rounded px-2 py-1 font-mono text-[11px] transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40";

const CHIP_ACTIVE_CLASS = "bg-primary/10 font-medium text-primary";

const TEMPORAL_INPUT_CLASS =
  "w-full rounded-md border border-input bg-background px-2 py-1.5 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40";

function temporalInputType(
  kind: InlineHelperKind
): "date" | "datetime-local" | "time" {
  if (kind === "date") {
    return "date";
  }
  if (kind === "time") {
    return "time";
  }
  return "datetime-local";
}

interface InlineCellHelperProps {
  /** The inline editor's input — the popup is anchored to it. */
  anchor: React.RefObject<HTMLInputElement | null>;
  column: SchemaColumn | undefined;
  /** Canonical draft text currently held by the inline editor. */
  draft: string;
  nullable: boolean;
  onCancel: () => void;
  onCommit: () => void;
  /** Writes the next canonical draft text back into the inline editor. */
  onDraftChange: (next: string) => void;
}

/**
 * Type-specific widget shown *next to* the inline cell input (Neon-style):
 * a date/time picker plus `NULL`/`now`/`today`/`tomorrow`/`yesterday` presets
 * for temporal columns, a TRUE/FALSE toggle for booleans, a UUID generator.
 *
 * It never owns the value — every interaction writes straight back into the
 * inline draft, so the cell input stays the single source of truth and the user
 * can keep typing while the helper is open.
 *
 * Renders `null` for kinds whose plain text input is already the right editor.
 */
export function InlineCellHelper({
  anchor,
  column,
  draft,
  nullable,
  onDraftChange,
  onCommit,
  onCancel,
}: InlineCellHelperProps) {
  const helperKind = getInlineHelperKind(classifyColumnKind(column));

  // The grid hands us a fresh closure on every render, so keep it in a ref
  // instead of re-subscribing the document listener below each time.
  const commitRef = useRef(onCommit);
  useEffect(() => {
    commitRef.current = onCommit;
  });

  useEffect(() => {
    if (!helperKind) {
      return;
    }
    // Base UI's own outside-press dismissal is intentionally left unhandled: the
    // inline input is the popup's anchor, not a registered trigger, so Base UI
    // counts a press on it as "outside" and would commit mid-typing. Deciding
    // here lets the edit session survive a press on its own input.
    const handlePointerDown = (event: PointerEvent) => {
      const { target } = event;
      if (!(target instanceof Element)) {
        return;
      }
      const pressedInlineInput = target === anchor.current;
      const pressedInsideHelper =
        target.closest(`[${INLINE_HELPER_ATTR}]`) !== null;
      if (pressedInlineInput || pressedInsideHelper) {
        return;
      }
      commitRef.current();
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [anchor, helperKind]);

  if (!helperKind) {
    return null;
  }

  // Keeps the inline input focused: `preventDefault` on mousedown suppresses the
  // focus change, so `onBlur` never fires and the edit session survives.
  const keepInlineFocus = (event: React.MouseEvent) => {
    event.preventDefault();
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onCommit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
  };

  // Once focus is inside the helper the inline input is already blurred, so its
  // own `onBlur` will not fire again. Commit when focus leaves the whole edit
  // session (helper + inline input) instead of leaving a stale draft behind.
  // `persistEditing` is a no-op once the cell is committed, so double-committing
  // through the inline input's own blur is harmless.
  const handleHelperBlur = (event: React.FocusEvent<HTMLElement>) => {
    const next = event.relatedTarget;
    if (
      next instanceof Element &&
      (next === anchor.current ||
        next.closest(`[${INLINE_HELPER_ATTR}]`) !== null)
    ) {
      return;
    }
    onCommit();
  };

  const nullButton = (
    <button
      className={PRESET_BUTTON_CLASS}
      disabled={!nullable}
      onClick={() => onDraftChange(NULL_SENTINEL)}
      onMouseDown={keepInlineFocus}
      type="button"
    >
      NULL
    </button>
  );

  const body = (() => {
    if (helperKind === "bool") {
      const current = initialBool(draft);
      return (
        <div className="flex items-center gap-1">
          {(["true", "false"] as const).map((value) => (
            <button
              className={cn(CHIP_CLASS, current === value && CHIP_ACTIVE_CLASS)}
              key={value}
              onClick={() => onDraftChange(value)}
              onMouseDown={keepInlineFocus}
              type="button"
            >
              {value.toUpperCase()}
            </button>
          ))}
          {nullable ? nullButton : null}
        </div>
      );
    }

    if (helperKind === "uuid") {
      return (
        <div className="flex items-center gap-1">
          <button
            className={cn(CHIP_CLASS, "flex items-center gap-1.5")}
            onClick={() => {
              if (typeof crypto !== "undefined" && crypto.randomUUID) {
                onDraftChange(crypto.randomUUID());
              }
            }}
            onMouseDown={keepInlineFocus}
            type="button"
          >
            <Icon className="size-3" name="dice" />
            Generate UUID v4
          </button>
          {nullable ? nullButton : null}
        </div>
      );
    }

    // Temporal kinds: presets on the left, native picker on the right.
    return (
      <div className="flex items-start gap-2.5">
        <div className="flex w-20 shrink-0 flex-col">
          {nullButton}
          {getTemporalPresets(helperKind).map((preset) => (
            <button
              className={PRESET_BUTTON_CLASS}
              key={preset}
              onClick={() =>
                onDraftChange(
                  resolveTemporalPreset(helperKind, preset, new Date())
                )
              }
              onMouseDown={keepInlineFocus}
              type="button"
            >
              {PRESET_LABELS[preset]}
            </button>
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <input
            className={TEMPORAL_INPUT_CLASS}
            onChange={(event) =>
              onDraftChange(
                temporalInputToDraft(helperKind, event.target.value)
              )
            }
            onKeyDown={handleKeyDown}
            step={helperKind === "date" ? undefined : 1}
            type={temporalInputType(helperKind)}
            value={draftToTemporalInput(helperKind, draft)}
          />
          <p className="truncate font-mono text-[10px] text-muted-foreground">
            {draft || "NULL"}
          </p>
        </div>
      </div>
    );
  })();

  return (
    // The popup's lifetime is owned by the edit session, not by Base UI: the grid
    // stops rendering this component when `editingCell` clears, so close requests
    // are dropped here on purpose (see the outside-press handler above).
    <PopoverPrimitive.Root onOpenChange={() => undefined} open>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner
          align="start"
          anchor={anchor}
          className="isolate z-50"
          side="bottom"
          sideOffset={4}
        >
          <PopoverPrimitive.Popup
            aria-label={column ? `${column.name} editor` : "value editor"}
            className="w-[min(320px,80vw)] rounded-lg bg-popover p-2 text-popover-foreground shadow-md outline-hidden ring-1 ring-foreground/10"
            data-inline-cell-helper=""
            initialFocus={false}
            onBlur={handleHelperBlur}
          >
            {body}
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
