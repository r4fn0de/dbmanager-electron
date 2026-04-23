/**
 * AiChatPanel — sidebar panel for conversational AI chat.
 *
 * Embedded in the SQL Editor view as a collapsible side panel.
 * Uses the useAiChat hook to manage streaming chat over Electron IPC.
 */
import {
  AlertCircle,
  Bot,
  Check,
  CircleDashed,
  ChevronDown,
  Copy,
  Code2,
  PanelRight,
  Plus,
  Send,
  Square,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
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
import { useTheme } from "next-themes";
import { useCallback, useEffect, useRef, useState } from "react";
import type { StickToBottomContext } from "use-stick-to-bottom";
import { Button } from "@/components/ui/button";
import { CodeBlock, CodeBlockCode } from "@/components/ui/code-block";
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
import { useAiChat, type AiChatMessage } from "@/hooks/useAiChat";
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
  /** Callback to insert SQL into the editor */
  onInsertSql?: (sql: string) => void;
  /** Callback when panel is closed */
  onClose?: () => void;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

type ToolCallLike = NonNullable<AiChatMessage["toolCalls"]>[number];

function stringifyPayload(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function compactPreview(value: unknown, max = 128): string {
  const normalized = stringifyPayload(value).replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}

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

function getToolStatus(toolCall: ToolCallLike, isStreaming: boolean): "running" | "success" | "error" {
  if (isStreaming && toolCall.result === undefined) return "running";
  if (toolCall.result && typeof toolCall.result === "object") {
    const result = toolCall.result as Record<string, unknown>;
    if (typeof result.error === "string" && result.error.trim()) return "error";
    if (result.success === false || result.ok === false) return "error";
  }
  return "success";
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
  const [copied, setCopied] = useState(false);
  const [copiedToolKey, setCopiedToolKey] = useState<string | null>(null);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => {
      setCopied(false);
    }, 1200);
    return () => clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    if (!copiedToolKey) return;
    const timer = setTimeout(() => {
      setCopiedToolKey(null);
    }, 1200);
    return () => clearTimeout(timer);
  }, [copiedToolKey]);

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
      <Message from="user" className="group/msg w-full max-w-full px-3 py-2">
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
  const firstSqlBlock = contentParts.find((part) => part.type === "code");
  const toolCalls = message.toolCalls ?? [];
  const hasToolCalls = toolCalls.length > 0;
  const toolDetails = toolCalls
    .map((tc, index) => {
      const status = getToolStatus(tc, Boolean(message.isStreaming));
      const input = stringifyPayload(tc.input);
      const output = stringifyPayload(tc.result);
      return [
        `### ${index + 1}. ${tc.toolName} (${status})`,
        input ? `**Input**\n\`\`\`json\n${input}\n\`\`\`` : "",
        output ? `**Output**\n\`\`\`json\n${output}\n\`\`\`` : "",
      ]
        .filter(Boolean)
        .join("\n\n");
    })
    .join("\n\n");

  return (
    <Message from="assistant" className="group/msg w-full max-w-full px-3 py-2">
      <div className="min-w-0 flex flex-col gap-1.5">
          {hasToolCalls && (
            <details className="group/tcalls rounded-lg border border-border/60 bg-muted/20 px-2 py-1.5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs text-foreground marker:content-none">
                <span className="inline-flex items-center gap-1.5">
                  <Wrench className="size-3.5 text-primary" />
                  <span className="font-medium">Tool Calls</span>
                  <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                    {toolCalls.length}
                  </span>
                </span>
                <span className="text-[10px] text-muted-foreground transition-transform duration-150 ease-out group-open/tcalls:rotate-180">
                  ▼
                </span>
              </summary>

              <div className="mt-2 space-y-1.5">
                {toolCalls.map((tc, index) => {
                  const status = getToolStatus(tc, Boolean(message.isStreaming));
                  const statusIcon =
                    status === "running"
                      ? <CircleDashed className="size-3.5 animate-spin text-muted-foreground" />
                      : status === "error"
                        ? <AlertCircle className="size-3.5 text-destructive" />
                        : <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />;
                  const statusLabel = status === "running" ? "Running" : status === "error" ? "Error" : "Done";
                  const preview = compactPreview(tc.result ?? tc.input);
                  const sqlFromTool = extractSqlSnippet(tc.result) ?? extractSqlSnippet(tc.input);
                  const copyValue = stringifyPayload(tc.result ?? tc.input);
                  const copyKey = `${tc.toolCallId}-${index}`;

                  return (
                    <div
                      key={copyKey}
                      className="group/tool flex items-start justify-between gap-2 rounded-md border border-border/50 bg-background/70 px-2 py-1.5 transition-colors duration-150 ease-out hover:bg-background"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          {statusIcon}
                          <span className="truncate text-xs font-medium text-foreground">{tc.toolName}</span>
                          <span className="text-[10px] text-muted-foreground">{statusLabel}</span>
                        </div>
                        {preview && (
                          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                            {preview}
                          </p>
                        )}
                      </div>

                      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity duration-150 ease-out group-hover/tool:opacity-100 group-focus-within/tool:opacity-100">
                        <MessageAction
                          tooltip={copiedToolKey === copyKey ? "Copied" : "Copy tool payload"}
                          label={copiedToolKey === copyKey ? "Copied" : "Copy tool payload"}
                          onClick={async () => {
                            if (!copyValue) return;
                            try {
                              await navigator.clipboard.writeText(copyValue);
                              setCopiedToolKey(copyKey);
                            } catch {
                              // Ignore copy failures.
                            }
                          }}
                          disabled={!copyValue}
                        >
                          {copiedToolKey === copyKey ? (
                            <Check className="size-3.5" />
                          ) : (
                            <Copy className="size-3.5" />
                          )}
                        </MessageAction>
                        <MessageAction
                          tooltip="Insert SQL from tool"
                          label="Insert SQL from tool"
                          onClick={() => {
                            if (sqlFromTool && onInsertSql) onInsertSql(sqlFromTool);
                          }}
                          disabled={!sqlFromTool || !onInsertSql}
                        >
                          <Code2 className="size-3.5" />
                        </MessageAction>
                      </div>
                    </div>
                  );
                })}
              </div>

              {toolDetails && (
                <div className="mt-2 rounded-md border border-border/60 bg-background/70 p-2">
                  <MessageResponse className="text-xs">{toolDetails}</MessageResponse>
                </div>
              )}
            </details>
          )}

          {/* Message content (text + code blocks) */}
          {contentParts.length > 0 && (
            <div className="space-y-2">
              {contentParts.map((part, index) =>
                part.type === "text" ? (
                  <MessageContent
                    key={`text-${index}`}
                    className="!w-full !max-w-none !bg-transparent !p-0 text-sm leading-relaxed break-words"
                  >
                    <MessageResponse>{part.content}</MessageResponse>
                  </MessageContent>
                ) : (
                  <div key={`code-${index}`} className="group/sql relative">
                    <CodeBlock className="!bg-transparent !text-inherit border-border/50 rounded-lg">
                      <CodeBlockCode
                        code={part.code}
                        language={part.language || "sql"}
                        theme={codeTheme}
                        className="[&>pre]:!rounded-none [&>pre]:!m-0"
                      />
                    </CodeBlock>
                    {onInsertSql && !message.isStreaming && (
                      <Button
                        variant="outline"
                        size="xs"
                        className="absolute top-1 right-1 z-10 h-6 bg-background/90 px-2 text-[11px] opacity-0 shadow-sm backdrop-blur transition-all duration-150 ease-out group-hover/sql:opacity-100 group-focus-within/sql:opacity-100 hover:bg-background active:scale-[0.97]"
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

          {/* Thinking indicator — ai-elements Reasoning, minimal style */}
          {message.isStreaming && !message.content && (
            <Reasoning isStreaming className="!mb-0 px-3">
              <ReasoningTrigger className="gap-1.5 py-1 text-xs">
                <span className="relative flex size-1.5">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/40 [animation-duration:1.5s] [animation-timing-function:cubic-bezier(0,0,0.2,1)]" />
                  <span className="inline-flex size-1.5 rounded-full bg-primary" />
                </span>
                Thinking…
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
  connectionLabel,
  dbType,
  schemaContext,
  contextPreview,
  isOpen,
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
  const [inputPulse, setInputPulse] = useState(false);
  const prevInputHadTextRef = useRef(false);
  const inputPulseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
      if (inputPulseTimeoutRef.current) {
        clearTimeout(inputPulseTimeoutRef.current);
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

  // Detect when user clears all text → trigger pulse animation
  const handleInputChange = useCallback((value: string) => {
    const hadText = prevInputHadTextRef.current;
    const nowEmpty = value.length === 0;
    prevInputHadTextRef.current = value.length > 0;

    if (hadText && nowEmpty) {
      setInputPulse(true);
      if (inputPulseTimeoutRef.current) clearTimeout(inputPulseTimeoutRef.current);
      inputPulseTimeoutRef.current = setTimeout(() => {
        setInputPulse(false);
        inputPulseTimeoutRef.current = null;
      }, 200);
    }

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

  if (!isOpen) return null;

  const isEmpty = messages.length === 0;
  const hasActiveConnection = Boolean(connectionId);
  const currentConnectionLabel = contextPreview?.connectionLabel || connectionLabel || connectionId || "Sem conexão";
  const activeConversation =
    conversations.find((conversation) => conversation.id === activeConversationId) ?? null;

  return (
    <div
      className={cn(
        "flex h-full flex-col overflow-hidden rounded-md bg-background",
        "motion-safe:animate-in motion-safe:slide-in-from-right-full",
        "motion-safe:duration-200 motion-safe:ease-out"
      )}
      style={{ width: "100%" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 h-9 border-b border-border/50 shrink-0">
        <div className="flex min-w-0 items-center gap-2">
          <Bot className="size-3.5 text-primary" />
          <span className="inline-flex items-center rounded-full border border-border/70 bg-muted/30 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {currentConnectionLabel}
          </span>
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
            <DropdownMenuContent align="start" side="bottom" className="w-[290px]">
              <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                Conversations
              </div>
              <DropdownMenuItem
                onClick={startNewConversation}
                disabled={isLoading}
              >
                <Plus className="size-3.5" />
                New conversation
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {conversations.length === 0 ? (
                <DropdownMenuItem disabled>No conversations yet</DropdownMenuItem>
              ) : (
                conversations.map((conversation) => (
                  <DropdownMenuItem
                    key={conversation.id}
                    className="flex items-center justify-between gap-2"
                    onClick={() => selectConversation(conversation.id)}
                    disabled={isLoading}
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-xs font-medium">
                        {conversation.title}
                      </span>
                      <span className="truncate text-[10px] text-muted-foreground/90">
                        {conversation.contextTag?.connectionLabel
                          || conversation.contextTag?.connectionId
                          || "Sem conexão"}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {new Intl.DateTimeFormat(undefined, {
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        }).format(new Date(conversation.updatedAt))}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      {conversation.id === activeConversationId && (
                        <Check className="size-3 text-primary" />
                      )}
                      <button
                        type="button"
                        aria-label="Delete conversation"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          deleteConversation(conversation.id);
                        }}
                        className="rounded p-1 text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
                        disabled={conversations.length === 1 || isLoading}
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </div>
                  </DropdownMenuItem>
                ))
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={clearAllConversations}
                disabled={isLoading || conversations.length === 0}
              >
                <Trash2 className="size-3.5" />
                Clear all
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={startNewConversation}
                  disabled={isLoading}
                  className="text-muted-foreground hover:text-foreground transition-transform duration-150 ease-out active:scale-[0.97]"
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

      {/* Messages — auto-scroll via StickToBottom */}
      <Conversation className="flex-1 min-h-0" contextRef={conversationRef}>
        <ConversationContent
          key={activeConversationId ?? "no-conversation"}
          className="flex flex-col gap-0 p-0"
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
            </ConversationEmptyState>
          ) : (
            messages.map((msg) => (
              <ChatMessage
                key={msg.id}
                message={msg}
                codeTheme={codeTheme}
                onInsertSql={onInsertSql}
              />
            ))
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {/* Error banner */}
      {error && (
        <div className="mx-3 mb-2 rounded-md border border-red-500/20 bg-red-500/5 px-2.5 py-1.5 text-xs text-red-600 dark:text-red-400 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 motion-safe:duration-150">
          {error}
        </div>
      )}
      {!hasActiveConnection && (
        <div className="mx-3 mb-2 rounded-md border border-amber-500/20 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-700 dark:text-amber-300">
          No momento estou sem conexão ativa. Posso ajudar com SQL conceitual, mas tools SQL ao vivo ficam bloqueadas.
        </div>
      )}

      {/* Input */}
      <div className="px-3 py-2 shrink-0">
        <PromptInput
          value={input}
          onValueChange={handleInputChange}
          onSubmit={handleSubmit}
          isLoading={isLoading}
          className={cn(
            "rounded-md border border-border bg-muted/40 p-2 shadow-none",
            "transition-transform duration-200 [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]",
            inputPulse && "scale-[1.02]",
          )}
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
                disabled={!input.trim()}
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
