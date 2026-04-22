/**
 * Module-level IPC proxy functions for AI operations.
 *
 * These are plain async functions — NOT React hooks — so they cause
 * zero re-renders. Use them anywhere: event handlers, effects,
 * queryFn callbacks, or even outside React components.
 *
 * Streaming chat is handled via the useAiChat hook (Electron IPC events),
 * not through these ORPC-based functions.
 */
import { ipc } from "@/ipc/manager";
import type { DatabaseType } from "@/ipc/db/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AiProvidersInfo {
  current: {
    provider: string;
    model: string;
  };
  providers: Array<{
    name: string;
    label: string;
    defaultModel: string;
    models: Array<{ id: string; label: string }>;
    hasApiKey: boolean;
  }>;
}

export interface AiApiKeyInfo {
  provider: string;
  masked: string;
  hasKey: boolean;
}

export interface AiSqlResult {
  sql: string;
}

export interface AiEnhancedPrompt {
  prompt: string;
}

export interface AiGeneratedTitle {
  title: string;
}

export interface AiFilterResult {
  filters: Array<{ column: string; operator: string; value?: string }>;
  orderBy: Array<{ column: string; direction: "asc" | "desc" }>;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function getAiSettings(): Promise<AiProvidersInfo> {
  try {
    const result = await ipc.client.ai.getSettings();
    // The ORPC handler calls getProvidersInfo() which returns { current, providers }.
    // Validate shape to fail loudly if ORPC type inference drifts.
    if (!result || typeof result !== "object" || !("current" in result) || !("providers" in result)) {
      throw new Error("Unexpected AI settings response shape");
    }
    return result as AiProvidersInfo;
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : "Failed to get AI settings",
    );
  }
}

export async function updateAiSettings(input: {
  provider?: string;
  model?: string;
}): Promise<void> {
  try {
    await ipc.client.ai.updateSettings(input);
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : "Failed to update AI settings",
    );
  }
}

export async function setAiApiKey(
  provider: "openai" | "anthropic" | "google",
  key: string,
): Promise<{ success: boolean }> {
  try {
    return await ipc.client.ai.setApiKey({ provider, key });
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : "Failed to set API key",
    );
  }
}

export async function getAiApiKey(
  provider: "openai" | "anthropic" | "google",
): Promise<AiApiKeyInfo> {
  try {
    return await ipc.client.ai.getApiKey({ provider });
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : "Failed to get API key info",
    );
  }
}

export async function isAiConfigured(): Promise<boolean> {
  try {
    return await ipc.client.ai.isConfigured();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// SQL assistance
// ---------------------------------------------------------------------------

export async function fixSql(
  sql: string,
  error: string,
  dbType: DatabaseType,
): Promise<AiSqlResult> {
  try {
    return await ipc.client.ai.fixSql({ sql, error, dbType });
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : "Failed to fix SQL",
    );
  }
}

export async function updateSql(
  sql: string,
  prompt: string,
  dbType: DatabaseType,
  context?: string,
): Promise<AiSqlResult> {
  try {
    return await ipc.client.ai.updateSql({
      sql,
      prompt,
      dbType,
      context,
    });
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : "Failed to update SQL",
    );
  }
}

export async function enhancePrompt(
  prompt: string,
): Promise<AiEnhancedPrompt> {
  try {
    return await ipc.client.ai.enhancePrompt({ prompt });
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : "Failed to enhance prompt",
    );
  }
}

export async function generateTitle(
  message: string,
): Promise<AiGeneratedTitle> {
  try {
    return await ipc.client.ai.generateTitle({ message });
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : "Failed to generate title",
    );
  }
}

// ---------------------------------------------------------------------------
// AI Filters
// ---------------------------------------------------------------------------

export async function getAiFilters(
  prompt: string,
  context: string,
): Promise<AiFilterResult> {
  try {
    return await ipc.client.ai.filters({ prompt, context });
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : "Failed to generate filters",
    );
  }
}
