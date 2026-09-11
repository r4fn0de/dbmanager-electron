import { beforeEach, describe, expect, it, vi } from "vitest";

const memoryStoreMocks = vi.hoisted(() => ({
  cleanupOldMemories: vi.fn(),
  clearConnectionMemories: vi.fn(),
  cosineSimilarity: vi.fn(() => 0.9),
  getMemoryStats: vi.fn(),
  getRecentMemories: vi.fn(),
  saveMemory: vi.fn(),
  searchMemoriesByText: vi.fn(),
  searchSimilarMemories: vi.fn(),
}));

const embeddingMocks = vi.hoisted(() => ({
  generateEmbedding: vi.fn(),
  generateEmbeddings: vi.fn(),
  getEmbeddingStatus: vi.fn(),
  optimizeQueryForSearch: vi.fn((v: string) => v),
}));

vi.mock("@/ipc/ai/memory-store", () => memoryStoreMocks);
vi.mock("@/ipc/ai/embedding-service", () => embeddingMocks);

import { getMemoryContextHandler } from "@/ipc/ai/memory-handlers";

function getHandler(
  procedure: unknown
): (ctx: { input: unknown; context: unknown }) => Promise<any> {
  const orpc = (procedure as Record<string, unknown>)["~orpc"];
  if (
    !orpc ||
    typeof (orpc as Record<string, unknown>).handler !== "function"
  ) {
    throw new Error("Could not extract handler from oRPC procedure");
  }
  return (orpc as Record<string, unknown>).handler as (ctx: {
    input: unknown;
    context: unknown;
  }) => Promise<any>;
}

describe("memory handlers", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    memoryStoreMocks.getRecentMemories.mockReturnValue([]);
  });

  it("returns semantic mode when embeddings are ready and similar results exist", async () => {
    embeddingMocks.getEmbeddingStatus.mockReturnValue("ready");
    embeddingMocks.generateEmbedding.mockResolvedValue(new Float32Array(384));

    memoryStoreMocks.searchSimilarMemories.mockReturnValue([
      {
        entry: { conversationId: "conv-1" },
        similarity: 0.91,
      },
    ]);

    memoryStoreMocks.getRecentMemories
      .mockReturnValueOnce([])
      .mockReturnValueOnce([
        {
          content: "find users",
          embedding: new Float32Array(384),
          messageId: "m1",
          role: "user",
        },
        { content: "SELECT * FROM users", messageId: "m1", role: "assistant" },
      ]);

    const handler = getHandler(getMemoryContextHandler);
    const result = await handler({
      context: {},
      input: { query: "users", recentLimit: 2, similarLimit: 2 },
    });

    expect(result.mode).toBe("semantic");
    expect(result.similarPastQueries.length).toBe(1);
  });

  it("falls back to text mode when embedding model is unavailable", async () => {
    embeddingMocks.getEmbeddingStatus.mockReturnValue("loading");

    memoryStoreMocks.searchMemoriesByText.mockReturnValue([
      {
        content: "show orders",
        conversationId: "conv-2",
        messageId: "m7",
        role: "user",
      },
    ]);

    memoryStoreMocks.getRecentMemories
      .mockReturnValueOnce([])
      .mockReturnValueOnce([
        { content: "SELECT * FROM orders", messageId: "m7", role: "assistant" },
      ]);

    const handler = getHandler(getMemoryContextHandler);
    const result = await handler({
      context: {},
      input: { query: "orders", recentLimit: 2, similarLimit: 2 },
    });

    expect(result.mode).toBe("text-fallback");
    expect(result.similarPastQueries[0]?.query).toBe("show orders");
  });
});
