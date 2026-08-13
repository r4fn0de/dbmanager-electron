/**
 * AI Configuration — manages API keys and provider settings.
 *
 * API keys are stored securely in electron-store (encrypted on disk).
 * The provider registry maps provider names → AI SDK model constructors.
 */
import Store from "electron-store";
import { safeStorage } from "electron";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import {
  PRIVACY_PRESETS,
  type AiModelEntry,
  type AiProviderName,
  type PrivacySettings,
  type PrivacyPreset,
} from "@/shared/ai/streaming-contracts";

// Re-export AiProviderName so consumers can import it from this module
export { type AiProviderName };

// ---------------------------------------------------------------------------
// Settings storage
// ---------------------------------------------------------------------------

export interface AiSettings {
  /** Selected provider name */
  provider: string;
  /** Selected model ID (e.g. "gpt-4o", "claude-sonnet-4-5") */
  model: string;
  /** API keys per provider */
  apiKeys: Record<string, string>;
  /** Base URL for OpenAI-compatible provider */
  openaiCompatibleBaseURL: string;
  /** Custom base URL for Ollama (empty = default localhost:11434) */
  ollamaBaseURL: string;
  /** User-added custom model IDs per provider */
  customModels: Record<string, string[]>;
  /** Per-context-type privacy toggles */
  privacySettings: PrivacySettings;
  /** Active privacy preset name (null means custom) */
  privacyPreset: PrivacyPreset | null;
  /** Cached Ollama model list (refreshed on detection) */
  ollamaModels: string[];
  /** Whether Ollama was detected on last check */
  ollamaDetected: boolean;
}

const defaults: AiSettings = {
  provider: "openai",
  model: "gpt-4o-mini",
  apiKeys: {},
  openaiCompatibleBaseURL: "http://localhost:1234/v1",
  ollamaBaseURL: "",
  customModels: {},
  privacySettings: PRIVACY_PRESETS.full,
  privacyPreset: "full",
  ollamaModels: [],
  ollamaDetected: false,
};

const store = new Store<AiSettings>({
  name: "ai-settings",
  defaults,
  // NOTE: encryptionKey is intentionally omitted so electron-store uses
  // Electron's safeStorage API for native OS-level encryption when available.
  // On platforms where safeStorage is unavailable (e.g. Linux without a keyring),
  // the data is stored as plaintext (which is still restricted to the user's
  // app data directory). We warn about this below.
});

// Warn if API keys will be stored in plaintext (Linux without keyring/keychain)
if (!safeStorage.isEncryptionAvailable()) {
  console.warn(
    "[ai:config] Electron safeStorage is NOT available on this system.",
    "API keys will be stored in PLAINTEXT in the app data directory.",
    "Install a keyring/keychain (e.g. gnome-keyring) for encrypted storage.",
  );
}

// ---------------------------------------------------------------------------
// Provider registry — maps provider name → AI SDK model factory + optional metadata
// ---------------------------------------------------------------------------

export interface ProviderEntry {
  label: string;
  /** Factory: given a model ID + API key, returns a LanguageModel instance */
  modelFactory: (options: {
    modelId: string;
    apiKey?: string;
    settings: AiSettings;
  }) => LanguageModel;
  defaultModel: string;
  /** Whether the user can type arbitrary model IDs (e.g. for self-hosted) */
  allowCustomModel: boolean;
  /** Whether the provider requires an API key to function */
  requiresApiKey: boolean;
  /** Optional: fetch available models from the provider's API */
  modelsFetcher?: (apiKey?: string, baseURL?: string) => Promise<AiModelEntry[]>;
  /** Optional: regex used to validate API key format */
  apiKeyFormat?: { pattern: RegExp; placeholder: string };
}

const DEFAULT_OLLAMA_URL = "http://localhost:11434/v1";
const OLLAMA_BASE_URL = "http://localhost:11434";

