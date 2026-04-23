/**
 * useAiChat — React hook for AI streaming chat over Electron IPC.
 *
 * Manages chat state (messages, streaming, errors) and communicates
 * with the main process via window.electron.aiChat bridge.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { generateTitle } from "@/hooks/ai-actions";
import type { DatabaseType } from "@/ipc/db/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AiChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
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
  connectionId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: AiChatMessage[];
}

interface UseAiChatOptions {
  /** Connection ID for the active database */
  connectionId: string | null;
  /** Database type (postgresql, mysql, etc.) */
  dbType: DatabaseType;
  /** Optional schema context to inject into system prompt */
  schemaContext?: string;
}

interface UseAiChatReturn {
  /** All chat messages in order */
  messages: AiChatMessage[];
  /** All persisted conversations for the active connection */
  conversations: AiChatConversation[];
  /** Active conversation ID */
  activeConversationId: string | null;
  /** Whether a response is currently streaming */
  isLoading: boolean;
  /** Last error message */
  error: string | null;
  /** Send a user message and start streaming */
  sendMessage: (
    content: string,
    options?: {
      contextSnapshot?: {
        selectionPreview?: string;
        errorPreview?: string;
      };
    },
  ) => void;
  /** Abort the current stream */
  abort: () => void;
  /** Backward-compatible alias for clearCurrentConversation */
  clearMessages: () => void;
  /** Start an empty conversation and make it active */
  startNewConversation: () => void;
  /** Switch active conversation */
  selectConversation: (conversationId: string) => void;
  /** Delete one conversation */
  deleteConversation: (conversationId: string) => void;
  /** Clear all conversations for the active connection */
  clearAllConversations: () => void;
  /** Clear messages for the active conversation */
  clearCurrentConversation: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const AI_CHAT_STORAGE_KEY = "ai-chat-history:v1";
const MAX_CONVERSATIONS_PER_CONNECTION = 30;
const MAX_MESSAGES_PER_CONVERSATION = 120;
const DEFAULT_CONVERSATION_TITLE = "New Chat";

interface AiChatStorageV1 {
  version: 1;
  conversationsByConnection: Record<string, AiChatConversation[]>;
  activeConversationByConnection: Record<string, string>;
}

const EMPTY_STORAGE: AiChatStorageV1 = {
  version: 1,
  conversationsByConnection: {},
  activeConversationByConnection: {},
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

function readStorage(): AiChatStorageV1 {
  if (typeof window === "undefined") return EMPTY_STORAGE;
  try {
    const raw = window.localStorage.getItem(AI_CHAT_STORAGE_KEY);
    if (!raw) return EMPTY_STORAGE;
    const parsed = JSON.parse(raw) as Partial<AiChatStorageV1>;
    if (parsed.version !== 1) return EMPTY_STORAGE;
    return {
      version: 1,
      conversationsByConnection: parsed.conversationsByConnection ?? {},
      activeConversationByConnection: parsed.activeConversationByConnection ?? {},
    };
  } catch {
    return EMPTY_STORAGE;
  }
}

function writeStorage(storage: AiChatStorageV1): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(AI_CHAT_STORAGE_KEY, JSON.stringify(storage));
  } catch {
    // Ignore storage quota/unavailable scenarios.
  }
}

function toPersistedMessage(message: AiChatMessage): AiChatMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    // Preserve isStreaming so in-memory state keeps the flag during
    // the streaming lifecycle.  For persisted messages the value is
    // always undefined/falsy, so no harm storing it.
    ...(message.isStreaming ? { isStreaming: true } : {}),
    ...(message.contextSnapshot ? { contextSnapshot: message.contextSnapshot } : {}),
    ...(message.toolCalls ? { toolCalls: message.toolCalls } : {}),
  };
}

function trimConversationMessages(messages: AiChatMessage[]): AiChatMessage[] {
  if (messages.length <= MAX_MESSAGES_PER_CONVERSATION) {
    return messages.map(toPersistedMessage);
  }
  return messages
    .slice(messages.length - MAX_MESSAGES_PER_CONVERSATION)
    .map(toPersistedMessage);
}

