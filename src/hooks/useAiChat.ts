/**
 * useAiChat — React hook for AI streaming chat over Electron IPC.
 *
 * Global chat state with persistent multi-conversation history.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { generateTitle } from "@/hooks/ai-actions";
import type { DatabaseType } from "@/ipc/db/types";

export interface AiChatContextTag {
  connectionId: string | null;
  connectionLabel?: string;
  dbType?: DatabaseType;
}

export interface AiChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt?: string;
  contextTag?: AiChatContextTag;
  /** Optional context snapshot attached to a user message */
  contextSnapshot?: {
    selectionPreview?: string;
    errorPreview?: string;
  };
  /** Tool calls made by the assistant during this message */
  toolCalls?: Array<{
    toolCallId: string;
    toolName: string;
    input: unknown;
    result?: unknown;
  }>;
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
    },
  ) => void;
  abort: () => void;
  clearMessages: () => void;
  startNewConversation: () => void;
  selectConversation: (conversationId: string) => void;
  deleteConversation: (conversationId: string) => void;
  clearAllConversations: () => void;
  clearCurrentConversation: () => void;
}

const AI_CHAT_STORAGE_KEY_V1 = "ai-chat-history:v1";
const AI_CHAT_STORAGE_KEY_V2 = "ai-chat-history:v2";
const MAX_CONVERSATIONS = 30;
const MAX_MESSAGES_PER_CONVERSATION = 120;
const DEFAULT_CONVERSATION_TITLE = "New Chat";

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
  const { isStreaming: _isStreaming, ...rest } = message;
  return rest;
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

  const messages = useMemo(() => {
    if (!activeConversationId) return [];
    const active = conversations.find((conversation) => conversation.id === activeConversationId);
    return active?.messages ?? [];
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

    const unsubChunk = aiChat.onChunk((chunk: AiChatChunk) => {
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
            messages: conversation.messages.map((msg) =>
              msg.id === id ? { ...msg, content: msg.content + chunk.text } : msg,
            ),
          };
        });
      } else if (chunk.type === "tool-call") {
        updateConversationById(streamConversationId, (conversation) => {
          const id = assistantIdRef.current;
          if (!id) return conversation;
          return {
            ...conversation,
            updatedAt: toIsoNow(),
            messages: conversation.messages.map((msg) =>
              msg.id === id
                ? {
                    ...msg,
                    toolCalls: [
                      ...(msg.toolCalls ?? []),
                      {
                        toolCallId: chunk.toolCallId,
                        toolName: chunk.toolName,
                        input: chunk.input,
                      },
                    ],
                  }
                : msg,
            ),
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
              if (msg.id !== id || !msg.toolCalls) return msg;
              const updated = [...msg.toolCalls];
              const callIdx = updated.findIndex((call) => call.toolCallId === chunk.toolCallId);
              if (callIdx >= 0) {
                updated[callIdx] = { ...updated[callIdx], result: chunk.result };
              }
              return { ...msg, toolCalls: updated };
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

      // Always compute model messages from latest in-memory conversation state.
      const coreMessages = [...activeConversation.messages, userMsg]
        .filter((message) => message.role !== "system")
        .map((message) => ({
          role: message.role,
          content: message.content,
        }));

      aiChat.start({
        chatId: chatIdRef.current,
        connectionId,
        dbType,
        schemaContext,
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
    [connectionId, connectionLabel, dbType, ensureConversation, schemaContext, updateConversationById],
  );

  const abort = useCallback(() => {
    const aiChat = window.electron?.aiChat;
    if (!aiChat) return;
    aiChat.abort(chatIdRef.current);
    setIsLoading(false);
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
    assistantIdRef.current = null;
    streamConversationIdRef.current = null;
  }, [connectionId, connectionLabel, dbType]);

  const clearCurrentConversation = useCallback(() => {
    const conversationId = activeConversationIdRef.current;
    if (!conversationId) return;
    chatIdRef.current = `chat-${Date.now()}`;
    setIsLoading(false);
    setError(null);
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
  };
}
