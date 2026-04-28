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

type AiProvider = "openai" | "anthropic" | "google" | "openai-compatible";
type AiDbType = "postgresql" | "mysql" | "mariadb" | "clickhouse" | "sqlite";

export interface AiProvidersInfo {
  current: {
    provider: string;
    model: string;
    openaiCompatibleBaseURL: string;
  };
  providers: unknown[];
}

export interface AiApiKeyInfo {
  provider: AiProvider;
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

export interface AiFilter {
  column: string;
  operator: string;
  value?: string;
}

export interface AiFilterOrderBy {
  column: string;
  direction: "asc" | "desc";
}

export interface AiFilterResult {
  filters: AiFilter[];
  orderBy: AiFilterOrderBy[];
}

function toAiDbType(dbType: DatabaseType): AiDbType {
  if (dbType === "redis") return "postgresql";
  return dbType;
}

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
  provider?: AiProvider;
  model?: string;
  openaiCompatibleBaseURL?: string;
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
  provider: AiProvider,
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
  provider: AiProvider,
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

export async function fixSql(
  sql: string,
  error: string,
  dbType: DatabaseType,
): Promise<AiSqlResult> {
  try {
    return await ipc.client.ai.fixSql({ sql, error, dbType: toAiDbType(dbType) });
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
      dbType: toAiDbType(dbType),
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