function withRetention(conversations: AiChatConversation[]): AiChatConversation[] {
  const normalized = conversations
    .map((conversation) => ({
      ...conversation,
      messages: trimConversationMessages(conversation.messages),
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  if (normalized.length <= MAX_CONVERSATIONS_PER_CONNECTION) {
    return normalized;
  }
  return normalized.slice(0, MAX_CONVERSATIONS_PER_CONNECTION);
}

function createEmptyConversation(connectionId: string): AiChatConversation {
  const now = new Date().toISOString();
  return {
    id: nextConversationId(),
    connectionId,
    title: DEFAULT_CONVERSATION_TITLE,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

function fallbackConversationTitle(): string {
  const clock = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());
  return `${DEFAULT_CONVERSATION_TITLE} ${clock}`;
}

export function useAiChat({
  connectionId,
  dbType,
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
  const connectionIdRef = useRef<string | null>(connectionId);

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

  const ensureConversation = useCallback((targetConnectionId: string) => {
    const existing = conversationsRef.current[0];
    if (existing) {
      setActiveConversationId(existing.id);
      return existing;
    }

    const created = createEmptyConversation(targetConnectionId);
    setConversations((prev) => withRetention([created, ...prev]));
    setActiveConversationId(created.id);
    return created;
  }, []);

  const persistCurrentConnection = useCallback(
    (nextConversations: AiChatConversation[], nextActiveConversationId: string | null) => {
      if (!connectionIdRef.current) return;
      const storage = readStorage();
      // Strip transient fields (e.g. isStreaming) before writing to localStorage
      // so a crash mid-stream never leaves stale isStreaming:true on rehydration.
      // nextConversations have already been processed through withRetention.
      storage.conversationsByConnection[connectionIdRef.current] = nextConversations.map(
        (conv) => ({
          ...conv,
          messages: conv.messages.map(({ isStreaming: _, ...msg }) => msg),
        }),
      );
      if (nextActiveConversationId) {
        storage.activeConversationByConnection[connectionIdRef.current] = nextActiveConversationId;
      } else {
        delete storage.activeConversationByConnection[connectionIdRef.current];
      }
      writeStorage(storage);
    },
    [],
  );

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    connectionIdRef.current = connectionId;
  }, [connectionId]);

  useEffect(() => {
    if (!connectionId) {
      setIsHydrated(false);
      setConversations([]);
      setActiveConversationId(null);
      setIsLoading(false);
      setError(null);
      assistantIdRef.current = null;
      streamConversationIdRef.current = null;
      return;
    }

    setIsHydrated(false);
    const storage = readStorage();
    const persisted = withRetention(storage.conversationsByConnection[connectionId] ?? []);
    const persistedActiveId = storage.activeConversationByConnection[connectionId] ?? null;
    const activeExists = persistedActiveId
      ? persisted.some((conversation) => conversation.id === persistedActiveId)
      : false;

    if (persisted.length === 0) {
      const fresh = createEmptyConversation(connectionId);
      setConversations([fresh]);
      setActiveConversationId(fresh.id);
      storage.conversationsByConnection[connectionId] = [fresh];
      storage.activeConversationByConnection[connectionId] = fresh.id;
      writeStorage(storage);
      setIsHydrated(true);
      return;
    }

    setConversations(persisted);
    setActiveConversationId(activeExists ? persistedActiveId : persisted[0].id);
    if (!activeExists) {
      storage.activeConversationByConnection[connectionId] = persisted[0].id;
      writeStorage(storage);
    }
    setIsHydrated(true);
  }, [connectionId]);

  useEffect(() => {
    if (!isHydrated) return;
    persistCurrentConnection(conversations, activeConversationId);
  }, [isHydrated, conversations, activeConversationId, persistCurrentConnection]);

  // Register IPC listeners for streaming chunks
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
            updatedAt: new Date().toISOString(),
            messages: conversation.messages.map((msg) =>
            msg.id === id
              ? { ...msg, content: msg.content + chunk.text }
              : msg,
            ),
          };
        });
      } else if (chunk.type === "tool-call") {
        updateConversationById(streamConversationId, (conversation) => {
          const id = assistantIdRef.current;
          if (!id) return conversation;
          return {
            ...conversation,
            updatedAt: new Date().toISOString(),
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
            updatedAt: new Date().toISOString(),
            messages: conversation.messages.map((msg) => {
            if (msg.id !== id || !msg.toolCalls) return msg;
            const updated = [...msg.toolCalls];
            const callIdx = updated.findIndex(
              (call) => call.toolCallId === chunk.toolCallId,
            );
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
            updatedAt: new Date().toISOString(),
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
          // Remove the streaming assistant message if it exists
          updateConversationById(streamConversationId, (conversation) => {
          const id = assistantIdRef.current;
            if (!id) return conversation;
          assistantIdRef.current = null;
            return {
              ...conversation,
              updatedAt: new Date().toISOString(),
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
      if (!connectionId || !content.trim()) return;

      const aiChat = window.electron?.aiChat;
      if (!aiChat) {
        setError("AI chat is not available");
        return;
      }

      setError(null);

      let targetConversationId = activeConversationIdRef.current;
      if (!targetConversationId) {
        const created = ensureConversation(connectionId);
        targetConversationId = created?.id ?? null;
      }
      if (!targetConversationId) return;

      const activeConversation = conversationsRef.current.find(
        (conversation) => conversation.id === targetConversationId,
      );
      if (!activeConversation) return;

      const hadUserMessages = activeConversation.messages.some(
        (message) => message.role === "user",
      );
      const isUntitledConversation = activeConversation.title === DEFAULT_CONVERSATION_TITLE;

      // Add user message
      const userMsg: AiChatMessage = {
        id: nextId(),
        role: "user",
        content: content.trim(),
        contextSnapshot: options?.contextSnapshot,
      };

      // Create placeholder assistant message
      const assistantMsg: AiChatMessage = {
        id: nextId(),
        role: "assistant",
        content: "",
        isStreaming: true,
      };

      assistantIdRef.current = assistantMsg.id;
      streamConversationIdRef.current = targetConversationId;
      updateConversationById(targetConversationId, (conversation) => ({
        ...conversation,
        updatedAt: new Date().toISOString(),
        messages: trimConversationMessages([...conversation.messages, userMsg, assistantMsg]),
      }));
      setIsLoading(true);

      // Build messages array for the model (CoreMessage format)
      const coreMessages = [...activeConversation.messages, userMsg]
        .filter((m) => m.role !== "system")
        .map((m) => ({
          role: m.role,
          content: m.content,
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
    [connectionId, dbType, ensureConversation, schemaContext, updateConversationById],
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
    if (!connectionId) return;
    const nextConversation = createEmptyConversation(connectionId);
    chatIdRef.current = `chat-${Date.now()}`;
    setConversations((prev) => withRetention([nextConversation, ...prev]));
    setActiveConversationId(nextConversation.id);
    setError(null);
  }, [connectionId]);

  const selectConversation = useCallback((conversationId: string) => {
    setActiveConversationId((prev) => (prev === conversationId ? prev : conversationId));
    setError(null);
  }, []);

  const deleteConversation = useCallback(
    (conversationId: string) => {
      if (!connectionId) return;
      setConversations((prev) => {
        const remaining = prev.filter((conversation) => conversation.id !== conversationId);
        if (remaining.length > 0) {
          return remaining;
        }
        return [createEmptyConversation(connectionId)];
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
    [connectionId],
  );

  const clearAllConversations = useCallback(() => {
    if (!connectionId) return;
    const fresh = createEmptyConversation(connectionId);
    chatIdRef.current = `chat-${Date.now()}`;
    setConversations([fresh]);
    setActiveConversationId(fresh.id);
    setIsLoading(false);
    setError(null);
    assistantIdRef.current = null;
    streamConversationIdRef.current = null;
  }, [connectionId]);

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
      updatedAt: new Date().toISOString(),
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
