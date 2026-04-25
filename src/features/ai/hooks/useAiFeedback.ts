/**
 * useAiFeedback — React hooks for AI feedback operations.
 */
import { useCallback, useState } from "react";
import { ipc } from "@/ipc/manager";
import type { AiFeedbackEntry, FeedbackStats } from "@/ipc/ai/feedback-store";

export interface FeedbackState {
  rating: "positive" | "negative" | null;
  isSubmitting: boolean;
}

/**
 * Hook to manage feedback for a specific AI message.
 */
export function useMessageFeedback(
  conversationId: string,
  messageId: string,
  prompt: string,
  response: string,
  connectionId?: string,
  schemaName?: string,
  tableName?: string,
) {
  const [state, setState] = useState<FeedbackState>({
    rating: null,
    isSubmitting: false,
  });

  /**
   * Load existing feedback for this message.
   */
  const loadFeedback = useCallback(async () => {
    try {
      const result = await ipc.client.ai.getFeedback({
        conversationId,
        messageId,
      });
      setState((prev) => ({ ...prev, rating: result.rating }));
    } catch {
      // Ignore errors, just means no feedback yet
    }
  }, [conversationId, messageId]);

  /**
   * Submit feedback (thumbs up/down).
   */
  const submitFeedback = useCallback(
    async (rating: "positive" | "negative", category?: string, comment?: string) => {
      setState((prev) => ({ ...prev, isSubmitting: true }));
      try {
        await ipc.client.ai.saveFeedback({
          conversationId,
          messageId,
          connectionId,
          schemaName,
          tableName,
          prompt: prompt.slice(0, 2000), // Limit size
          response: response.slice(0, 4000), // Limit size
          rating,
          category,
          comment,
        });
        setState({ rating, isSubmitting: false });
        return true;
      } catch (err) {
        console.error("[useAiFeedback] IPC call failed:", err);
        setState((prev) => ({ ...prev, isSubmitting: false }));
        return false;
      }
    },
    [conversationId, messageId, prompt, response, connectionId, schemaName, tableName],
  );

  /**
   * Remove feedback.
   */
  const removeFeedback = useCallback(async () => {
    setState((prev) => ({ ...prev, isSubmitting: true }));
    try {
      await ipc.client.ai.removeFeedback({
        conversationId,
        messageId,
      });
      setState({ rating: null, isSubmitting: false });
      return true;
    } catch (err) {
      setState((prev) => ({ ...prev, isSubmitting: false }));
      console.error("Failed to remove feedback:", err);
      return false;
    }
  }, [conversationId, messageId]);

  /**
   * Toggle feedback (if same rating, remove; if different, update).
   */
  const toggleFeedback = useCallback(
    async (rating: "positive" | "negative", category?: string) => {
      if (state.rating === rating) {
        return removeFeedback();
      }
      return submitFeedback(rating, category);
    },
    [state.rating, submitFeedback, removeFeedback],
  );

  return {
    ...state,
    loadFeedback,
    submitFeedback,
    removeFeedback,
    toggleFeedback,
  };
}

/**
 * Hook to get feedback statistics.
 */
export function useFeedbackStats(connectionId?: string) {
  const [stats, setStats] = useState<FeedbackStats | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const loadStats = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await ipc.client.ai.getFeedbackStats({ connectionId });
      setStats(result);
    } catch (err) {
      console.error("Failed to load feedback stats:", err);
    } finally {
      setIsLoading(false);
    }
  }, [connectionId]);

  return { stats, isLoading, loadStats };
}

/**
 * Hook to list feedback entries.
 */
export function useFeedbackList(options?: {
  conversationId?: string;
  connectionId?: string;
  category?: string;
  rating?: "positive" | "negative";
  limit?: number;
}) {
  const [entries, setEntries] = useState<AiFeedbackEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  const loadEntries = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await ipc.client.ai.listFeedback({
        ...options,
        limit: options?.limit ?? 50,
      });
      setEntries(result.entries);
      setTotal(result.total);
    } catch (err) {
      console.error("Failed to load feedback list:", err);
    } finally {
      setIsLoading(false);
    }
  }, [options?.conversationId, options?.connectionId, options?.category, options?.rating, options?.limit]);

  return { entries, total, isLoading, loadEntries };
}
