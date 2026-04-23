"use no memo"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/utils/tailwind";
import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type ChatToolPart = {
  type: string;
  state:
    | "input-streaming"
    | "input-available"
    | "output-available"
    | "output-error";
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  toolCallId?: string;
  errorText?: string;
};

export type ChatToolProps = {
  toolPart: ChatToolPart;
  defaultOpen?: boolean;
  className?: string;
};

/** Tiny status dot — pulses when running, colored by state otherwise. */
function StatusDot({ state }: { state: ChatToolPart["state"] }) {
  const dotColor = {
    "input-streaming": "bg-blue-500",
    "input-available": "bg-orange-400",
    "output-available": "bg-emerald-500 dark:bg-emerald-400",
    "output-error": "bg-red-500 dark:bg-red-400",
  }[state] ?? "bg-muted-foreground";

  return (
    <span className="relative flex size-1.5 shrink-0">
      {state === "input-streaming" && (
        <span
          className={cn(
            "absolute inline-flex size-full animate-ping rounded-full opacity-40",
            dotColor,
            "[animation-duration:1.5s] [animation-timing-function:cubic-bezier(0,0,0.2,1)]",
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
  }[state];
  if (!label) return null;
  return (
    <span className="text-[10px] text-muted-foreground/70">{label}</span>
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
export function ChatTool({ toolPart, defaultOpen = true, className }: ChatToolProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const { state, input, output, errorText } = toolPart;

  const hasInput = input && Object.keys(input).length > 0;
  const hasOutput = output !== undefined && output !== null;
  const hasExpandableContent = hasInput || hasOutput || (state === "output-error" && errorText);

  // Auto-open collapsible when expandable content first appears (tool result arrives)
  const hadExpandableRef = useRef(hasExpandableContent);
  useEffect(() => {
    if (hasExpandableContent && !hadExpandableRef.current) {
      setIsOpen(true);
    }
    hadExpandableRef.current = hasExpandableContent;
  }, [hasExpandableContent]);

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
            <ChevronDown
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
                    <pre className="whitespace-pre-wrap break-words text-foreground/80">
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
            </div>
          </CollapsibleContent>
        )}
      </Collapsible>
    </div>
  );
}
