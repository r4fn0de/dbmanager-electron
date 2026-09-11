/**
 * AI Memory Handlers — semantic memory with local embeddings.
 *
 * Provides oRPC endpoints for storing and retrieving conversation memories
 * using vector similarity search (Transformers.js embeddings).
 */
import { os } from "@orpc/server";
import { z } from "zod";
import {
  generateEmbedding,
  generateEmbeddings,
  getEmbeddingStatus,
  optimizeQueryForSearch,
} from "./embedding-service";
import {
  cleanupOldMemories,
  clearConnectionMemories,
  cosineSimilarity,
  getMemoryStats,
  getRecentMemories,
  type MemoryEntry,
  saveMemory,
  searchMemoriesByText,
  searchSimilarMemories,
} from "./memory-store";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const MemoryEntrySchema = z.object({
  connectionId: z.string().optional(),
  content: z.string(),
  conversationId: z.string(),
  id: z.string(),
  messageId: z.string(),
  metadata: z.string().optional(),
  role: z.enum(["user", "assistant"]),
  timestamp: z.string(),
});

const _MemorySearchResultSchema = z.object({
  entry: MemoryEntrySchema,
  similarity: z.number(),
});

// ---------------------------------------------------------------------------
// Embedding Status
// ---------------------------------------------------------------------------

/**
 * Check if embedding model is loaded and ready.
 */
export const getEmbeddingStatusHandler = os.handler(async () => ({
  ready: getEmbeddingStatus() === "ready",
  status: getEmbeddingStatus(),
}));

// ---------------------------------------------------------------------------
// Store Memory
// ---------------------------------------------------------------------------

/**
 * Save a message to memory with optional embedding generation.
 */
export const storeMemoryHandler = os
  .input(
    z.object({
      connectionId: z.string().optional(),
      content: z.string(),
      conversationId: z.string(),
      generateEmbedding: z.boolean().optional().default(true),
      messageId: z.string(),
      metadata: z
        .object({
          schemaName: z.string().optional(),
          sqlGenerated: z.boolean().optional(),
          tableName: z.string().optional(),
          toolCalls: z.array(z.string()).optional(),
        })
        .optional(),
      role: z.enum(["user", "assistant"]),
    })
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
      connectionId: input.connectionId,
      content: input.content,
      conversationId: input.conversationId,
      embedding,
      messageId: input.messageId,
      metadata: input.metadata ? JSON.stringify(input.metadata) : undefined,
      role: input.role,
    });

    return {
      hasEmbedding: !!embedding,
      id: entry.id,
      success: true,
    };
  });

/**
 * Store multiple memories in batch (more efficient for initial import).
 */
