/**
 * AI Memory Handlers — semantic memory with local embeddings.
 *
 * Provides oRPC endpoints for storing and retrieving conversation memories
 * using vector similarity search (Transformers.js embeddings).
 */
import { os } from "@orpc/server";
import { z } from "zod";
import {
  saveMemory,
  searchSimilarMemories,
  searchMemoriesByText,
  getRecentMemories,
  getMemoryStats,
  clearConnectionMemories,
  cleanupOldMemories,
  cosineSimilarity,
  type MemoryEntry,
  type MemorySearchResult,
} from "./memory-store";
import {
  generateEmbedding,
  generateEmbeddings,
  getEmbeddingStatus,
  optimizeQueryForSearch,
} from "./embedding-service";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const MemoryEntrySchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  messageId: z.string(),
  connectionId: z.string().optional(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  timestamp: z.string(),
  metadata: z.string().optional(),
});

const MemorySearchResultSchema = z.object({
  entry: MemoryEntrySchema,
  similarity: z.number(),
});

// ---------------------------------------------------------------------------
// Embedding Status
// ---------------------------------------------------------------------------

/**
 * Check if embedding model is loaded and ready.
 */
export const getEmbeddingStatusHandler = os.handler(async () => {
  return {
    status: getEmbeddingStatus(),
    ready: getEmbeddingStatus() === "ready",
  };
});

// ---------------------------------------------------------------------------
// Store Memory
// ---------------------------------------------------------------------------

/**
 * Save a message to memory with optional embedding generation.
 */
export const storeMemoryHandler = os
  .input(
    z.object({
      conversationId: z.string(),
      messageId: z.string(),
      connectionId: z.string().optional(),
      role: z.enum(["user", "assistant"]),
      content: z.string(),
      generateEmbedding: z.boolean().optional().default(true),
      metadata: z
        .object({
          schemaName: z.string().optional(),
          tableName: z.string().optional(),
          toolCalls: z.array(z.string()).optional(),
          sqlGenerated: z.boolean().optional(),
        })
        .optional(),
    }),
  )
  .handler(async ({ input }) => {
    let embedding: Float32Array | undefined;

    if (input.generateEmbedding && getEmbeddingStatus() === "ready") {
      try {
        // Optimize content for better semantic search
        const optimizedContent = optimizeQueryForSearch(input.content, {
          schema: input.metadata?.schemaName,
          table: input.metadata?.tableName,
        });
        embedding = await generateEmbedding(optimizedContent);
      } catch (err) {
        console.warn("[Memory] Failed to generate embedding:", err);
        // Continue without embedding - will use FTS fallback
      }
    }

    const entry = saveMemory({
      conversationId: input.conversationId,
      messageId: input.messageId,
      connectionId: input.connectionId,
      role: input.role,
      content: input.content,
      embedding,
      metadata: input.metadata ? JSON.stringify(input.metadata) : undefined,
    });

    return {
      success: true,
      id: entry.id,
      hasEmbedding: !!embedding,
    };
  });

/**
 * Store multiple memories in batch (more efficient for initial import).
 */
export const storeMemoriesBatchHandler = os
  .input(
    z.object({
      messages: z.array(
        z.object({
          conversationId: z.string(),
          messageId: z.string(),
          connectionId: z.string().optional(),
          role: z.enum(["user", "assistant"]),
          content: z.string(),
          metadata: z.string().optional(),
        }),
      ),
      generateEmbeddings: z.boolean().optional().default(true),
    }),
  )
  .handler(async ({ input }) => {
    let embeddings: Float32Array[] | undefined;

    // Batch generate embeddings if model is ready
    if (input.generateEmbeddings && getEmbeddingStatus() === "ready" && input.messages.length > 0) {
      try {
        const optimizedContents = input.messages.map((m) =>
          optimizeQueryForSearch(m.content),
        );
        embeddings = await generateEmbeddings(optimizedContents);
      } catch (err) {
        console.warn("[Memory] Failed to generate batch embeddings:", err);
      }
    }

    const results: Array<{ id: string; hasEmbedding: boolean }> = [];

    for (let i = 0; i < input.messages.length; i++) {
      const msg = input.messages[i];
      const embedding = embeddings?.[i];

      const entry = saveMemory({
        conversationId: msg.conversationId,
        messageId: msg.messageId,
        connectionId: msg.connectionId,
        role: msg.role,
        content: msg.content,
        embedding,
        metadata: msg.metadata,
      });

      results.push({
        id: entry.id,
        hasEmbedding: !!embedding,
      });
    }

    return {
      success: true,
      stored: results.length,
      withEmbeddings: results.filter((r) => r.hasEmbedding).length,
    };
  });

// ---------------------------------------------------------------------------
// Search Memory
// ---------------------------------------------------------------------------

/**
 * Search memories using semantic similarity (vector search).
 * Falls back to FTS if no embedding provided or model not ready.
 */
