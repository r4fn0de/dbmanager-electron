/**
 * AiChatPanel — sidebar panel for conversational AI chat.
 *
 * Embedded in the SQL Editor view as a collapsible side panel.
 * Uses the useAiChat hook to manage streaming chat over Electron IPC.
 */

import { AnimatePresence, motion } from "motion/react";
import { useTheme } from "next-themes";
import {
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { StickToBottomContext } from "use-stick-to-bottom";
import { ClickHouse } from "@/components/icons/ClickHouse";
import { MariaDb } from "@/components/icons/MariaDb";
import { MySql } from "@/components/icons/MySql";
import { Neon } from "@/components/icons/Neon";
import { PostgreSql } from "@/components/icons/PostgreSql";
import { Redis } from "@/components/icons/Redis";
import { Sqlite } from "@/components/icons/Sqlite";
import { Supabase } from "@/components/icons/Supabase";
import { Button } from "@/components/ui/button";
import { CodeBlockCode } from "@/components/ui/code-block";
import { DotmSquare12 } from "@/components/ui/dotm-square-12";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FeedbackBar } from "@/components/ui/feedback-bar";
import { Icon as UiIcon } from "@/components/ui/Icon";
import {
  PromptInput,
  PromptInputActions,
  PromptInputTextarea,
} from "@/components/ui/prompt-input";
import { setPromptInputCursorOffset } from "@/components/ui/prompt-input-mentions";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  findConnectionByMentionName,
  parseMentions,
} from "@/features/ai/lib/mention-utils";
import { useConnectionsList } from "@/features/connection/hooks/useConnectionsList";
import type { DatabaseType } from "@/ipc/db/types";
import type { ConnectionProvider } from "@/lib/stores/connection-tabs";
import { cn } from "@/lib/utils";
import type { UserConnectionsContext } from "@/shared/ai/streaming-contracts";
import { getAiSettings } from "../hooks/ai-actions";
import {
  type AiChatMessage,
  type TextPart,
  type ToolInvocationPart,
  useAiChat,
} from "../hooks/useAiChat";
import { useMessageFeedback } from "../hooks/useAiFeedback";
import { useMentions } from "../hooks/useMentions";
import { ChatTable } from "./ai-elements/chat-table";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
  conversationMotionPresets,
} from "./ai-elements/conversation";
import {
  Message,
  MessageAction,
  MessageContent,
  MessageResponse,
  MessageToolbar,
} from "./ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "./ai-elements/reasoning";
import { Shimmer } from "./ai-elements/shimmer";
import { ChatTool, type ChatToolPart } from "./ai-elements/tool";
import { MentionDropdown } from "./MentionDropdown";

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

function getDatabaseBrandColor(
  dbType: DatabaseType,
  provider?: ConnectionProvider
): {
  bgLight: string;
  textLight: string;
  bgDark: string;
  textDark: string;
} {
  if (provider) {
    switch (provider) {
      case "neon":
        return {
          bgDark: "#00E0D920",
          bgLight: "#00E0D914",
          textDark: "#00E0D9",
          textLight: "#008F8A",
        };
      case "supabase":
        return {
          bgDark: "#3ECF8E20",
          bgLight: "#3ECF8E14",
          textDark: "#3ECF8E",
          textLight: "#1A8A55",
        };
      case "mysql":
        return {
          bgDark: "#00546B20",
          bgLight: "#00546B14",
          textDark: "#4DB8D4",
          textLight: "#00546B",
        };
      case "mariadb":
        return {
          bgDark: "#C49A6C20",
          bgLight: "#C49A6C14",
          textDark: "#D4B07C",
          textLight: "#8B6914",
        };
      case "clickhouse":
        return {
          bgDark: "#FFCC0020",
          bgLight: "#FFCC0014",
          textDark: "#FFD633",
          textLight: "#9A7B00",
        };
      case "redis":
        return {
          bgDark: "#DC382D20",
          bgLight: "#DC382D14",
          textDark: "#EF6B5E",
          textLight: "#DC382D",
        };
    }
  }

  switch (dbType) {
    case "postgresql":
      return {
        bgDark: "#33679120",
        bgLight: "#33679114",
        textDark: "#6BA0D0",
        textLight: "#336791",
      };
    case "mysql":
      return {
        bgDark: "#00546B20",
        bgLight: "#00546B14",
        textDark: "#4DB8D4",
        textLight: "#00546B",
      };
    case "mariadb":
      return {
        bgDark: "#C49A6C20",
        bgLight: "#C49A6C14",
        textDark: "#D4B07C",
        textLight: "#8B6914",
      };
    case "sqlite":
      return {
        bgDark: "#0F80CC20",
        bgLight: "#0F80CC14",
        textDark: "#5CB3E8",
        textLight: "#0F6BA8",
      };
    case "clickhouse":
      return {
        bgDark: "#FFCC0020",
        bgLight: "#FFCC0014",
        textDark: "#FFD633",
        textLight: "#9A7B00",
      };
    case "redis":
      return {
        bgDark: "#DC382D20",
        bgLight: "#DC382D14",
        textDark: "#EF6B5E",
        textLight: "#DC382D",
      };
    default:
      return {
        bgDark: "#33679120",
        bgLight: "#33679114",
        textDark: "#6BA0D0",
        textLight: "#336791",
      };
  }
}