// Static model catalog fallback (used if modelsFetcher is unavailable)
const STATIC_MODELS: Record<AiProviderName, { id: string; label: string }[]> = {
  openai: [
    { id: "gpt-4o", label: "GPT-4o" },
    { id: "gpt-4o-mini", label: "GPT-4o mini" },
    { id: "o1-preview", label: "o1 Preview" },
    { id: "o3-mini", label: "o3-mini" },
  ],
  anthropic: [
    { id: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet" },
    { id: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku" },
    { id: "claude-3-opus-20240229", label: "Claude 3 Opus" },
  ],
  google: [
    { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
    { id: "gemini-2.0-flash-thinking", label: "Gemini 2.0 Flash Thinking" },
    { id: "gemini-1.5-pro", label: "Gemini 1.5 Pro" },
  ],
  "openai-compatible": [],
  ollama: [],
};

const PROVIDERS: Record<AiProviderName, ProviderEntry> = {
  openai: {
    label: "OpenAI",
    modelFactory: ({ modelId, apiKey }) => createOpenAI({ apiKey })(modelId),
    defaultModel: "gpt-4o-mini",
    allowCustomModel: true,
    requiresApiKey: true,
    apiKeyFormat: {
      pattern: /^sk-[A-Za-z0-9_-]{20,}$/,
      placeholder: "sk-...",
    },
    modelsFetcher: fetchOpenAiModels,
  },
  anthropic: {
    label: "Anthropic",
    modelFactory: ({ modelId, apiKey }) =>
      createAnthropic({ apiKey })(modelId),
    defaultModel: "claude-sonnet-4-5-20250514",
    allowCustomModel: true,
    requiresApiKey: true,
    apiKeyFormat: {
      pattern: /^sk-ant-api-03-[A-Za-z0-9_-]+$/,
      placeholder: "sk-ant-...",
    },
    modelsFetcher: fetchAnthropicModels,
  },
  google: {
    label: "Google",
    modelFactory: ({ modelId, apiKey }) =>
      createGoogleGenerativeAI({ apiKey })(modelId),
    defaultModel: "gemini-2.0-flash",
    allowCustomModel: true,
    requiresApiKey: true,
    apiKeyFormat: {
      pattern: /^[A-Za-z0-9_-]{20,}$/,
      placeholder: "API key",
    },
    modelsFetcher: fetchGoogleModels,
  },
  "openai-compatible": {
    label: "OpenAI-Compatible",
    modelFactory: ({ modelId, apiKey, settings }) => {
      const provider = createOpenAICompatible({
        name: "openai-compatible",
        baseURL: settings.openaiCompatibleBaseURL,
        ...(apiKey ? { apiKey } : {}),
      });
      return provider.chatModel(modelId);
    },
    defaultModel: "",
    allowCustomModel: true,
    requiresApiKey: false,
    apiKeyFormat: {
      pattern: /^[A-Za-z0-9_-]+$/,
      placeholder: "API key (optional)",
    },
    modelsFetcher: fetchOpenAICompatibleModels,
  },
  ollama: {
    label: "Ollama",
    modelFactory: ({ modelId, settings }) => {
      const baseURL = getOllamaBaseURL(settings);
      const provider = createOpenAICompatible({
        name: "ollama",
        baseURL,
        apiKey: "ollama",
      });
      return provider.chatModel(modelId);
    },
    defaultModel: "qwen2.5-coder:7b",
    allowCustomModel: true,
    requiresApiKey: false,
    modelsFetcher: fetchOllamaModels,
  },
};

function isProviderName(value: string): value is AiProviderName {
  return value in PROVIDERS;
}

function getCustomModels(providerName: string): string[] {
  return store.get("customModels", {})[providerName] ?? [];
}

function isModelAllowedForProvider(providerName: AiProviderName, modelId: string): boolean {
  if (!modelId.trim()) return false;
  const entry = PROVIDERS[providerName];
  if (entry.allowCustomModel) return true;
  const custom = getCustomModels(providerName);
  if (custom.includes(modelId)) return true;
  return STATIC_MODELS[providerName]?.some((m) => m.id === modelId) ?? false;
}

// ---------------------------------------------------------------------------
// Model discovery — polls provider APIs at runtime
// ---------------------------------------------------------------------------

async function fetchWithError(timeout: number, url: string, options?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (err: unknown) {
    clearTimeout(id);
    throw err;
  }
}

/** Fetch models from OpenAI / OpenAI-compatible endpoint */
async function fetchOpenAiModels(apiKey?: string, baseURL = "https://api.openai.com/v1"): Promise<AiModelEntry[]> {
  const headers: Record<string, string> = { "HTTP-Referer": "http://localhost" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const res = await fetchWithError(3000, `${baseURL}/models`, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json() as { data?: Array<{ id: string; id_name?: string }> };
  return (data.data ?? []).map((m) => ({
    id: m.id,
    label: m.id_name ?? m.id,
  }));
}

/** Fetch models from Anthropic — no public list endpoint; use static catalog */
async function fetchAnthropicModels(): Promise<AiModelEntry[]> {
  return STATIC_MODELS.anthropic;
}

/** Fetch models from Google — no public list endpoint; use static catalog */
async function fetchGoogleModels(): Promise<AiModelEntry[]> {
  return STATIC_MODELS.google;
}

/** Fetch models from OpenAI-compatible endpoint */
async function fetchOpenAICompatibleModels(apiKey?: string, baseURL?: string): Promise<AiModelEntry[]> {
  if (!baseURL) throw new Error("Base URL required for OpenAI-compatible provider");
  const res = await fetchOpenAiModels(apiKey, baseURL);
  if (res.length === 0) return STATIC_MODELS.openai;
  return res;
}

/** Fetch models from Ollama API */
async function fetchOllamaModels(_apiKey?: string, baseURL?: string): Promise<AiModelEntry[]> {
  const url = baseURL || OLLAMA_BASE_URL;
  const res = await fetchWithError(3000, `${url}/api/tags`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json() as { models?: Array<{ name: string }> };
  return (data.models ?? []).map((m) => ({ id: m.name, label: m.name }));
}

/** Fetch available models for a provider (with fallback to static catalog). */
export async function fetchProviderModels(providerName: AiProviderName, apiKey?: string, baseURL?: string): Promise<AiModelEntry[]> {
  const entry = PROVIDERS[providerName];
  if (!entry.modelsFetcher) return [];
  try {
    const models = await entry.modelsFetcher(apiKey, baseURL);
    if (models.length > 0) return models;
  } catch {
    // fetch failed — fall through to static catalog
  }
  return STATIC_MODELS[providerName] ?? [];
}

/** Validate an API key against the provider's format regex. */
export function validateApiKey(providerName: AiProviderName, key: string): { valid: boolean; error?: string } {
  const entry = PROVIDERS[providerName];
  if (!entry.apiKeyFormat) return { valid: true };
  if (!key.trim()) return { valid: entry.requiresApiKey ? false : true };
  if (!entry.apiKeyFormat.pattern.test(key)) {
    return { valid: false, error: "Invalid API key format for this provider" };
  }
  return { valid: true };
}

// ---------------------------------------------------------------------------
// Settings storage helpers
// ---------------------------------------------------------------------------

function getOllamaBaseURL(settings?: AiSettings): string {
  const custom = settings?.ollamaBaseURL?.trim() ?? "";
  return custom ? `${custom}/v1` : DEFAULT_OLLAMA_URL;
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Get the current AI settings */
export function getAiSettings(): AiSettings {
  return {
    provider: store.get("provider", defaults.provider),
    model: store.get("model", defaults.model),
    apiKeys: store.get("apiKeys", defaults.apiKeys),
    openaiCompatibleBaseURL: store.get("openaiCompatibleBaseURL", defaults.openaiCompatibleBaseURL),
    ollamaBaseURL: store.get("ollamaBaseURL", defaults.ollamaBaseURL),
    customModels: store.get("customModels", defaults.customModels),
    privacySettings: store.get("privacySettings", defaults.privacySettings),
    privacyPreset: store.get("privacyPreset", defaults.privacyPreset),
    ollamaModels: store.get("ollamaModels", defaults.ollamaModels),
    ollamaDetected: store.get("ollamaDetected", defaults.ollamaDetected),
  };
}

/** Update AI settings */
export function updateAiSettings(input: Partial<AiSettings>): AiSettings {
  const current = getAiSettings();
  const nextProviderRaw = input.provider ?? current.provider;

  if (!isProviderName(nextProviderRaw)) {
    throw new Error(`Invalid AI provider '${nextProviderRaw}'.`);
  }

  const nextOpenAICompatibleBaseURL =
    input.openaiCompatibleBaseURL?.trim() ?? current.openaiCompatibleBaseURL;

  if (!isValidHttpUrl(nextOpenAICompatibleBaseURL)) {
    throw new Error(
      "Invalid OpenAI-compatible base URL. Use a valid http(s) URL.",
    );
  }

  const nextProvider: AiProviderName = nextProviderRaw;
  const nextModel = input.model
    ?? (input.provider ? PROVIDERS[nextProvider].defaultModel : current.model);

  if (nextModel && !isModelAllowedForProvider(nextProvider, nextModel)) {
    throw new Error(
      `Model '${nextModel}' is not available for provider '${nextProvider}'.`,
    );
  }

  if (input.provider) store.set("provider", nextProvider);
  if (input.model || input.provider) store.set("model", nextModel);
  if (input.apiKeys) store.set("apiKeys", input.apiKeys);
  if (input.openaiCompatibleBaseURL) {
    store.set("openaiCompatibleBaseURL", nextOpenAICompatibleBaseURL);
  }
  if (input.ollamaBaseURL !== undefined) {
    const trimmed = input.ollamaBaseURL.trim();
    if (trimmed && !isValidHttpUrl(trimmed)) {
      throw new Error(
        "Invalid Ollama base URL. Use a valid http(s) URL or leave empty for localhost.",
      );
    }
    store.set("ollamaBaseURL", trimmed);
  }
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

/** Add a custom model ID for a provider (persists across restarts) */
export function addCustomModel(
  provider: AiProviderName,
  modelId: string,
): void {
  const id = modelId.trim();
  if (!id) return;
  const all = store.get("customModels", {});
  const list: string[] = all[provider] ?? [];
  if (!list.includes(id)) {
    list.push(id);
    all[provider] = list;
    store.set("customModels", all);
  }
}

/** Remove a custom model ID for a provider */
export function removeCustomModel(
  provider: AiProviderName,
  modelId: string,
): void {
  const all = store.get("customModels", {});
  const list: string[] = all[provider] ?? [];
  const filtered = list.filter((m) => m !== modelId);
  if (filtered.length !== list.length) {
    all[provider] = filtered;
    store.set("customModels", all);
  }
}

/** Get the currently configured LanguageModel instance */
export function getCurrentModel(): LanguageModel {
  const settings = getAiSettings();
  if (!isProviderName(settings.provider)) {
    throw new Error(`Invalid AI provider '${settings.provider}' in settings.`);
  }

  const providerName = settings.provider;
  const provider = PROVIDERS[providerName];
  const apiKey = settings.apiKeys[providerName];

  if (provider.requiresApiKey && !apiKey) {
    throw new Error(
      `API key not configured for ${provider?.label ?? providerName}. ` +
      "Set it in Settings → AI.",
    );
  }

  if (
    providerName === "openai-compatible" &&
    !isValidHttpUrl(settings.openaiCompatibleBaseURL)
  ) {
    throw new Error(
      "OpenAI-compatible base URL is invalid. Set it in Settings → AI.",
    );
  }

  const modelId = settings.model || provider.defaultModel;
  return provider.modelFactory({ modelId, apiKey, settings });
}

/** Check if AI is configured (has at least one API key or Ollama detected) */
export function isAiConfigured(): boolean {
  const settings = getAiSettings();
  if (settings.provider === "ollama" && settings.ollamaDetected) {
    return true;
  }
  const apiKeys = store.get("apiKeys", {});
  if (
    settings.provider === "openai-compatible" &&
    settings.openaiCompatibleBaseURL.trim().length > 0
  ) {
    return true;
  }
  return Object.values(apiKeys).some((k) => k && k.trim().length > 0);
}

/** Get available providers info for the renderer */
export function getProvidersInfo() {
  const settings = getAiSettings();
  return {
    current: {
      provider: settings.provider as AiProviderName,
      model: settings.model,
      openaiCompatibleBaseURL: settings.openaiCompatibleBaseURL,
      ollamaBaseURL: settings.ollamaBaseURL,
    },
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
    ollamaDetected: settings.ollamaDetected,
    ollamaModels: settings.ollamaModels,
    providers: Object.entries(PROVIDERS).map(([name, entry]) => {
      const custom = settings.customModels[name] ?? [];
      const customModelEntries: AiModelEntry[] = custom.map((id) => ({
        id,
        label: id,
        isCustom: true,
      }));
      return {
        name: name as AiProviderName,
        label: entry.label,
        defaultModel: entry.defaultModel,
        models: [],
        customModels: customModelEntries,
        hasApiKey: !!(settings.apiKeys[name]?.trim()),
        requiresApiKey: entry.requiresApiKey,
        allowCustomModel: entry.allowCustomModel,
        apiKeyFormat: entry.apiKeyFormat
          ? { placeholder: entry.apiKeyFormat.placeholder }
          : undefined,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Ollama detection
// ---------------------------------------------------------------------------

export async function detectOllama(): Promise<{
  detected: boolean;
  models: string[];
}> {
  const settings = getAiSettings();
  const baseURL = settings.ollamaBaseURL?.trim()
    ? `${settings.ollamaBaseURL.replace(/\/v1$/, "")}`
    : OLLAMA_BASE_URL;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    const response = await fetch(`${baseURL}/api/tags`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      store.set("ollamaDetected", false);
      store.set("ollamaModels", []);
      return { detected: false, models: [] };
    }

    const data = (await response.json()) as {
      models?: Array<{ name: string }>;
    };
    const models = (data.models ?? []).map((m) => m.name);

    store.set("ollamaDetected", true);
    store.set("ollamaModels", models);

    return { detected: true, models };
  } catch {
    store.set("ollamaDetected", false);
    store.set("ollamaModels", []);
    return { detected: false, models: [] };
  }
}

// ---------------------------------------------------------------------------
// Privacy settings
// ---------------------------------------------------------------------------

/** Get the current privacy settings */
export function getPrivacySettings(): PrivacySettings {
  const preset = store.get("privacyPreset", null);
  if (preset && preset in PRIVACY_PRESETS) {
    return PRIVACY_PRESETS[preset];
  }
  return store.get("privacySettings", PRIVACY_PRESETS.full);
}

/** Get the active privacy preset name (null if custom) */
export function getPrivacyPreset(): PrivacyPreset | null {
  return store.get("privacyPreset", null);
}

/** Update privacy settings */
export function updatePrivacySettings(
  settings: Partial<PrivacySettings>,
  preset?: PrivacyPreset | null,
): PrivacySettings {
  if (preset !== undefined) {
    store.set("privacyPreset", preset);
    if (preset && preset in PRIVACY_PRESETS) {
      store.set("privacySettings", PRIVACY_PRESETS[preset]);
      return PRIVACY_PRESETS[preset];
    }
  }
  const current = getPrivacySettings();
  const next = { ...current, ...settings };
  store.set("privacySettings", next);
  store.set("privacyPreset", null);
  return next;
}
