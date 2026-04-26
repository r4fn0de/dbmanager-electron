"use no memo"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Icon } from "@/components/ui/Icon";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import { useCallback, useEffect, useRef, useState } from "react";

export type ChatToolPart = {
  type: string;
  state:
    | "input-streaming"
    | "input-available"
    | "output-available"
    | "output-error"
    | "pending-approval";
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  toolCallId?: string;
  errorText?: string;
  /** Approval request metadata — present when state is "pending-approval" */
  approvalRequest?: {
    description: string;
    preview?: string;
    warnings?: string[];
  };
};

export type ChatToolProps = {
  toolPart: ChatToolPart;
  defaultOpen?: boolean;
  className?: string;
  /** Callback when user approves a pending tool call */
  onApprove?: (toolCallId: string) => void;
  /** Callback when user rejects a pending tool call */
  onReject?: (toolCallId: string) => void;
};

/** Tiny status dot — pulses when running, colored by state otherwise. */
function StatusDot({ state }: { state: ChatToolPart["state"] }) {
  const dotColor = {
    "input-streaming": "bg-blue-500",
    "input-available": "bg-orange-400",
    "output-available": "bg-emerald-500 dark:bg-emerald-400",
    "output-error": "bg-red-500 dark:bg-red-400",
    "pending-approval": "bg-amber-500 dark:bg-amber-400",
  }[state] ?? "bg-muted-foreground";

  return (
    <span className="relative flex size-1.5 shrink-0">
      {state === "input-streaming" && (
        <span
          className={cn(
            "absolute inline-flex size-full animate-ping rounded-full opacity-40",
            dotColor,
            "animation-duration-[1.5s] ease-out",
          )}
        />
      )}
      <span className={cn("inline-flex size-1.5 rounded-full", dotColor)} />
    </span>
  );
}

/** Subtle state label — only shown while processing. */
function StateLabel({ state }: { state: ChatToolPart["state"] }) {
  if (state === "output-available") return null;
  const label = {
    "input-streaming": "Running",
    "input-available": "Ready",
    "output-error": "Error",
    "pending-approval": "Awaiting approval",
  }[state];
  if (!label) return null;
  return (
    <span className={cn(
      "text-[10px]",
      state === "pending-approval" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground/70",
    )}>
      {label}
    </span>
  );
}

