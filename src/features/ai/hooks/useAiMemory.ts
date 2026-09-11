/**
 * React Query hook for AI Memory (semantic memory with local embeddings).
 *
 * Provides methods to:
 * - Store conversation messages with embeddings
 * - Search memories semantically (vector similarity)
 * - Get relevant context for AI prompts
 * - Manage memory lifecycle (cleanup, stats)
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { ipc } from "@/ipc/manager";

export const MEMORY_KEYS = {
  all: ["ai-memory"] as const,
  context: (query: string, connectionId?: string) =>
    [...MEMORY_KEYS.all, "context", query, connectionId ?? "all"] as const,
  embeddingStatus: () => [...MEMORY_KEYS.all, "embedding-status"] as const,
  history: (connectionId?: string, conversationId?: string) =>
    [
      ...MEMORY_KEYS.all,
      "history",
      connectionId ?? "all",
      conversationId ?? "all",
    ] as const,
  search: (query: string) => [...MEMORY_KEYS.all, "search", query] as const,
  stats: () => [...MEMORY_KEYS.all, "stats"] as const,
};

export interface MemoryEntry {
  connectionId?: string;
  content: string;
  conversationId: string;
  id: string;
  messageId: string;
  metadata?: string;
  role: "user" | "assistant";
  timestamp: string;
}

export interface MemorySearchResult {
  entry: MemoryEntry;
  similarity: number;
}

export interface MemoryContext {
  mode?: "semantic" | "text-fallback";
  recentMessages: Pick<MemoryEntry, "id" | "role" | "content" | "timestamp" | "metadata">[];
  similarPastQueries: Array<{
    query: string;
    response: string;
    similarity: number;
  }>;
}

export interface MemoryStats {
  conversations: number;
  oldestEntry: string | null;
  totalEntries: number;
  withEmbeddings: number;
}

export interface StoreMemoryInput {
  connectionId?: string;
  content: string;
  conversationId: string;
  generateEmbedding?: boolean;
  messageId: string;
  metadata?: {
    schemaName?: string;
    tableName?: string;
    toolCalls?: string[];
    sqlGenerated?: boolean;
  };
  role: "user" | "assistant";
}

export interface SearchMemoryInput {
  connectionId?: string;
  conversationId?: string;
  limit?: number;
  lookbackHours?: number;
  minSimilarity?: number;
  query: string;
}

export interface MemoryContextInput {
  connectionId?: string;
  conversationId?: string;
  query: string;
  recentLimit?: number;
  similarLimit?: number;
}

export interface UseAiMemoryReturn {
  cleanupMemory: (
    olderThanDays: number
  ) => Promise<{ success: boolean; deletedCount: number }>;
  clearMemory: (
    connectionId: string
  ) => Promise<{ success: boolean; deletedCount: number }>;

  // Embedding status
  embeddingStatus: { status: string; ready: boolean } | undefined;
  getMemoryContext: (input: MemoryContextInput) => Promise<MemoryContext>;

  // History
  history:
    | {
        messages: Pick<
            MemoryEntry,
            "id" | "role" | "content" | "timestamp" | "metadata"
          >[];
      }
    | undefined;
  isHistoryLoading: boolean;
  isStatsLoading: boolean;
  isStatusLoading: boolean;
  memoryStatus: "ready" | "degraded";
  refetchHistory: () => Promise<void>;
  refetchStats: () => Promise<void>;
  searchMemory: (
    input: SearchMemoryInput
  ) => Promise<{ method: string; results: MemorySearchResult[] }>;
  // Stats
  stats: MemoryStats | undefined;
  statsError: string | null;

  // Actions
  storeMemory: (
    input: StoreMemoryInput
  ) => Promise<{ success: boolean; id: string; hasEmbedding: boolean }>;
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
    gcTime: 5 * 60_000,
    queryFn: () => ipc.client.ai.getMemoryStats(),
    queryKey: MEMORY_KEYS.stats(),
    staleTime: 60_000,
  });

  const { data: embeddingStatus, isLoading: isStatusLoading } = useQuery({
    gcTime: 5 * 60_000,
    queryFn: () => ipc.client.ai.getEmbeddingStatus(),
    queryKey: MEMORY_KEYS.embeddingStatus(),
    staleTime: 30_000,
  });

  const {
    data: history,
    isLoading: isHistoryLoading,
    refetch: refetchHistoryQuery,
  } = useQuery({
    enabled: false, // Don't auto-fetch, manual trigger only
    gcTime: 5 * 60_000,
    queryFn: () => ipc.client.ai.getRecentHistory({ limit: 50 }),
    queryKey: MEMORY_KEYS.history(),
    staleTime: 10_000,
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
    mutationFn: (input: MemoryContextInput) =>
      ipc.client.ai.getMemoryContext(input),
  });

  const { mutateAsync: clearMemoryMutate } = useMutation({
    mutationFn: (connectionId: string) =>
      ipc.client.ai.clearMemory({ connectionId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MEMORY_KEYS.all });
    },
  });

  const { mutateAsync: cleanupMemoryMutate } = useMutation({
    mutationFn: (olderThanDays: number) =>
      ipc.client.ai.cleanupMemory({ olderThanDays }),
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
        throw new Error(
          err instanceof Error ? err.message : "Failed to store memory"
        );
      }
    },
    [storeMemoryMutate]
  );

  const searchMemory = useCallback(
    async (input: SearchMemoryInput) => {
      try {
        return await searchMemoryMutate(input);
      } catch (err) {
        throw new Error(
          err instanceof Error ? err.message : "Failed to search memory"
        );
      }
    },
    [searchMemoryMutate]
  );

  const getMemoryContext = useCallback(
    async (input: MemoryContextInput) => {
      try {
        return await getMemoryContextMutate(input);
      } catch (err) {
        throw new Error(
          err instanceof Error ? err.message : "Failed to get memory context"
        );
      }
    },
    [getMemoryContextMutate]
  );

  const clearMemory = useCallback(
    async (connectionId: string) => {
      try {
        return await clearMemoryMutate(connectionId);
      } catch (err) {
        throw new Error(
          err instanceof Error ? err.message : "Failed to clear memory"
        );
      }
    },
    [clearMemoryMutate]
  );

  const cleanupMemory = useCallback(
    async (olderThanDays: number) => {
      try {
        return await cleanupMemoryMutate(olderThanDays);
      } catch (err) {
        throw new Error(
          err instanceof Error ? err.message : "Failed to cleanup memory"
        );
      }
    },
    [cleanupMemoryMutate]
  );

  const memoryStatus: "ready" | "degraded" =
    embeddingStatus?.ready || embeddingStatus?.status === "ready"
      ? "ready"
      : "degraded";

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
    cleanupMemory,
    clearMemory,
    embeddingStatus,
    getMemoryContext,
    history,
    isHistoryLoading,
    isStatsLoading,
    isStatusLoading,
    memoryStatus,
    refetchHistory,
    refetchStats,
    searchMemory,
    stats,
    statsError: statsError instanceof Error ? statsError.message : null,
    storeMemory,
  };
}
