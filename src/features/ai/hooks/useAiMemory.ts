/**
 * React Query hook for AI Memory (semantic memory with local embeddings).
 *
 * Provides methods to:
 * - Store conversation messages with embeddings
 * - Search memories semantically (vector similarity)
 * - Get relevant context for AI prompts
 * - Manage memory lifecycle (cleanup, stats)
 */
import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ipc } from "@/ipc/manager";

// ---------------------------------------------------------------------------
// Query Keys
// ---------------------------------------------------------------------------

export const MEMORY_KEYS = {
  all: ["ai-memory"] as const,
  stats: () => [...MEMORY_KEYS.all, "stats"] as const,
  history: (connectionId?: string, conversationId?: string) =>
    [...MEMORY_KEYS.all, "history", connectionId ?? "all", conversationId ?? "all"] as const,
  search: (query: string) => [...MEMORY_KEYS.all, "search", query] as const,
  context: (query: string, connectionId?: string) =>
    [...MEMORY_KEYS.all, "context", query, connectionId ?? "all"] as const,
  embeddingStatus: () => [...MEMORY_KEYS.all, "embedding-status"] as const,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemoryEntry {
  id: string;
  conversationId: string;
  messageId: string;
  connectionId?: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  metadata?: string;
}

export interface MemorySearchResult {
  entry: MemoryEntry;
  similarity: number;
}

export interface MemoryContext {
  recentMessages: Array<Pick<MemoryEntry, "id" | "role" | "content" | "timestamp" | "metadata">>;
  similarPastQueries: Array<{
    query: string;
    response: string;
    similarity: number;
  }>;
}

export interface MemoryStats {
  totalEntries: number;
  withEmbeddings: number;
  conversations: number;
  oldestEntry: string | null;
}

export interface StoreMemoryInput {
  conversationId: string;
  messageId: string;
  connectionId?: string;
  role: "user" | "assistant";
  content: string;
  generateEmbedding?: boolean;
  metadata?: {
    schemaName?: string;
    tableName?: string;
    toolCalls?: string[];
    sqlGenerated?: boolean;
  };
}

export interface SearchMemoryInput {
  query: string;
  connectionId?: string;
  conversationId?: string;
  limit?: number;
  minSimilarity?: number;
  lookbackHours?: number;
}

export interface MemoryContextInput {
  query: string;
  connectionId?: string;
  conversationId?: string;
  recentLimit?: number;
  similarLimit?: number;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseAiMemoryReturn {
  // Stats
  stats: MemoryStats | undefined;
  isStatsLoading: boolean;
  statsError: string | null;
  refetchStats: () => Promise<void>;

  // Embedding status
  embeddingStatus: { status: string; ready: boolean } | undefined;
  isStatusLoading: boolean;

  // History
  history: { messages: Array<Pick<MemoryEntry, "id" | "role" | "content" | "timestamp" | "metadata">> } | undefined;
  isHistoryLoading: boolean;
  refetchHistory: () => Promise<void>;

  // Actions
  storeMemory: (input: StoreMemoryInput) => Promise<{ success: boolean; id: string; hasEmbedding: boolean }>;
  searchMemory: (input: SearchMemoryInput) => Promise<{ method: string; results: MemorySearchResult[] }>;
  getMemoryContext: (input: MemoryContextInput) => Promise<MemoryContext>;
  clearMemory: (connectionId: string) => Promise<{ success: boolean; deletedCount: number }>;
  cleanupMemory: (olderThanDays: number) => Promise<{ success: boolean; deletedCount: number }>;
}

export function useAiMemory(): UseAiMemoryReturn {
  const queryClient = useQueryClient();

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  const {
    data: stats,
    isLoading: isStatsLoading,
    error: statsError,
    refetch: refetchStatsQuery,
  } = useQuery({
    queryKey: MEMORY_KEYS.stats(),
    queryFn: () => ipc.client.ai.getMemoryStats(),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });

  const {
    data: embeddingStatus,
    isLoading: isStatusLoading,
  } = useQuery({
    queryKey: MEMORY_KEYS.embeddingStatus(),
    queryFn: () => ipc.client.ai.getEmbeddingStatus(),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });

  const {
    data: history,
    isLoading: isHistoryLoading,
    refetch: refetchHistoryQuery,
  } = useQuery({
    queryKey: MEMORY_KEYS.history(),
    queryFn: () => ipc.client.ai.getRecentHistory({ limit: 50 }),
    staleTime: 10_000,
    gcTime: 5 * 60_000,
    enabled: false, // Don't auto-fetch, manual trigger only
  });

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------

  const { mutateAsync: storeMemoryMutate } = useMutation({
    mutationFn: (input: StoreMemoryInput) => ipc.client.ai.storeMemory(input),
  });

  const { mutateAsync: searchMemoryMutate } = useMutation({
    mutationFn: (input: SearchMemoryInput) => ipc.client.ai.searchMemory(input),
  });

  const { mutateAsync: getMemoryContextMutate } = useMutation({
    mutationFn: (input: MemoryContextInput) => ipc.client.ai.getMemoryContext(input),
  });

  const { mutateAsync: clearMemoryMutate } = useMutation({
    mutationFn: (connectionId: string) => ipc.client.ai.clearMemory({ connectionId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MEMORY_KEYS.all });
    },
  });

  const { mutateAsync: cleanupMemoryMutate } = useMutation({
    mutationFn: (olderThanDays: number) => ipc.client.ai.cleanupMemory({ olderThanDays }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MEMORY_KEYS.all });
    },
  });

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  const storeMemory = useCallback(
    async (input: StoreMemoryInput) => {
      try {
        return await storeMemoryMutate(input);
      } catch (err) {
        throw new Error(err instanceof Error ? err.message : "Failed to store memory");
      }
    },
    [storeMemoryMutate],
  );

  const searchMemory = useCallback(
    async (input: SearchMemoryInput) => {
      try {
        return await searchMemoryMutate(input);
      } catch (err) {
        throw new Error(err instanceof Error ? err.message : "Failed to search memory");
      }
    },
    [searchMemoryMutate],
  );

  const getMemoryContext = useCallback(
    async (input: MemoryContextInput) => {
      try {
        return await getMemoryContextMutate(input);
      } catch (err) {
        throw new Error(err instanceof Error ? err.message : "Failed to get memory context");
      }
    },
    [getMemoryContextMutate],
  );

  const clearMemory = useCallback(
    async (connectionId: string) => {
      try {
        return await clearMemoryMutate(connectionId);
      } catch (err) {
        throw new Error(err instanceof Error ? err.message : "Failed to clear memory");
      }
    },
    [clearMemoryMutate],
  );

  const cleanupMemory = useCallback(
    async (olderThanDays: number) => {
      try {
        return await cleanupMemoryMutate(olderThanDays);
      } catch (err) {
        throw new Error(err instanceof Error ? err.message : "Failed to cleanup memory");
      }
    },
    [cleanupMemoryMutate],
  );

  const refetchStats = useCallback(async () => {
    await refetchStatsQuery();
  }, [refetchStatsQuery]);

  const refetchHistory = useCallback(async () => {
    await refetchHistoryQuery();
  }, [refetchHistoryQuery]);

  // -------------------------------------------------------------------------
  // Return
  // -------------------------------------------------------------------------

  return {
    stats,
    isStatsLoading,
    statsError: statsError instanceof Error ? statsError.message : null,
    refetchStats,
    embeddingStatus,
    isStatusLoading,
    history,
    isHistoryLoading,
    refetchHistory,
    storeMemory,
    searchMemory,
    getMemoryContext,
    clearMemory,
    cleanupMemory,
  };
}
