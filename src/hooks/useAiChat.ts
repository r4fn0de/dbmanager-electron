/**
 * useAiChat — React hook for AI streaming chat over Electron IPC.
 *
 * Manages chat state (messages, streaming, errors) and communicates
 * with the main process via window.electron.aiChat bridge.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { DatabaseType } from "@/ipc/db/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AiChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
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
  /** Whether a response is currently streaming */
  isLoading: boolean;
  /** Last error message */
  error: string | null;
  /** Send a user message and start streaming */
  sendMessage: (content: string) => void;
  /** Abort the current stream */
  abort: () => void;
  /** Clear all messages */
  clearMessages: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

let messageCounter = 0;
function nextId(): string {
  return `msg-${Date.now()}-${++messageCounter}`;
}

export function useAiChat({
  connectionId,
  dbType,
  schemaContext,
}: UseAiChatOptions): UseAiChatReturn {
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chatIdRef = useRef<string>(`chat-${Date.now()}`);
  const assistantIdRef = useRef<string | null>(null);

  // Register IPC listeners for streaming chunks
  useEffect(() => {
    const aiChat = window.electron?.aiChat;
    if (!aiChat) return;

    const unsubChunk = aiChat.onChunk((chunk: AiChatChunk) => {
      if (chunk.chatId !== chatIdRef.current) return;

      if (chunk.type === "text") {
        setMessages((prev) => {
          const id = assistantIdRef.current;
          if (!id) return prev;
          return prev.map((msg) =>
            msg.id === id
              ? { ...msg, content: msg.content + chunk.text }
              : msg,
          );
        });
      } else if (chunk.type === "tool-call") {
        setMessages((prev) => {
          const id = assistantIdRef.current;
          if (!id) return prev;
          return prev.map((msg) =>
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
          );
        });
      } else if (chunk.type === "tool-result") {
        setMessages((prev) => {
          const id = assistantIdRef.current;
          if (!id) return prev;
          return prev.map((msg) => {
            if (msg.id !== id || !msg.toolCalls) return msg;
            const updated = [...msg.toolCalls];
            const callIdx = updated.findIndex(
              (call) => call.toolCallId === chunk.toolCallId,
            );
            if (callIdx >= 0) {
              updated[callIdx] = { ...updated[callIdx], result: chunk.result };
            }
            return { ...msg, toolCalls: updated };
          });
        });
      }
    });

    const unsubDone = aiChat.onDone(({ chatId }) => {
      if (chatId !== chatIdRef.current) return;

      setMessages((prev) => {
        const id = assistantIdRef.current;
        if (!id) return prev;
        return prev.map((msg) =>
          msg.id === id ? { ...msg, isStreaming: false } : msg,
        );
      });
      setIsLoading(false);
      assistantIdRef.current = null;
    });

    const unsubError = aiChat.onError(
      ({ chatId, message }: { chatId: string; message: string }) => {
        if (chatId !== chatIdRef.current) return;

        setError(message);
        setIsLoading(false);
        // Remove the streaming assistant message if it exists
        setMessages((prev) => {
          const id = assistantIdRef.current;
          if (!id) return prev;
          assistantIdRef.current = null;
          return prev.filter((msg) => msg.id !== id);
        });
      },
    );

    return () => {
      unsubChunk();
      unsubDone();
      unsubError();
    };
  }, []);

  const sendMessage = useCallback(
    (content: string) => {
      if (!connectionId || !content.trim()) return;

      const aiChat = window.electron?.aiChat;
      if (!aiChat) {
        setError("AI chat is not available");
        return;
      }

      setError(null);

      // Add user message
      const userMsg: AiChatMessage = {
        id: nextId(),
        role: "user",
        content: content.trim(),
      };

      // Create placeholder assistant message
      const assistantMsg: AiChatMessage = {
        id: nextId(),
        role: "assistant",
        content: "",
        isStreaming: true,
      };

      assistantIdRef.current = assistantMsg.id;
      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setIsLoading(true);

      // Build messages array for the model (CoreMessage format)
      const coreMessages = [...messages, userMsg]
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
    },
    [connectionId, dbType, schemaContext, messages],
  );

  const abort = useCallback(() => {
    const aiChat = window.electron?.aiChat;
    if (!aiChat) return;
    aiChat.abort(chatIdRef.current);
    setIsLoading(false);
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
    chatIdRef.current = `chat-${Date.now()}`;
  }, []);

  return { messages, isLoading, error, sendMessage, abort, clearMessages };
}
