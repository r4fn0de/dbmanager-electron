/**
 * AI Feedback Handlers — IPC handlers for AI feedback operations.
 */
import { os } from "@orpc/server";
import { z } from "zod";
import {
  type AiFeedbackEntry,
  type FeedbackStats,
  getFeedbackRating,
  getFeedbackStats,
  getNegativeFeedback,
  listFeedback,
  removeFeedback,
  saveFeedback,
} from "./feedback-store";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const saveFeedbackSchema = z.object({
  category: z.string().optional(),
  comment: z.string().optional(),
  connectionId: z.string().optional(),
  conversationId: z.string(),
  messageId: z.string(),
  prompt: z.string(),
  rating: z.enum(["positive", "negative"]),
  response: z.string(),
  schemaName: z.string().optional(),
  tableName: z.string().optional(),
});

const getFeedbackSchema = z.object({
  conversationId: z.string(),
  messageId: z.string(),
});

const removeFeedbackSchema = z.object({
  conversationId: z.string(),
  messageId: z.string(),
});

const listFeedbackSchema = z.object({
  category: z.string().optional(),
  connectionId: z.string().optional(),
  conversationId: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional().default(50),
  offset: z.number().int().min(0).optional().default(0),
  rating: z.enum(["positive", "negative"]).optional(),
});

const getStatsSchema = z.object({
  category: z.string().optional(),
  connectionId: z.string().optional(),
  since: z.string().optional(), // ISO date string
});

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * Save or update feedback for an AI response.
 */
export const saveFeedbackHandler = os
  .input(saveFeedbackSchema)
  .handler(async ({ input }): Promise<AiFeedbackEntry> => saveFeedback(input));

/**
 * Get feedback rating for a specific message.
 */
export const getFeedbackHandler = os
  .input(getFeedbackSchema)
  .handler(
    async ({ input }): Promise<{ rating: "positive" | "negative" | null }> => {
      const rating = getFeedbackRating(input.conversationId, input.messageId);
      return { rating };
    }
  );

/**
 * Remove feedback for a specific message.
 */
export const removeFeedbackHandler = os
  .input(removeFeedbackSchema)
  .handler(async ({ input }): Promise<{ success: boolean }> => {
    const success = removeFeedback(input.conversationId, input.messageId);
    return { success };
  });

/**
 * List feedback entries with optional filters.
 */
export const listFeedbackHandler = os
  .input(listFeedbackSchema)
  .handler(
    async ({
      input,
    }): Promise<{ entries: AiFeedbackEntry[]; total: number }> => {
      const entries = listFeedback(input);
      // Get total count for pagination
      const allEntries = listFeedback({
        category: input.category,
        connectionId: input.connectionId,
        conversationId: input.conversationId,
        rating: input.rating,
      });
      return { entries, total: allEntries.length };
    }
  );

/**
 * Get overall feedback statistics.
 */
export const getFeedbackStatsHandler = os
  .input(getStatsSchema)
  .handler(
    async ({ input }): Promise<FeedbackStats> => getFeedbackStats(input)
  );

/**
 * Get recent negative feedback for review.
 */
export const getNegativeFeedbackHandler = os
  .input(
    z.object({ limit: z.number().int().min(1).max(100).optional().default(20) })
  )
  .handler(async ({ input }): Promise<{ entries: AiFeedbackEntry[] }> => {
    const entries = getNegativeFeedback(input.limit);
    return { entries };
  });
