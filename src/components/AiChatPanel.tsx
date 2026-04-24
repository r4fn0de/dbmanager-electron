/**
 * AiChatPanel — sidebar panel for conversational AI chat.
 *
 * Embedded in the SQL Editor view as a collapsible side panel.
 * Uses the useAiChat hook to manage streaming chat over Electron IPC.
 */
import {
  Bot,
  Check,
  ChevronDown,
  Code2,
  Copy,
  Lightbulb,
  PanelRight,
  Plus,
  Search,
  Send,
  Square,
  Table2,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { motion } from "motion/react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Reasoning,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { useTheme } from "next-themes";
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { StickToBottomContext } from "use-stick-to-bottom";
import { Button } from "@/components/ui/button";
import { CodeBlockCode } from "@/components/ui/code-block";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Message,
  MessageAction,
  MessageContent,
  MessageResponse,
  MessageToolbar,
} from "@/components/ai-elements/message";
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
import { useAiChat, type AiChatMessage, type TextPart, type ToolInvocationPart } from "@/hooks/useAiChat";
import { useMessageFeedback } from "@/hooks/useAiFeedback";
import { FeedbackBar } from "@/components/ui/feedback-bar";
import { ChatTool, type ChatToolPart } from "@/components/ai-elements/tool";
import { ChatTable } from "@/components/ai-elements/chat-table";
import { cn } from "@/utils/tailwind";
import type { DatabaseType } from "@/ipc/db/types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface AiChatPanelProps {
  /** Active connection ID (optional in global mode) */
  connectionId: string | null;
  /** Active connection display label */
  connectionLabel?: string;
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
  /** Additional className for the root element (layout positioning) */
  className?: string;
  /** Callback to insert SQL into the editor */
  onInsertSql?: (sql: string) => void;
  /** Callback when panel is closed */
  onClose?: () => void;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

type ToolCallLike = ToolInvocationPart["toolInvocation"];

/**
 * Enhanced code block for assistant messages.
 * Adds language label, copy button, and optional Insert SQL button.
 */
function AssistantCodeBlock({
  code,
  language,
  codeTheme,
  onInsertSql,
  isStreaming,
}: {
  code: string;
  language?: string;
  codeTheme: string;
  onInsertSql?: (sql: string) => void;
  isStreaming?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const displayLang = language?.trim() || "sql";
  const isSqlLike = /^(sql|postgres|postgresql|mysql|mariadb|sqlite|clickhouse)$/i.test(displayLang);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <div className="group/code relative rounded-lg border border-border/40 bg-background/60 backdrop-blur-sm">
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-border/30 bg-muted/30 px-3 py-1">
        <span className="text-[11px] font-medium text-muted-foreground/80">{displayLang}</span>
        <div className="flex items-center gap-1 opacity-0 transition-opacity duration-150 ease-out group-hover/code:opacity-100 group-focus-within/code:opacity-100">
          <MessageAction
            tooltip={copied ? "Copied" : "Copy code"}
            label={copied ? "Copied" : "Copy code"}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(code);
                setCopied(true);
              } catch {
                // Ignore copy failures.
              }
            }}
          >
            {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          </MessageAction>
          {!isStreaming && isSqlLike && onInsertSql && (
            <MessageAction
              tooltip="Insert SQL"
              label="Insert SQL"
              onClick={() => onInsertSql(code)}
            >
              <Code2 className="size-3" />
            </MessageAction>
          )}
        </div>
      </div>
      {/* Code content */}
      <div className="w-full overflow-x-auto text-[13px]">
        <CodeBlockCode
          code={code}
          language={language || "sql"}
          theme={codeTheme}
          className="[&>pre]:!rounded-none [&>pre]:!m-0 [&>pre]:px-4 [&>pre]:py-3"
        />
      </div>
    </div>
  );
}

/**
 * Extract a SQL snippet from a tool invocation result or args.
 * Used to power the "Insert SQL from tool" button.
 */
