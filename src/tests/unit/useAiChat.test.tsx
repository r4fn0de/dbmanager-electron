import { renderHook, waitFor } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAiChat } from "@/hooks/useAiChat";

vi.mock("@/hooks/ai-actions", () => ({
  generateTitle: vi.fn().mockResolvedValue({ title: "Generated Chat Title" }),
}));

const AI_CHAT_STORAGE_KEY = "ai-chat-history:v1";

function makeMessages(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `msg-${index + 1}`,
    role: index % 2 === 0 ? "user" : "assistant",
    content: `message-${index + 1}`,
  }));
}

describe("useAiChat", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();

    (window as any).electron = {
      aiChat: {
        start: vi.fn(),
        abort: vi.fn(),
        onChunk: vi.fn(() => () => {}),
        onDone: vi.fn(() => () => {}),
        onError: vi.fn(() => () => {}),
      },
    };
  });

  it("rehydrates history per connection", async () => {
    localStorage.setItem(
      AI_CHAT_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        conversationsByConnection: {
          "conn-a": [
            {
              id: "conv-a",
              connectionId: "conn-a",
              title: "A",
              createdAt: "2025-01-01T00:00:00.000Z",
              updatedAt: "2025-01-01T00:00:00.000Z",
              messages: [{ id: "m1", role: "user", content: "hello a" }],
            },
          ],
          "conn-b": [
            {
              id: "conv-b",
              connectionId: "conn-b",
              title: "B",
              createdAt: "2025-01-01T00:00:00.000Z",
              updatedAt: "2025-01-01T00:00:00.000Z",
              messages: [{ id: "m2", role: "user", content: "hello b" }],
            },
          ],
        },
        activeConversationByConnection: {
          "conn-a": "conv-a",
          "conn-b": "conv-b",
        },
      }),
    );

    const { result, rerender } = renderHook(
      ({ connectionId }) =>
        useAiChat({
          connectionId,
          dbType: "postgresql",
          schemaContext: undefined,
        }),
      { initialProps: { connectionId: "conn-a" as string | null } },
    );

    await waitFor(() => {
      expect(result.current.messages[0]?.content).toBe("hello a");
    });

    rerender({ connectionId: "conn-b" });

    await waitFor(() => {
      expect(result.current.messages[0]?.content).toBe("hello b");
    });
  });

  it("does not wipe existing storage during initial hydration", async () => {
    localStorage.setItem(
      AI_CHAT_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        conversationsByConnection: {
          "conn-a": [
            {
              id: "conv-a",
              connectionId: "conn-a",
              title: "Persisted Chat",
              createdAt: "2025-01-01T00:00:00.000Z",
              updatedAt: "2025-01-01T00:00:00.000Z",
              messages: [{ id: "m1", role: "user", content: "still here" }],
            },
          ],
        },
        activeConversationByConnection: {
          "conn-a": "conv-a",
        },
      }),
    );

    renderHook(() =>
      useAiChat({
        connectionId: "conn-a",
        dbType: "postgresql",
      }),
    );

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(AI_CHAT_STORAGE_KEY) ?? "{}");
      expect(stored.conversationsByConnection["conn-a"]?.[0]?.title).toBe("Persisted Chat");
      expect(stored.conversationsByConnection["conn-a"]?.[0]?.messages?.[0]?.content).toBe("still here");
    });
  });

  it("creates a new conversation and makes it active", async () => {
    const { result } = renderHook(() =>
      useAiChat({
        connectionId: "conn-a",
        dbType: "postgresql",
      }),
    );

    await waitFor(() => {
      expect(result.current.conversations.length).toBe(1);
    });

    const previousActiveId = result.current.activeConversationId;
    act(() => {
      result.current.startNewConversation();
    });

    expect(result.current.conversations.length).toBe(2);
    expect(result.current.activeConversationId).not.toBe(previousActiveId);
    expect(result.current.messages).toHaveLength(0);
  });

  it("sets title on first user message using generated title", async () => {
    const { result } = renderHook(() =>
      useAiChat({
        connectionId: "conn-a",
        dbType: "postgresql",
      }),
    );

    await waitFor(() => {
      expect(result.current.conversations.length).toBe(1);
    });

    act(() => {
      result.current.sendMessage("first prompt");
    });

    await waitFor(() => {
      expect(result.current.conversations[0]?.title).toBe("Generated Chat Title");
    });
  });

  it("applies retention for conversations and messages", async () => {
    localStorage.setItem(
      AI_CHAT_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        conversationsByConnection: {
          "conn-a": Array.from({ length: 35 }, (_, index) => ({
            id: `conv-${index}`,
            connectionId: "conn-a",
            title: `Conv ${index}`,
            createdAt: `2025-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
            updatedAt: `2025-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
            messages: makeMessages(140),
          })),
        },
        activeConversationByConnection: {
          "conn-a": "conv-34",
        },
      }),
    );

    const { result } = renderHook(() =>
      useAiChat({
        connectionId: "conn-a",
        dbType: "postgresql",
      }),
    );

    await waitFor(() => {
      expect(result.current.conversations.length).toBe(30);
    });

    expect(result.current.conversations.every((conversation) => conversation.messages.length <= 120)).toBe(true);
  });

  it("deleting active conversation falls back to another", async () => {
    const { result } = renderHook(() =>
      useAiChat({
        connectionId: "conn-a",
        dbType: "postgresql",
      }),
    );

    await waitFor(() => {
      expect(result.current.conversations.length).toBe(1);
    });

    act(() => {
      result.current.startNewConversation();
    });

    const active = result.current.activeConversationId;
    act(() => {
      if (active) result.current.deleteConversation(active);
    });

    expect(result.current.activeConversationId).toBeTruthy();
    expect(result.current.conversations.length).toBe(1);
  });

  it("clearAllConversations only clears current connection", async () => {
    localStorage.setItem(
      AI_CHAT_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        conversationsByConnection: {
          "conn-a": [
            {
              id: "conv-a",
              connectionId: "conn-a",
              title: "A",
              createdAt: "2025-01-01T00:00:00.000Z",
              updatedAt: "2025-01-01T00:00:00.000Z",
              messages: [{ id: "m1", role: "user", content: "a" }],
            },
          ],
          "conn-b": [
            {
              id: "conv-b",
              connectionId: "conn-b",
              title: "B",
              createdAt: "2025-01-01T00:00:00.000Z",
              updatedAt: "2025-01-01T00:00:00.000Z",
              messages: [{ id: "m2", role: "user", content: "b" }],
            },
          ],
        },
        activeConversationByConnection: {
          "conn-a": "conv-a",
          "conn-b": "conv-b",
        },
      }),
    );

    const { result } = renderHook(() =>
      useAiChat({
        connectionId: "conn-a",
        dbType: "postgresql",
      }),
    );

    await waitFor(() => {
      expect(result.current.conversations.length).toBe(1);
    });

    act(() => {
      result.current.clearAllConversations();
    });

    const stored = JSON.parse(localStorage.getItem(AI_CHAT_STORAGE_KEY) ?? "{}");
    expect(stored.conversationsByConnection["conn-b"]).toHaveLength(1);
    expect(stored.conversationsByConnection["conn-a"]).toHaveLength(1);
  });

  it("handles invalid JSON in localStorage", async () => {
    localStorage.setItem(AI_CHAT_STORAGE_KEY, "{not-valid-json");

    const { result } = renderHook(() =>
      useAiChat({
        connectionId: "conn-a",
        dbType: "postgresql",
      }),
    );

    await waitFor(() => {
      expect(result.current.conversations.length).toBe(1);
    });
  });
});
