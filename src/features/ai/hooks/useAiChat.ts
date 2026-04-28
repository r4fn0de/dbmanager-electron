/**
 * useAiChat — React hook for AI streaming chat over Electron IPC.
 *
 * Global chat state with persistent multi-conversation history.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { generateTitle } from "./ai-actions";
import type { DatabaseType } from "@/ipc/db/types";
import type {
  AiChatChunkPayload,
  AiRendererApi,
  UserConnectionsContext,
} from "@/shared/ai/streaming-contracts";

export interface AiChatContextTag {
  connectionId: string | null;
  connectionLabel?: string;
  dbType?: DatabaseType;
}

// ── Parts-based message model (mirrors AI SDK UIMessage.parts) ──

/** A text segment produced by the assistant. */
export interface TextPart {
  type: "text";
  text: string;
}

/** A reasoning segment streamed by the model. */
export interface ReasoningPart {
  type: "reasoning";
  text: string;
}

/** A source emitted by the model/provider (URL or document reference). */
export interface SourcePart {
  type: "source";
  source: unknown;
}

/** A tool invocation within an assistant message (call + optional result). */
export interface ToolInvocationPart {
  type: "tool-invocation";
  toolInvocation: {
    toolCallId: string;
    toolName: string;
    args: unknown;
    result?: unknown;
    state: "call" | "partial-call" | "result" | "pending-approval";
    /** Approval request metadata — present when state is "pending-approval" */
    approvalRequest?: {
      description: string;
      preview?: string;
      warnings?: string[];
    };
  };
}

/** Union of all part types that can appear in an assistant message. */
export type AiChatMessagePart = TextPart | ReasoningPart | SourcePart | ToolInvocationPart;

export interface AiChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  /** Legacy flat text content — kept for storage compat and copy operations. */
  content: string;
  /** Structured parts (AI SDK UIMessage.parts pattern). */
  parts?: AiChatMessagePart[];
  createdAt?: string;
  contextTag?: AiChatContextTag;
  /** Optional context snapshot attached to a user message */
  contextSnapshot?: {
    selectionPreview?: string;
    errorPreview?: string;
  };
  /** Whether this message is currently being streamed */
  isStreaming?: boolean;
}

export interface AiChatConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  contextTag?: AiChatContextTag;
  messages: AiChatMessage[];
}

interface UseAiChatOptions {
  /** Current active connection ID from app context (optional in global mode) */
  connectionId: string | null;
  /** Active database type from app context */
  dbType: DatabaseType;
  /** Optional connection label for UI/tagging */
  connectionLabel?: string;
  /** Optional schema context to inject into system prompt */
  schemaContext?: string;
  /** Optional connection metadata (host, port, local vs remote) for AI context */
  connectionInfo?: {
    name: string;
    host: string;
    port: number;
    database: string;
    isLocal?: boolean;
  };
  /** Optional global snapshot of user connections for cross-connection questions */
  userConnectionsContext?: UserConnectionsContext;
}

interface UseAiChatReturn {
  messages: AiChatMessage[];
  conversations: AiChatConversation[];
  activeConversationId: string | null;
  isLoading: boolean;
  error: string | null;
  sendMessage: (
    content: string,
    options?: {
      contextSnapshot?: {
        selectionPreview?: string;
        errorPreview?: string;
      };
      mentionedConnectionId?: string | null;
    },
  ) => void;
  abort: () => void;
  clearMessages: () => void;
  startNewConversation: () => void;
  selectConversation: (conversationId: string) => void;
  deleteConversation: (conversationId: string) => void;
  clearAllConversations: () => void;
  clearCurrentConversation: () => void;
  /** Approve a pending tool invocation */
  approveToolCall: (toolCallId: string) => void;
  /** Reject a pending tool invocation */
  rejectToolCall: (toolCallId: string) => void;
}

const AI_CHAT_STORAGE_KEY_V1 = "ai-chat-history:v1";
const AI_CHAT_STORAGE_KEY_V2 = "ai-chat-history:v2";
const MAX_CONVERSATIONS = 30;
const MAX_MESSAGES_PER_CONVERSATION = 120;
const DEFAULT_CONVERSATION_TITLE = "New Chat";
const MAX_MODEL_MESSAGES = 32;
const MAX_MODEL_CHARS = 24_000;

