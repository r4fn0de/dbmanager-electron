/**
 * AiChatPanel — sidebar panel for conversational AI chat.
 *
 * Embedded in the SQL Editor view as a collapsible side panel.
 * Uses the useAiChat hook to manage streaming chat over Electron IPC.
 */
import { PostgreSql } from "@/components/icons/PostgreSql";
import { Neon } from "@/components/icons/Neon";
import { Supabase } from "@/components/icons/Supabase";
import { MySql } from "@/components/icons/MySql";
import { MariaDb } from "@/components/icons/MariaDb";
import { Sqlite } from "@/components/icons/Sqlite";
import { ClickHouse } from "@/components/icons/ClickHouse";
import { Redis } from "@/components/icons/Redis";
import type { ConnectionProvider } from "@/lib/stores/connection-tabs";
import { motion, AnimatePresence } from "motion/react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
  conversationMotionPresets,
} from "./ai-elements/conversation";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "./ai-elements/reasoning";
import { Shimmer } from "./ai-elements/shimmer";
import { useTheme } from "next-themes";
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { StickToBottomContext } from "use-stick-to-bottom";
import { Button } from "@/components/ui/button";
import { Icon as UiIcon } from "@/components/ui/Icon";
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
} from "./ai-elements/message";
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
import { parseMentions, findConnectionByMentionName } from "@/features/ai/lib/mention-utils";
import { useAiChat, type AiChatMessage, type TextPart, type ToolInvocationPart } from "../hooks/useAiChat";
import { useMessageFeedback } from "../hooks/useAiFeedback";
import { useMentions } from "../hooks/useMentions";
import { MentionDropdown } from "./MentionDropdown";
import { MentionChip } from "./MentionChip";
import { useConnectionsList } from "@/features/connection/hooks/useConnectionsList";
import { FeedbackBar } from "@/components/ui/feedback-bar";
import { ChatTool, type ChatToolPart } from "./ai-elements/tool";
import { ChatTable } from "./ai-elements/chat-table";
import { cn } from "@/lib/utils";
import { DotmSquare12 } from "@/components/ui/dotm-square-12";
import type { DatabaseType } from "@/ipc/db/types";
import type { UserConnectionsContext } from "@/shared/ai/streaming-contracts";

function getDatabaseIcon(dbType: DatabaseType, provider?: ConnectionProvider) {
  if (provider) {
    switch (provider) {
      case "neon":
        return Neon;
      case "supabase":
        return Supabase;
      case "mysql":
        return MySql;
      case "mariadb":
        return MariaDb;
      case "clickhouse":
        return ClickHouse;
      case "redis":
        return Redis;
    }
  }

  switch (dbType) {
    case "postgresql":
      return PostgreSql;
    case "mysql":
      return MySql;
    case "mariadb":
      return MariaDb;
    case "sqlite":
      return Sqlite;
    case "clickhouse":
      return ClickHouse;
    case "redis":
      return Redis;
    default:
      return PostgreSql;
  }
}

function getDatabaseBrandColor(dbType: DatabaseType, provider?: ConnectionProvider): {
  bgLight: string;
  textLight: string;
  bgDark: string;
  textDark: string;
} {
  if (provider) {
    switch (provider) {
      case "neon":
        return { bgLight: "#00E0D914", textLight: "#008F8A", bgDark: "#00E0D920", textDark: "#00E0D9" };
      case "supabase":
        return { bgLight: "#3ECF8E14", textLight: "#1A8A55", bgDark: "#3ECF8E20", textDark: "#3ECF8E" };
      case "mysql":
        return { bgLight: "#00546B14", textLight: "#00546B", bgDark: "#00546B20", textDark: "#4DB8D4" };
      case "mariadb":
        return { bgLight: "#C49A6C14", textLight: "#8B6914", bgDark: "#C49A6C20", textDark: "#D4B07C" };
      case "clickhouse":
        return { bgLight: "#FFCC0014", textLight: "#9A7B00", bgDark: "#FFCC0020", textDark: "#FFD633" };
      case "redis":
        return { bgLight: "#DC382D14", textLight: "#DC382D", bgDark: "#DC382D20", textDark: "#EF6B5E" };
    }
  }

  switch (dbType) {
    case "postgresql":
      return { bgLight: "#33679114", textLight: "#336791", bgDark: "#33679120", textDark: "#6BA0D0" };
    case "mysql":
      return { bgLight: "#00546B14", textLight: "#00546B", bgDark: "#00546B20", textDark: "#4DB8D4" };
    case "mariadb":
      return { bgLight: "#C49A6C14", textLight: "#8B6914", bgDark: "#C49A6C20", textDark: "#D4B07C" };
    case "sqlite":
      return { bgLight: "#0F80CC14", textLight: "#0F6BA8", bgDark: "#0F80CC20", textDark: "#5CB3E8" };
    case "clickhouse":
      return { bgLight: "#FFCC0014", textLight: "#9A7B00", bgDark: "#FFCC0020", textDark: "#FFD633" };
    case "redis":
      return { bgLight: "#DC382D14", textLight: "#DC382D", bgDark: "#DC382D20", textDark: "#EF6B5E" };
    default:
      return { bgLight: "#33679114", textLight: "#336791", bgDark: "#33679120", textDark: "#6BA0D0" };
  }
}

