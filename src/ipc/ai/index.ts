/**
 * AI IPC Module — aggregates all AI handlers and exports.
 *
 * Follows the same pattern as the db module:
 * - ORPC handlers for request/response operations (settings, fix SQL, etc.)
 * - Direct Electron IPC events for streaming (chat)
 */
import {
  aiGetSettings,
  aiUpdateSettings,
  aiSetApiKey,
  aiGetApiKey,
  aiIsConfigured,
  aiFixSql,
  aiUpdateSql,
  aiEnhancePrompt,
  aiGenerateTitle,
  aiFilters,
} from "./handlers";
import {
  saveFeedbackHandler,
  getFeedbackHandler,
  removeFeedbackHandler,
  listFeedbackHandler,
  getFeedbackStatsHandler,
  getNegativeFeedbackHandler,
} from "./feedback-handlers";

export { registerAiStreamingHandlers } from "./streaming";
export { AI_IPC_CHANNELS } from "@/constants";
export { isAiConfigured, getProvidersInfo } from "./config";
export { createAiTools } from "./tools";

export const ai = {
  // Settings
  getSettings: aiGetSettings,
  updateSettings: aiUpdateSettings,
  setApiKey: aiSetApiKey,
  getApiKey: aiGetApiKey,
  isConfigured: aiIsConfigured,
  // SQL assistance
  fixSql: aiFixSql,
  updateSql: aiUpdateSql,
  enhancePrompt: aiEnhancePrompt,
  generateTitle: aiGenerateTitle,
  // Table filters
  filters: aiFilters,
  // Feedback
  saveFeedback: saveFeedbackHandler,
  getFeedback: getFeedbackHandler,
  removeFeedback: removeFeedbackHandler,
  listFeedback: listFeedbackHandler,
  getFeedbackStats: getFeedbackStatsHandler,
  getNegativeFeedback: getNegativeFeedbackHandler,
};