interface AiChatPanelProps {
  /** Additional className for the root element (layout positioning) */
  className?: string;
  /** Active connection ID (optional in global mode) */
  connectionId: string | null;
  /** Optional connection metadata for AI context (host, port, local vs remote) */
  connectionInfo?: {
    name: string;
    host: string;
    port: number;
    database: string;
    isLocal?: boolean;
  };
  /** Active connection display label */
  connectionLabel?: string;
  /** Compact preview of what editor context will be sent to AI */
  contextPreview?: {
    connectionLabel: string;
    dbType: DatabaseType;
    selectionPreview?: string;
    errorPreview?: string;
    tablePreview?: string;
  };
  /** Database engine type */
  dbType: DatabaseType;
  /** Whether the panel is visible */
  isOpen: boolean;
  /** Callback when panel is closed */
  onClose?: () => void;
  /** Callback to insert SQL into the editor */
  onInsertSql?: (sql: string) => void;
  /** Cloud provider (neon, supabase, etc.) — overrides dbType icon when available */
  provider?: ConnectionProvider;
  /** Optional schema context (table/column names) */
  schemaContext?: string;
  /** Optional global connection snapshot for cross-connection questions */
  userConnectionsContext?: UserConnectionsContext;
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
  const isSqlLikeLanguage =
    /^(sql|postgres|postgresql|mysql|mariadb|sqlite|clickhouse)$/i.test(
      displayLang
    );
  const isSqlByContent =
    /\b(select|insert|update|delete|create|alter|drop|with|from|where|join)\b/i.test(
      code
    );
  const canInsertSql = (isSqlLikeLanguage || isSqlByContent) && !!onInsertSql;

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <div className="group/code relative rounded-lg border border-border/40 bg-background/60 backdrop-blur-sm">
      {/* Header bar */}
      <div className="flex items-center justify-between border-border/30 border-b bg-muted/30 px-3 py-1">
        <span className="select-text font-medium text-[11px] text-muted-foreground/80">
          {displayLang}
        </span>
        <div className="flex items-center gap-1 opacity-0 transition-opacity duration-150 ease-out group-focus-within/code:opacity-100 group-hover/code:opacity-100">
          <MessageAction
            label={copied ? "Copied" : "Copy code"}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(code);
                setCopied(true);
              } catch {
                // Ignore copy failures.
              }
            }}
            tooltip={copied ? "Copied" : "Copy code"}
          >
            {copied ? (
              <UiIcon className="size-3" name="check" />
            ) : (
              <UiIcon className="size-3" name="copy" />
            )}
          </MessageAction>
          {canInsertSql && (
            <MessageAction
              label="Insert SQL"
              onClick={() => onInsertSql(code)}
              tooltip="Insert SQL"
            >
              <UiIcon className="size-3" name="code" />
            </MessageAction>
          )}
        </div>
      </div>
      {/* Code content */}
      <div className="w-full overflow-x-auto text-[13px]">
        <CodeBlockCode
          className="[&>pre]:m-0! [&>pre]:rounded-none! [&>pre]:px-4 [&>pre]:py-3"
          code={code}
          language={language || "sql"}
          theme={codeTheme}
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
    if (!text) {
      return null;
    }
    const lowered = text.toLowerCase();
    if (
      lowered.includes("select ") ||
      lowered.includes("insert ") ||
      lowered.includes("update ") ||
      lowered.includes("delete ") ||
      lowered.includes("create ") ||
      lowered.includes("alter ") ||
      lowered.includes("drop ") ||
      lowered.includes("with ")
    ) {
      return text;
    }
    return null;
  }
  if (!value || typeof value !== "object") {
    return null;
  }

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
  const title =
    typeof sourceRecord.title === "string" ? sourceRecord.title.trim() : "";
  const url =
    typeof sourceRecord.url === "string" ? sourceRecord.url.trim() : undefined;
  const sourceType =
    typeof sourceRecord.sourceType === "string"
      ? sourceRecord.sourceType.trim()
      : "";

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

