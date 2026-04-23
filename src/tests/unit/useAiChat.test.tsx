import { renderHook, waitFor } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAiChat } from "@/hooks/useAiChat";

vi.mock("@/hooks/ai-actions", () => ({
  generateTitle: vi.fn().mockResolvedValue({ title: "Generated Chat Title" }),
}));

const AI_CHAT_STORAGE_KEY_V1 = "ai-chat-history:v1";
const AI_CHAT_STORAGE_KEY_V2 = "ai-chat-history:v2";

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

  it("migrates v1 history to v2 and preserves connection tags", async () => {
    localStorage.setItem(
      AI_CHAT_STORAGE_KEY_V1,
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
              createdAt: "2025-01-02T00:00:00.000Z",
              updatedAt: "2025-01-02T00:00:00.000Z",
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

    const { result } = renderHook(() =>
      useAiChat({
        connectionId: "conn-a",
        dbType: "postgresql",
      }),
    );

    await waitFor(() => {
      expect(result.current.conversations.length).toBe(2);
    });

    const migrated = JSON.parse(localStorage.getItem(AI_CHAT_STORAGE_KEY_V2) ?? "{}");
    expect(migrated.version).toBe(2);
    expect(migrated.conversations).toHaveLength(2);
    expect(migrated.conversations[0].contextTag.connectionId).toBeTruthy();
    expect(
      migrated.conversations.every(
        (conversation: any) => conversation.messages.every((message: any) => Boolean(message.contextTag)),
      ),
    ).toBe(true);
  });

  it("migration is idempotent and does not duplicate conversations", async () => {
    localStorage.setItem(
      AI_CHAT_STORAGE_KEY_V1,
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
        },
        activeConversationByConnection: {
          "conn-a": "conv-a",
        },
      }),
    );

    const first = renderHook(() =>
      useAiChat({
        connectionId: "conn-a",
        dbType: "postgresql",
      }),
    );

    await waitFor(() => {
      expect(first.result.current.conversations.length).toBe(1);
    });
    first.unmount();

    const second = renderHook(() =>
      useAiChat({
        connectionId: "conn-a",
        dbType: "postgresql",
      }),
    );

    await waitFor(() => {
      expect(second.result.current.conversations.length).toBe(1);
    });

    const migrated = JSON.parse(localStorage.getItem(AI_CHAT_STORAGE_KEY_V2) ?? "{}");
    expect(migrated.conversations).toHaveLength(1);
  });

  it("does not wipe existing v2 storage during initial hydration", async () => {
    localStorage.setItem(
      AI_CHAT_STORAGE_KEY_V2,
      JSON.stringify({
        version: 2,
        conversations: [
          {
            id: "conv-a",
            title: "Persisted Chat",
            createdAt: "2025-01-01T00:00:00.000Z",
            updatedAt: "2025-01-01T00:00:00.000Z",
            contextTag: { connectionId: "conn-a", dbType: "postgresql" },
            messages: [{ id: "m1", role: "user", content: "still here" }],
          },
        ],
        activeConversationId: "conv-a",
      }),
    );

    renderHook(() =>
      useAiChat({
        connectionId: "conn-a",
        dbType: "postgresql",
      }),
    );

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(AI_CHAT_STORAGE_KEY_V2) ?? "{}");
      expect(stored.conversations[0]?.title).toBe("Persisted Chat");
      expect(stored.conversations[0]?.messages?.[0]?.content).toBe("still here");
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

  it("applies retention limits for global conversations and messages", async () => {
    localStorage.setItem(
      AI_CHAT_STORAGE_KEY_V2,
      JSON.stringify({
        version: 2,
        conversations: Array.from({ length: 35 }, (_, index) => ({
          id: `conv-${index}`,
          title: `Conv ${index}`,
          createdAt: `2025-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
          updatedAt: `2025-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
          contextTag: { connectionId: "conn-a", dbType: "postgresql" },
          messages: makeMessages(140),
        })),
        activeConversationId: "conv-34",
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

    expect(
      result.current.conversations.every((conversation) => conversation.messages.length <= 120),
    ).toBe(true);
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

  it("clearAllConversations resets global history", async () => {
    localStorage.setItem(
      AI_CHAT_STORAGE_KEY_V2,
      JSON.stringify({
        version: 2,
        conversations: [
          {
            id: "conv-a",
            title: "A",
            createdAt: "2025-01-01T00:00:00.000Z",
            updatedAt: "2025-01-01T00:00:00.000Z",
            contextTag: { connectionId: "conn-a", dbType: "postgresql" },
            messages: [{ id: "m1", role: "user", content: "a" }],
          },
          {
            id: "conv-b",
            title: "B",
            createdAt: "2025-01-02T00:00:00.000Z",
            updatedAt: "2025-01-02T00:00:00.000Z",
            contextTag: { connectionId: "conn-b", dbType: "postgresql" },
            messages: [{ id: "m2", role: "user", content: "b" }],
          },
        ],
        activeConversationId: "conv-a",
      }),
    );

    const { result } = renderHook(() =>
      useAiChat({
        connectionId: "conn-a",
        dbType: "postgresql",
      }),
    );

    await waitFor(() => {
      expect(result.current.conversations.length).toBe(2);
    });

    act(() => {
      result.current.clearAllConversations();
    });

    const stored = JSON.parse(localStorage.getItem(AI_CHAT_STORAGE_KEY_V2) ?? "{}");
    expect(stored.conversations).toHaveLength(1);
    expect(stored.activeConversationId).toBeTruthy();
  });

  it("restores global active conversation after restart", async () => {
    const first = renderHook(() =>
      useAiChat({
        connectionId: "conn-a",
        dbType: "postgresql",
      }),
    );

    await waitFor(() => {
      expect(first.result.current.conversations.length).toBe(1);
    });

    act(() => {
      first.result.current.startNewConversation();
    });

    const chosen = first.result.current.activeConversationId;
    first.unmount();

    const second = renderHook(() =>
      useAiChat({
        connectionId: "conn-a",
        dbType: "postgresql",
      }),
    );

    await waitFor(() => {
      expect(second.result.current.activeConversationId).toBe(chosen);
    });
  });

  it("handles invalid JSON in localStorage", async () => {
    localStorage.setItem(AI_CHAT_STORAGE_KEY_V2, "{not-valid-json");

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