interface AiChatPanelProps {
  /** Active connection ID (optional in global mode) */
  connectionId: string | null;
  /** Active connection display label */
  connectionLabel?: string;
  /** Database engine type */
  dbType: DatabaseType;
  /** Cloud provider (neon, supabase, etc.) — overrides dbType icon when available */
  provider?: ConnectionProvider;
  /** Optional schema context (table/column names) */
  schemaContext?: string;
  /** Optional connection metadata for AI context (host, port, local vs remote) */
  connectionInfo?: {
    name: string;
    host: string;
    port: number;
    database: string;
    isLocal?: boolean;
  };
  /** Optional global connection snapshot for cross-connection questions */
  userConnectionsContext?: UserConnectionsContext;
  /** Compact preview of what editor context will be sent to AI */
  contextPreview?: {
    connectionLabel: string;
    dbType: DatabaseType;
    selectionPreview?: string;
    errorPreview?: string;
    tablePreview?: string;
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
  const isSqlLikeLanguage = /^(sql|postgres|postgresql|mysql|mariadb|sqlite|clickhouse)$/i.test(displayLang);
  const isSqlByContent =
    /\b(select|insert|update|delete|create|alter|drop|with|from|where|join)\b/i.test(
      code,
    );
  const canInsertSql = (isSqlLikeLanguage || isSqlByContent) && !!onInsertSql;

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <div className="group/code relative rounded-lg border border-border/40 bg-background/60 backdrop-blur-sm">
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-border/30 bg-muted/30 px-3 py-1">
        <span className="text-[11px] font-medium text-muted-foreground/80 select-text">{displayLang}</span>
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
            {copied ? <UiIcon name="check" className="size-3" /> : <UiIcon name="copy" className="size-3" />}
          </MessageAction>
          {canInsertSql && (
            <MessageAction
              tooltip="Insert SQL"
              label="Insert SQL"
              onClick={() => onInsertSql(code)}
            >
              <UiIcon name="code" className="size-3" />
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
          className="[&>pre]:rounded-none! [&>pre]:m-0! [&>pre]:px-4 [&>pre]:py-3"
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

function extractSourceMeta(source: unknown): { label: string; url?: string } {
  if (!source || typeof source !== "object") {
    return { label: "Reference" };
  }

  const sourceRecord = source as Record<string, unknown>;
  const title = typeof sourceRecord.title === "string" ? sourceRecord.title.trim() : "";
  const url = typeof sourceRecord.url === "string" ? sourceRecord.url.trim() : undefined;
  const sourceType = typeof sourceRecord.sourceType === "string" ? sourceRecord.sourceType.trim() : "";

  if (title) {
    return { label: title, url };
  }
  if (sourceType) {
    return { label: sourceType, url };
  }
  if (url) {
    return { label: url, url };
  }
  return { label: "Reference" };
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
    invocation.state === "pending-approval" ? "pending-approval"
    : invocation.state === "call" ? "input-streaming"
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

  // Extract approval request metadata if present
  const approvalRequest =
    invocation.state === "pending-approval" && invocation.approvalRequest
      ? invocation.approvalRequest
      : undefined;

  return {
    type: invocation.toolName,
    state,
    input,
    output,
    toolCallId: invocation.toolCallId,
    errorText,
    approvalRequest,
  };
}

/**
 * Deterministic hash to show feedback for ~25% of messages.
 * Same message ID always produces same result (consistent for user).
 */
function shouldShowFeedback(messageId: string): boolean {
  let hash = 0;
  for (let i = 0; i < messageId.length; i++) {
    hash = ((hash << 5) - hash + messageId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 4 === 0; // 25% chance (1 in 4)
}

/** Shared typography className for assistant prose content. */
const ASSISTANT_PROSE_CLASS =
  "w-full! max-w-none! bg-transparent! p-0 text-[14.5px] leading-7 wrap-break-word text-zinc-800 dark:text-zinc-200 [&_a]:font-medium [&_a]:text-primary [&_a]:underline-offset-4 [&_a]:hover:underline [&_blockquote]:border-l-2 [&_blockquote]:border-muted-foreground/30 [&_blockquote]:pl-4 [&_blockquote]:italic [&_code]:rounded-md [&_code]:border [&_code]:border-zinc-300/80 [&_code]:bg-zinc-100/80 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.88em] [&_code]:text-zinc-900 [&_code]:dark:border-zinc-700/80 [&_code]:dark:bg-zinc-800/80 [&_code]:dark:text-zinc-100 [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:mt-6 [&_h1]:mb-3 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-5 [&_h2]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-2 [&_hr]:border-muted-foreground/20 [&_hr]:my-4 [&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:leading-7 [&_p+p]:mt-3 [&_strong]:font-semibold [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5";

function AiMessageFeedback({
  message,
  connectionId,
  conversationId,
  showFeedback,
}: {
  message: AiChatMessage;
  connectionId: string | null;
  conversationId: string;
  showFeedback: boolean;
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
    ?.reduce<string[]>((texts, part) => {
      if (part.type === "text") {
        texts.push(part.text);
      }
      return texts;
    }, [])
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
    if (!showFeedback) {
      setIsLoadingExistingFeedback(false);
      return;
    }

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

  if (!showFeedback) {
    return null;
  }

  if (isLoadingExistingFeedback && !localRating) {
    return null;
  }

  if (activeRating) {
    return null;
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
  onApproveToolCall,
  onRejectToolCall,
}: {
  message: AiChatMessage;
  codeTheme: string;
  onInsertSql?: (sql: string) => void;
  connectionId: string | null;
  conversationId: string;
  onApproveToolCall?: (toolCallId: string) => void;
  onRejectToolCall?: (toolCallId: string) => void;
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
      <motion.div
        layout="position"
        initial={conversationMotionPresets.message.initial}
        animate={conversationMotionPresets.message.animate}
        exit={conversationMotionPresets.message.exit}
        transition={conversationMotionPresets.message.transition}
      >
        <Message
          from="user"
          className="group/msg w-full max-w-full pl-3 pr-3 py-2"
        >
          <div className="ml-auto flex max-w-[72%] min-w-0 flex-col items-end">
          {(message.contextSnapshot?.selectionPreview || message.contextSnapshot?.errorPreview || message.contextSnapshot?.tablePreview) && (
            <div className="mb-1.5 flex w-full justify-end">
              {message.contextSnapshot?.tablePreview && (
                <div
                  className="
                    inline-flex max-w-full cursor-default items-center gap-2
                    rounded-lg bg-muted/50 px-2 py-1
                  "
                >
                  <UiIcon name="table" className="size-3.5 shrink-0 text-muted-foreground/70" />
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-medium text-foreground/90">
                      {message.contextSnapshot.tablePreview}
                    </p>
                    <p className="text-[11px] text-muted-foreground/70">Selected Table</p>
                  </div>
                </div>
              )}
              {message.contextSnapshot?.selectionPreview && (
                <div
                  className="
                    inline-flex w-45.5 max-w-full min-h-13 cursor-default
                    items-center gap-2 rounded-lg bg-muted/50 px-2 py-1.5
                  "
                >
                  <span className="flex size-5 shrink-0 items-center justify-center rounded bg-foreground/8 text-[10px] font-semibold text-muted-foreground">
                    SQL
                  </span>
                  <div className="min-w-0 overflow-hidden">
                    <p className="truncate text-[12px] font-medium text-foreground/90">
                      {message.contextSnapshot.selectionPreview}
                    </p>
                    <p className="text-[11px] text-muted-foreground/70">Selected Text</p>
                  </div>
                </div>
              )}
              {!message.contextSnapshot?.selectionPreview && message.contextSnapshot?.errorPreview && (
                <div
                  className="
                    inline-flex max-w-full cursor-default items-center gap-2
                    rounded-lg bg-amber-500/8 px-2 py-1
                  "
                >
                  <UiIcon name="code" className="size-3.5 shrink-0 text-amber-600/70 dark:text-amber-400/70" />
                  <div className="min-w-0">
                    <p className="truncate text-[12px] text-amber-700/80 dark:text-amber-300/80">
                      {message.contextSnapshot.errorPreview}
                    </p>
                    <p className="text-[11px] text-amber-600/50 dark:text-amber-400/50">Last Error</p>
                  </div>
                </div>
              )}
            </div>
          )}
          {message.content && (
            <p className="text-[14px] leading-6 whitespace-pre-wrap wrap-break-word rounded-2xl bg-muted/60 px-3.5 py-2 text-foreground">
              {message.content}
            </p>
          )}
        </div>
        </Message>
      </motion.div>
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
    kind: "text-segments" | "tool-group" | "reasoning" | "source";
    segments?: TextSegment[];
    invocations?: ToolInvocationPart[];
    reasoningText?: string;
    source?: unknown;
  }> = [];

  let pendingTools: ToolInvocationPart[] = [];
  for (const part of parts) {
    if (part.type === "tool-invocation") {
      pendingTools.push(part);
    } else if (part.type === "text") {
      // Flush any accumulated tool invocations before rendering text
      if (pendingTools.length > 0) {
        renderedParts.push({ kind: "tool-group", invocations: [...pendingTools] });
        pendingTools = [];
      }
      const segments = splitTextIntoSegments(part.text);
      if (segments.length > 0) {
        renderedParts.push({ kind: "text-segments", segments });
      }
    } else if (part.type === "reasoning") {
      if (pendingTools.length > 0) {
        renderedParts.push({ kind: "tool-group", invocations: [...pendingTools] });
        pendingTools = [];
      }
      if (part.text.trim()) {
        renderedParts.push({ kind: "reasoning", reasoningText: part.text });
      }
    } else if (part.type === "source") {
      if (pendingTools.length > 0) {
        renderedParts.push({ kind: "tool-group", invocations: [...pendingTools] });
        pendingTools = [];
      }
      renderedParts.push({ kind: "source", source: part.source });
    }
  }
  // Flush any remaining tool invocations at the end
  if (pendingTools.length > 0) {
    renderedParts.push({ kind: "tool-group", invocations: [...pendingTools] });
  }

  const hasContent = renderedParts.length > 0;

  return (
    <motion.div
      layout="position"
      initial={conversationMotionPresets.message.initial}
      animate={conversationMotionPresets.message.animate}
      exit={conversationMotionPresets.message.exit}
      transition={conversationMotionPresets.message.transition}
    >
      <Message
        from="assistant"
        className="group/msg w-full max-w-full pl-1 pr-2 py-2"
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
                            onApprove={onApproveToolCall}
                            onReject={onRejectToolCall}
                          />
                          {sqlFromTool && onInsertSql && tip.toolInvocation.state === "result" && (
                            <MessageAction
                              tooltip="Insert SQL from tool"
                              label="Insert SQL"
                              onClick={() => onInsertSql(sqlFromTool)}
                              className="mt-1 ml-1"
                            >
                              <UiIcon name="code" className="size-3.5" />
                            </MessageAction>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  block.kind === "reasoning" ? (
                    <Reasoning
                      key={`reasoning-${blockIndex}`}
                      defaultOpen={false}
                      isStreaming={message.isStreaming}
                      className="mb-1 rounded-md border border-border/30 bg-muted/20 px-3 py-2"
                    >
                      <ReasoningTrigger className="text-xs text-muted-foreground/80">
                        <span className="inline-flex items-center gap-1.5">
                          <UiIcon name="brain" className="size-3.5" />
                          Reasoning
                        </span>
                      </ReasoningTrigger>
                      <ReasoningContent className="mt-2 text-xs leading-6">
                        {block.reasoningText ?? ""}
                      </ReasoningContent>
                    </Reasoning>
                  ) : block.kind === "source" ? (
                    <div
                      key={`source-${blockIndex}`}
                      className="rounded-md border border-border/30 bg-muted/20 px-3 py-2 text-xs text-muted-foreground"
                    >
                      {(() => {
                        const sourceMeta = extractSourceMeta(block.source);
                        return sourceMeta.url ? (
                          <a
                            href={sourceMeta.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 text-primary underline-offset-4 hover:underline"
                          >
                            <UiIcon name="link" className="size-3.5" />
                            {sourceMeta.label}
                          </a>
                        ) : (
                          <span className="inline-flex items-center gap-1.5">
                            <UiIcon name="link" className="size-3.5" />
                            {sourceMeta.label}
                          </span>
                        );
                      })()}
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
                )),
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
                {copied ? <UiIcon name="check" className="size-3.5" /> : <UiIcon name="copy" className="size-3.5" />}
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
                <UiIcon name="code" className="size-3.5" />
              </MessageAction>
            </MessageToolbar>
          )}

          {/* Feedback buttons for completed assistant messages — show only ~25% of the time */}
          {!message.isStreaming && message.role === "assistant" && !isUser && (
            <AiMessageFeedback
              message={message}
              connectionId={connectionId}
              conversationId={conversationId}
              showFeedback={shouldShowFeedback(message.id)}
            />
          )}

          {/* Thinking indicator — ai-elements Reasoning, minimal style */}
          {message.isStreaming && !message.content && (
            <Reasoning isStreaming className="mb-0! px-3">
              <ReasoningTrigger className="gap-1.5 py-1 text-xs">
                <DotmSquare12
                  size={14}
                  dotSize={2}
                  speed={1.2}
                  pattern="full"
                  animated
                  hoverAnimated={false}
                  className="shrink-0 opacity-85"
                  aria-hidden
                />
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
          {!message.isStreaming && !hasContent && (
            <p className="px-3 text-xs text-muted-foreground">No response</p>
          )}
        </div>
      </Message>
    </motion.div>
  );
}

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
    // Streaming can leave the final code fence unclosed for a while.
    // Detect an open fence in the trailing chunk and render it as code immediately.
    const openFenceMatch = trailing.match(/```([\w-]+)?\s*\n([\s\S]*)$/);
    if (openFenceMatch) {
      const openFencePrefix = openFenceMatch[0];
      const openFenceStart = trailing.lastIndexOf(openFencePrefix);
      const proseBeforeFence = trailing.slice(0, openFenceStart);
      if (proseBeforeFence.trim()) {
        pushProseSegments(segments, proseBeforeFence);
      }
      const openFenceCode = (openFenceMatch[2] ?? "").trim();
      if (openFenceCode) {
        segments.push({
          type: "code",
          code: openFenceCode,
          language: openFenceMatch[1]?.trim() || undefined,
        });
      }
    } else {
      pushProseSegments(segments, trailing);
    }
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

export function AiChatPanel({
  connectionId,
  connectionLabel,
  dbType,
  provider,
  schemaContext,
  connectionInfo,
  userConnectionsContext,
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
    approveToolCall,
    rejectToolCall,
  } = useAiChat({
    connectionId,
    dbType,
    connectionLabel,
    schemaContext,
    connectionInfo,
    userConnectionsContext,
  });

  const [input, setInput] = useState("");
  const [dismissedContext, setDismissedContext] = useState<{
    selection: boolean;
    error: boolean;
    table: boolean;
  }>({ selection: false, error: false, table: false });
  const [exitingContext, setExitingContext] = useState<{
    selection: boolean;
    error: boolean;
    table: boolean;
  }>({ selection: false, error: false, table: false });
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const mentionDropdownRef = useRef<HTMLDivElement>(null);
  const conversationRef = useRef<StickToBottomContext | null>(null);
  const previousConversationIdRef = useRef<string | null>(null);
  const previousIsOpenRef = useRef(false);
  const contextDismissTimeoutsRef = useRef<{
    selection?: ReturnType<typeof setTimeout>;
    error?: ReturnType<typeof setTimeout>;
    table?: ReturnType<typeof setTimeout>;
  }>({});

  // ── Mention support ──
  const { connections } = useConnectionsList();
  const {
    mentionState,
    handleTextChange,
    handleKeyDown: handleMentionKeyDown,
    selectMention,
    closeMention,
    selectedMentions,
    removeMention,
    clearMentions,
  } = useMentions(connections);

  const handleMentionSelect = useCallback(
    (connectionIndex: number) => {
      const connection = mentionState.filteredConnections[connectionIndex];
      if (!connection) return;
      const result = selectMention(connection);
      if (result !== null) {
        setInput(result.text);
        // Focus and place cursor where the mention token was removed.
        requestAnimationFrame(() => {
          const textarea = inputRef.current;
          if (!textarea) return;
          textarea.focus();
          textarea.setSelectionRange(result.cursorPos, result.cursorPos);
        });
      }
    },
    [mentionState.filteredConnections, selectMention],
  );

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
    setDismissedContext({ selection: false, error: false, table: false });
    setExitingContext({ selection: false, error: false, table: false });
  }, [contextPreview?.selectionPreview, contextPreview?.errorPreview, contextPreview?.tablePreview]);

  useEffect(() => {
    return () => {
      if (contextDismissTimeoutsRef.current.selection) {
        clearTimeout(contextDismissTimeoutsRef.current.selection);
      }
      if (contextDismissTimeoutsRef.current.error) {
        clearTimeout(contextDismissTimeoutsRef.current.error);
      }
      if (contextDismissTimeoutsRef.current.table) {
        clearTimeout(contextDismissTimeoutsRef.current.table);
      }
    };
  }, []);

  const showSelectionContextChip = Boolean(
    contextPreview?.selectionPreview && !dismissedContext.selection,
  );
  const showErrorContextChip = Boolean(
    contextPreview?.errorPreview && !dismissedContext.error,
  );
  const showTableContextChip = Boolean(
    contextPreview?.tablePreview && !dismissedContext.table,
  );

  const hasChips =
    showSelectionContextChip || showErrorContextChip || showTableContextChip ||
    exitingContext.selection || exitingContext.error || exitingContext.table ||
    selectedMentions.size > 0;

  const handleInputChange = useCallback((value: string) => {
    setInput(value);
    const textarea = inputRef.current;
    const cursorPos = textarea?.selectionStart ?? value.length;
    handleTextChange(value, cursorPos);
  }, [handleTextChange]);

  const handleTextareaKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Backspace") {
        const textarea = inputRef.current;
        const atBeginning = Boolean(
          textarea &&
          textarea.selectionStart === 0 &&
          textarea.selectionEnd === 0,
        );

        if (atBeginning && selectedMentions.size > 0) {
          const mentionIds = Array.from(selectedMentions.keys());
          const lastMentionId = mentionIds[mentionIds.length - 1];
          if (lastMentionId) {
            event.preventDefault();
            removeMention(lastMentionId);
            return;
          }
        }
      }

      const handled = handleMentionKeyDown(event);
      if (handled && event.key === "Enter") {
        // Enter was consumed by mention dropdown for selection
        handleMentionSelect(mentionState.activeIndex);
      }
    },
    [
      handleMentionKeyDown,
      mentionState.activeIndex,
      handleMentionSelect,
      selectedMentions,
      removeMention,
    ],
  );

  const handleSubmit = useCallback(() => {
    if (!input.trim() || isLoading) return;

    // Close mention dropdown if open
    closeMention();

    const contextSnapshot = {
      selectionPreview:
        showSelectionContextChip && contextPreview?.selectionPreview
          ? contextPreview.selectionPreview
          : undefined,
      errorPreview:
        showErrorContextChip && contextPreview?.errorPreview
          ? contextPreview.errorPreview
          : undefined,
      tablePreview:
        showTableContextChip && contextPreview?.tablePreview
          ? contextPreview.tablePreview
          : undefined,
    };

    if (showSelectionContextChip) {
      setExitingContext((prev) => ({ ...prev, selection: true }));
    }
    if (showErrorContextChip) {
      setExitingContext((prev) => ({ ...prev, error: true }));
    }
    if (showTableContextChip) {
      setExitingContext((prev) => ({ ...prev, table: true }));
    }
    if (showSelectionContextChip || showErrorContextChip || showTableContextChip) {
      setTimeout(() => {
        if (showSelectionContextChip) {
          setDismissedContext((prev) => ({ ...prev, selection: true }));
          setExitingContext((prev) => ({ ...prev, selection: false }));
        }
        if (showErrorContextChip) {
          setDismissedContext((prev) => ({ ...prev, error: true }));
          setExitingContext((prev) => ({ ...prev, error: false }));
        }
        if (showTableContextChip) {
          setDismissedContext((prev) => ({ ...prev, table: true }));
          setExitingContext((prev) => ({ ...prev, table: false }));
        }
      }, 250);
    }

    // Resolve any @mentions in the input to connection IDs
    const selectedMentionConnection = Array.from(selectedMentions.values())[0];
    const mentionNames = parseMentions(input.trim());
    const typedMentionConnection = mentionNames.length > 0
      ? findConnectionByMentionName(connections, mentionNames[0])
      : undefined;
    const mentionedConnection = selectedMentionConnection ?? typedMentionConnection;

    sendMessage(input.trim(), {
      contextSnapshot:
        contextSnapshot.selectionPreview || contextSnapshot.errorPreview || contextSnapshot.tablePreview
          ? contextSnapshot
          : undefined,
      mentionedConnectionId: mentionedConnection?.id ?? null,
    });
    setInput("");
    clearMentions();
  }, [
    input,
    isLoading,
    sendMessage,
    closeMention,
    showSelectionContextChip,
    showErrorContextChip,
    showTableContextChip,
    contextPreview?.selectionPreview,
    contextPreview?.errorPreview,
    contextPreview?.tablePreview,
    selectedMentions,
    clearMentions,
  ]);

  const handleDismissContextChip = useCallback((kind: "selection" | "error" | "table") => {
    setExitingContext((prev) => ({ ...prev, [kind]: true }));
    const existing = contextDismissTimeoutsRef.current[kind];
    if (existing) clearTimeout(existing);
    contextDismissTimeoutsRef.current[kind] = setTimeout(() => {
      setDismissedContext((prev) => ({ ...prev, [kind]: true }));
      setExitingContext((prev) => ({ ...prev, [kind]: false }));
      contextDismissTimeoutsRef.current[kind] = undefined;
    }, 250);
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
    >
      {/* Header — minimal, near-transparent */}
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 px-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {hasActiveConnection ? (
            (() => {
              const DbIcon = getDatabaseIcon(dbType, provider);
              const colors = getDatabaseBrandColor(dbType, provider);
              const isDark = resolvedTheme === "dark";
              return (
                <span
                  className="inline-flex h-4.5 shrink-0 items-center gap-1.5 rounded-full px-2 text-[10px] font-medium transition-[background,color] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]"
                  style={{
                    backgroundColor: isDark ? colors.bgDark : colors.bgLight,
                    color: isDark ? colors.textDark : colors.textLight,
                  }}
                >
                  <DbIcon className="size-3.5" />
                  <span className="truncate">{currentConnectionLabel}</span>
                </span>
              );
            })()
          ) : (
            <span
              className="
                inline-flex h-4.5 shrink-0 items-center gap-1.5 rounded-full
                bg-muted/40 px-2 text-[10px] font-medium
                text-muted-foreground/70
                dark:bg-muted/30 dark:text-muted-foreground/60
                transition-[background,color] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]
              "
            >
              <UiIcon name="database" className="size-3" />
              <span>Global</span>
            </span>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 min-w-0 flex-1 justify-between px-2 text-xs font-semibold tracking-tight max-w-35 xs:max-w-45 sm:max-w-52.5"
                >
                  <span className="truncate shrink">
                    {activeConversation?.title ?? "AI Chat"}
                  </span>
                  <UiIcon
                    name="chevron-down"
                    className="size-3 shrink-0 opacity-70 ml-1"
                  />
                </Button>
              }
            />
            <DropdownMenuContent align="start" side="bottom" className="w-72.5 p-1">
              <div className="px-2 py-1 text-[11px] font-semibold tracking-wide text-muted-foreground/70 uppercase">
                History
              </div>
              <DropdownMenuItem
                onClick={startNewConversation}
                disabled={isLoading}
                className="gap-2 rounded-md my-0.5 active:scale-[0.97] transition-[transform,background] duration-150 ease-out"
              >
                <UiIcon name="plus" className="size-3.5" />
                New conversation
              </DropdownMenuItem>
              <DropdownMenuSeparator className="my-1" />
              {conversations.length === 0 ? (
                <div className="px-2 py-4 text-center text-xs text-muted-foreground/60">
                  No conversations yet
                </div>
              ) : (
                <div className="max-h-60 overflow-y-auto overscroll-contain -mx-1 px-1">
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
                          <UiIcon name="trash" className="size-3" />
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
                <UiIcon name="trash" className="size-3.5" />
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
                  <UiIcon name="plus" className="size-3.5" />
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
                  <UiIcon name="trash" className="size-3.5" />
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
                    <UiIcon name="panel-right" className="size-3.5" />
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
                <UiIcon name="bot" className="size-5 text-primary" />
              </div>
              <div className="text-center space-y-1">
                <p className="text-sm font-medium">AI SQL Assistant</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Ask about your database schema, generate queries, or fix errors.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-1.5 mt-2">
                {getContextualSuggestions(dbType, hasActiveConnection).map((suggestion, index) => (
                  <button
                    key={suggestion.label}
                    type="button"
                    onClick={() => sendMessage(suggestion.label)}
                    className="
                      group/suggest inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium
                      bg-muted/40 text-muted-foreground/80
                      hover:bg-muted/70 hover:text-foreground/90
                      dark:bg-muted/25 dark:text-muted-foreground/70
                      dark:hover:bg-muted/50 dark:hover:text-foreground/80
                      transition-[background,color,transform,opacity]
                      duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]
                      active:scale-[0.96] active:opacity-70
                      motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1.5
                      motion-safe:duration-200 motion-safe:ease-out
                    "
                    style={{ animationDelay: `${index * 60}ms`, animationFillMode: "backwards" }}
                  >
                    <span className="shrink-0 text-muted-foreground/60 transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] group-active/suggest:scale-95">{suggestion.icon}</span>
                    {suggestion.label}
                  </button>
                ))}
              </div>
            </ConversationEmptyState>
          ) : (
            <AnimatePresence initial={false} mode="popLayout">
              {messages.map((msg) => (
                <ChatMessage
                  key={msg.id}
                  message={msg}
                  codeTheme={codeTheme}
                  onInsertSql={onInsertSql}
                  connectionId={connectionId}
                  conversationId={activeConversationId!}
                  onApproveToolCall={approveToolCall}
                  onRejectToolCall={rejectToolCall}
                />
              ))}
            </AnimatePresence>
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
        <div className="relative">
          {/* Mention dropdown */}
          {mentionState.isOpen && (
            <MentionDropdown
              ref={mentionDropdownRef}
              connections={mentionState.filteredConnections}
              activeIndex={mentionState.activeIndex}
              onSelect={(connection) => {
                const selectedIndex = mentionState.filteredConnections.findIndex(
                  (item) => item.id === connection.id,
                );
                if (selectedIndex >= 0) {
                  handleMentionSelect(selectedIndex);
                }
              }}
              onClose={closeMention}
            />
          )}
          <PromptInput
            value={input}
            onValueChange={handleInputChange}
            onSubmit={handleSubmit}
            isLoading={isLoading}
            onClick={() => inputRef.current?.focus()}
            className={cn(
              "relative z-30 rounded-2xl border border-border/30",
              "bg-background/60 px-2 shadow-none backdrop-blur-md",
              "dark:bg-background/50",
              "focus-within:border-border/50 focus-within:bg-background/70",
              "dark:focus-within:bg-background/60",
              "transition-[background,border-color,padding] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
              hasChips ? "pt-2.5 pb-1" : "py-1",
            )}
          >
          <AnimatePresence>
                  {showSelectionContextChip && (
                <motion.div
                  key="selection-context"
                  layout="position"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                  className="group/ctx relative inline-flex w-45.5 max-w-full min-h-13 cursor-default items-center gap-2 rounded-lg border border-border/50 bg-muted/50 px-2 py-1.5 dark:bg-muted/30"
                >
                  <span className="flex size-5 shrink-0 items-center justify-center rounded bg-foreground/15 text-[10px] font-semibold text-foreground dark:bg-foreground/10">
                    AI
                  </span>
                  <div className="min-w-0 overflow-hidden">
                    <p className="truncate text-[12px] font-medium text-foreground">
                      {contextPreview?.selectionPreview}
                    </p>
                    <p className="text-[11px] text-muted-foreground/80 dark:text-muted-foreground/70">Selected Text</p>
                  </div>
                  <button
                    type="button"
                    aria-label="Remove selected text context"
                    className="absolute -right-2 -top-2 rounded-full border border-border/60 bg-background p-0.5 text-muted-foreground opacity-0 shadow-sm transition-all duration-150 ease-out hover:text-foreground group-hover/ctx:opacity-100"
                    onClick={() => handleDismissContextChip("selection")}
                  >
                    <UiIcon name="x" className="size-3" />
                  </button>
                </motion.div>
              )}
                  {showErrorContextChip && (
                <motion.div
                  key="error-context"
                  layout="position"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                  className="group/ctx relative inline-flex max-w-full cursor-default items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/15 px-2 py-1 dark:border-amber-400/35 dark:bg-amber-400/20"
                >
                  <UiIcon name="code" className="size-3.5 shrink-0 text-amber-700 dark:text-amber-300" />
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-medium text-amber-800 dark:text-amber-200">
                      {contextPreview?.errorPreview}
                    </p>
                    <p className="text-[11px] text-amber-700/80 dark:text-amber-300/80">Last Error</p>
                  </div>
                  <button
                    type="button"
                    aria-label="Remove error context"
                    className="absolute -right-2 -top-2 rounded-full border border-amber-400/35 bg-background p-0.5 text-amber-700/70 opacity-0 shadow-sm transition-all duration-150 ease-out hover:text-amber-900 group-hover/ctx:opacity-100 dark:text-amber-300/80 dark:hover:text-amber-200"
                    onClick={() => handleDismissContextChip("error")}
                  >
                    <UiIcon name="x" className="size-3" />
                  </button>
                </motion.div>
              )}
                  {showTableContextChip && (
                <motion.div
                  key="table-context"
                  layout="position"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                  className="group/ctx relative inline-flex max-w-full cursor-default items-center gap-2 rounded-lg border border-border/50 bg-muted/50 px-2 py-1 dark:bg-muted/30"
                >
                  <UiIcon name="table" className="size-3.5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-medium text-foreground">
                      {contextPreview?.tablePreview}
                    </p>
                    <p className="text-[11px] text-muted-foreground/80 dark:text-muted-foreground/70">Selected Table</p>
                  </div>
                  <button
                    type="button"
                    aria-label="Remove table context"
                    className="absolute -right-2 -top-2 rounded-full border border-border/60 bg-background p-0.5 text-muted-foreground opacity-0 shadow-sm transition-all duration-150 ease-out hover:text-foreground group-hover/ctx:opacity-100"
                    onClick={() => handleDismissContextChip("table")}
                  >
                    <UiIcon name="x" className="size-3" />
                  </button>
                </motion.div>
              )}
          </AnimatePresence>
          <div className="flex flex-wrap items-center gap-1 px-1.5 py-0">
            {Array.from(selectedMentions.entries()).map(([id, connection]) => (
              <MentionChip
                key={id}
                connection={connection}
              />
            ))}
            <PromptInputTextarea
              ref={inputRef}
              onKeyDown={handleTextareaKeyDown}
              placeholder={
                hasActiveConnection
                  ? "Ask about your database…"
                  : "Ask anything about SQL, modeling, or debugging…"
              }
              className="
                w-auto! max-h-62.5 min-h-10 min-w-32 flex-1 basis-32 overflow-y-auto px-0 py-0 text-sm leading-5
                placeholder:text-muted-foreground/50
                dark:bg-transparent
              "
            />
          </div>
          <PromptInputActions className="justify-end gap-2 pl-2 pr-0.5 pb-1.5 pt-1">
            {isLoading ? (
             <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={abort}
                  className="
                    h-7 w-7 rounded-full
                    border border-border/30 bg-background/50 text-muted-foreground backdrop-blur-sm
                    hover:bg-background/70 hover:text-foreground
                    dark:border-border/20 dark:bg-background/40
                    dark:hover:bg-background/60
                    transition-[background,color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]
                    active:scale-[0.96]
                  "
                >
                  <UiIcon name="square" className="size-4" />
                </Button>
            ) : (
             <Button
                  type="button"
                  size="icon-sm"
                  onClick={handleSubmit}
                  disabled={!input.trim()}
                  className="
                    h-7 w-7 rounded-full
                    bg-primary/85 text-primary-foreground shadow-[0_1px_2px_rgba(0,0,0,0.06)]
                    hover:bg-primary
                    disabled:bg-muted/50 disabled:text-muted-foreground/50 disabled:shadow-none
                    dark:bg-primary/75 dark:hover:bg-primary
                    dark:disabled:bg-muted/30 dark:disabled:text-muted-foreground/40
                    transition-[background,color,transform,opacity,box-shadow]
                    duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]
                    active:scale-[0.96]
                  "
                >
                  <UiIcon name="send" className="size-4" />
                </Button>
            )}
          </PromptInputActions>
        </PromptInput>
        </div>
      </div>
    </motion.div>
  );
}

function getContextualSuggestions(dbType: DatabaseType, hasConnection: boolean): Array<{ label: string; icon: ReactNode }> {
  if (!hasConnection) {
    return [
      { label: "SQL best practices", icon: <UiIcon name="bulb" className="size-3" /> },
      { label: "Database design tips", icon: <UiIcon name="table" className="size-3" /> },
      { label: "Index optimization", icon: <UiIcon name="zap" className="size-3" /> },
      { label: "Query examples", icon: <UiIcon name="code" className="size-3" /> },
    ];
  }

  // Database-specific suggestions
  switch (dbType) {
    case "postgresql":
      return [
        { label: "List all tables", icon: <UiIcon name="table" className="size-3" /> },
        { label: "Show table sizes", icon: <UiIcon name="database" className="size-3" /> },
        { label: "Find slow queries", icon: <UiIcon name="zap" className="size-3" /> },
        { label: "Check indexes", icon: <UiIcon name="search" className="size-3" /> },
        { label: "RLS policies", icon: <UiIcon name="shield" className="size-3" /> },
      ];
    case "mysql":
    case "mariadb":
      return [
        { label: "Show all tables", icon: <UiIcon name="table" className="size-3" /> },
        { label: "Table statuses", icon: <UiIcon name="database" className="size-3" /> },
        { label: "Find missing indexes", icon: <UiIcon name="zap" className="size-3" /> },
        { label: "Check constraints", icon: <UiIcon name="search" className="size-3" /> },
      ];
    case "sqlite":
      return [
        { label: "List tables", icon: <UiIcon name="table" className="size-3" /> },
        { label: "Schema info", icon: <UiIcon name="database" className="size-3" /> },
        { label: "Table sizes", icon: <UiIcon name="zap" className="size-3" /> },
      ];
    case "clickhouse":
      return [
        { label: "List tables", icon: <UiIcon name="table" className="size-3" /> },
        { label: "Table engines", icon: <UiIcon name="database" className="size-3" /> },
        { label: "Partition info", icon: <UiIcon name="zap" className="size-3" /> },
      ];
    case "redis":
      return [
        { label: "List keys", icon: <UiIcon name="key" className="size-3" /> },
        { label: "Memory usage", icon: <UiIcon name="database" className="size-3" /> },
        { label: "Key patterns", icon: <UiIcon name="search" className="size-3" /> },
      ];
    default:
      return [
        { label: "Show tables", icon: <UiIcon name="table" className="size-3" /> },
        { label: "Find recent records", icon: <UiIcon name="search" className="size-3" /> },
        { label: "Explain schema", icon: <UiIcon name="bulb" className="size-3" /> },
        { label: "Optimize query", icon: <UiIcon name="zap" className="size-3" /> },
      ];
  }
}