export const storeMemoriesBatchHandler = os
  .input(
    z.object({
      generateEmbeddings: z.boolean().optional().default(true),
      messages: z.array(
        z.object({
          connectionId: z.string().optional(),
          content: z.string(),
          conversationId: z.string(),
          messageId: z.string(),
          metadata: z.string().optional(),
          role: z.enum(["user", "assistant"]),
        })
      ),
    })
  )
  .handler(async ({ input }) => {
    let embeddings: Float32Array[] | undefined;

    // Batch generate embeddings if model is ready
    if (
      input.generateEmbeddings &&
      getEmbeddingStatus() === "ready" &&
      input.messages.length > 0
    ) {
      try {
        const optimizedContents = input.messages.map((m) =>
          optimizeQueryForSearch(m.content)
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
        connectionId: msg.connectionId,
        content: msg.content,
        conversationId: msg.conversationId,
        embedding,
        messageId: msg.messageId,
        metadata: msg.metadata,
        role: msg.role,
      });

      results.push({
        hasEmbedding: !!embedding,
        id: entry.id,
      });
    }

    return {
      stored: results.length,
      success: true,
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
      connectionId: z.string().optional(),
      conversationId: z.string().optional(),
      limit: z.number().optional().default(5),
      lookbackHours: z.number().optional(),
      minSimilarity: z.number().optional().default(0.7),
      query: z.string(),
    })
  )
  .handler(async ({ input }) => {
    // Try semantic search first if model is ready
    if (getEmbeddingStatus() === "ready") {
      try {
        const queryEmbedding = await generateEmbedding(
          optimizeQueryForSearch(input.query)
        );

        const results = searchSimilarMemories(queryEmbedding, {
          connectionId: input.connectionId,
          conversationId: input.conversationId,
          limit: input.limit,
          lookbackHours: input.lookbackHours,
          minSimilarity: input.minSimilarity,
        });

        return {
          method: "semantic",
          results: results.map((r) => ({
            entry: {
              connectionId: r.entry.connectionId,
              content: r.entry.content,
              conversationId: r.entry.conversationId,
              id: r.entry.id,
              messageId: r.entry.messageId,
              metadata: r.entry.metadata,
              role: r.entry.role,
              timestamp: r.entry.timestamp,
            },
            similarity: r.similarity,
          })),
        };
      } catch (err) {
        console.warn(
          "[Memory] Semantic search failed, falling back to FTS:",
          err
        );
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
          connectionId: r.connectionId,
          content: r.content,
          conversationId: r.conversationId,
          id: r.id,
          messageId: r.messageId,
          metadata: r.metadata,
          role: r.role,
          timestamp: r.timestamp,
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
      connectionId: z.string().optional(),
      conversationId: z.string().optional(),
      query: z.string(),
      recentLimit: z.number().optional().default(5),
      similarLimit: z.number().optional().default(3),
    })
  )
  .handler(async ({ input }) => {
    let mode: "semantic" | "text-fallback" = "text-fallback";
    const context: {
      recentMessages: Pick<MemoryEntry, "id" | "role" | "content" | "timestamp" | "metadata">[];
      similarPastQueries: Array<{
        query: string;
        response: string;
        similarity: number;
      }>;
      mode: "semantic" | "text-fallback";
    } = {
      mode: "text-fallback",
      recentMessages: [],
      similarPastQueries: [],
    };

    // Get recent conversation history
    const recentMemories = getRecentMemories({
      connectionId: input.connectionId,
      conversationId: input.conversationId,
      hours: 24, // Last 24 hours
      limit: input.recentLimit,
    });

    context.recentMessages = recentMemories.map((m) => ({
      content: m.content,
      id: m.id,
      metadata: m.metadata,
      role: m.role,
      timestamp: m.timestamp,
    }));

    // Get semantically similar past queries
    if (getEmbeddingStatus() === "ready") {
      try {
        const queryEmbedding = await generateEmbedding(
          optimizeQueryForSearch(input.query)
        );

        const similarResults = searchSimilarMemories(queryEmbedding, {
          connectionId: input.connectionId,
          limit: input.similarLimit * 2, // Get more to pair user+assistant
          lookbackHours: 168, // Last 7 days
          minSimilarity: 0.75,
        });

        // Group by conversation to get user-assistant pairs
        const seenConversations = new Set<string>();
        for (const result of similarResults) {
          const convId = result.entry.conversationId;
          if (seenConversations.has(convId)) {
            continue;
          }

          // Get the full conversation context
          const conversationMemories = getRecentMemories({
            conversationId: convId,
            limit: 10,
          });

          // Find user query and assistant response
          const userMsg = conversationMemories.find(
            (m) =>
              m.role === "user" &&
              cosineSimilarity(
                queryEmbedding,
                m.embedding || new Float32Array(384)
              ) > 0.7
          );
          const assistantMsg = conversationMemories.find(
            (m) => m.role === "assistant" && m.messageId === userMsg?.messageId
          );

          if (userMsg && assistantMsg) {
            context.similarPastQueries.push({
              query: userMsg.content,
              response: assistantMsg.content,
              similarity: result.similarity,
            });
            seenConversations.add(convId);
          }

          if (context.similarPastQueries.length >= input.similarLimit) {
            break;
          }
        }
        mode = "semantic";
      } catch (err) {
        console.warn("[Memory] Failed to get similar queries:", err);
      }
    }

    if (context.similarPastQueries.length === 0) {
      try {
        const textMatches = searchMemoriesByText(input.query, {
          connectionId: input.connectionId,
          limit: input.similarLimit * 3,
        });

        for (const match of textMatches) {
          if (match.role !== "user") {
            continue;
          }

          const pairedConversation = getRecentMemories({
            conversationId: match.conversationId,
            limit: 20,
          });

          const assistantMatch = pairedConversation.find(
            (m) => m.role === "assistant" && m.messageId === match.messageId
          );
          if (!assistantMatch) {
            continue;
          }

          context.similarPastQueries.push({
            query: match.content,
            response: assistantMatch.content,
            similarity: 0.6,
          });

          if (context.similarPastQueries.length >= input.similarLimit) {
            break;
          }
        }
      } catch (err) {
        console.warn("[Memory] Text fallback search failed:", err);
      }
    }

    context.mode = mode;

    return context;
  });

// ---------------------------------------------------------------------------
// Memory Management
// ---------------------------------------------------------------------------

/**
 * Get memory statistics.
 */
export const getMemoryStatsHandler = os.handler(async () => getMemoryStats());

/**
 * Clear all memories for a connection.
 */
export const clearMemoryHandler = os
  .input(
    z.object({
      connectionId: z.string(),
    })
  )
  .handler(async ({ input }) => {
    const deleted = clearConnectionMemories(input.connectionId);
    return { deletedCount: deleted, success: true };
  });

/**
 * Clean up old memories.
 */
export const cleanupMemoryHandler = os
  .input(
    z.object({
      olderThanDays: z.number().default(30),
    })
  )
  .handler(async ({ input }) => {
    const deleted = cleanupOldMemories(input.olderThanDays);
    return { deletedCount: deleted, success: true };
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
      hours: z.number().optional(),
      limit: z.number().optional().default(10),
    })
  )
  .handler(async ({ input }) => {
    const memories = getRecentMemories({
      connectionId: input.connectionId,
      conversationId: input.conversationId,
      hours: input.hours,
      limit: input.limit,
    });

    return {
      messages: memories.map((m) => ({
        content: m.content,
        id: m.id,
        metadata: m.metadata,
        role: m.role,
        timestamp: m.timestamp,
      })),
    };
  });
