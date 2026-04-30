import { beforeEach, describe, expect, it, vi } from "vitest";

const memoryStoreMocks = vi.hoisted(() => ({
  saveMemory: vi.fn(),
  searchSimilarMemories: vi.fn(),
  searchMemoriesByText: vi.fn(),
  getRecentMemories: vi.fn(),
  getMemoryStats: vi.fn(),
  clearConnectionMemories: vi.fn(),
  cleanupOldMemories: vi.fn(),
  cosineSimilarity: vi.fn(() => 0.9),
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
  procedure: unknown,
): (ctx: { input: unknown; context: unknown }) => Promise<any> {
  const orpc = (procedure as Record<string, unknown>)["~orpc"];
  if (!orpc || typeof (orpc as Record<string, unknown>).handler !== "function") {
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
        { role: "user", content: "find users", messageId: "m1", embedding: new Float32Array(384) },
        { role: "assistant", content: "SELECT * FROM users", messageId: "m1" },
      ]);

    const handler = getHandler(getMemoryContextHandler);
    const result = await handler({
      input: { query: "users", similarLimit: 2, recentLimit: 2 },
      context: {},
    });

    expect(result.mode).toBe("semantic");
    expect(result.similarPastQueries.length).toBe(1);
  });

  it("falls back to text mode when embedding model is unavailable", async () => {
    embeddingMocks.getEmbeddingStatus.mockReturnValue("loading");

    memoryStoreMocks.searchMemoriesByText.mockReturnValue([
      {
        role: "user",
        content: "show orders",
        conversationId: "conv-2",
        messageId: "m7",
      },
    ]);

    memoryStoreMocks.getRecentMemories
      .mockReturnValueOnce([])
      .mockReturnValueOnce([
        { role: "assistant", content: "SELECT * FROM orders", messageId: "m7" },
      ]);

    const handler = getHandler(getMemoryContextHandler);
    const result = await handler({
      input: { query: "orders", similarLimit: 2, recentLimit: 2 },
      context: {},
    });

    expect(result.mode).toBe("text-fallback");
    expect(result.similarPastQueries[0]?.query).toBe("show orders");
  });
});
