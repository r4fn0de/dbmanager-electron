import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { useAiMemory } from "@/features/ai/hooks/useAiMemory";

const aiMocks = vi.hoisted(() => ({
  getEmbeddingStatus: vi.fn(),
  getMemoryStats: vi.fn(),
  getRecentHistory: vi.fn(),
  storeMemory: vi.fn(),
  searchMemory: vi.fn(),
  getMemoryContext: vi.fn(),
  clearMemory: vi.fn(),
  cleanupMemory: vi.fn(),
}));

vi.mock("@/ipc/manager", () => ({
  ipc: {
    client: {
      ai: {
        getEmbeddingStatus: aiMocks.getEmbeddingStatus,
        getMemoryStats: aiMocks.getMemoryStats,
        getRecentHistory: aiMocks.getRecentHistory,
        storeMemory: aiMocks.storeMemory,
        searchMemory: aiMocks.searchMemory,
        getMemoryContext: aiMocks.getMemoryContext,
        clearMemory: aiMocks.clearMemory,
        cleanupMemory: aiMocks.cleanupMemory,
      },
    },
  },
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useAiMemory", () => {
  it("exposes degraded mode when embeddings are not ready", async () => {
    aiMocks.getEmbeddingStatus.mockResolvedValue({ status: "loading", ready: false });
    aiMocks.getMemoryStats.mockResolvedValue({
      totalEntries: 0,
      withEmbeddings: 0,
      conversations: 0,
      oldestEntry: null,
    });
    aiMocks.getRecentHistory.mockResolvedValue({ messages: [] });

    const { result } = renderHook(() => useAiMemory(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isStatusLoading).toBe(false);
    });

    expect(result.current.memoryStatus).toBe("degraded");
  });

  it("passes through memory context mode from backend", async () => {
    aiMocks.getEmbeddingStatus.mockResolvedValue({ status: "ready", ready: true });
    aiMocks.getMemoryStats.mockResolvedValue({
      totalEntries: 10,
      withEmbeddings: 8,
      conversations: 2,
      oldestEntry: "2026-01-01T00:00:00.000Z",
    });
    aiMocks.getRecentHistory.mockResolvedValue({ messages: [] });
    aiMocks.getMemoryContext.mockResolvedValue({
      mode: "text-fallback",
      recentMessages: [],
      similarPastQueries: [],
    });

    const { result } = renderHook(() => useAiMemory(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isStatusLoading).toBe(false);
    });

    const context = await result.current.getMemoryContext({ query: "show users" });
    expect(context.mode).toBe("text-fallback");
    expect(result.current.memoryStatus).toBe("ready");
  });
});
