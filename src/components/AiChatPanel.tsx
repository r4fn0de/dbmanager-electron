/**
 * AiChatPanel — sidebar panel for conversational AI chat.
 *
 * Embedded in the SQL Editor view as a collapsible side panel.
 * Uses the useAiChat hook to manage streaming chat over Electron IPC.
 */
import {
  Bot,
  Code2,
  Loader2,
  PanelRight,
  Send,
  Square,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CodeBlock, CodeBlockCode } from "@/components/ui/code-block";
import {
  Message,
  MessageContent,
} from "@/components/ui/message";
import {
  PromptInput,
  PromptInputActions,
  PromptInputTextarea,
} from "@/components/ui/prompt-input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAiChat, type AiChatMessage } from "@/hooks/useAiChat";
import { cn } from "@/utils/tailwind";
import type { DatabaseType } from "@/ipc/db/types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface AiChatPanelProps {
  /** Active connection ID */
  connectionId: string | null;
  /** Database engine type */
  dbType: DatabaseType;
  /** Optional schema context (table/column names) */
  schemaContext?: string;
  /** Compact preview of what editor context will be sent to AI */
  contextPreview?: {
    connectionLabel: string;
    dbType: DatabaseType;
    selectionPreview?: string;
    errorPreview?: string;
  };
  /** Whether the panel is visible */
  isOpen: boolean;
  /** Callback to insert SQL into the editor */
  onInsertSql?: (sql: string) => void;
  /** Callback when panel is closed */
  onClose?: () => void;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ToolCallBadge({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary leading-none">
      <Wrench className="size-2.5" />
      {name}
    </span>
  );
}

function ChatMessage({
  message,
  codeTheme,
  onInsertSql,
}: {
  message: AiChatMessage;
  codeTheme: string;
  onInsertSql?: (sql: string) => void;
}) {
  const isUser = message.role === "user";

  // ── User message: right-aligned, no avatar ──
  if (isUser) {
    return (
      <Message className="group/msg w-full px-3 py-2 flex justify-end">
        <div className="flex max-w-[85%] min-w-0 flex-col items-end">
          {(message.contextSnapshot?.selectionPreview || message.contextSnapshot?.errorPreview) && (
            <div className="mb-1.5 flex w-full justify-end">
              {message.contextSnapshot?.selectionPreview && (
                <div className="inline-flex w-[182px] max-w-full min-h-[52px] cursor-default items-center gap-2 rounded-lg bg-background/70 px-2 py-1.5 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-200">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded bg-foreground/10 text-[10px] font-semibold text-foreground">
                    AI
                  </span>
                  <div className="min-w-0 overflow-hidden">
                    <p className="truncate text-[12px] font-medium text-foreground">
                      {message.contextSnapshot.selectionPreview}
                    </p>
                    <p className="text-[11px] text-muted-foreground">Selected Text</p>
                  </div>
                </div>
              )}
              {!message.contextSnapshot?.selectionPreview && message.contextSnapshot?.errorPreview && (
                <div className="inline-flex max-w-full cursor-default items-center gap-2 rounded-lg bg-amber-500/10 px-2 py-1 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-200">
                  <Code2 className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                  <div className="min-w-0">
                    <p className="truncate text-[12px] text-amber-700 dark:text-amber-300">
                      {message.contextSnapshot.errorPreview}
                    </p>
                    <p className="text-[11px] text-amber-600/80 dark:text-amber-400/80">Last Error</p>
                  </div>
                </div>
              )}
            </div>
          )}
          {message.content && (
            <p className="text-sm leading-relaxed whitespace-pre-wrap break-words rounded-lg bg-muted/40 px-3 py-2">
              {message.content}
            </p>
          )}
        </div>
      </Message>
    );
  }

  // ── Assistant message: left-aligned ──
  const contentParts = parseAssistantContent(message.content);

  return (
    <Message className="group/msg w-full px-3 py-2">
      <div className="min-w-0 flex flex-col gap-1.5">
          {/* Tool calls */}
          {message.toolCalls && message.toolCalls.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {message.toolCalls.map((tc, i) => (
                <ToolCallBadge key={`${tc.toolName}-${i}`} name={tc.toolName} />
              ))}
            </div>
          )}

          {/* Message content (text + code blocks) */}
          {contentParts.length > 0 && (
            <div className="space-y-2">
              {contentParts.map((part, index) =>
                part.type === "text" ? (
                  <MessageContent
                    key={`text-${index}`}
                    markdown
                    className="!bg-transparent !p-0 text-sm leading-relaxed break-words"
                  >
                    {part.content}
                  </MessageContent>
                ) : (
                  <div key={`code-${index}`} className="group/sql relative">
                    <CodeBlock>
                      <CodeBlockCode
                        code={part.code}
                        language={part.language || "sql"}
                        theme={codeTheme}
                      />
                    </CodeBlock>
                    {onInsertSql && !message.isStreaming && (
                      <Button
                        variant="ghost"
                        size="xs"
                        className="absolute top-1 right-1 opacity-0 transition-all duration-150 ease-out group-hover/sql:opacity-100 active:scale-[0.97]"
                        onClick={() => onInsertSql(part.code)}
                      >
                        Insert
                      </Button>
                    )}
                  </div>
                ),
              )}
            </div>
          )}

          {/* Streaming indicator */}
          {message.isStreaming && !message.content && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              Thinking…
            </div>
          )}

        </div>
    </Message>
  );
}

