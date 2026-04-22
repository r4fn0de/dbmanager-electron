/**
 * AiChatPanel — sidebar panel for conversational AI chat.
 *
 * Embedded in the SQL Editor view as a collapsible side panel.
 * Uses the useAiChat hook to manage streaming chat over Electron IPC.
 */
import {
  Bot,
  ChevronDown,
  Loader2,
  Send,
  Square,
  Trash2,
  Wrench,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
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
  /** Whether the panel is visible */
  isOpen: boolean;
  /** Callback to insert SQL into the editor */
  onInsertSql?: (sql: string) => void;
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
  onInsertSql,
}: {
  message: AiChatMessage;
  onInsertSql?: (sql: string) => void;
}) {
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";

  // Extract SQL code blocks from assistant messages
  const sqlBlocks = isAssistant
    ? extractSqlBlocks(message.content)
    : [];

  return (
    <div
      className={cn(
        "group/msg flex gap-2.5 px-3 py-3 transition-colors",
        isUser ? "bg-muted/20" : "bg-background",
      )}
    >
      {/* Avatar */}
      <div
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-md text-xs font-semibold",
          isUser
            ? "bg-foreground/10 text-foreground"
            : "bg-primary/10 text-primary",
        )}
      >
        {isUser ? "U" : <Bot className="size-3.5" />}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 space-y-1.5">
        {/* Tool calls */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-1">
            {message.toolCalls.map((tc, i) => (
              <ToolCallBadge key={`${tc.toolName}-${i}`} name={tc.toolName} />
            ))}
          </div>
        )}

        {/* Message text */}
        {message.content && (
          <div className="text-sm leading-relaxed whitespace-pre-wrap break-words">
            {message.content}
          </div>
        )}

        {/* Streaming indicator */}
        {message.isStreaming && !message.content && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            Thinking…
          </div>
        )}

        {/* Streaming cursor */}
        {message.isStreaming && message.content && (
          <span className="inline-block w-1.5 h-4 bg-primary/60 animate-pulse rounded-sm align-text-bottom ml-0.5" />
        )}

        {/* SQL code blocks with insert action */}
        {sqlBlocks.length > 0 && onInsertSql && !message.isStreaming && (
          <div className="mt-2 space-y-1.5">
            {sqlBlocks.map((sql, i) => (
              <div key={i} className="group/sql relative">
                <pre className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs font-mono overflow-x-auto max-h-32 leading-relaxed">
                  {sql}
                </pre>
                <Button
                  variant="ghost"
                  size="xs"
                  className="absolute top-1 right-1 opacity-0 group-hover/sql:opacity-100 transition-opacity"
                  onClick={() => onInsertSql(sql)}
                >
                  Insert
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Extract SQL code blocks from markdown
// ---------------------------------------------------------------------------

function extractSqlBlocks(content: string): string[] {
  const blocks: string[] = [];
  const regex = /```(?:sql|postgresql|mysql|mariadb)?\s*\n([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const sql = match[1].trim();
    if (sql) blocks.push(sql);
  }
  return blocks;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AiChatPanel({
  connectionId,
  dbType,
  schemaContext,
  isOpen,
  onInsertSql,
}: AiChatPanelProps) {
  const { messages, isLoading, error, sendMessage, abort, clearMessages } =
    useAiChat({
      connectionId,
      dbType,
      schemaContext,
    });

  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
    }
  }, [isOpen]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!input.trim() || isLoading) return;
      sendMessage(input.trim());
      setInput("");
    },
    [input, isLoading, sendMessage],
  );

  if (!isOpen) return null;

  const isEmpty = messages.length === 0;

  return (
    <div className="flex h-full flex-col bg-background border-l border-border/50">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/50 shrink-0">
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
                  className="text-muted-foreground hover:text-foreground"
                />
              }
            />
            <TooltipContent>Clear chat</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center h-full px-6 text-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-full bg-primary/10">
              <Bot className="size-5 text-primary" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">AI SQL Assistant</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Ask about your database schema, generate SQL queries,
                or get help fixing errors.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-1.5 mt-1">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => sendMessage(s)}
                  className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            {messages.map((msg) => (
              <ChatMessage
                key={msg.id}
                message={msg}
                onInsertSql={onInsertSql}
              />
            ))}
          </div>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-3 mb-2 rounded-md border border-red-500/20 bg-red-500/5 px-2.5 py-1.5 text-xs text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Input */}
      <div className="px-3 py-2 border-t border-border/50 shrink-0">
        <form onSubmit={handleSubmit} className="flex items-center gap-1.5">
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              connectionId
                ? "Ask about your database…"
                : "Select a connection first"
            }
            disabled={!connectionId}
            className="h-8 text-xs"
          />
          {isLoading ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={abort}
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              <Square className="size-3.5" />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon"
              disabled={!input.trim() || !connectionId}
              className="shrink-0"
            >
              <Send className="size-3.5" />
            </Button>
          )}
        </form>
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
