import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { useAiMemory } from "@/features/ai/hooks/useAiMemory";

const aiMocks = vi.hoisted(() => ({
  cleanupMemory: vi.fn(),
  clearMemory: vi.fn(),
  getEmbeddingStatus: vi.fn(),
  getMemoryContext: vi.fn(),
  getMemoryStats: vi.fn(),
  getRecentHistory: vi.fn(),
  searchMemory: vi.fn(),
  storeMemory: vi.fn(),
}));

vi.mock("@/ipc/manager", () => ({
  ipc: {
    client: {
      ai: {
        cleanupMemory: aiMocks.cleanupMemory,
        clearMemory: aiMocks.clearMemory,
        getEmbeddingStatus: aiMocks.getEmbeddingStatus,
        getMemoryContext: aiMocks.getMemoryContext,
        getMemoryStats: aiMocks.getMemoryStats,
        getRecentHistory: aiMocks.getRecentHistory,
        searchMemory: aiMocks.searchMemory,
        storeMemory: aiMocks.storeMemory,
      },
    },
  },
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe("useAiMemory", () => {
  it("exposes degraded mode when embeddings are not ready", async () => {
    aiMocks.getEmbeddingStatus.mockResolvedValue({
      ready: false,
      status: "loading",
    });
    aiMocks.getMemoryStats.mockResolvedValue({
      conversations: 0,
      oldestEntry: null,
      totalEntries: 0,
      withEmbeddings: 0,
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
    aiMocks.getEmbeddingStatus.mockResolvedValue({
      ready: true,
      status: "ready",
    });
    aiMocks.getMemoryStats.mockResolvedValue({
      conversations: 2,
      oldestEntry: "2026-01-01T00:00:00.000Z",
      totalEntries: 10,
      withEmbeddings: 8,
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

    const context = await result.current.getMemoryContext({
      query: "show users",
    });
    expect(context.mode).toBe("text-fallback");
    expect(result.current.memoryStatus).toBe("ready");
  });
});