function getToolStatus(
  invocation: ToolCallLike
): "running" | "success" | "error" {
  if (invocation.state === "call") {
    return "running";
  }
  if (invocation.result && typeof invocation.result === "object") {
    const result = invocation.result as Record<string, unknown>;
    if (typeof result.error === "string" && result.error.trim()) {
      return "error";
    }
    if (result.success === false || result.ok === false) {
      return "error";
    }
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
  if (
    status === "error" &&
    invocation.result &&
    typeof invocation.result === "object"
  ) {
    const result = invocation.result as Record<string, unknown>;
    errorText = typeof result.error === "string" ? result.error : undefined;
  }

  // Map invocation state → ChatToolPart state
  const state: ChatToolPart["state"] =
    invocation.state === "pending-approval"
      ? "pending-approval"
      : invocation.state === "call"
        ? "input-streaming"
        : invocation.state === "partial-call"
          ? "input-available"
          : status === "error"
            ? "output-error"
            : "output-available";

  // Safely cast args/output to Record<string, unknown>
  const input =
    invocation.args && typeof invocation.args === "object"
      ? (invocation.args as Record<string, unknown>)
      : undefined;
  const output =
    invocation.result !== undefined && invocation.result !== null
      ? typeof invocation.result === "object"
        ? (invocation.result as Record<string, unknown>)
        : { result: invocation.result }
      : undefined;

  // Extract approval request metadata if present
  const approvalRequest =
    invocation.state === "pending-approval" && invocation.approvalRequest
      ? invocation.approvalRequest
      : undefined;

  return {
    approvalRequest,
    errorText,
    input,
    output,
    state,
    toolCallId: invocation.toolCallId,
    type: invocation.toolName,
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
  const [localRating, setLocalRating] = useState<
    "positive" | "negative" | null
  >(null);
  const [isLoadingExistingFeedback, setIsLoadingExistingFeedback] =
    useState(true);

  const prompt =
    message.parts
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
    connectionId ?? undefined
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

  const handleFeedback = useCallback(
    (newRating: "positive" | "negative") => {
      // Optimistic UI: update immediately so the user sees feedback
      setLocalRating(newRating);

      // Fire-and-forget IPC call
      toggleFeedback(newRating).catch(() => {
        // Revert on failure
        setLocalRating(null);
      });
    },
    [toggleFeedback]
  );

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
        className="origin-left scale-90"
        onClose={() => {
          setIsDismissed(true);
          try {
            localStorage.setItem(dismissStorageKey, "1");
          } catch {
            // Ignore localStorage failures.
          }
        }}
        onHelpful={() => handleFeedback("positive")}
        onNotHelpful={() => handleFeedback("negative")}
        title="Was this helpful?"
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
    if (!copied) {
      return;
    }
    const timer = setTimeout(() => {
      setCopied(false);
    }, 1200);
    return () => clearTimeout(timer);
  }, [copied]);

  const handleCopyMessage = useCallback(async () => {
    if (!message.content) {
      return;
    }
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
        animate={conversationMotionPresets.message.animate}
        exit={conversationMotionPresets.message.exit}
        initial={conversationMotionPresets.message.initial}
        layout="position"
        transition={conversationMotionPresets.message.transition}
      >
        <Message
          className="group/msg w-full max-w-full py-2 pr-3 pl-3"
          from="user"
        >
          <div className="ml-auto flex min-w-0 max-w-[72%] flex-col items-end">
            {(message.contextSnapshot?.selectionPreview ||
              message.contextSnapshot?.errorPreview ||
              message.contextSnapshot?.tablePreview) && (
              <div className="mb-1.5 flex w-full justify-end">
                {message.contextSnapshot?.tablePreview && (
                  <div className="inline-flex max-w-full cursor-default items-center gap-2 rounded-lg bg-muted/50 px-2 py-1">
                    <UiIcon
                      className="size-3.5 shrink-0 text-muted-foreground/70"
                      name="table"
                    />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-[12px] text-foreground/90">
                        {message.contextSnapshot.tablePreview}
                      </p>
                      <p className="text-[11px] text-muted-foreground/70">
                        Selected Table
                      </p>
                    </div>
                  </div>
                )}
                {message.contextSnapshot?.selectionPreview && (
                  <div className="inline-flex min-h-13 w-45.5 max-w-full cursor-default items-center gap-2 rounded-lg bg-muted/50 px-2 py-1.5">
                    <span className="flex size-5 shrink-0 items-center justify-center rounded bg-foreground/8 font-semibold text-[10px] text-muted-foreground">
                      SQL
                    </span>
                    <div className="min-w-0 overflow-hidden">
                      <p className="truncate font-medium text-[12px] text-foreground/90">
                        {message.contextSnapshot.selectionPreview}
                      </p>
                      <p className="text-[11px] text-muted-foreground/70">
                        Selected Text
                      </p>
                    </div>
                  </div>
                )}
                {!message.contextSnapshot?.selectionPreview &&
                  message.contextSnapshot?.errorPreview && (
                    <div className="inline-flex max-w-full cursor-default items-center gap-2 rounded-lg bg-amber-500/8 px-2 py-1">
                      <UiIcon
                        className="size-3.5 shrink-0 text-amber-600/70 dark:text-amber-400/70"
                        name="code"
                      />
                      <div className="min-w-0">
                        <p className="truncate text-[12px] text-amber-700/80 dark:text-amber-300/80">
                          {message.contextSnapshot.errorPreview}
                        </p>
                        <p className="text-[11px] text-amber-600/50 dark:text-amber-400/50">
                          Last Error
                        </p>
                      </div>
                    </div>
                  )}
              </div>
            )}
            {message.content && (
              <p className="wrap-break-word whitespace-pre-wrap rounded-2xl bg-muted/60 px-3.5 py-2 text-[14px] text-foreground leading-6">
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
        renderedParts.push({
          invocations: [...pendingTools],
          kind: "tool-group",
        });
        pendingTools = [];
      }
      const segments = splitTextIntoSegments(part.text);
      if (segments.length > 0) {
        renderedParts.push({ kind: "text-segments", segments });
      }
    } else if (part.type === "reasoning") {
      if (pendingTools.length > 0) {
        renderedParts.push({
          invocations: [...pendingTools],
          kind: "tool-group",
        });
        pendingTools = [];
      }
      if (part.text.trim()) {
        renderedParts.push({ kind: "reasoning", reasoningText: part.text });
      }
    } else if (part.type === "source") {
      if (pendingTools.length > 0) {
        renderedParts.push({
          invocations: [...pendingTools],
          kind: "tool-group",
        });
        pendingTools = [];
      }
      renderedParts.push({ kind: "source", source: part.source });
    }
  }
  // Flush any remaining tool invocations at the end
  if (pendingTools.length > 0) {
    renderedParts.push({ invocations: [...pendingTools], kind: "tool-group" });
  }

  const hasContent = renderedParts.length > 0;

  return (
    <motion.div
      animate={conversationMotionPresets.message.animate}
      exit={conversationMotionPresets.message.exit}
      initial={conversationMotionPresets.message.initial}
      layout="position"
      transition={conversationMotionPresets.message.transition}
    >
      <Message
        className="group/msg w-full max-w-full py-2 pr-2 pl-1"
        from="assistant"
      >
        <div className="flex min-w-0 flex-col gap-1.5">
          {/* Render parts in their original interleaved order */}
          {hasContent && (
            <div className="space-y-3">
              {renderedParts.map((block, blockIndex) =>
                block.kind === "tool-group" ? (
                  <div className="space-y-2" key={`tools-${blockIndex}`}>
                    {block.invocations!.map((tip) => {
                      const chatToolPart = toChatToolPart(tip.toolInvocation);
                      const sqlFromTool =
                        extractSqlSnippet(tip.toolInvocation.result) ??
                        extractSqlSnippet(tip.toolInvocation.args);
                      return (
                        <div key={tip.toolInvocation.toolCallId}>
                          <ChatTool
                            className="mt-1"
                            defaultOpen
                            onApprove={onApproveToolCall}
                            onReject={onRejectToolCall}
                            toolPart={chatToolPart}
                          />
                          {sqlFromTool &&
                            onInsertSql &&
                            tip.toolInvocation.state === "result" && (
                              <MessageAction
                                className="mt-1 ml-1"
                                label="Insert SQL"
                                onClick={() => onInsertSql(sqlFromTool)}
                                tooltip="Insert SQL from tool"
                              >
                                <UiIcon className="size-3.5" name="code" />
                              </MessageAction>
                            )}
                        </div>
                      );
                    })}
                  </div>
                ) : block.kind === "reasoning" ? (
                  <Reasoning
                    className="mb-1 rounded-md border border-border/30 bg-muted/20 px-3 py-2"
                    defaultOpen={false}
                    isStreaming={message.isStreaming}
                    key={`reasoning-${blockIndex}`}
                  >
                    <ReasoningTrigger className="text-muted-foreground/80 text-xs">
                      <span className="inline-flex items-center gap-1.5">
                        <UiIcon className="size-3.5" name="brain" />
                        Reasoning
                      </span>
                    </ReasoningTrigger>
                    <ReasoningContent className="mt-2 text-xs leading-6">
                      {block.reasoningText ?? ""}
                    </ReasoningContent>
                  </Reasoning>
                ) : block.kind === "source" ? (
                  <div
                    className="rounded-md border border-border/30 bg-muted/20 px-3 py-2 text-muted-foreground text-xs"
                    key={`source-${blockIndex}`}
                  >
                    {(() => {
                      const sourceMeta = extractSourceMeta(block.source);
                      return sourceMeta.url ? (
                        <a
                          className="inline-flex items-center gap-1.5 text-primary underline-offset-4 hover:underline"
                          href={sourceMeta.url}
                          rel="noreferrer"
                          target="_blank"
                        >
                          <UiIcon className="size-3.5" name="link" />
                          {sourceMeta.label}
                        </a>
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          <UiIcon className="size-3.5" name="link" />
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
                          className={ASSISTANT_PROSE_CLASS}
                          key={`seg-${segIndex}`}
                        >
                          <MessageResponse isStreaming={message.isStreaming}>
                            {seg.content}
                          </MessageResponse>
                        </MessageContent>
                      ) : seg.type === "code" ? (
                        <AssistantCodeBlock
                          code={seg.code}
                          codeTheme={codeTheme}
                          isStreaming={message.isStreaming}
                          key={`seg-${segIndex}`}
                          language={seg.language}
                          onInsertSql={onInsertSql}
                        />
                      ) : (
                        <ChatTable
                          className="my-1"
                          isStreaming={message.isStreaming}
                          key={`seg-${segIndex}`}
                          markdown={seg.markdown}
                        />
                      )
                    )}
                  </Fragment>
                )
              )}
            </div>
          )}

          {!message.isStreaming && (message.content || firstSqlBlock) && (
            <MessageToolbar className="mt-0 justify-start gap-1.5">
              <MessageAction
                disabled={!message.content}
                label={copied ? "Copied" : "Copy response"}
                onClick={handleCopyMessage}
                tooltip={copied ? "Copied" : "Copy response"}
              >
                {copied ? (
                  <UiIcon className="size-3.5" name="check" />
                ) : (
                  <UiIcon className="size-3.5" name="copy" />
                )}
              </MessageAction>
              <MessageAction
                disabled={!(onInsertSql && firstSqlBlock)}
                label="Insert first SQL block"
                onClick={() => {
                  if (firstSqlBlock?.type === "code" && onInsertSql) {
                    onInsertSql(firstSqlBlock.code);
                  }
                }}
                tooltip="Insert first SQL block"
              >
                <UiIcon className="size-3.5" name="code" />
              </MessageAction>
            </MessageToolbar>
          )}

          {/* Feedback buttons for completed assistant messages — show only ~25% of the time */}
          {!message.isStreaming && message.role === "assistant" && !isUser && (
            <AiMessageFeedback
              connectionId={connectionId}
              conversationId={conversationId}
              message={message}
              showFeedback={shouldShowFeedback(message.id)}
            />
          )}

          {/* Thinking indicator — ai-elements Reasoning, minimal style */}
          {message.isStreaming && !message.content && (
            <Reasoning className="mb-0! px-3" isStreaming>
              <ReasoningTrigger className="gap-1.5 py-1 text-xs">
                <DotmSquare12
                  animated
                  aria-hidden
                  className="shrink-0 opacity-85"
                  dotSize={2}
                  hoverAnimated={false}
                  pattern="full"
                  size={14}
                  speed={1.2}
                />
                <Shimmer
                  as="span"
                  className="font-medium text-xs"
                  duration={1.8}
                  spread={1.4}
                >
                  Thinking…
                </Shimmer>
              </ReasoningTrigger>
            </Reasoning>
          )}
          {/* No-content fallback for completed/aborted messages */}
          {!(message.isStreaming || hasContent) && (
            <p className="px-3 text-muted-foreground text-xs">No response</p>
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
  if (!text) {
    return [];
  }

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
        code: normalizedCode,
        language: language?.trim() || undefined,
        type: "code",
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
          code: openFenceCode,
          language: openFenceMatch[1]?.trim() || undefined,
          type: "code",
        });
      }
    } else {
      pushProseSegments(segments, trailing);
    }
  }

  if (segments.length === 0) {
    segments.push({ content: text, type: "text" });
  }

  return segments;
}