// ---------------------------------------------------------------------------
// Extract SQL code blocks from markdown
// ---------------------------------------------------------------------------

type AssistantContentPart =
  | { type: "text"; content: string }
  | { type: "code"; code: string; language?: string };

function parseAssistantContent(content: string): AssistantContentPart[] {
  if (!content) return [];

  const parts: AssistantContentPart[] = [];
  const fenceRegex = /```([\w-]+)?\s*\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = fenceRegex.exec(content)) !== null) {
    const [fullMatch, language, code] = match;
    const start = match.index;

    if (start > lastIndex) {
      const textChunk = content.slice(lastIndex, start).trim();
      if (textChunk) {
        parts.push({ type: "text", content: textChunk });
      }
    }

    const normalizedCode = code?.trim() ?? "";
    if (normalizedCode) {
      parts.push({
        type: "code",
        code: normalizedCode,
        language: language?.trim() || undefined,
      });
    }

    lastIndex = start + fullMatch.length;
  }

  if (lastIndex < content.length) {
    const trailing = content.slice(lastIndex).trim();
    if (trailing) {
      parts.push({ type: "text", content: trailing });
    }
  }

  if (parts.length === 0) {
    parts.push({ type: "text", content });
  }

  return parts;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AiChatPanel({
  connectionId,
  dbType,
  schemaContext,
  contextPreview,
  isOpen,
  onInsertSql,
  onClose,
}: AiChatPanelProps) {
  const { resolvedTheme } = useTheme();
  const codeTheme = resolvedTheme === "dark" ? "github-dark" : "github-light";

  const { messages, isLoading, error, sendMessage, abort, clearMessages } =
    useAiChat({
      connectionId,
      dbType,
      schemaContext,
    });

  const [input, setInput] = useState("");
  const [dismissedContext, setDismissedContext] = useState<{
    selection: boolean;
    error: boolean;
  }>({ selection: false, error: false });
  const [selectionTrend, setSelectionTrend] = useState<"grow" | "shrink" | null>(null);
  const [exitingContext, setExitingContext] = useState<{
    selection: boolean;
    error: boolean;
  }>({ selection: false, error: false });
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const contextDismissTimeoutsRef = useRef<{
    selection?: ReturnType<typeof setTimeout>;
    error?: ReturnType<typeof setTimeout>;
  }>({});
  const selectionTrendTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevSelectionLengthRef = useRef(0);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  useEffect(() => {
    setDismissedContext({ selection: false, error: false });
    setExitingContext({ selection: false, error: false });
  }, [contextPreview?.selectionPreview, contextPreview?.errorPreview]);

  useEffect(() => {
    const nextLength = contextPreview?.selectionPreview?.length ?? 0;
    const prevLength = prevSelectionLengthRef.current;
    prevSelectionLengthRef.current = nextLength;

    if (!contextPreview?.selectionPreview || dismissedContext.selection) {
      setSelectionTrend(null);
      return;
    }

    if (nextLength > prevLength) {
      setSelectionTrend("grow");
    } else if (nextLength < prevLength) {
      setSelectionTrend("shrink");
    } else {
      return;
    }

    if (selectionTrendTimeoutRef.current) {
      clearTimeout(selectionTrendTimeoutRef.current);
    }
    selectionTrendTimeoutRef.current = setTimeout(() => {
      setSelectionTrend(null);
      selectionTrendTimeoutRef.current = null;
    }, 220);
  }, [contextPreview?.selectionPreview, dismissedContext.selection]);

  useEffect(() => {
    return () => {
      if (contextDismissTimeoutsRef.current.selection) {
        clearTimeout(contextDismissTimeoutsRef.current.selection);
      }
      if (contextDismissTimeoutsRef.current.error) {
        clearTimeout(contextDismissTimeoutsRef.current.error);
      }
      if (selectionTrendTimeoutRef.current) {
        clearTimeout(selectionTrendTimeoutRef.current);
      }
    };
  }, []);

  const showSelectionContextChip = Boolean(
    contextPreview?.selectionPreview && !dismissedContext.selection,
  );
  const showErrorContextChip = Boolean(
    contextPreview?.errorPreview && !dismissedContext.error,
  );

  const handleSubmit = useCallback(() => {
    if (!input.trim() || isLoading) return;
    const contextSnapshot = {
      selectionPreview:
        showSelectionContextChip && contextPreview?.selectionPreview
          ? contextPreview.selectionPreview
          : undefined,
      errorPreview:
        showErrorContextChip && contextPreview?.errorPreview
          ? contextPreview.errorPreview
          : undefined,
    };

    if (showSelectionContextChip) {
      setExitingContext((prev) => ({ ...prev, selection: true }));
    }
    if (showErrorContextChip) {
      setExitingContext((prev) => ({ ...prev, error: true }));
    }
    if (showSelectionContextChip || showErrorContextChip) {
      setTimeout(() => {
        if (showSelectionContextChip) {
          setDismissedContext((prev) => ({ ...prev, selection: true }));
          setExitingContext((prev) => ({ ...prev, selection: false }));
        }
        if (showErrorContextChip) {
          setDismissedContext((prev) => ({ ...prev, error: true }));
          setExitingContext((prev) => ({ ...prev, error: false }));
        }
      }, 170);
    }

    sendMessage(input.trim(), {
      contextSnapshot:
        contextSnapshot.selectionPreview || contextSnapshot.errorPreview
          ? contextSnapshot
          : undefined,
    });
    setInput("");
  }, [
    input,
    isLoading,
    sendMessage,
    showSelectionContextChip,
    showErrorContextChip,
    contextPreview?.selectionPreview,
    contextPreview?.errorPreview,
  ]);

  const handleDismissContextChip = useCallback((kind: "selection" | "error") => {
    setExitingContext((prev) => ({ ...prev, [kind]: true }));
    const existing = contextDismissTimeoutsRef.current[kind];
    if (existing) clearTimeout(existing);
    contextDismissTimeoutsRef.current[kind] = setTimeout(() => {
      setDismissedContext((prev) => ({ ...prev, [kind]: true }));
      setExitingContext((prev) => ({ ...prev, [kind]: false }));
      contextDismissTimeoutsRef.current[kind] = undefined;
    }, 180);
  }, []);

  if (!isOpen) return null;

  const isEmpty = messages.length === 0;

  return (
    <div
      className={cn(
        "flex h-full flex-col bg-background",
        "motion-safe:animate-in motion-safe:slide-in-from-right-full",
        "motion-safe:duration-200 motion-safe:ease-out"
      )}
      style={{ width: "100%" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 h-9 border-b border-border/50 shrink-0">
        <div className="flex items-center gap-2">
          <Bot className="size-3.5 text-primary" />
          <span className="text-xs font-semibold tracking-tight">AI Chat</span>
        </div>
        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={clearMessages}
                  disabled={isEmpty}
                  className="text-muted-foreground hover:text-foreground transition-transform duration-150 ease-out active:scale-[0.97]"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              }
            />
            <TooltipContent>Clear chat</TooltipContent>
          </Tooltip>
          {onClose && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={onClose}
                    className="text-muted-foreground hover:text-foreground transition-transform duration-150 ease-out active:scale-[0.97]"
                  >
                    <PanelRight className="size-3.5" />
                  </Button>
                }
              />
              <TooltipContent>Close panel</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center h-full px-6 py-8 gap-4">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
              <Bot className="size-5 text-primary" />
            </div>
            <div className="text-center space-y-1">
              <p className="text-sm font-medium">AI SQL Assistant</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Ask about your database schema, generate queries, or fix errors.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-1.5 mt-1">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => sendMessage(s)}
                  className="rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground transition-colors duration-150 active:scale-[0.97]"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div>
            {messages.map((msg) => (
              <ChatMessage
                key={msg.id}
                message={msg}
                codeTheme={codeTheme}
                onInsertSql={onInsertSql}
              />
            ))}
          </div>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-3 mb-2 rounded-md border border-red-500/20 bg-red-500/5 px-2.5 py-1.5 text-xs text-red-600 dark:text-red-400 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 motion-safe:duration-150">
          {error}
        </div>
      )}

      {/* Input */}
      <div className="px-3 py-2 shrink-0">
        <PromptInput
          value={input}
          onValueChange={setInput}
          onSubmit={handleSubmit}
          isLoading={isLoading}
          disabled={!connectionId}
          className="rounded-md border border-border bg-muted/40 p-2 shadow-none"
        >
          {contextPreview && (showSelectionContextChip || showErrorContextChip) && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {showSelectionContextChip && (
                <div
                  className={cn(
                    "group/ctx relative inline-flex w-[182px] max-w-full min-h-[52px] cursor-default items-center gap-2 rounded-lg bg-background/70 px-2 py-1.5 transition-all duration-200 [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]",
                    exitingContext.selection && "-translate-y-1 scale-[0.98] opacity-0",
                    selectionTrend === "grow" && "scale-[1.015]",
                    selectionTrend === "shrink" && "scale-[0.995] opacity-95",
                  )}
                >
                  <span className="flex size-5 shrink-0 items-center justify-center rounded bg-foreground/10 text-[10px] font-semibold text-foreground">
                    AI
                  </span>
                  <div className="min-w-0 overflow-hidden">
                    <p
                      key={contextPreview.selectionPreview}
                      className="truncate text-[12px] font-medium text-foreground motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-200"
                    >
                      {contextPreview.selectionPreview}
                    </p>
                    <p className="text-[11px] text-muted-foreground">Selected Text</p>
                  </div>
                  <button
                    type="button"
                    aria-label="Remove selected text context"
                    className="absolute -right-2 -top-2 rounded-full border border-border/60 bg-background p-0.5 text-muted-foreground opacity-0 shadow-sm transition-all duration-150 ease-out hover:text-foreground group-hover/ctx:opacity-100"
                    onClick={() => handleDismissContextChip("selection")}
                  >
                    <X className="size-3" />
                  </button>
                </div>
              )}
              {showErrorContextChip && (
                <div
                  className={cn(
                    "group/ctx relative inline-flex max-w-full cursor-default items-center gap-2 rounded-lg bg-amber-500/10 px-2 py-1 transition-all duration-200 [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]",
                    exitingContext.error && "-translate-y-1 scale-[0.98] opacity-0",
                  )}
                >
                  <Code2 className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                  <div className="min-w-0">
                    <p
                      key={contextPreview.errorPreview}
                      className="truncate text-[12px] text-amber-700 dark:text-amber-300 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-200"
                    >
                      {contextPreview.errorPreview}
                    </p>
                    <p className="text-[11px] text-amber-600/80 dark:text-amber-400/80">Last Error</p>
                  </div>
                  <button
                    type="button"
                    aria-label="Remove error context"
                    className="absolute -right-2 -top-2 rounded-full border border-amber-400/35 bg-background p-0.5 text-amber-700/70 opacity-0 shadow-sm transition-all duration-150 ease-out hover:text-amber-900 group-hover/ctx:opacity-100 dark:text-amber-300/80 dark:hover:text-amber-200"
                    onClick={() => handleDismissContextChip("error")}
                  >
                    <X className="size-3" />
                  </button>
                </div>
              )}
            </div>
          )}
          <PromptInputTextarea
            ref={inputRef}
            placeholder={
              connectionId
                ? "Ask about your database…"
                : "Select a connection first"
            }
            className="max-h-[250px] min-h-[72px] overflow-y-auto p-2 text-sm dark:bg-transparent"
          />
          <PromptInputActions className="justify-end gap-2 px-2 pb-2">
            {isLoading ? (
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={abort}
                className="gap-1.5"
              >
                <Square className="size-3" />
                Stop
              </Button>
            ) : (
              <Button
                type="button"
                size="xs"
                onClick={handleSubmit}
                disabled={!input.trim() || !connectionId}
                className="gap-1.5"
              >
                Send
                <Send className="size-3" />
              </Button>
            )}
          </PromptInputActions>
        </PromptInput>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Suggestion chips for empty state
// ---------------------------------------------------------------------------

const SUGGESTIONS = [
  "Show me all tables",
  "Write a query to find recent users",
  "Explain this schema",
  "Help me optimize a query",
] as const;
