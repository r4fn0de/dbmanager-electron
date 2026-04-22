/**
 * AI Configuration — manages API keys and provider settings.
 *
 * API keys are stored securely in electron-store (encrypted on disk).
 * The provider registry maps provider names → AI SDK model constructors.
 */
import Store from "electron-store";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";

// ---------------------------------------------------------------------------
// Settings storage
// ---------------------------------------------------------------------------

interface AiSettings {
  /** Selected provider name (openai | anthropic | google) */
  provider: string;
  /** Selected model ID (e.g. "gpt-4o", "claude-sonnet-4-5") */
  model: string;
  /** API keys per provider */
  apiKeys: Record<string, string>;
}

const defaults: AiSettings = {
  provider: "openai",
  model: "gpt-4o-mini",
  apiKeys: {},
};

const store = new Store<AiSettings>({
  name: "ai-settings",
  defaults,
  // NOTE: encryptionKey is intentionally omitted so electron-store uses
  // Electron's safeStorage API for native OS-level encryption when available.
  // On platforms where safeStorage is unavailable, the data is stored as
  // plaintext (which is still restricted to the user's app data directory).
});

// ---------------------------------------------------------------------------
// Provider registry — maps provider name → AI SDK model factory
// ---------------------------------------------------------------------------

export type AiProviderName = "openai" | "anthropic" | "google";

interface ProviderEntry {
  label: string;
  /** Factory: given a model ID + API key, returns a LanguageModel instance */
  modelFactory: (modelId: string, apiKey: string) => LanguageModel;
  defaultModel: string;
  /** Available models for this provider */
  models: { id: string; label: string }[];
}

const PROVIDERS: Record<AiProviderName, ProviderEntry> = {
  openai: {
    label: "OpenAI",
    // AI SDK v6: createOpenAI({ apiKey }) returns a callable provider
    modelFactory: (modelId, apiKey) =>
      createOpenAI({ apiKey })(modelId),
    defaultModel: "gpt-4o-mini",
    models: [
      { id: "gpt-4o", label: "GPT-4o" },
      { id: "gpt-4o-mini", label: "GPT-4o Mini" },
      { id: "o3-mini", label: "o3 Mini" },
    ],
  },
  anthropic: {
    label: "Anthropic",
    modelFactory: (modelId, apiKey) =>
      createAnthropic({ apiKey })(modelId),
    defaultModel: "claude-sonnet-4-5-20250514",
    models: [
      { id: "claude-sonnet-4-5-20250514", label: "Claude Sonnet 4.5" },
      { id: "claude-haiku-4-5-20250514", label: "Claude Haiku 4.5" },
    ],
  },
  google: {
    label: "Google",
    modelFactory: (modelId, apiKey) =>
      createGoogleGenerativeAI({ apiKey })(modelId),
    defaultModel: "gemini-2.0-flash",
    models: [
      { id: "gemini-2.5-flash-preview-05-20", label: "Gemini 2.5 Flash" },
      { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
    ],
  },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Get the current AI settings */
export function getAiSettings(): AiSettings {
  return {
    provider: store.get("provider", defaults.provider),
    model: store.get("model", defaults.model),
    apiKeys: store.get("apiKeys", defaults.apiKeys),
  };
}

/** Update AI settings */
export function updateAiSettings(input: Partial<AiSettings>): AiSettings {
  if (input.provider) store.set("provider", input.provider);
  if (input.model) store.set("model", input.model);
  if (input.apiKeys) store.set("apiKeys", input.apiKeys);
  return getAiSettings();
}

/** Set API key for a specific provider */
export function setApiKey(provider: AiProviderName, key: string): void {
  const apiKeys = store.get("apiKeys", {});
  apiKeys[provider] = key;
  store.set("apiKeys", apiKeys);
}

/** Get API key for a specific provider */
export function getApiKey(provider: AiProviderName): string {
  return store.get("apiKeys", {})[provider] ?? "";
}

/** Get the currently configured LanguageModel instance */
export function getCurrentModel(): LanguageModel {
  const settings = getAiSettings();
  const providerName = settings.provider as AiProviderName;
  const provider = PROVIDERS[providerName];
  const apiKey = settings.apiKeys[providerName];

  if (!apiKey) {
    throw new Error(
      `API key not configured for ${provider?.label ?? providerName}. ` +
      "Set it in Settings → AI.",
    );
  }

  const modelId = settings.model || provider.defaultModel;
  return provider.modelFactory(modelId, apiKey);
}

/** Check if AI is configured (has at least one API key) */
export function isAiConfigured(): boolean {
  const apiKeys = store.get("apiKeys", {});
  return Object.values(apiKeys).some((k) => k && k.trim().length > 0);
}

/** Get available providers info for the renderer */
export function getProvidersInfo() {
  const settings = getAiSettings();
  return {
    current: {
      provider: settings.provider,
      model: settings.model,
    },
    providers: Object.entries(PROVIDERS).map(([name, entry]) => ({
      name,
      label: entry.label,
      defaultModel: entry.defaultModel,
      models: entry.models,
      hasApiKey: !!(settings.apiKeys[name]?.trim()),
    })),
  };
}