export const searchMemoryHandler = os
  .input(
    z.object({
      query: z.string(),
      connectionId: z.string().optional(),
      conversationId: z.string().optional(),
      limit: z.number().optional().default(5),
      minSimilarity: z.number().optional().default(0.7),
      lookbackHours: z.number().optional(),
    }),
  )
  .handler(async ({ input }) => {
    // Try semantic search first if model is ready
    if (getEmbeddingStatus() === "ready") {
      try {
        const queryEmbedding = await generateEmbedding(
          optimizeQueryForSearch(input.query),
        );

        const results = searchSimilarMemories(queryEmbedding, {
          connectionId: input.connectionId,
          conversationId: input.conversationId,
          limit: input.limit,
          minSimilarity: input.minSimilarity,
          lookbackHours: input.lookbackHours,
        });

        return {
          method: "semantic",
          results: results.map((r) => ({
            entry: {
              id: r.entry.id,
              conversationId: r.entry.conversationId,
              messageId: r.entry.messageId,
              connectionId: r.entry.connectionId,
              role: r.entry.role,
              content: r.entry.content,
              timestamp: r.entry.timestamp,
              metadata: r.entry.metadata,
            },
            similarity: r.similarity,
          })),
        };
      } catch (err) {
        console.warn("[Memory] Semantic search failed, falling back to FTS:", err);
      }
    }

    // Fallback to full-text search
    const results = searchMemoriesByText(input.query, {
      connectionId: input.connectionId,
      limit: input.limit,
    });

    return {
      method: "text",
      results: results.map((r) => ({
        entry: {
          id: r.id,
          conversationId: r.conversationId,
          messageId: r.messageId,
          connectionId: r.connectionId,
          role: r.role,
          content: r.content,
          timestamp: r.timestamp,
          metadata: r.metadata,
        },
        similarity: 1.0, // FTS doesn't give similarity scores
      })),
    };
  });

/**
 * Get relevant context for a conversation.
 * Combines recent history with semantically similar past messages.
 */
export const getMemoryContextHandler = os
  .input(
    z.object({
      query: z.string(),
      connectionId: z.string().optional(),
      conversationId: z.string().optional(),
      recentLimit: z.number().optional().default(5),
      similarLimit: z.number().optional().default(3),
    }),
  )
  .handler(async ({ input }) => {
    const context: {
      recentMessages: Array<Pick<MemoryEntry, "id" | "role" | "content" | "timestamp" | "metadata">>;
      similarPastQueries: Array<{
        query: string;
        response: string;
        similarity: number;
      }>;
    } = {
      recentMessages: [],
      similarPastQueries: [],
    };

    // Get recent conversation history
    const recentMemories = getRecentMemories({
      connectionId: input.connectionId,
      conversationId: input.conversationId,
      limit: input.recentLimit,
      hours: 24, // Last 24 hours
    });

    context.recentMessages = recentMemories.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
      metadata: m.metadata,
    }));

    // Get semantically similar past queries
    if (getEmbeddingStatus() === "ready") {
      try {
        const queryEmbedding = await generateEmbedding(
          optimizeQueryForSearch(input.query),
        );

        const similarResults = searchSimilarMemories(queryEmbedding, {
          connectionId: input.connectionId,
          limit: input.similarLimit * 2, // Get more to pair user+assistant
          minSimilarity: 0.75,
          lookbackHours: 168, // Last 7 days
        });

        // Group by conversation to get user-assistant pairs
        const seenConversations = new Set<string>();
        for (const result of similarResults) {
          const convId = result.entry.conversationId;
          if (seenConversations.has(convId)) continue;

          // Get the full conversation context
          const conversationMemories = getRecentMemories({
            conversationId: convId,
            limit: 10,
          });

          // Find user query and assistant response
          const userMsg = conversationMemories.find(
            (m) => m.role === "user" && cosineSimilarity(queryEmbedding, m.embedding || new Float32Array(384)) > 0.7,
          );
          const assistantMsg = conversationMemories.find(
            (m) => m.role === "assistant" && m.messageId === userMsg?.messageId,
          );

          if (userMsg && assistantMsg) {
            context.similarPastQueries.push({
              query: userMsg.content,
              response: assistantMsg.content,
              similarity: result.similarity,
            });
            seenConversations.add(convId);
          }

          if (context.similarPastQueries.length >= input.similarLimit) break;
        }
      } catch (err) {
        console.warn("[Memory] Failed to get similar queries:", err);
      }
    }

    return context;
  });

// ---------------------------------------------------------------------------
// Memory Management
// ---------------------------------------------------------------------------

/**
 * Get memory statistics.
 */
export const getMemoryStatsHandler = os.handler(async () => {
  return getMemoryStats();
});

/**
 * Clear all memories for a connection.
 */
export const clearMemoryHandler = os
  .input(
    z.object({
      connectionId: z.string(),
    }),
  )
  .handler(async ({ input }) => {
    const deleted = clearConnectionMemories(input.connectionId);
    return { success: true, deletedCount: deleted };
  });

/**
 * Clean up old memories.
 */
export const cleanupMemoryHandler = os
  .input(
    z.object({
      olderThanDays: z.number().default(30),
    }),
  )
  .handler(async ({ input }) => {
    const deleted = cleanupOldMemories(input.olderThanDays);
    return { success: true, deletedCount: deleted };
  });

// ---------------------------------------------------------------------------
// Recent History
// ---------------------------------------------------------------------------

/**
 * Get recent conversation history.
 */
export const getRecentHistoryHandler = os
  .input(
    z.object({
      connectionId: z.string().optional(),
      conversationId: z.string().optional(),
      limit: z.number().optional().default(10),
      hours: z.number().optional(),
    }),
  )
  .handler(async ({ input }) => {
    const memories = getRecentMemories({
      connectionId: input.connectionId,
      conversationId: input.conversationId,
      limit: input.limit,
      hours: input.hours,
    });

    return {
      messages: memories.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
        metadata: m.metadata,
      })),
    };
  });