/**
 * Splits prose text into alternating text and markdown-table segments.
 * A markdown table is a block of consecutive lines starting with `|`.
 */
function pushProseSegments(segments: TextSegment[], raw: string): void {
  const trimmed = raw.trim();
  if (!trimmed) {
    return;
  }

  const lines = trimmed.split("\n");
  // Group consecutive |-prefixed lines into blocks.
  // A valid markdown table needs at least 2 lines (header + separator).
  // Single |-prefixed lines are kept as prose to avoid false positives.
  const blocks: Array<{ kind: "prose" | "table"; lines: string[] }> = [];
  let currentKind: "prose" | "table" | null = null;

  for (const line of lines) {
    const isTableLine = line.trimStart().startsWith("|");
    const kind = isTableLine ? "table" : "prose";

    if (kind === currentKind) {
      blocks[blocks.length - 1].lines.push(line);
    } else {
      blocks.push({ kind, lines: [line] });
      currentKind = kind;
    }
  }

  for (const block of blocks) {
    const content = block.lines.join("\n");
    if (block.kind === "table" && block.lines.length >= 2) {
      segments.push({ markdown: content, type: "table" });
    } else {
      const prose = content.trim();
      if (prose) {
        segments.push({ content: prose, type: "text" });
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

  const [providerIsLocal, setProviderIsLocal] = useState(false);

  useEffect(() => {
    getAiSettings().then((providersInfo) => {
      setProviderIsLocal(providersInfo.current.provider === "ollama");
    });
  }, []);

  const {
    messages,
    conversations,
    activeConversationId,
    isLoading,
    error,
    clearError,
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
    connectionInfo,
    connectionLabel,
    dbType,
    schemaContext,
    userConnectionsContext,
  });

  const [input, setInput] = useState("");
  const [lastSubmittedPrompt, setLastSubmittedPrompt] = useState("");
  const [dismissedContext, setDismissedContext] = useState<{
    selection: boolean;
    error: boolean;
    table: boolean;
  }>({ error: false, selection: false, table: false });
  const [exitingContext, setExitingContext] = useState<{
    selection: boolean;
    error: boolean;
    table: boolean;
  }>({ error: false, selection: false, table: false });
  const inputRef = useRef<HTMLDivElement>(null);
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
      if (!connection) {
        return;
      }
      const result = selectMention(connection);
      if (result !== null) {
        setInput(result.text);
        // Focus and place cursor after the inserted mention token.
        requestAnimationFrame(() => {
          const editor = inputRef.current;
          if (!editor) {
            return;
          }
          editor.focus();
          setPromptInputCursorOffset(editor, result.cursorPos);
        });
      }
    },
    [mentionState.filteredConnections, selectMention]
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

    if (
      !(isOpen && activeConversationId && (openedNow || conversationChanged))
    ) {
      return;
    }

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
    setDismissedContext({ error: false, selection: false, table: false });
    setExitingContext({ error: false, selection: false, table: false });
  }, [
    contextPreview?.selectionPreview,
    contextPreview?.errorPreview,
    contextPreview?.tablePreview,
  ]);

  useEffect(
    () => () => {
      if (contextDismissTimeoutsRef.current.selection) {
        clearTimeout(contextDismissTimeoutsRef.current.selection);
      }
      if (contextDismissTimeoutsRef.current.error) {
        clearTimeout(contextDismissTimeoutsRef.current.error);
      }
      if (contextDismissTimeoutsRef.current.table) {
        clearTimeout(contextDismissTimeoutsRef.current.table);
      }
    },
    []
  );

  const showSelectionContextChip = Boolean(
    contextPreview?.selectionPreview && !dismissedContext.selection
  );
  const showErrorContextChip = Boolean(
    contextPreview?.errorPreview && !dismissedContext.error
  );
  const showTableContextChip = Boolean(
    contextPreview?.tablePreview && !dismissedContext.table
  );

  const hasChips =
    showSelectionContextChip ||
    showErrorContextChip ||
    showTableContextChip ||
    exitingContext.selection ||
    exitingContext.error ||
    exitingContext.table;

  const inlineMentions = useMemo(
    () =>
      Array.from(selectedMentions.values()).map((connection) => ({
        id: connection.id,
        label: connection.name,
      })),
    [selectedMentions]
  );

  const handleInputChange = useCallback(
    (value: string, cursorPos?: number) => {
      setInput(value);
      if (cursorPos !== undefined) {
        handleTextChange(value, cursorPos);
      }
    },
    [handleTextChange]
  );

  const handleTextareaKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const handled = handleMentionKeyDown(event);
      if (handled && event.key === "Enter") {
        // Enter was consumed by mention dropdown for selection
        handleMentionSelect(mentionState.activeIndex);
      }
    },
    [handleMentionKeyDown, mentionState.activeIndex, handleMentionSelect]
  );

  const handleSubmit = useCallback(() => {
    if (!input.trim() || isLoading) {
      return;
    }

    // Close mention dropdown if open
    closeMention();

    const contextSnapshot = {
      errorPreview:
        showErrorContextChip && contextPreview?.errorPreview
          ? contextPreview.errorPreview
          : undefined,
      selectionPreview:
        showSelectionContextChip && contextPreview?.selectionPreview
          ? contextPreview.selectionPreview
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
    if (
      showSelectionContextChip ||
      showErrorContextChip ||
      showTableContextChip
    ) {
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
    const typedMentionConnection =
      mentionNames.length > 0
        ? findConnectionByMentionName(connections, mentionNames[0])
        : undefined;
    const mentionedConnection =
      selectedMentionConnection ?? typedMentionConnection;

    const prompt = input.trim();
    sendMessage(prompt, {
      contextSnapshot:
        contextSnapshot.selectionPreview ||
        contextSnapshot.errorPreview ||
        contextSnapshot.tablePreview
          ? contextSnapshot
          : undefined,
      mentionedConnectionId: mentionedConnection?.id ?? null,
    });
    setLastSubmittedPrompt(prompt);
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

  const handleRetryLastPrompt = useCallback(() => {
    if (!lastSubmittedPrompt || isLoading) {
      return;
    }
    clearError();
    sendMessage(lastSubmittedPrompt);
  }, [clearError, isLoading, lastSubmittedPrompt, sendMessage]);

  const handleDismissContextChip = useCallback(
    (kind: "selection" | "error" | "table") => {
      setExitingContext((prev) => ({ ...prev, [kind]: true }));
      const existing = contextDismissTimeoutsRef.current[kind];
      if (existing) {
        clearTimeout(existing);
      }
      contextDismissTimeoutsRef.current[kind] = setTimeout(() => {
        setDismissedContext((prev) => ({ ...prev, [kind]: true }));
        setExitingContext((prev) => ({ ...prev, [kind]: false }));
        contextDismissTimeoutsRef.current[kind] = undefined;
      }, 250);
    },
    []
  );

  const dismissSelectionChip = useCallback(
    () => handleDismissContextChip("selection"),
    [handleDismissContextChip]
  );
  const dismissErrorChip = useCallback(
    () => handleDismissContextChip("error"),
    [handleDismissContextChip]
  );
  const dismissTableChip = useCallback(
    () => handleDismissContextChip("table"),
    [handleDismissContextChip]
  );

  const isEmpty = messages.length === 0;
  const hasActiveConnection = Boolean(connectionId);
  const currentConnectionLabel =
    contextPreview?.connectionLabel ||
    connectionLabel ||
    connectionId ||
    "No connection";
  const activeConversation =
    conversations.find(
      (conversation) => conversation.id === activeConversationId
    ) ?? null;

  return (
    <motion.div
      className={cn(
        "relative flex h-full flex-col overflow-hidden rounded-b-md bg-transparent",
        className
      )}
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
                  className="inline-flex h-4.5 shrink-0 items-center gap-1.5 rounded-full px-2 font-medium text-[10px] transition-[background,color] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]"
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
            <span className="inline-flex h-4.5 shrink-0 items-center gap-1.5 rounded-full bg-muted/40 px-2 font-medium text-[10px] text-muted-foreground/70 transition-[background,color] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] dark:bg-muted/30 dark:text-muted-foreground/60">
              <UiIcon className="size-3" name="database" />
              <span>Global</span>
            </span>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  className="h-7 min-w-0 max-w-35 xs:max-w-45 flex-1 justify-between px-2 font-semibold text-xs tracking-tight sm:max-w-52.5"
                  size="sm"
                  variant="ghost"
                >
                  <span className="shrink truncate">
                    {activeConversation?.title ?? "AI Chat"}
                  </span>
                  <UiIcon
                    className="ml-1 size-3 shrink-0 opacity-70"
                    name="chevron-down"
                  />
                </Button>
              }
            />
            <DropdownMenuContent
              align="start"
              className="w-72.5 p-1"
              side="bottom"
            >
              <div className="px-2 py-1 font-semibold text-[11px] text-muted-foreground/70 uppercase tracking-wide">
                History
              </div>
              <DropdownMenuItem
                className="my-0.5 gap-2 rounded-md transition-[transform,background] duration-150 ease-out active:scale-[0.97]"
                disabled={isLoading}
                onClick={startNewConversation}
              >
                <UiIcon className="size-3.5" name="plus" />
                New conversation
              </DropdownMenuItem>
              <DropdownMenuSeparator className="my-1" />
              {conversations.length === 0 ? (
                <div className="px-2 py-4 text-center text-muted-foreground/60 text-xs">
                  No conversations yet
                </div>
              ) : (
                <div className="-mx-1 max-h-60 overflow-y-auto overscroll-contain px-1">
                  {conversations.map((conversation, index) => {
                    const isActive = conversation.id === activeConversationId;
                    return (
                      <DropdownMenuItem
                        className={cn(
                          "my-0.5 flex items-center justify-between gap-2 rounded-md px-2 py-1.5",
                          "transition-[transform,background] duration-150 ease-out active:scale-[0.97]",
                          "motion-safe:fade-in-0 motion-safe:slide-in-from-left-1 motion-safe:animate-in",
                          isActive && "bg-primary/5"
                        )}
                        disabled={isLoading}
                        key={conversation.id}
                        onClick={() => selectConversation(conversation.id)}
                        style={{
                          animationDelay: `${index * 40}ms`,
                          animationFillMode: "backwards",
                        }}
                      >
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <div className="flex items-center gap-1.5">
                            {isActive && (
                              <span className="motion-safe:zoom-in-50 size-1.5 shrink-0 rounded-full bg-primary motion-safe:animate-in motion-safe:duration-150" />
                            )}
                            <span
                              className={cn(
                                "truncate font-medium text-xs",
                                isActive
                                  ? "text-foreground"
                                  : "text-foreground/80"
                              )}
                            >
                              {conversation.title}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 pl-3">
                            <span className="truncate text-[10px] text-muted-foreground/70">
                              {conversation.contextTag?.connectionLabel ||
                                conversation.contextTag?.connectionId ||
                                "No connection"}
                            </span>
                            <span className="text-[10px] text-muted-foreground/40">
                              ·
                            </span>
                            <span className="text-[10px] text-muted-foreground/50 tabular-nums">
                              {new Intl.DateTimeFormat(undefined, {
                                day: "2-digit",
                                hour: "2-digit",
                                minute: "2-digit",
                                month: "2-digit",
                              }).format(new Date(conversation.updatedAt))}
                            </span>
                          </div>
                        </div>
                        <button
                          aria-label="Delete conversation"
                          className="rounded p-1 text-muted-foreground/50 transition-[color,transform] duration-150 ease-out hover:text-destructive active:scale-[0.93] disabled:opacity-30"
                          disabled={conversations.length === 1 || isLoading}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            deleteConversation(conversation.id);
                          }}
                          type="button"
                        >
                          <UiIcon className="size-3" name="trash" />
                        </button>
                      </DropdownMenuItem>
                    );
                  })}
                </div>
              )}
              <DropdownMenuSeparator className="my-1" />
              <DropdownMenuItem
                className="my-0.5 gap-2 rounded-md text-muted-foreground transition-[transform,background] duration-150 ease-out active:scale-[0.97]"
                disabled={isLoading || conversations.length === 0}
                onClick={clearAllConversations}
              >
                <UiIcon className="size-3.5" name="trash" />
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
                  className="text-muted-foreground transition-[color,transform] duration-150 ease-out hover:text-foreground active:scale-[0.97]"
                  disabled={isLoading}
                  onClick={startNewConversation}
                  size="icon-xs"
                  variant="ghost"
                >
                  <UiIcon className="size-3.5" name="plus" />
                </Button>
              }
            />
            <TooltipContent>New conversation</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  className="text-muted-foreground transition-[color,transform] duration-150 ease-out hover:text-foreground active:scale-[0.97]"
                  disabled={isEmpty || isLoading}
                  onClick={clearMessages}
                  size="icon-xs"
                  variant="ghost"
                >
                  <UiIcon className="size-3.5" name="trash" />
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
                    className="text-muted-foreground transition-[color,transform] duration-150 ease-out hover:text-foreground active:scale-[0.97]"
                    onClick={onClose}
                    size="icon-xs"
                    variant="ghost"
                  >
                    <UiIcon className="size-3.5" name="panel-right" />
                  </Button>
                }
              />
              <TooltipContent>Close panel</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Messages — auto-scroll via StickToBottom */}
      <Conversation
        className="-mb-2 min-h-0 flex-1"
        contextRef={conversationRef}
      >
        <ConversationContent
          className="flex flex-col gap-0 pr-0 pl-3"
          key={activeConversationId ?? "no-conversation"}
        >
          {isEmpty ? (
            <ConversationEmptyState>
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                <UiIcon className="size-5 text-primary" name="bot" />
              </div>
              <div className="space-y-1 text-center">
                <p className="font-medium text-sm">AI SQL Assistant</p>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  Ask about your database schema, generate queries, or fix
                  errors.
                </p>
              </div>
              <div className="mt-2 flex flex-wrap justify-center gap-1.5">
                {getContextualSuggestions(dbType, hasActiveConnection).map(
                  (suggestion, index) => (
                    <button
                      className="group/suggest motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1.5 inline-flex items-center gap-1.5 rounded-full bg-muted/40 px-3 py-1.5 font-medium text-[11px] text-muted-foreground/80 transition-[background,color,transform,opacity] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-muted/70 hover:text-foreground/90 active:scale-[0.96] active:opacity-70 motion-safe:animate-in motion-safe:duration-200 motion-safe:ease-out dark:bg-muted/25 dark:text-muted-foreground/70 dark:hover:bg-muted/50 dark:hover:text-foreground/80"
                      key={suggestion.label}
                      onClick={() => sendMessage(suggestion.label)}
                      style={{
                        animationDelay: `${index * 60}ms`,
                        animationFillMode: "backwards",
                      }}
                      type="button"
                    >
                      <span className="shrink-0 text-muted-foreground/60 transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] group-active/suggest:scale-95">
                        {suggestion.icon}
                      </span>
                      {suggestion.label}
                    </button>
                  )
                )}
              </div>
            </ConversationEmptyState>
          ) : (
            <AnimatePresence initial={false} mode="popLayout">
              {messages.map((msg) => (
                <ChatMessage
                  codeTheme={codeTheme}
                  connectionId={connectionId}
                  conversationId={activeConversationId!}
                  key={msg.id}
                  message={msg}
                  onApproveToolCall={approveToolCall}
                  onInsertSql={onInsertSql}
                  onRejectToolCall={rejectToolCall}
                />
              ))}
            </AnimatePresence>
          )}
        </ConversationContent>
        <ConversationScrollButton className="bottom-8 z-40" />
      </Conversation>

      {/* Input */}
      <div className="z-30 shrink-0 py-2 pr-3 pl-4">
        {error && (
          <div className="motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 relative z-10 mb-2 rounded-md border border-red-500/30 bg-red-500/8 px-2.5 py-2 text-red-700 text-xs motion-safe:animate-in motion-safe:duration-150 dark:text-red-300">
            <div className="flex items-start gap-2">
              <UiIcon
                className="mt-0.5 size-3.5 shrink-0"
                name="alert-triangle"
              />
              <div className="min-w-0 flex-1">
                <p className="font-medium">Streaming failed</p>
                <p className="mt-0.5 break-words text-red-700/90 dark:text-red-300/90">
                  {error}
                </p>
                <div className="mt-2 flex items-center gap-1.5">
                  <Button
                    className="h-6 border-red-500/30 bg-transparent px-2 text-[11px] text-red-700 hover:bg-red-500/10 dark:text-red-300"
                    disabled={!lastSubmittedPrompt || isLoading}
                    onClick={handleRetryLastPrompt}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Retry
                  </Button>
                  <Button
                    className="h-6 px-2 text-[11px] text-red-700/80 hover:bg-red-500/10 hover:text-red-700 dark:text-red-300/80 dark:hover:text-red-300"
                    onClick={clearError}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
        <div className="relative">
          {/* Mention dropdown */}
          {mentionState.isOpen && (
            <MentionDropdown
              activeIndex={mentionState.activeIndex}
              connections={mentionState.filteredConnections}
              onClose={closeMention}
              onSelect={(connection) => {
                const selectedIndex =
                  mentionState.filteredConnections.findIndex(
                    (item) => item.id === connection.id
                  );
                if (selectedIndex >= 0) {
                  handleMentionSelect(selectedIndex);
                }
              }}
              ref={mentionDropdownRef}
            />
          )}
          <PromptInput
            className={cn(
              "relative z-30 rounded-2xl border border-border/30",
              "bg-background/60 px-2 shadow-none backdrop-blur-md",
              "dark:bg-background/50",
              "focus-within:border-border/50 focus-within:bg-background/70",
              "dark:focus-within:bg-background/60",
              "transition-[background,border-color,padding] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
              hasChips ? "pt-3 pb-1" : "py-1"
            )}
            isLoading={isLoading}
            onClick={() => inputRef.current?.focus()}
            onCursorChange={handleInputChange}
            onSubmit={handleSubmit}
            onValueChange={handleInputChange}
            value={input}
          >
            {hasChips ? (
              <div className="flex flex-wrap items-center gap-1 px-1.5 pb-1.5">
                <AnimatePresence>
                  {showSelectionContextChip ? (
                    <motion.div
                      animate={{ opacity: 1, scale: 1 }}
                      className="group/ctx inline-flex h-[18px] min-w-0 max-w-[14rem] cursor-default items-center gap-1 rounded bg-muted/60 px-1 text-foreground/80 text-sm leading-none transition-colors hover:bg-muted/80 dark:bg-muted/40 dark:hover:bg-muted/60"
                      exit={{ opacity: 0, scale: 0.9 }}
                      initial={{ opacity: 0, scale: 0.9 }}
                      key="selection-context"
                      layout="position"
                      title={contextPreview?.selectionPreview}
                      transition={{ duration: 0.15, ease: [0.23, 1, 0.32, 1] }}
                    >
                      <span className="pointer-events-none inline-flex shrink-0 items-center group-hover/ctx:hidden">
                        <span className="flex size-3.5 shrink-0 items-center justify-center rounded bg-foreground/10 font-semibold text-[8px] text-foreground/80">
                          AI
                        </span>
                      </span>
                      <button
                        aria-label="Remove selected text context"
                        className="hidden shrink-0 items-center text-muted-foreground transition-colors hover:text-foreground group-hover/ctx:inline-flex"
                        onClick={dismissSelectionChip}
                        tabIndex={-1}
                        type="button"
                      >
                        <UiIcon className="size-3.5" name="x" />
                      </button>
                      <span className="truncate">
                        {contextPreview?.selectionPreview}
                      </span>
                    </motion.div>
                  ) : null}
                  {showErrorContextChip ? (
                    <motion.div
                      animate={{ opacity: 1, scale: 1 }}
                      className="group/ctx inline-flex h-[18px] min-w-0 max-w-[14rem] cursor-default items-center gap-1 rounded bg-amber-500/15 px-1 text-amber-800 text-sm leading-none transition-colors hover:bg-amber-500/25 dark:bg-amber-400/20 dark:text-amber-200 dark:hover:bg-amber-400/30"
                      exit={{ opacity: 0, scale: 0.9 }}
                      initial={{ opacity: 0, scale: 0.9 }}
                      key="error-context"
                      layout="position"
                      title={contextPreview?.errorPreview}
                      transition={{ duration: 0.15, ease: [0.23, 1, 0.32, 1] }}
                    >
                      <span className="pointer-events-none inline-flex shrink-0 items-center group-hover/ctx:hidden">
                        <UiIcon
                          className="size-3.5 shrink-0 text-amber-700 dark:text-amber-300"
                          name="code"
                        />
                      </span>
                      <button
                        aria-label="Remove error context"
                        className="hidden shrink-0 items-center text-amber-700 transition-colors hover:opacity-80 group-hover/ctx:inline-flex dark:text-amber-300"
                        onClick={dismissErrorChip}
                        tabIndex={-1}
                        type="button"
                      >
                        <UiIcon className="size-3.5" name="x" />
                      </button>
                      <span className="truncate">
                        {contextPreview?.errorPreview}
                      </span>
                    </motion.div>
                  ) : null}
                  {showTableContextChip ? (
                    <motion.div
                      animate={{ opacity: 1, scale: 1 }}
                      className="group/ctx inline-flex h-[18px] min-w-0 max-w-[14rem] cursor-default items-center gap-1 rounded bg-muted/60 px-1 text-foreground/80 text-sm leading-none transition-colors hover:bg-muted/80 dark:bg-muted/40 dark:hover:bg-muted/60"
                      exit={{ opacity: 0, scale: 0.9 }}
                      initial={{ opacity: 0, scale: 0.9 }}
                      key="table-context"
                      layout="position"
                      title={contextPreview?.tablePreview}
                      transition={{ duration: 0.15, ease: [0.23, 1, 0.32, 1] }}
                    >
                      <span className="pointer-events-none inline-flex shrink-0 items-center group-hover/ctx:hidden">
                        <UiIcon
                          className="size-3.5 shrink-0 text-muted-foreground"
                          name="table"
                        />
                      </span>
                      <button
                        aria-label="Remove table context"
                        className="hidden shrink-0 items-center text-muted-foreground transition-colors hover:text-foreground group-hover/ctx:inline-flex"
                        onClick={dismissTableChip}
                        tabIndex={-1}
                        type="button"
                      >
                        <UiIcon className="size-3.5" name="x" />
                      </button>
                      <span className="truncate">
                        {contextPreview?.tablePreview}
                      </span>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </div>
            ) : null}
            <div className="flex items-center px-1.5 py-0">
              <PromptInputTextarea
                className={cn(
                  "max-h-62.5 min-h-10 w-auto! min-w-32 flex-1 basis-32 overflow-y-auto py-0 text-sm leading-5",
                  "placeholder:text-muted-foreground/50",
                  "dark:bg-transparent",
                  "px-0"
                )}
                inlineMentions={inlineMentions}
                onInlineMentionRemove={(mention) => removeMention(mention.id)}
                onKeyDown={handleTextareaKeyDown}
                placeholder={
                  hasActiveConnection
                    ? "Ask about your database…"
                    : "Ask anything about SQL, modeling, or debugging…"
                }
                ref={inputRef}
              />
            </div>
            <PromptInputActions className="justify-end gap-2 pt-1 pr-0.5 pb-1.5 pl-2">
              {isLoading ? (
                <Button
                  className="h-7 w-7 rounded-full border border-border/30 bg-background/50 text-muted-foreground backdrop-blur-sm transition-[background,color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-background/70 hover:text-foreground active:scale-[0.96] dark:border-border/20 dark:bg-background/40 dark:hover:bg-background/60"
                  onClick={abort}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <UiIcon className="size-4" name="square" />
                </Button>
              ) : (
                <Button
                  className="h-7 w-7 rounded-full bg-primary/85 text-primary-foreground shadow-[0_1px_2px_rgba(0,0,0,0.06)] transition-[background,color,transform,opacity,box-shadow] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-primary active:scale-[0.96] disabled:bg-muted/50 disabled:text-muted-foreground/50 disabled:shadow-none dark:bg-primary/75 dark:disabled:bg-muted/30 dark:disabled:text-muted-foreground/40 dark:hover:bg-primary"
                  disabled={!input.trim()}
                  onClick={handleSubmit}
                  size="icon-sm"
                  type="button"
                >
                  <UiIcon className="size-4" name="send" />
                </Button>
              )}
            </PromptInputActions>
          </PromptInput>
          {/* Data locality indicator */}
          <div className="flex items-center justify-center gap-1.5 px-2 pt-1">
            {providerIsLocal ? (
              <span className="flex items-center gap-1 text-[10px] text-emerald-600/70 dark:text-emerald-400/50">
                <UiIcon className="size-3" name="shield-check" />
                Local model - data stays on device
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[10px] text-amber-600/60 dark:text-amber-400/40">
                <UiIcon className="size-3" name="cloud" />
                Data sent to external provider
              </span>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function getContextualSuggestions(
  dbType: DatabaseType,
  hasConnection: boolean
): Array<{ label: string; icon: ReactNode }> {
  if (!hasConnection) {
    return [
      {
        icon: <UiIcon className="size-3" name="bulb" />,
        label: "SQL best practices",
      },
      {
        icon: <UiIcon className="size-3" name="table" />,
        label: "Database design tips",
      },
      {
        icon: <UiIcon className="size-3" name="zap" />,
        label: "Index optimization",
      },
      {
        icon: <UiIcon className="size-3" name="code" />,
        label: "Query examples",
      },
    ];
  }

  // Database-specific suggestions
  switch (dbType) {
    case "postgresql":
      return [
        {
          icon: <UiIcon className="size-3" name="table" />,
          label: "List all tables",
        },
        {
          icon: <UiIcon className="size-3" name="database" />,
          label: "Show table sizes",
        },
        {
          icon: <UiIcon className="size-3" name="zap" />,
          label: "Find slow queries",
        },
        {
          icon: <UiIcon className="size-3" name="search" />,
          label: "Check indexes",
        },
        {
          icon: <UiIcon className="size-3" name="shield" />,
          label: "RLS policies",
        },
      ];
    case "mysql":
    case "mariadb":
      return [
        {
          icon: <UiIcon className="size-3" name="table" />,
          label: "Show all tables",
        },
        {
          icon: <UiIcon className="size-3" name="database" />,
          label: "Table statuses",
        },
        {
          icon: <UiIcon className="size-3" name="zap" />,
          label: "Find missing indexes",
        },
        {
          icon: <UiIcon className="size-3" name="search" />,
          label: "Check constraints",
        },
      ];
    case "sqlite":
      return [
        {
          icon: <UiIcon className="size-3" name="table" />,
          label: "List tables",
        },
        {
          icon: <UiIcon className="size-3" name="database" />,
          label: "Schema info",
        },
        {
          icon: <UiIcon className="size-3" name="zap" />,
          label: "Table sizes",
        },
      ];
    case "clickhouse":
      return [
        {
          icon: <UiIcon className="size-3" name="table" />,
          label: "List tables",
        },
        {
          icon: <UiIcon className="size-3" name="database" />,
          label: "Table engines",
        },
        {
          icon: <UiIcon className="size-3" name="zap" />,
          label: "Partition info",
        },
      ];
    case "redis":
      return [
        { icon: <UiIcon className="size-3" name="key" />, label: "List keys" },
        {
          icon: <UiIcon className="size-3" name="database" />,
          label: "Memory usage",
        },
        {
          icon: <UiIcon className="size-3" name="search" />,
          label: "Key patterns",
        },
      ];
    default:
      return [
        {
          icon: <UiIcon className="size-3" name="table" />,
          label: "Show tables",
        },
        {
          icon: <UiIcon className="size-3" name="search" />,
          label: "Find recent records",
        },
        {
          icon: <UiIcon className="size-3" name="bulb" />,
          label: "Explain schema",
        },
        {
          icon: <UiIcon className="size-3" name="zap" />,
          label: "Optimize query",
        },
      ];
  }
}