/** Format a value for display — keeps output compact. */
function formatCompact(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * ChatTool — a minimal tool-call display that blends into the chat flow.
 *
 * Design philosophy (Emil):
 * - Good defaults matter more than options
 * - Unseen details compound — the status dot, monospace name, and compact
 *   output all contribute to a feeling of precision without shouting
 * - Beauty is leverage — this component makes the AI chat feel professional
 */
export function ChatTool({ toolPart, defaultOpen = true, className, onApprove, onReject }: ChatToolProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const { state, input, output, errorText, approvalRequest, toolCallId } = toolPart;

  const hasInput = input && Object.keys(input).length > 0;
  const hasOutput = output !== undefined && output !== null;
  const isPendingApproval = state === "pending-approval";
  const hasExpandableContent = hasInput || hasOutput || (state === "output-error" && errorText) || isPendingApproval;

  // Auto-open collapsible when expandable content first appears (tool result arrives)
  const hadExpandableRef = useRef(hasExpandableContent);
  useEffect(() => {
    if (hasExpandableContent && !hadExpandableRef.current) {
      setIsOpen(true);
    }
    hadExpandableRef.current = hasExpandableContent;
  }, [hasExpandableContent]);

  // Keyboard shortcuts for approval — Enter to approve, Escape to reject.
  // Only active when this tool is in pending-approval state.
  // Enter is guarded: ignored when focus is in an input/textarea/contenteditable
  // so the user can still type in the chat prompt.
  const handleApprove = useCallback(() => {
    if (toolCallId && onApprove) onApprove(toolCallId);
  }, [toolCallId, onApprove]);

  const handleReject = useCallback(() => {
    if (toolCallId && onReject) onReject(toolCallId);
  }, [toolCallId, onReject]);

  useEffect(() => {
    if (!isPendingApproval || !toolCallId) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if focus is inside an input, textarea, or contenteditable element
      const active = document.activeElement;
      const isTyping =
        active instanceof HTMLInputElement
        || active instanceof HTMLTextAreaElement
        || (active instanceof HTMLElement && active.isContentEditable);

      if (e.key === "Enter" && !isTyping) {
        e.preventDefault();
        handleApprove();
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleReject();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPendingApproval, toolCallId, handleApprove, handleReject]);

  return (
    <div
      className={cn(
        "overflow-hidden rounded-md bg-muted/20",
        className,
      )}
    >
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger
          className={cn(
            "flex w-full items-center justify-between gap-2 px-2.5 py-1.5",
            "text-left transition-colors duration-100 ease-out",
            "hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            hasExpandableContent && "cursor-pointer",
            !hasExpandableContent && "cursor-default",
          )}
        >
          <div className="flex min-w-0 items-center gap-1.5">
            <StatusDot state={state} />
            <span className="truncate font-mono text-xs font-medium text-foreground/90">
              {toolPart.type}
            </span>
            <StateLabel state={state} />
          </div>
          {hasExpandableContent && (
            <Icon
              name="chevron-down"
              className={cn(
                "size-3 shrink-0 text-muted-foreground/50 transition-transform duration-150 ease-out",
                isOpen && "rotate-180",
              )}
            />
          )}
        </CollapsibleTrigger>

        {hasExpandableContent && (
          <CollapsibleContent
            className="data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down overflow-hidden"
          >
            <div className="space-y-2 px-2.5 py-2 text-xs">
              {hasInput && (
                <div>
                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                    Input
                  </span>
                  <div className="mt-1 max-h-40 overflow-auto rounded bg-background/40 p-1.5 font-mono text-[11px] leading-relaxed">
                    {Object.entries(input ?? {}).map(([key, value]) => (
                      <div key={key} className="flex gap-1">
                        <span className="text-muted-foreground/70">{key}:</span>
                        <span className="break-all text-foreground/80">{formatCompact(value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {hasOutput && (
                <div>
                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                    Output
                  </span>
                  <div className="mt-1 max-h-48 overflow-auto rounded bg-background/40 p-1.5 font-mono text-[11px] leading-relaxed">
                    <pre className="whitespace-pre-wrap wrap-break-word text-foreground/80">
                      {formatCompact(output)}
                    </pre>
                  </div>
                </div>
              )}

              {state === "output-error" && errorText && (
                <div>
                  <span className="text-[10px] font-medium uppercase tracking-wider text-red-500/80">
                    Error
                  </span>
                  <div className="mt-1 rounded border border-red-200/40 bg-red-500/5 p-1.5 text-[11px] text-red-600 dark:border-red-900/30 dark:text-red-400">
                    {errorText}
                  </div>
                </div>
              )}

              {/* Approval request UI — inline approve/reject */}
              {isPendingApproval && (
                <div className="space-y-2.5">
                  {/* Description */}
                  {approvalRequest?.description && (
                    <p className="text-xs text-foreground/80">
                      {approvalRequest.description}
                    </p>
                  )}

                  {/* SQL preview */}
                  {approvalRequest?.preview && (
                    <div>
                      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                        SQL
                      </span>
                      <pre className="mt-1 max-h-32 overflow-auto rounded bg-background/60 p-2 font-mono text-[11px] leading-relaxed text-foreground/80 whitespace-pre-wrap break-words">
                        {approvalRequest.preview}
                      </pre>
                    </div>
                  )}

                  {/* Warnings */}
                  {approvalRequest?.warnings && approvalRequest.warnings.length > 0 && (
                    <div className="space-y-1">
                      {approvalRequest.warnings.map((warning, index) => (
                        <div
                          key={index}
                          className="flex items-start gap-1.5 rounded border border-amber-200/40 bg-amber-500/5 px-2 py-1 text-[11px] text-amber-700 dark:border-amber-800/30 dark:text-amber-400"
                        >
                          <Icon name="alert-triangle" className="mt-px size-3 shrink-0" />
                          <span>{warning}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Approve / Reject buttons */}
                  <div className="flex items-center gap-2 pt-0.5">
                    <button
                      type="button"
                      onClick={() => toolCallId && onApprove?.(toolCallId)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium",
                        "bg-emerald-600/90 text-white shadow-sm",
                        "hover:bg-emerald-600 active:bg-emerald-700",
                        "dark:bg-emerald-500/80 dark:hover:bg-emerald-500 dark:active:bg-emerald-600",
                        "transition-[background,transform] duration-100 ease-out active:scale-[0.97]",
                      )}
                    >
                      <Icon name="check" className="size-3" />
                      Approve
                      <Kbd className="ml-1 h-4 min-w-4 bg-white/15 text-white/70 dark:bg-white/10 dark:text-white/60">↵</Kbd>
                    </button>
                    <button
                      type="button"
                      onClick={() => toolCallId && onReject?.(toolCallId)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium",
                        "border border-border/50 bg-background text-muted-foreground",
                        "hover:bg-muted/60 hover:text-foreground",
                        "dark:hover:bg-muted/40",
                        "transition-[background,color,transform] duration-100 ease-out active:scale-[0.97]",
                      )}
                    >
                      <Icon name="x" className="size-3" />
                      Reject
                      <Kbd className="ml-1 h-4 min-w-4 bg-muted/60 text-muted-foreground/60">⎋</Kbd>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </CollapsibleContent>
        )}
      </Collapsible>
    </div>
  );
}