function extractSqlSnippet(value: unknown): string | null {
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return null;
    const lowered = text.toLowerCase();
    if (
      lowered.includes("select ")
      || lowered.includes("insert ")
      || lowered.includes("update ")
      || lowered.includes("delete ")
      || lowered.includes("create ")
      || lowered.includes("alter ")
      || lowered.includes("drop ")
      || lowered.includes("with ")
    ) {
      return text;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;

  const record = value as Record<string, unknown>;
  for (const key of ["sql", "query", "statement", "ddl", "command"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}

function getToolStatus(invocation: ToolCallLike): "running" | "success" | "error" {
  if (invocation.state === "call") return "running";
  if (invocation.result && typeof invocation.result === "object") {
    const result = invocation.result as Record<string, unknown>;
    if (typeof result.error === "string" && result.error.trim()) return "error";
    if (result.success === false || result.ok === false) return "error";
  }
  return "success";
}

/**
 * Maps a ToolInvocationPart to the ChatTool component's ChatToolPart shape.
 */
function toChatToolPart(invocation: ToolCallLike): ChatToolPart {
  const status = getToolStatus(invocation);

  // Extract error text from result if applicable
  let errorText: string | undefined;
  if (status === "error" && invocation.result && typeof invocation.result === "object") {
    const result = invocation.result as Record<string, unknown>;
    errorText = typeof result.error === "string" ? result.error : undefined;
  }

  // Map invocation state → ChatToolPart state
  const state: ChatToolPart["state"] =
    invocation.state === "call" ? "input-streaming"
    : invocation.state === "partial-call" ? "input-available"
    : status === "error" ? "output-error"
    : "output-available";

  // Safely cast args/output to Record<string, unknown>
  const input = (invocation.args && typeof invocation.args === "object")
    ? invocation.args as Record<string, unknown>
    : undefined;
  const output = (invocation.result !== undefined && invocation.result !== null)
    ? typeof invocation.result === "object"
      ? invocation.result as Record<string, unknown>
      : { result: invocation.result }
    : undefined;

  return {
    type: invocation.toolName,
    state,
    input,
    output,
    toolCallId: invocation.toolCallId,
    errorText,
  };
}

/** Shared typography className for assistant prose content. */
const ASSISTANT_PROSE_CLASS =
  "!w-full !max-w-none !bg-transparent !p-0 text-[14.5px] leading-7 break-words text-zinc-800 dark:text-zinc-200 [&_a]:font-medium [&_a]:text-primary [&_a]:underline-offset-4 [&_a]:hover:underline [&_blockquote]:border-l-2 [&_blockquote]:border-muted-foreground/30 [&_blockquote]:pl-4 [&_blockquote]:italic [&_code]:rounded-md [&_code]:border [&_code]:border-zinc-300/80 [&_code]:bg-zinc-100/80 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.88em] [&_code]:text-zinc-900 [&_code]:dark:border-zinc-700/80 [&_code]:dark:bg-zinc-800/80 [&_code]:dark:text-zinc-100 [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:mt-6 [&_h1]:mb-3 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-5 [&_h2]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-2 [&_hr]:border-muted-foreground/20 [&_hr]:my-4 [&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:leading-7 [&_p+p]:mt-3 [&_strong]:font-semibold [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5";

function AiMessageFeedback({
  message,
  connectionId,
  conversationId,
}: {
  message: AiChatMessage;
  connectionId: string | null;
  conversationId: string;
}) {
  const dismissStorageKey = `ai-feedback-dismissed:${conversationId}:${message.id}`;
  const [isDismissed, setIsDismissed] = useState(() => {
    try {
      return localStorage.getItem(dismissStorageKey) === "1";
    } catch {
      return false;
    }
  });
  const [localRating, setLocalRating] = useState<"positive" | "negative" | null>(null);
  const [isLoadingExistingFeedback, setIsLoadingExistingFeedback] = useState(true);

  const prompt = message.parts
    ?.filter((p): p is TextPart => p.type === "text")
    .map((p) => p.text)
    .join(" ") ?? "";

  const response = message.content ?? "";

  const { rating, toggleFeedback, loadFeedback } = useMessageFeedback(
    conversationId,
    message.id,
    prompt,
    response,
    connectionId ?? undefined,
  );

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        await loadFeedback();
      } finally {
        if (!cancelled) {
          setIsLoadingExistingFeedback(false);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [loadFeedback]);

  const handleFeedback = useCallback((newRating: "positive" | "negative") => {
    // Optimistic UI: update immediately so the user sees feedback
    setLocalRating(newRating);

    // Fire-and-forget IPC call
    toggleFeedback(newRating).catch(() => {
      // Revert on failure
      setLocalRating(null);
    });
  }, [toggleFeedback]);

  const activeRating = localRating ?? rating;

  if (isLoadingExistingFeedback && !localRating) {
    return null;
  }

  if (activeRating) {
    return (
      <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
        {activeRating === "positive" ? (
          <>
            <ThumbsUp className="h-3 w-3 text-green-600" />
            <span>Thanks for the feedback!</span>
          </>
        ) : activeRating === "negative" ? (
          <>
            <ThumbsDown className="h-3 w-3 text-red-600" />
            <span>Thanks for the feedback!</span>
          </>
        ) : null}
      </div>
    );
  }

  if (isDismissed) {
    return null;
  }

  return (
    <div className="mt-2 flex justify-start">
      <FeedbackBar
        title="Was this helpful?"
        onHelpful={() => handleFeedback("positive")}
        onNotHelpful={() => handleFeedback("negative")}
        onClose={() => {
          setIsDismissed(true);
          try {
            localStorage.setItem(dismissStorageKey, "1");
          } catch {
            // Ignore localStorage failures.
          }
        }}
        className="scale-90 origin-left"
      />
    </div>
  );
}

function ChatMessage({
  message,
  codeTheme,
  onInsertSql,
  connectionId,
  conversationId,
}: {
  message: AiChatMessage;
  codeTheme: string;
  onInsertSql?: (sql: string) => void;
  connectionId: string | null;
  conversationId: string;
}) {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => {
      setCopied(false);
    }, 1200);
    return () => clearTimeout(timer);
  }, [copied]);

  const handleCopyMessage = useCallback(async () => {
    if (!message.content) return;
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
    } catch {
      // Ignore copy failures (clipboard permissions/platform differences).
    }
  }, [message.content]);

  // ── User message: right-aligned, no avatar ──
  if (isUser) {
    return (
      <Message
        from="user"
        className="
          group/msg w-full max-w-full pl-3 pr-3 py-2
          motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2
          motion-safe:duration-200
        "
        style={{ animationTimingFunction: "cubic-bezier(0.23,1,0.32,1)" }}
      >
        <div className="ml-auto flex max-w-[72%] min-w-0 flex-col items-end">
          {(message.contextSnapshot?.selectionPreview || message.contextSnapshot?.errorPreview) && (
            <div className="mb-1.5 flex w-full justify-end">
              {message.contextSnapshot?.selectionPreview && (
                <div
                  className="
                    inline-flex w-[182px] max-w-full min-h-[52px] cursor-default
                    items-center gap-2 rounded-lg bg-background/70 px-2 py-1.5
                    motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1
                    motion-safe:duration-200
                  "
                  style={{ animationTimingFunction: "cubic-bezier(0.23,1,0.32,1)" }}
                >
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
                <div
                  className="
                    inline-flex max-w-full cursor-default items-center gap-2
                    rounded-lg bg-amber-500/10 px-2 py-1
                    motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1
                    motion-safe:duration-200
                  "
                  style={{ animationTimingFunction: "cubic-bezier(0.23,1,0.32,1)" }}
                >
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
          {/* Light-mode visual spec documented in docs/ai-chat-visual-style.md */}
          {message.content && (
            <p
              className="
                text-[14px] leading-6 whitespace-pre-wrap break-words rounded-xl
                border border-zinc-300/70 bg-zinc-200/85 px-2 py-2 text-zinc-900
                shadow-[0_1px_0_rgba(255,255,255,0.45)_inset] backdrop-blur-sm
                dark:border-zinc-700/70 dark:bg-zinc-800/85 dark:text-zinc-100
                dark:shadow-[0_1px_0_rgba(255,255,255,0.05)_inset]
                motion-safe:animate-in motion-safe:zoom-in-95
                motion-safe:duration-200
              "
              style={{ animationTimingFunction: "cubic-bezier(0.23,1,0.32,1)" }}
            >
              {message.content}
            </p>
          )}
        </div>
      </Message>
    );
  }

  // ── Assistant message: left-aligned, parts-based rendering in order ──
  const parts = message.parts ?? [];

  // Find first SQL code block across all text parts for the toolbar button
  const firstSqlBlock = parts
    .filter((p): p is TextPart => p.type === "text")
    .flatMap((tp) => splitTextIntoSegments(tp.text))
    .find((seg) => seg.type === "code");

  // Group consecutive tool-invocation parts into a single collapsible section
  // while rendering text parts in their original interleaved order.
  const renderedParts: Array<{
    kind: "text-segments" | "tool-group";
    segments?: TextSegment[];
    invocations?: ToolInvocationPart[];
  }> = [];

  let pendingTools: ToolInvocationPart[] = [];
  for (const part of parts) {
    if (part.type === "tool-invocation") {
      pendingTools.push(part);
    } else {
      // Flush any accumulated tool invocations before rendering text
      if (pendingTools.length > 0) {
        renderedParts.push({ kind: "tool-group", invocations: [...pendingTools] });
        pendingTools = [];
      }
      const segments = splitTextIntoSegments(part.text);
      if (segments.length > 0) {
        renderedParts.push({ kind: "text-segments", segments });
      }
    }
  }
  // Flush any remaining tool invocations at the end
  if (pendingTools.length > 0) {
    renderedParts.push({ kind: "tool-group", invocations: [...pendingTools] });
  }

  const hasContent = renderedParts.length > 0;

  return (
    <Message
      from="assistant"
      className="
        group/msg w-full max-w-full pl-1 pr-2 py-2
        motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1
        motion-safe:duration-250
      "
      style={{ animationTimingFunction: "cubic-bezier(0.23,1,0.32,1)" }}
    >
      <div className="min-w-0 flex flex-col gap-1.5">
          {/* Render parts in their original interleaved order */}
          {hasContent && (
            <div className="space-y-3">
              {renderedParts.map((block, blockIndex) =>
                block.kind === "tool-group" ? (
                  <div key={`tools-${blockIndex}`} className="space-y-2">
                    {block.invocations!.map((tip) => {
                      const chatToolPart = toChatToolPart(tip.toolInvocation);
                      const sqlFromTool = extractSqlSnippet(tip.toolInvocation.result) ?? extractSqlSnippet(tip.toolInvocation.args);
                      return (
                        <div key={tip.toolInvocation.toolCallId}>
                          <ChatTool
                            toolPart={chatToolPart}
                            defaultOpen
                            className="mt-1"
                          />
                          {sqlFromTool && onInsertSql && tip.toolInvocation.state === "result" && (
                            <MessageAction
                              tooltip="Insert SQL from tool"
                              label="Insert SQL"
                              onClick={() => onInsertSql(sqlFromTool)}
                              className="mt-1 ml-1"
                            >
                              <Code2 className="size-3.5" />
                            </MessageAction>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <Fragment key={`text-${blockIndex}`}>
                    {block.segments!.map((seg, segIndex) =>
                      seg.type === "text" ? (
                        <MessageContent
                          key={`seg-${segIndex}`}
                          className={ASSISTANT_PROSE_CLASS}
                        >
                          <MessageResponse isStreaming={message.isStreaming}>{seg.content}</MessageResponse>
                        </MessageContent>
                      ) : seg.type === "code" ? (
                        <AssistantCodeBlock
                          key={`seg-${segIndex}`}
                          code={seg.code}
                          language={seg.language}
                          codeTheme={codeTheme}
                          onInsertSql={onInsertSql}
                          isStreaming={message.isStreaming}
                        />
                      ) : (
                        <ChatTable
                          key={`seg-${segIndex}`}
                          markdown={seg.markdown}
                          isStreaming={message.isStreaming}
                          className="my-1"
                        />
                      ),
                    )}
                  </Fragment>
                ),
              )}
            </div>
          )}

          {!message.isStreaming && (message.content || firstSqlBlock) && (
            <MessageToolbar className="mt-0 justify-start gap-1.5">
              <MessageAction
                tooltip={copied ? "Copied" : "Copy response"}
                label={copied ? "Copied" : "Copy response"}
                onClick={handleCopyMessage}
                disabled={!message.content}
              >
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              </MessageAction>
              <MessageAction
                tooltip="Insert first SQL block"
                label="Insert first SQL block"
                onClick={() => {
                  if (firstSqlBlock?.type === "code" && onInsertSql) {
                    onInsertSql(firstSqlBlock.code);
                  }
                }}
                disabled={!onInsertSql || !firstSqlBlock}
              >
                <Code2 className="size-3.5" />
              </MessageAction>
            </MessageToolbar>
          )}

          {/* Feedback buttons for completed assistant messages */}
          {!message.isStreaming && message.role === "assistant" && !isUser && (
            <AiMessageFeedback
              message={message}
              connectionId={connectionId}
              conversationId={conversationId}
            />
          )}

          {/* Thinking indicator — ai-elements Reasoning, minimal style */}
          {message.isStreaming && !message.content && (
            <Reasoning isStreaming className="!mb-0 px-3">
              <ReasoningTrigger className="gap-1.5 py-1 text-xs">
                <span className="relative flex size-1.5">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/40 [animation-duration:1.5s] [animation-timing-function:cubic-bezier(0,0,0.2,1)]" />
                  <span className="inline-flex size-1.5 rounded-full bg-primary" />
                </span>
                <Shimmer
                  as="span"
                  className="text-xs font-medium"
                  duration={1.8}
                  spread={1.4}
                >
                  Thinking…
                </Shimmer>
              </ReasoningTrigger>
            </Reasoning>
          )}
          {/* No-content fallback for completed/aborted messages */}
          {!message.isStreaming && !message.content && (
            <p className="px-3 text-xs text-muted-foreground">No response</p>
          )}

        </div>
    </Message>
  );
}

// ---------------------------------------------------------------------------
// Split a single text part into prose + fenced code segments
// ---------------------------------------------------------------------------

type TextSegment =
  | { type: "text"; content: string }
  | { type: "code"; code: string; language?: string }
  | { type: "table"; markdown: string };

/**
 * Splits the text content of a single TextPart into alternating
 * prose, fenced-code-block, and markdown-table segments for rendering.
 *
 * This replaces the old `parseAssistantContent` which operated on the
 * flat `message.content` string. Now each TextPart is split independently,
 * so tool-invocation parts are handled separately via the parts array.
 */
function splitTextIntoSegments(text: string): TextSegment[] {
  if (!text) return [];

  const segments: TextSegment[] = [];
  const fenceRegex = /```([\w-]+)?\s*\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  // First pass: extract fenced code blocks
  while ((match = fenceRegex.exec(text)) !== null) {
    const [fullMatch, language, code] = match;
    const start = match.index;

    if (start > lastIndex) {
      const prose = text.slice(lastIndex, start);
      pushProseSegments(segments, prose);
    }

    const normalizedCode = code?.trim() ?? "";
    if (normalizedCode) {
      segments.push({
        type: "code",
        code: normalizedCode,
        language: language?.trim() || undefined,
      });
    }

    lastIndex = start + fullMatch.length;
  }

  // Handle trailing text after last code fence
  if (lastIndex < text.length) {
    const trailing = text.slice(lastIndex);
    pushProseSegments(segments, trailing);
  }

  if (segments.length === 0) {
    segments.push({ type: "text", content: text });
  }

  return segments;
}

/**
 * Splits prose text into alternating text and markdown-table segments.
 * A markdown table is a block of consecutive lines starting with `|`.
 */
function pushProseSegments(segments: TextSegment[], raw: string): void {
  const trimmed = raw.trim();
  if (!trimmed) return;

  const lines = trimmed.split("\n");
  // Group consecutive |-prefixed lines into blocks.
  // A valid markdown table needs at least 2 lines (header + separator).
  // Single |-prefixed lines are kept as prose to avoid false positives.
  const blocks: Array<{ kind: "prose" | "table"; lines: string[] }> = [];
  let currentKind: "prose" | "table" | null = null;

  for (const line of lines) {
    const isTableLine = line.trimStart().startsWith("|");
    const kind = isTableLine ? "table" : "prose";

    if (kind !== currentKind) {
      blocks.push({ kind, lines: [line] });
      currentKind = kind;
    } else {
      blocks[blocks.length - 1].lines.push(line);
    }
  }

  for (const block of blocks) {
    const content = block.lines.join("\n");
    if (block.kind === "table" && block.lines.length >= 2) {
      segments.push({ type: "table", markdown: content });
    } else {
      const prose = content.trim();
      if (prose) {
        segments.push({ type: "text", content: prose });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AiChatPanel({
  connectionId,
  connectionLabel,
  dbType,
  schemaContext,
  contextPreview,
  isOpen,
  className,
  onInsertSql,
  onClose,
}: AiChatPanelProps) {
  const { resolvedTheme } = useTheme();
  const codeTheme = resolvedTheme === "dark" ? "github-dark" : "github-light";

  const {
    messages,
    conversations,
    activeConversationId,
    isLoading,
    error,
    sendMessage,
    abort,
    clearMessages,
    startNewConversation,
    selectConversation,
    deleteConversation,
    clearAllConversations,
  } = useAiChat({
    connectionId,
    dbType,
    connectionLabel,
    schemaContext,
  });

  const [input, setInput] = useState("");
  const [dismissedContext, setDismissedContext] = useState<{
    selection: boolean;
    error: boolean;
  }>({ selection: false, error: false });
  const [isTitleMorphing, setIsTitleMorphing] = useState(false);
  const [exitingContext, setExitingContext] = useState<{
    selection: boolean;
    error: boolean;
  }>({ selection: false, error: false });
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const conversationRef = useRef<StickToBottomContext | null>(null);
  const previousConversationIdRef = useRef<string | null>(null);
  const previousIsOpenRef = useRef(false);
  const contextDismissTimeoutsRef = useRef<{
    selection?: ReturnType<typeof setTimeout>;
    error?: ReturnType<typeof setTimeout>;
  }>({});
  const titleMorphTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousTitleRef = useRef<string | null>(null);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Ensure active conversation opens pinned to the latest message.
  useEffect(() => {
    const openedNow = isOpen && !previousIsOpenRef.current;
    const conversationChanged =
      isOpen && activeConversationId !== previousConversationIdRef.current;

    previousIsOpenRef.current = isOpen;
    previousConversationIdRef.current = activeConversationId;

    if (!isOpen || !activeConversationId || (!openedNow && !conversationChanged)) return;

    const t1 = setTimeout(() => {
      void conversationRef.current?.scrollToBottom();
    }, 0);
    const t2 = setTimeout(() => {
      void conversationRef.current?.scrollToBottom();
    }, 80);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [activeConversationId, isOpen]);

  useEffect(() => {
    setDismissedContext({ selection: false, error: false });
    setExitingContext({ selection: false, error: false });
  }, [contextPreview?.selectionPreview, contextPreview?.errorPreview]);

  useEffect(() => {
    return () => {
      if (contextDismissTimeoutsRef.current.selection) {
        clearTimeout(contextDismissTimeoutsRef.current.selection);
      }
      if (contextDismissTimeoutsRef.current.error) {
        clearTimeout(contextDismissTimeoutsRef.current.error);
      }
      if (titleMorphTimeoutRef.current) {
        clearTimeout(titleMorphTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const currentTitle =
      conversations.find((conversation) => conversation.id === activeConversationId)?.title
      ?? null;
    const previousTitle = previousTitleRef.current;
    previousTitleRef.current = currentTitle;

    if (!currentTitle || !previousTitle || currentTitle === previousTitle) return;

    setIsTitleMorphing(true);
    if (titleMorphTimeoutRef.current) {
      clearTimeout(titleMorphTimeoutRef.current);
    }
    titleMorphTimeoutRef.current = setTimeout(() => {
      setIsTitleMorphing(false);
      titleMorphTimeoutRef.current = null;
    }, 220);
  }, [activeConversationId, conversations]);

  const showSelectionContextChip = Boolean(
    contextPreview?.selectionPreview && !dismissedContext.selection,
  );
  const showErrorContextChip = Boolean(
    contextPreview?.errorPreview && !dismissedContext.error,
  );

  const handleInputChange = useCallback((value: string) => {
    setInput(value);
  }, []);

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

  const isEmpty = messages.length === 0;
  const hasActiveConnection = Boolean(connectionId);
  const currentConnectionLabel = contextPreview?.connectionLabel || connectionLabel || connectionId || "No connection";
  const activeConversation =
    conversations.find((conversation) => conversation.id === activeConversationId) ?? null;

  return (
    <motion.div
      className={cn("relative flex h-full flex-col overflow-hidden rounded-b-md bg-transparent", className)}
      style={{ width: "100%" }}
      initial={{ x: 24, opacity: 0, transition: { duration: 0.3, ease: [0.23, 1, 0.32, 1] } }}
      animate={{ x: 0, opacity: 1, transition: { duration: 0.3, ease: [0.23, 1, 0.32, 1] } }}
      exit={{ x: 24, opacity: 0, transition: { duration: 0.2, ease: [0.23, 1, 0.32, 1] } }}
    >
      {/* Header — minimal, near-transparent */}
      <div className="flex h-9 shrink-0 items-center justify-between px-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Bot className="size-3.5 text-primary/80" />
          {hasActiveConnection ? (
            <span
              className="
                inline-flex h-[18px] items-center gap-1 rounded-full
                bg-primary/[0.07] px-2 text-[10px] font-medium
                text-foreground/70
                dark:bg-primary/[0.12] dark:text-foreground/60
                transition-[background,color] duration-200 [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]
              "
            >
              <span className="size-1.5 rounded-full bg-primary/60 dark:bg-primary/50" />
              {currentConnectionLabel}
            </span>
          ) : (
            <span
              className="
                inline-flex h-[18px] items-center gap-1.5 rounded-full
                bg-muted/40 px-2 text-[10px] font-medium
                text-muted-foreground/70
                dark:bg-muted/30 dark:text-muted-foreground/60
                transition-[background,color] duration-200 [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]
              "
            >
              <span className="size-1 rounded-full bg-muted-foreground/25 dark:bg-muted-foreground/20" />
              Global
            </span>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 max-w-[210px] justify-start px-2 text-xs font-semibold tracking-tight"
                >
                  <span
                    key={`${activeConversation?.id ?? "none"}:${activeConversation?.title ?? "AI Chat"}`}
                    className={cn(
                      "truncate transition-[filter,opacity,transform] duration-200 [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]",
                      "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-180",
                      isTitleMorphing && "opacity-80 blur-[1.5px] -translate-y-0.5",
                    )}
                  >
                    {activeConversation?.title ?? "AI Chat"}
                  </span>
                  <ChevronDown className="size-3 shrink-0 opacity-70" />
                </Button>
              }
            />
            <DropdownMenuContent align="start" side="bottom" className="w-[290px] p-1">
              <div className="px-2 py-1 text-[11px] font-semibold tracking-wide text-muted-foreground/70 uppercase">
                History
              </div>
              <DropdownMenuItem
                onClick={startNewConversation}
                disabled={isLoading}
                className="gap-2 rounded-md my-0.5 active:scale-[0.97] transition-[transform,background] duration-150 ease-out"
              >
                <Plus className="size-3.5" />
                New conversation
              </DropdownMenuItem>
              <DropdownMenuSeparator className="my-1" />
              {conversations.length === 0 ? (
                <div className="px-2 py-4 text-center text-xs text-muted-foreground/60">
                  No conversations yet
                </div>
              ) : (
                <div className="max-h-[240px] overflow-y-auto overscroll-contain -mx-1 px-1">
                  {conversations.map((conversation, index) => {
                    const isActive = conversation.id === activeConversationId;
                    return (
                      <DropdownMenuItem
                        key={conversation.id}
                        className={cn(
                          "flex items-center justify-between gap-2 rounded-md my-0.5 px-2 py-1.5",
                          "transition-[transform,background] duration-150 ease-out active:scale-[0.97]",
                          "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-left-1",
                          isActive && "bg-primary/5",
                        )}
                        style={{ animationDelay: `${index * 40}ms`, animationFillMode: "backwards" }}
                        onClick={() => selectConversation(conversation.id)}
                        disabled={isLoading}
                      >
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <div className="flex items-center gap-1.5">
                            {isActive && (
                              <span className="size-1.5 shrink-0 rounded-full bg-primary motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:duration-150" />
                            )}
                            <span className={cn(
                              "truncate text-xs font-medium",
                              isActive ? "text-foreground" : "text-foreground/80",
                            )}>
                              {conversation.title}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 pl-3">
                            <span className="truncate text-[10px] text-muted-foreground/70">
                              {conversation.contextTag?.connectionLabel
                                || conversation.contextTag?.connectionId
                                || "No connection"}
                            </span>
                            <span className="text-[10px] text-muted-foreground/40">·</span>
                            <span className="text-[10px] text-muted-foreground/50 tabular-nums">
                              {new Intl.DateTimeFormat(undefined, {
                                month: "2-digit",
                                day: "2-digit",
                                hour: "2-digit",
                                minute: "2-digit",
                              }).format(new Date(conversation.updatedAt))}
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          aria-label="Delete conversation"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            deleteConversation(conversation.id);
                          }}
                          className="rounded p-1 text-muted-foreground/50 transition-[color,transform] duration-150 ease-out hover:text-destructive active:scale-[0.93] disabled:opacity-30"
                          disabled={conversations.length === 1 || isLoading}
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </DropdownMenuItem>
                    );
                  })}
                </div>
              )}
              <DropdownMenuSeparator className="my-1" />
              <DropdownMenuItem
                onClick={clearAllConversations}
                disabled={isLoading || conversations.length === 0}
                className="gap-2 rounded-md my-0.5 text-muted-foreground active:scale-[0.97] transition-[transform,background] duration-150 ease-out"
              >
                <Trash2 className="size-3.5" />
                Clear all
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="flex items-center gap-px">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={startNewConversation}
                  disabled={isLoading}
                  className="text-muted-foreground hover:text-foreground transition-[color,transform] duration-150 ease-out active:scale-[0.97]"
                >
                  <Plus className="size-3.5" />
                </Button>
              }
            />
            <TooltipContent>New conversation</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={clearMessages}
                  disabled={isEmpty || isLoading}
                  className="text-muted-foreground hover:text-foreground transition-[color,transform] duration-150 ease-out active:scale-[0.97]"
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
                    className="text-muted-foreground hover:text-foreground transition-[color,transform] duration-150 ease-out active:scale-[0.97]"
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

      {/* Messages — auto-scroll via StickToBottom */}
      <Conversation className="flex-1 min-h-0 -mb-2" contextRef={conversationRef}>
        <ConversationContent
          key={activeConversationId ?? "no-conversation"}
          className="flex flex-col gap-0 pl-3 pr-0"
        >
          {isEmpty ? (
            <ConversationEmptyState>
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                <Bot className="size-5 text-primary" />
              </div>
              <div className="text-center space-y-1">
                <p className="text-sm font-medium">AI SQL Assistant</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Ask about your database schema, generate queries, or fix errors.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-1.5 mt-2">
                {SUGGESTIONS.map((s, i) => (
                  <button
                    key={s.label}
                    type="button"
                    onClick={() => sendMessage(s.label)}
                    className="
                      group/suggest inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium
                      bg-muted/40 text-muted-foreground/80
                      hover:bg-muted/70 hover:text-foreground/90
                      dark:bg-muted/25 dark:text-muted-foreground/70
                      dark:hover:bg-muted/50 dark:hover:text-foreground/80
                      transition-[background,color,transform,opacity]
                      duration-150 [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]
                      active:scale-[0.96] active:opacity-70
                      motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1.5
                      motion-safe:duration-200 motion-safe:ease-out
                    "
                    style={{ animationDelay: `${i * 60}ms`, animationFillMode: "backwards" }}
                  >
                    <span className="shrink-0 text-muted-foreground/60 transition-transform duration-150 [transition-timing-function:cubic-bezier(0.23,1,0.32,1)] group-active/suggest:scale-95">{s.icon}</span>
                    {s.label}
                  </button>
                ))}
              </div>
            </ConversationEmptyState>
          ) : (
            messages.map((msg) => (
              <ChatMessage
                key={msg.id}
                message={msg}
                codeTheme={codeTheme}
                onInsertSql={onInsertSql}
                connectionId={connectionId}
                conversationId={activeConversationId!}
              />
            ))
          )}
        </ConversationContent>
        <ConversationScrollButton className="bottom-8 z-40" />
      </Conversation>

      {/* Input */}
      <div className="z-30 shrink-0 pl-4 pr-3 py-2">
        {error && (
          <div className="relative z-10 mb-2 rounded-md border border-red-500/20 bg-red-500/5 px-2.5 py-1.5 text-xs text-red-600 dark:text-red-400 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 motion-safe:duration-150">
            {error}
          </div>
        )}
        <PromptInput
          value={input}
          onValueChange={handleInputChange}
          onSubmit={handleSubmit}
          isLoading={isLoading}
          className="
            relative z-30 rounded-2xl border border-border/30
            bg-background/60 p-2 shadow-none backdrop-blur-md
            dark:bg-background/50
            focus-within:border-border/50 focus-within:bg-background/70
            dark:focus-within:bg-background/60
            transition-[background,border-color] duration-200 [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]
          "
        >
          {contextPreview && (showSelectionContextChip || showErrorContextChip) && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {showSelectionContextChip && (
                <div
                  className={cn(
                    "group/ctx relative inline-flex w-[182px] max-w-full min-h-[52px] cursor-default items-center gap-2 rounded-lg bg-background/70 px-2 py-1.5",
                    "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-150 motion-safe:ease-out",
                    "transition-all duration-200 [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]",
                    exitingContext.selection && "-translate-y-1 scale-[0.98] opacity-0",
                  )}
                >
                  <span className="flex size-5 shrink-0 items-center justify-center rounded bg-foreground/10 text-[10px] font-semibold text-foreground">
                    AI
                  </span>
                  <div className="min-w-0 overflow-hidden">
                    <p className="truncate text-[12px] font-medium text-foreground">
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
                    "group/ctx relative inline-flex max-w-full cursor-default items-center gap-2 rounded-lg bg-amber-500/10 px-2 py-1",
                    "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-150 motion-safe:ease-out",
                    "transition-all duration-200 [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]",
                    exitingContext.error && "-translate-y-1 scale-[0.98] opacity-0",
                  )}
                >
                  <Code2 className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                  <div className="min-w-0">
                    <p className="truncate text-[12px] text-amber-700 dark:text-amber-300">
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
              hasActiveConnection
                ? "Ask about your database…"
                : "Ask anything about SQL, modeling, or debugging…"
            }
            className="
              max-h-[250px] min-h-[72px] overflow-y-auto px-3 py-2 text-sm
              placeholder:text-muted-foreground/50
              dark:bg-transparent
            "
          />
          <PromptInputActions className="justify-end gap-2 px-3 pb-2">
            {isLoading ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={abort}
                className="
                  border border-border/30 bg-background/40 text-muted-foreground backdrop-blur-sm
                  hover:bg-background/60 hover:text-foreground
                  dark:border-border/20 dark:bg-background/30
                  dark:hover:bg-background/50
                  transition-[background,color,transform] duration-150 [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]
                  active:scale-[0.96]
                "
              >
                <Square className="size-3.5" />
              </Button>
            ) : (
              <Button
                type="button"
                size="icon-xs"
                onClick={handleSubmit}
                disabled={!input.trim()}
                className="
                  bg-primary/80 text-primary-foreground shadow-[0_1px_2px_rgba(0,0,0,0.08)]
                  hover:bg-primary
                  disabled:bg-muted/50 disabled:text-muted-foreground/50 disabled:shadow-none
                  dark:bg-primary/70 dark:hover:bg-primary
                  dark:disabled:bg-muted/30 dark:disabled:text-muted-foreground/40
                  transition-[background,color,transform,opacity,box-shadow]
                  duration-150 [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]
                  active:scale-[0.96]
                "
              >
                <Send className="size-3.5" />
              </Button>
            )}
          </PromptInputActions>
        </PromptInput>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Suggestion chips for empty state
// ---------------------------------------------------------------------------

const SUGGESTIONS: Array<{ label: string; icon: ReactNode }> = [
  { label: "Show tables", icon: <Table2 className="size-3" /> },
  { label: "Find recent users", icon: <Search className="size-3" /> },
  { label: "Explain schema", icon: <Lightbulb className="size-3" /> },
  { label: "Optimize query", icon: <Zap className="size-3" /> },
];