interface AiChatStorageV1 {
  version: 1;
  conversationsByConnection: Record<
    string,
    Array<{
      id: string;
      connectionId: string;
      title: string;
      createdAt: string;
      updatedAt: string;
      messages: AiChatMessage[];
    }>
  >;
  activeConversationByConnection: Record<string, string>;
}

interface AiChatStorageV2 {
  version: 2;
  conversations: AiChatConversation[];
  activeConversationId: string | null;
  migratedFromV1?: boolean;
}

const EMPTY_STORAGE_V2: AiChatStorageV2 = {
  version: 2,
  conversations: [],
  activeConversationId: null,
  migratedFromV1: false,
};

let messageCounter = 0;
function nextId(): string {
  return `msg-${Date.now()}-${++messageCounter}`;
}

function nextConversationId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `conv-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function toIsoNow(): string {
  return new Date().toISOString();
}

function fallbackConversationTitle(): string {
  const clock = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());
  return `${DEFAULT_CONVERSATION_TITLE} ${clock}`;
}

function toPersistedMessage(message: AiChatMessage): AiChatMessage {
  return message;
}

function toStorageMessage(message: AiChatMessage): AiChatMessage {
  // Strip isStreaming (runtime-only) and any legacy toolCalls that may have
  // been loaded from v2 storage so they aren't written back.
  const { isStreaming: _isStreaming, ...rest } = message as LegacyAiChatMessage;
  const { toolCalls: _toolCalls, ...clean } = rest;
  return clean as AiChatMessage;
}

function toModelContent(message: AiChatMessage): string {
  let content = message.content;
  if (message.contextSnapshot) {
    const snapshot = message.contextSnapshot;
    const contextParts: string[] = [];
    if (snapshot.selectionPreview) {
      contextParts.push(`[Selected text in editor]\n${snapshot.selectionPreview}`);
    }
    if (snapshot.errorPreview) {
      contextParts.push(`[Last error in editor]\n${snapshot.errorPreview}`);
    }
    if (contextParts.length > 0) {
      content = `${contextParts.join("\n\n")}\n\n${content}`;
    }
  }

  return content.trim();
}

function buildModelMessages(messages: AiChatMessage[]) {
  const base = messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      role: message.role,
      content: toModelContent(message),
    }))
    .filter((message) => message.content.length > 0);

  if (base.length <= MAX_MODEL_MESSAGES) {
    const totalChars = base.reduce((sum, message) => sum + message.content.length, 0);
    if (totalChars <= MAX_MODEL_CHARS) return base;
  }

  const selected: typeof base = [];
  let charBudget = 0;

  for (let i = base.length - 1; i >= 0; i -= 1) {
    const message = base[i];
    const nextSize = charBudget + message.content.length;
    if (selected.length >= MAX_MODEL_MESSAGES || nextSize > MAX_MODEL_CHARS) {
      continue;
    }
    selected.unshift(message);
    charBudget = nextSize;
  }

  return selected.length > 0 ? selected : base.slice(-1);
}

/**
 * Shape of a message as stored in v2 localStorage (may contain legacy toolCalls).
 * Used only inside ensureParts for safe access to pre-migration data.
 */
interface LegacyAiChatMessage extends AiChatMessage {
  /** Removed from the public type; may still exist in stored JSON. */
  toolCalls?: Array<{
    toolCallId: string;
    toolName: string;
    input: unknown;
    result?: unknown;
  }>;
}

/**
 * Reconstruct parts[] from legacy content + toolCalls for v2 storage
 * messages that were saved before the parts migration.
 */
export function ensureParts(message: AiChatMessage): AiChatMessage {
  if (message.parts && message.parts.length > 0) return message;

  const parts: AiChatMessagePart[] = [];

  // Convert legacy toolCalls into tool-invocation parts.
  // Cast through LegacyAiChatMessage for safe access to pre-migration data.
  const legacy = message as LegacyAiChatMessage;
  if (legacy.toolCalls && legacy.toolCalls.length > 0) {
    for (const tc of legacy.toolCalls) {
      parts.push({
        type: "tool-invocation",
        toolInvocation: {
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          args: tc.input,
          result: tc.result,
          state: tc.result !== undefined ? "result" : "call",
        },
      });
    }
  }

  // Add text part from content if non-empty
  if (message.content) {
    parts.push({ type: "text", text: message.content });
  }

  // Ensure at least one text part for empty assistant messages
  if (parts.length === 0 && message.role === "assistant") {
    parts.push({ type: "text", text: "" });
  }

  return { ...message, parts };
}

function trimConversationMessages(messages: AiChatMessage[]): AiChatMessage[] {
  const normalized = messages.map(toPersistedMessage);
  if (normalized.length <= MAX_MESSAGES_PER_CONVERSATION) return normalized;
  return normalized.slice(normalized.length - MAX_MESSAGES_PER_CONVERSATION);
}

function withRetention(conversations: AiChatConversation[]): AiChatConversation[] {
  const normalized = conversations
    .map((conversation) => ({
      ...conversation,
      messages: trimConversationMessages(conversation.messages),
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  if (normalized.length <= MAX_CONVERSATIONS) return normalized;
  return normalized.slice(0, MAX_CONVERSATIONS);
}

function createContextTag(options: {
  connectionId: string | null;
  connectionLabel?: string;
  dbType: DatabaseType;
}): AiChatContextTag {
  return {
    connectionId: options.connectionId,
    connectionLabel: options.connectionLabel,
    dbType: options.dbType,
  };
}

function createEmptyConversation(options: {
  connectionId: string | null;
  connectionLabel?: string;
  dbType: DatabaseType;
}): AiChatConversation {
  const now = toIsoNow();
  return {
    id: nextConversationId(),
    title: DEFAULT_CONVERSATION_TITLE,
    createdAt: now,
    updatedAt: now,
    contextTag: createContextTag(options),
    messages: [],
  };
}

function normalizeConversation(conversation: AiChatConversation): AiChatConversation {
  return {
    ...conversation,
    messages: trimConversationMessages(conversation.messages ?? []),
  };
}

function readStorageV1(): AiChatStorageV1 | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(AI_CHAT_STORAGE_KEY_V1);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AiChatStorageV1>;
    if (parsed.version !== 1) return null;
    return {
      version: 1,
      conversationsByConnection: parsed.conversationsByConnection ?? {},
      activeConversationByConnection: parsed.activeConversationByConnection ?? {},
    };
  } catch {
    return null;
  }
}

function migrateV1ToV2(preferredConnectionId: string | null): AiChatStorageV2 {
  const v1 = readStorageV1();
  if (!v1) return EMPTY_STORAGE_V2;

  try {
    const flattened: AiChatConversation[] = [];
    const seenIds = new Set<string>();

    for (const [legacyConnectionId, legacyConversations] of Object.entries(v1.conversationsByConnection)) {
      for (const legacyConversation of legacyConversations ?? []) {
        const baseId = legacyConversation.id || nextConversationId();
        const uniqueId = seenIds.has(baseId) ? `${baseId}-${legacyConnectionId}` : baseId;
        seenIds.add(uniqueId);

        const contextTag: AiChatContextTag = {
          connectionId: legacyConnectionId,
          connectionLabel: legacyConnectionId,
        };

        flattened.push(
          normalizeConversation({
            id: uniqueId,
            title: legacyConversation.title || DEFAULT_CONVERSATION_TITLE,
            createdAt: legacyConversation.createdAt || toIsoNow(),
            updatedAt: legacyConversation.updatedAt || legacyConversation.createdAt || toIsoNow(),
            contextTag,
            messages: (legacyConversation.messages ?? []).map((message) => ({
              ...message,
              contextTag: message.contextTag ?? contextTag,
              createdAt: message.createdAt ?? legacyConversation.updatedAt ?? legacyConversation.createdAt,
            })),
          }),
        );
      }
    }

    const conversations = withRetention(flattened);

    const preferredActive = preferredConnectionId
      ? v1.activeConversationByConnection[preferredConnectionId] ?? null
      : null;

    const fallbackActive = Object.values(v1.activeConversationByConnection).find((id) =>
      conversations.some((conversation) => conversation.id === id),
    );

    const activeConversationId =
      (preferredActive && conversations.some((conversation) => conversation.id === preferredActive)
        ? preferredActive
        : null)
      ?? fallbackActive
      ?? conversations[0]?.id
      ?? null;

    return {
      version: 2,
      conversations,
      activeConversationId,
      migratedFromV1: true,
    };
  } catch {
    // Keep v1 intact and start fresh v2 storage if migration fails.
    return EMPTY_STORAGE_V2;
  }
}

function readStorageV2(preferredConnectionId: string | null): AiChatStorageV2 {
  if (typeof window === "undefined") return EMPTY_STORAGE_V2;

  try {
    const raw = window.localStorage.getItem(AI_CHAT_STORAGE_KEY_V2);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AiChatStorageV2>;
      if (parsed.version === 2) {
        const conversations = withRetention((parsed.conversations ?? []).map(normalizeConversation));
        const activeConversationId =
          parsed.activeConversationId && conversations.some((conversation) => conversation.id === parsed.activeConversationId)
            ? parsed.activeConversationId
            : conversations[0]?.id ?? null;

        return {
          version: 2,
          conversations,
          activeConversationId,
          migratedFromV1: Boolean(parsed.migratedFromV1),
        };
      }
    }
  } catch {
    // Fall through to migration/empty state.
  }

  return migrateV1ToV2(preferredConnectionId);
}

function writeStorageV2(storage: AiChatStorageV2): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(AI_CHAT_STORAGE_KEY_V2, JSON.stringify(storage));
  } catch {
    // Ignore storage quota/unavailable scenarios.
  }
}

export function useAiChat({
  connectionId,
  dbType,
  connectionLabel,
  schemaContext,
  connectionInfo,
  userConnectionsContext,
}: UseAiChatOptions): UseAiChatReturn {
  const [conversations, setConversations] = useState<AiChatConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chatIdRef = useRef<string>(`chat-${Date.now()}`);
  const assistantIdRef = useRef<string | null>(null);
  const streamConversationIdRef = useRef<string | null>(null);
  const activeConversationIdRef = useRef<string | null>(null);
  const conversationsRef = useRef<AiChatConversation[]>([]);
  const migratedFromV1Ref = useRef(false);
  const pendingApprovalRef = useRef<
    Map<string, { chatId: string; toolCallId: string; description: string; preview?: string; warnings?: string[] }>
  >(new Map());

  const messages = useMemo(() => {
    if (!activeConversationId) return [];
    const active = conversations.find((conversation) => conversation.id === activeConversationId);
    return active?.messages.map(ensureParts) ?? [];
  }, [activeConversationId, conversations]);

  const updateConversationById = useCallback(
    (
      conversationId: string,
      updater: (conversation: AiChatConversation) => AiChatConversation,
    ) => {
      setConversations((prev) =>
        withRetention(
          prev.map((conversation) =>
            conversation.id === conversationId ? updater(conversation) : conversation,
          ),
        ),
      );
    },
    [],
  );

  const ensureConversation = useCallback(() => {
    const existing = conversationsRef.current[0];
    if (existing) {
      setActiveConversationId(existing.id);
      return existing;
    }

    const created = createEmptyConversation({ connectionId, connectionLabel, dbType });
    setConversations((prev) => withRetention([created, ...prev]));
    setActiveConversationId(created.id);
    return created;
  }, [connectionId, connectionLabel, dbType]);

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  // ── Tool approval IPC listener ──
  useEffect(() => {
    const ai = (window as any).ai as AiRendererApi | undefined;
    const aiToolApproval = ai?.toolApproval;
    if (!aiToolApproval) return;

    const unsub = aiToolApproval.onRequest((payload) => {
      const { chatId, toolCallId, description, preview, warnings } = payload;

      // Only handle if this is for our current chat session
      if (chatId !== chatIdRef.current) return;

      const streamConversationId = streamConversationIdRef.current;
      if (!streamConversationId) return;

      // Store the approval request for reference
      pendingApprovalRef.current.set(toolCallId, {
        chatId,
        toolCallId,
        description,
        preview,
        warnings,
      });

      // Update the matching tool invocation state to "pending-approval"
      updateConversationById(streamConversationId, (conversation) => {
        const id = assistantIdRef.current;
        if (!id) return conversation;
        return {
          ...conversation,
          updatedAt: toIsoNow(),
          messages: conversation.messages.map((msg) => {
            if (msg.id !== id) return msg;
            const parts = (msg.parts ?? []).map((part) => {
              if (
                part.type === "tool-invocation"
                && part.toolInvocation.toolCallId === toolCallId
              ) {
                return {
                  ...part,
                  toolInvocation: {
                    ...part.toolInvocation,
                    state: "pending-approval" as const,
                    approvalRequest: { description, preview, warnings },
                  },
                };
              }
              return part;
            });
            return { ...msg, parts };
          }),
        };
      });
    });

    return () => {
      unsub?.();
    };
  }, [updateConversationById]);

  useEffect(() => {
    const storage = readStorageV2(connectionId);
    const hydratedConversations = storage.conversations;

    if (hydratedConversations.length === 0) {
      const fresh = createEmptyConversation({ connectionId, connectionLabel, dbType });
      setConversations([fresh]);
      setActiveConversationId(fresh.id);
      writeStorageV2({
        version: 2,
        conversations: [fresh],
        activeConversationId: fresh.id,
        migratedFromV1: storage.migratedFromV1,
      });
      migratedFromV1Ref.current = Boolean(storage.migratedFromV1);
      setIsHydrated(true);
      return;
    }

    setConversations(hydratedConversations);
    setActiveConversationId(storage.activeConversationId ?? hydratedConversations[0]?.id ?? null);
    writeStorageV2({
      version: 2,
      conversations: hydratedConversations,
      activeConversationId: storage.activeConversationId ?? hydratedConversations[0]?.id ?? null,
      migratedFromV1: storage.migratedFromV1,
    });
    migratedFromV1Ref.current = Boolean(storage.migratedFromV1);
    setIsHydrated(true);
    // Hydrate once on mount; global history should not reset when context changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    writeStorageV2({
      version: 2,
      conversations: conversations.map((conversation) => ({
        ...conversation,
        messages: conversation.messages.map(toStorageMessage),
      })),
      activeConversationId,
      migratedFromV1: migratedFromV1Ref.current,
    });
  }, [isHydrated, conversations, activeConversationId]);

  useEffect(() => {
    const aiChat = window.electron?.aiChat;
    if (!aiChat) return;

    const unsubChunk = aiChat.onChunk((chunk: AiChatChunkPayload) => {
      if (chunk.chatId !== chatIdRef.current) return;
      const streamConversationId = streamConversationIdRef.current;
      if (!streamConversationId) return;

      if (chunk.type === "text") {
        updateConversationById(streamConversationId, (conversation) => {
          const id = assistantIdRef.current;
          if (!id) return conversation;
          return {
            ...conversation,
            updatedAt: toIsoNow(),
            messages: conversation.messages.map((msg) => {
              if (msg.id !== id) return msg;
              const parts = [...(msg.parts ?? [])];
              // Append to the last text part, or create a new one
              const lastPart = parts[parts.length - 1];
              if (lastPart?.type === "text") {
                parts[parts.length - 1] = { ...lastPart, text: lastPart.text + chunk.text };
              } else {
                parts.push({ type: "text", text: chunk.text });
              }
              return { ...msg, content: msg.content + chunk.text, parts };
            }),
          };
        });
      } else if (chunk.type === "reasoning") {
        updateConversationById(streamConversationId, (conversation) => {
          const id = assistantIdRef.current;
          if (!id) return conversation;
          return {
            ...conversation,
            updatedAt: toIsoNow(),
            messages: conversation.messages.map((msg) => {
              if (msg.id !== id) return msg;
              const parts = [...(msg.parts ?? [])];
              const lastPart = parts[parts.length - 1];
              if (lastPart?.type === "reasoning") {
                parts[parts.length - 1] = { ...lastPart, text: lastPart.text + chunk.text };
              } else {
                parts.push({ type: "reasoning", text: chunk.text });
              }
              return { ...msg, parts };
            }),
          };
        });
      } else if (chunk.type === "source") {
        updateConversationById(streamConversationId, (conversation) => {
          const id = assistantIdRef.current;
          if (!id) return conversation;
          return {
            ...conversation,
            updatedAt: toIsoNow(),
            messages: conversation.messages.map((msg) => {
              if (msg.id !== id) return msg;
              const parts = [...(msg.parts ?? [])];
              parts.push({ type: "source", source: chunk.source });
              return { ...msg, parts };
            }),
          };
        });
      } else if (chunk.type === "tool-call") {
        updateConversationById(streamConversationId, (conversation) => {
          const id = assistantIdRef.current;
          if (!id) return conversation;
          return {
            ...conversation,
            updatedAt: toIsoNow(),
            messages: conversation.messages.map((msg) => {
              if (msg.id !== id) return msg;
              const parts = [...(msg.parts ?? [])];
              parts.push({
                type: "tool-invocation",
                toolInvocation: {
                  toolCallId: chunk.toolCallId ?? nextId(),
                  toolName: chunk.toolName ?? "tool",
                  args: chunk.input,
                  state: "call",
                },
              });
              return { ...msg, parts };
            }),
          };
        });
      } else if (
        chunk.type === "tool-call-streaming-start"
        || chunk.type === "tool-call-delta"
      ) {
        updateConversationById(streamConversationId, (conversation) => {
          const id = assistantIdRef.current;
          if (!id) return conversation;
          return {
            ...conversation,
            updatedAt: toIsoNow(),
            messages: conversation.messages.map((msg) => {
              if (msg.id !== id) return msg;

              const parts = [...(msg.parts ?? [])];
              const existingToolIndex = parts.findIndex(
                (part) =>
                  part.type === "tool-invocation"
                  && part.toolInvocation.toolCallId === chunk.toolCallId,
              );

              if (existingToolIndex >= 0) {
                const existing = parts[existingToolIndex];
                if (existing?.type === "tool-invocation") {
                  parts[existingToolIndex] = {
                    ...existing,
                    toolInvocation: {
                      ...existing.toolInvocation,
                      state: "partial-call",
                      args:
                        chunk.type === "tool-call-delta" && chunk.argsTextDelta
                          ? `${String(existing.toolInvocation.args ?? "")}${chunk.argsTextDelta}`
                          : existing.toolInvocation.args,
                    },
                  };
                }
              } else {
                parts.push({
                  type: "tool-invocation",
                  toolInvocation: {
                    toolCallId: chunk.toolCallId ?? nextId(),
                    toolName: chunk.toolName ?? "tool",
                    args:
                      chunk.type === "tool-call-delta" && chunk.argsTextDelta
                        ? chunk.argsTextDelta
                        : chunk.input,
                    state: "partial-call",
                  },
                });
              }

              return { ...msg, parts };
            }),
          };
        });
      } else if (chunk.type === "tool-result") {
        updateConversationById(streamConversationId, (conversation) => {
          const id = assistantIdRef.current;
          if (!id) return conversation;
          return {
            ...conversation,
            updatedAt: toIsoNow(),
            messages: conversation.messages.map((msg) => {
              if (msg.id !== id) return msg;
              const parts = (msg.parts ?? []).map((part) => {
                if (
                  part.type === "tool-invocation"
                  && part.toolInvocation.toolCallId === chunk.toolCallId
                ) {
                  return {
                    ...part,
                    toolInvocation: {
                      ...part.toolInvocation,
                      result: chunk.result,
                      state: "result" as const,
                    },
                  };
                }
                return part;
              });
              return { ...msg, parts };
            }),
          };
        });
      }
    });

    const unsubDone = aiChat.onDone(({ chatId }) => {
      if (chatId !== chatIdRef.current) return;
      const streamConversationId = streamConversationIdRef.current;

      if (streamConversationId) {
        updateConversationById(streamConversationId, (conversation) => {
          const id = assistantIdRef.current;
          if (!id) return conversation;
          return {
            ...conversation,
            updatedAt: toIsoNow(),
            messages: conversation.messages.map((msg) =>
              msg.id === id ? { ...msg, isStreaming: false } : msg,
            ),
          };
        });
      }
      setIsLoading(false);
      assistantIdRef.current = null;
      streamConversationIdRef.current = null;
    });

    const unsubError = aiChat.onError(
      ({ chatId, message }: { chatId: string; message: string }) => {
        if (chatId !== chatIdRef.current) return;
        const streamConversationId = streamConversationIdRef.current;

        setError(message);
        setIsLoading(false);
        if (streamConversationId) {
          updateConversationById(streamConversationId, (conversation) => {
            const id = assistantIdRef.current;
            if (!id) return conversation;
            assistantIdRef.current = null;
            return {
              ...conversation,
              updatedAt: toIsoNow(),
              messages: conversation.messages.filter((msg) => msg.id !== id),
            };
          });
        } else {
          assistantIdRef.current = null;
        }
        streamConversationIdRef.current = null;
      },
    );

    return () => {
      unsubChunk();
      unsubDone();
      unsubError();
    };
  }, [updateConversationById]);

  const sendMessage = useCallback(
    (
      content: string,
      options?: {
        contextSnapshot?: {
          selectionPreview?: string;
          errorPreview?: string;
        };
        mentionedConnectionId?: string | null;
      },
    ) => {
      if (!content.trim()) return;

      const aiChat = window.electron?.aiChat;
      if (!aiChat) {
        setError("AI chat is not available");
        return;
      }

      setError(null);

      let targetConversationId = activeConversationIdRef.current;
      if (!targetConversationId) {
        const created = ensureConversation();
        targetConversationId = created?.id ?? null;
      }
      if (!targetConversationId) return;

      const activeConversation = conversationsRef.current.find(
        (conversation) => conversation.id === targetConversationId,
      );
      if (!activeConversation) return;

      const hadUserMessages = activeConversation.messages.some((message) => message.role === "user");
      const isUntitledConversation = activeConversation.title === DEFAULT_CONVERSATION_TITLE;
      const contextTag = createContextTag({ connectionId, connectionLabel, dbType });
      const now = toIsoNow();

      const userMsg: AiChatMessage = {
        id: nextId(),
        role: "user",
        content: content.trim(),
        createdAt: now,
        contextTag,
        contextSnapshot: options?.contextSnapshot,
      };

      const assistantMsg: AiChatMessage = {
        id: nextId(),
        role: "assistant",
        content: "",
        parts: [],
        createdAt: now,
        contextTag,
        isStreaming: true,
      };

      assistantIdRef.current = assistantMsg.id;
      streamConversationIdRef.current = targetConversationId;
      updateConversationById(targetConversationId, (conversation) => ({
        ...conversation,
        updatedAt: now,
        contextTag: conversation.contextTag ?? contextTag,
        messages: trimConversationMessages([...conversation.messages, userMsg, assistantMsg]),
      }));
      setIsLoading(true);

      // Compute model messages from latest in-memory state and keep
      // only the most relevant tail to avoid context dilution.
      const coreMessages = buildModelMessages([...activeConversation.messages, userMsg]);

      aiChat.start({
        chatId: chatIdRef.current,
        connectionId,
        mentionedConnectionId: options?.mentionedConnectionId ?? null,
        dbType,
        schemaContext,
        connectionInfo,
        userConnectionsContext,
        messages: coreMessages,
      });

      if (!hadUserMessages && isUntitledConversation) {
        void (async () => {
          let nextTitle = fallbackConversationTitle();
          try {
            const generated = await generateTitle(content.trim());
            if (generated.title.trim()) {
              nextTitle = generated.title.trim();
            }
          } catch {
            // Keep fallback title when generation fails.
          }

          updateConversationById(targetConversationId, (conversation) => ({
            ...conversation,
            title:
              conversation.title === DEFAULT_CONVERSATION_TITLE
                ? nextTitle
                : conversation.title,
            updatedAt: conversation.updatedAt,
          }));
        })();
      }
    },
    [connectionId, connectionLabel, connectionInfo, dbType, ensureConversation, schemaContext, updateConversationById, userConnectionsContext],
  );

  /** Approve a pending tool invocation. */
  const approveToolCall = useCallback((toolCallId: string) => {
    const ai = (window as any).ai as AiRendererApi | undefined;
    const aiToolApproval = ai?.toolApproval;
    if (!aiToolApproval) return;

    const entry = pendingApprovalRef.current.get(toolCallId);
    if (!entry) return;

    // Send approval response to main process
    aiToolApproval.respond({
      chatId: entry.chatId,
      toolCallId,
      approved: true,
    });

    // Update the tool invocation state back to "call" (running)
    const streamConversationId = streamConversationIdRef.current;
    if (streamConversationId) {
      updateConversationById(streamConversationId, (conversation) => {
        const id = assistantIdRef.current;
        if (!id) return conversation;
        return {
          ...conversation,
          updatedAt: toIsoNow(),
          messages: conversation.messages.map((msg) => {
            if (msg.id !== id) return msg;
            const parts = (msg.parts ?? []).map((part) => {
              if (
                part.type === "tool-invocation"
                && part.toolInvocation.toolCallId === toolCallId
              ) {
                return {
                  ...part,
                  toolInvocation: {
                    ...part.toolInvocation,
                    state: "call" as const,
                    approvalRequest: undefined,
                  },
                };
              }
              return part;
            });
            return { ...msg, parts };
          }),
        };
      });
    }

    pendingApprovalRef.current.delete(toolCallId);
  }, [updateConversationById]);

  /** Reject a pending tool invocation. */
  const rejectToolCall = useCallback((toolCallId: string) => {
    const ai = (window as any).ai as AiRendererApi | undefined;
    const aiToolApproval = ai?.toolApproval;
    if (!aiToolApproval) return;

    const entry = pendingApprovalRef.current.get(toolCallId);
    if (!entry) return;

    // Send rejection response to main process
    aiToolApproval.respond({
      chatId: entry.chatId,
      toolCallId,
      approved: false,
    });

    // Update the tool invocation state back to "call" (will receive error result)
    const streamConversationId = streamConversationIdRef.current;
    if (streamConversationId) {
      updateConversationById(streamConversationId, (conversation) => {
        const id = assistantIdRef.current;
        if (!id) return conversation;
        return {
          ...conversation,
          updatedAt: toIsoNow(),
          messages: conversation.messages.map((msg) => {
            if (msg.id !== id) return msg;
            const parts = (msg.parts ?? []).map((part) => {
              if (
                part.type === "tool-invocation"
                && part.toolInvocation.toolCallId === toolCallId
              ) {
                return {
                  ...part,
                  toolInvocation: {
                    ...part.toolInvocation,
                    state: "call" as const,
                    approvalRequest: undefined,
                  },
                };
              }
              return part;
            });
            return { ...msg, parts };
          }),
        };
      });
    }

    pendingApprovalRef.current.delete(toolCallId);
  }, [updateConversationById]);

  const abort = useCallback(() => {
    const aiChat = window.electron?.aiChat;
    if (!aiChat) return;
    aiChat.abort(chatIdRef.current);
    setIsLoading(false);
    // Clean up stale pending approvals for the aborted stream
    pendingApprovalRef.current.clear();
    const streamConversationId = streamConversationIdRef.current;
    if (streamConversationId) {
      updateConversationById(streamConversationId, (conversation) => {
        const id = assistantIdRef.current;
        if (!id) return conversation;
        return {
          ...conversation,
          messages: conversation.messages.map((message) =>
            message.id === id ? { ...message, isStreaming: false } : message,
          ),
        };
      });
    }
    assistantIdRef.current = null;
    streamConversationIdRef.current = null;
  }, [updateConversationById]);

  const startNewConversation = useCallback(() => {
    const nextConversation = createEmptyConversation({ connectionId, connectionLabel, dbType });
    chatIdRef.current = `chat-${Date.now()}`;
    setConversations((prev) => withRetention([nextConversation, ...prev]));
    setActiveConversationId(nextConversation.id);
    setError(null);
  }, [connectionId, connectionLabel, dbType]);

  const selectConversation = useCallback((conversationId: string) => {
    setActiveConversationId((prev) => (prev === conversationId ? prev : conversationId));
    setError(null);
  }, []);

  const deleteConversation = useCallback(
    (conversationId: string) => {
      setConversations((prev) => {
        const remaining = prev.filter((conversation) => conversation.id !== conversationId);
        if (remaining.length > 0) {
          return remaining;
        }
        return [createEmptyConversation({ connectionId, connectionLabel, dbType })];
      });
      setActiveConversationId((prevActiveId) => {
        if (prevActiveId !== conversationId) return prevActiveId;
        const remaining = conversationsRef.current.filter(
          (conversation) => conversation.id !== conversationId,
        );
        return remaining[0]?.id ?? null;
      });
      setError(null);
    },
    [connectionId, connectionLabel, dbType],
  );

  const clearAllConversations = useCallback(() => {
    const fresh = createEmptyConversation({ connectionId, connectionLabel, dbType });
    chatIdRef.current = `chat-${Date.now()}`;
    setConversations([fresh]);
    setActiveConversationId(fresh.id);
    setIsLoading(false);
    setError(null);
    pendingApprovalRef.current.clear();
    assistantIdRef.current = null;
    streamConversationIdRef.current = null;
  }, [connectionId, connectionLabel, dbType]);

  const clearCurrentConversation = useCallback(() => {
    const conversationId = activeConversationIdRef.current;
    if (!conversationId) return;
    chatIdRef.current = `chat-${Date.now()}`;
    setIsLoading(false);
    setError(null);
    // Clean up stale pending approvals
    pendingApprovalRef.current.clear();
    assistantIdRef.current = null;
    streamConversationIdRef.current = null;
    updateConversationById(conversationId, (conversation) => ({
      ...conversation,
      title: DEFAULT_CONVERSATION_TITLE,
      updatedAt: toIsoNow(),
      messages: [],
    }));
  }, [updateConversationById]);

  const clearMessages = useCallback(() => {
    clearCurrentConversation();
  }, [clearCurrentConversation]);

  useEffect(() => {
    if (!activeConversationId) return;
    const exists = conversations.some((conversation) => conversation.id === activeConversationId);
    if (!exists) {
      setActiveConversationId(conversations[0]?.id ?? null);
    }
  }, [activeConversationId, conversations]);

  return {
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
    clearCurrentConversation,
    approveToolCall,
    rejectToolCall,
  };
}
