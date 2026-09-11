/**
 * AI IPC Module — aggregates all AI handlers and exports.
 *
 * Follows the same pattern as the db module:
 * - ORPC handlers for request/response operations (settings, fix SQL, etc.)
 * - Direct Electron IPC events for streaming (chat)
 */

import {
  aiCreateConnection,
  aiDeleteConnection,
  aiDiscoverModels,
  aiGetConnection,
  aiListConnectionModels,
  aiListConnections,
  aiSetConnectionModels,
  aiSetDefaultModel,
  aiTestConnection,
  aiUpdateConnection,
} from "./connection-handlers";
import {
  getFeedbackHandler,
  getFeedbackStatsHandler,
  getNegativeFeedbackHandler,
  listFeedbackHandler,
  removeFeedbackHandler,
  saveFeedbackHandler,
} from "./feedback-handlers";
import {
  aiAddCustomModel,
  aiAddCustomProvider,
  aiCheckProviderEndpoint,
  aiDetectOllama,
  aiEnhancePrompt,
  aiFetchModels,
  aiFilters,
  aiFixSql,
  aiGenerateTitle,
  aiGetApiKey,
  aiGetPrivacySettings,
  aiGetSettings,
  aiIsConfigured,
  aiRemoveCustomModel,
  aiRemoveCustomProvider,
  aiSetApiKey,
  aiSetCustomProviderApiKey,
  aiTableSearch,
  aiUpdateCustomProvider,
  aiUpdatePrivacySettings,
  aiUpdateSettings,
  aiUpdateSql,
} from "./handlers";
import {
  cleanupMemoryHandler,
  clearMemoryHandler,
  getEmbeddingStatusHandler,
  getMemoryContextHandler,
  getMemoryStatsHandler,
  getRecentHistoryHandler,
  searchMemoryHandler,
  storeMemoriesBatchHandler,
  storeMemoryHandler,
} from "./memory-handlers";

export { AI_IPC_CHANNELS } from "@/constants";
export { getProvidersInfo, isAiConfigured } from "./config";
export { registerAiStreamingHandlers } from "./streaming";
export { createAiTools } from "./tools";

export const ai = {
  // Custom models
  addCustomModel: aiAddCustomModel,
  // Custom providers
  addCustomProvider: aiAddCustomProvider,
  checkProviderEndpoint: aiCheckProviderEndpoint,
  cleanupMemory: cleanupMemoryHandler,
  clearMemory: clearMemoryHandler,
  createConnection: aiCreateConnection,
  deleteConnection: aiDeleteConnection,
  // Ollama
  detectOllama: aiDetectOllama,
  discoverModels: aiDiscoverModels,
  enhancePrompt: aiEnhancePrompt,
  fetchModels: aiFetchModels,
  // Table filters
  filters: aiFilters,
  // SQL assistance
  fixSql: aiFixSql,
  generateTitle: aiGenerateTitle,
  getApiKey: aiGetApiKey,
  getConnection: aiGetConnection,
  // Memory
  getEmbeddingStatus: getEmbeddingStatusHandler,
  getFeedback: getFeedbackHandler,
  getFeedbackStats: getFeedbackStatsHandler,
  getMemoryContext: getMemoryContextHandler,
  getMemoryStats: getMemoryStatsHandler,
  getNegativeFeedback: getNegativeFeedbackHandler,
  // Privacy
  getPrivacySettings: aiGetPrivacySettings,
  getRecentHistory: getRecentHistoryHandler,
  // Settings
  getSettings: aiGetSettings,
  isConfigured: aiIsConfigured,
  listConnectionModels: aiListConnectionModels,
  // Connection management
  listConnections: aiListConnections,
  listFeedback: listFeedbackHandler,
  removeCustomModel: aiRemoveCustomModel,
  removeCustomProvider: aiRemoveCustomProvider,
  removeFeedback: removeFeedbackHandler,
  // Feedback
  saveFeedback: saveFeedbackHandler,
  searchMemory: searchMemoryHandler,
  setApiKey: aiSetApiKey,
  setConnectionModels: aiSetConnectionModels,
  setCustomProviderApiKey: aiSetCustomProviderApiKey,
  setDefaultModel: aiSetDefaultModel,
  storeMemoriesBatch: storeMemoriesBatchHandler,
  storeMemory: storeMemoryHandler,
  // Table search
  tableSearch: aiTableSearch,
  testConnection: aiTestConnection,
  updateConnection: aiUpdateConnection,
  updateCustomProvider: aiUpdateCustomProvider,
  updatePrivacySettings: aiUpdatePrivacySettings,
  updateSettings: aiUpdateSettings,
  updateSql: aiUpdateSql,
};
