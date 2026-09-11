/**
 * AI Configuration — manages API keys and provider settings.
 *
 * API keys are encrypted with Electron safeStorage before they are persisted
 * in electron-store. The provider registry maps provider names → AI SDK model
 * constructors.
 */

import { randomUUID } from "node:crypto";
import type { LanguageModel } from "ai";
import { safeStorage } from "electron";
import Store from "electron-store";
import { resolveApiModel } from "@/ipc/ai/adapters/api-provider-adapter";
import {
  getDefaultConnectionId,
  type LegacyAiSettings,
  migrateLegacyAiSettings,
  syncLegacyAiSettings,
} from "@/ipc/ai/connections-store";
import { decryptSecret, encryptSecret } from "@/ipc/security/secrets";
import {
  type AiModelEntry,
  type AiProviderName,
  CUSTOM_AI_PROVIDER_PREFIX,
  type CustomAiProvider,
  isCustomAiProviderId,
  PRIVACY_PRESETS,
  type PrivacyPreset,
  type PrivacySettings,
} from "@/shared/ai/streaming-contracts";

// Re-export AiProviderName so consumers can import it from this module
export type { AiProviderName };

// ---------------------------------------------------------------------------
// Settings storage
// ---------------------------------------------------------------------------

export interface AiSettings {
  /** API keys per provider */
  apiKeys: Record<string, string>;
  /** User-added custom model IDs per provider */
  customModels: Record<string, string[]>;
  /** User-saved custom (OpenAI-compatible) provider endpoints */
  customProviders: CustomAiProvider[];
  /** Selected model ID (e.g. "gpt-4o", "claude-sonnet-4-5") */
  model: string;
  /** Custom base URL for Ollama (empty = default localhost:11434) */
  ollamaBaseURL: string;
  /** Whether Ollama was detected on last check */
  ollamaDetected: boolean;
  /** Cached Ollama model list (refreshed on detection) */
  ollamaModels: string[];
  /** Base URL for OpenAI-compatible provider */
  openaiCompatibleBaseURL: string;
  /** Active privacy preset name (null means custom) */
  privacyPreset: PrivacyPreset | null;
  /** Per-context-type privacy toggles */
  privacySettings: PrivacySettings;
  /** Selected provider name */
  provider: string;
}

const defaults: AiSettings = {
  apiKeys: {},
  customModels: {},
  customProviders: [],
  model: "gpt-4o-mini",
  ollamaBaseURL: "",
  ollamaDetected: false,
  ollamaModels: [],
  openaiCompatibleBaseURL: "http://localhost:1234/v1",
  privacyPreset: "full",
  privacySettings: PRIVACY_PRESETS.full,
  provider: "openai",
};

const store = new Store<AiSettings>({
  defaults,
  name: "ai-settings",
  // API keys are encrypted explicitly by getStoredApiKeys/setStoredApiKeys.
  // On platforms where safeStorage is unavailable (e.g. Linux without a
  // keyring), the fallback remains restricted to the user's app data directory.
});

// Warn if API keys will be stored in plaintext (Linux without keyring/keychain)
if (!safeStorage.isEncryptionAvailable()) {
  console.warn(
    "[ai:config] Electron safeStorage is NOT available on this system.",
    "API keys will be stored in PLAINTEXT in the app data directory.",
    "Install a keyring/keychain (e.g. gnome-keyring) for encrypted storage."
  );
}

function getStoredApiKeys(): Record<string, string> {
  const stored = store.get("apiKeys", {});
  return Object.fromEntries(
    Object.entries(stored).map(([provider, key]) => [
      provider,
      decryptSecret(key),
    ])
  );
}

function setStoredApiKeys(apiKeys: Record<string, string>): void {
  const encrypted = Object.fromEntries(
    Object.entries(apiKeys).map(([provider, key]) => [
      provider,
      encryptSecret(key),
    ])
  );
  store.set("apiKeys", encrypted);
}

function getLegacySettingsSnapshot(): LegacyAiSettings {
  return {
    apiKeys: getStoredApiKeys(),
    customModels: store.get("customModels", defaults.customModels),
    customProviders: store.get("customProviders", defaults.customProviders),
    model: store.get("model", defaults.model),
    ollamaBaseURL: store.get("ollamaBaseURL", defaults.ollamaBaseURL),
    ollamaModels: store.get("ollamaModels", defaults.ollamaModels),
    openaiCompatibleBaseURL: store.get(
      "openaiCompatibleBaseURL",
      defaults.openaiCompatibleBaseURL
    ),
    provider: store.get("provider", defaults.provider),
  };
}

function migrateAiConnections(): void {
  const legacy = getLegacySettingsSnapshot();
  migrateLegacyAiSettings(legacy);
  if (Object.keys(legacy.apiKeys).length > 0) {
    setStoredApiKeys(legacy.apiKeys);
  }
}

// Migrate before any caller can resolve a model or settings response. The
// legacy fields remain the compatibility source of truth for existing APIs.
migrateAiConnections();

// ---------------------------------------------------------------------------
// Provider registry — maps provider name → AI SDK model factory + optional metadata
// ---------------------------------------------------------------------------

export interface ProviderEntry {
  /** Whether the user can type arbitrary model IDs (e.g. for self-hosted) */
  allowCustomModel: boolean;
  /** Optional: regex used to validate API key format */
  apiKeyFormat?: { pattern: RegExp; placeholder: string };
  defaultModel: string;
  label: string;
  /** Optional: fetch available models from the provider's API */
  modelsFetcher?: (
    apiKey?: string,
    baseURL?: string
  ) => Promise<AiModelEntry[]>;
  /** Whether the provider requires an API key to function */
  requiresApiKey: boolean;
}

const OLLAMA_BASE_URL = "http://localhost:11434";

// Static model catalog fallback (used if modelsFetcher is unavailable)
const STATIC_MODELS: Record<AiProviderName, { id: string; label: string }[]> = {
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
  ollama: [],
  openai: [
    { id: "gpt-4o", label: "GPT-4o" },
    { id: "gpt-4o-mini", label: "GPT-4o mini" },
    { id: "o1-preview", label: "o1 Preview" },
    { id: "o3-mini", label: "o3-mini" },
  ],
  "openai-compatible": [],
};

const PROVIDERS: Record<AiProviderName, ProviderEntry> = {
  anthropic: {
    allowCustomModel: true,
    apiKeyFormat: {
      pattern: /^sk-ant-api-03-[A-Za-z0-9_-]+$/,
      placeholder: "sk-ant-...",
    },
    defaultModel: "claude-sonnet-4-5-20250514",
    label: "Anthropic",
    modelsFetcher: fetchAnthropicModels,
    requiresApiKey: true,
  },
  google: {
    allowCustomModel: true,
    apiKeyFormat: {
      pattern: /^[A-Za-z0-9_-]{20,}$/,
      placeholder: "API key",
    },
    defaultModel: "gemini-2.0-flash",
    label: "Google",
    modelsFetcher: fetchGoogleModels,
    requiresApiKey: true,
  },
  ollama: {
    allowCustomModel: true,
    defaultModel: "qwen2.5-coder:7b",
    label: "Ollama",
    modelsFetcher: fetchOllamaModels,
    requiresApiKey: false,
  },
  openai: {
    allowCustomModel: true,
    apiKeyFormat: {
      pattern: /^sk-[A-Za-z0-9_-]{20,}$/,
      placeholder: "sk-...",
    },
    defaultModel: "gpt-4o-mini",
    label: "OpenAI",
    modelsFetcher: fetchOpenAiModels,
    requiresApiKey: true,
  },
  "openai-compatible": {
    allowCustomModel: true,
    apiKeyFormat: {
      pattern: /^[A-Za-z0-9_-]+$/,
      placeholder: "API key (optional)",
    },
    defaultModel: "",
    label: "OpenAI-Compatible",
    modelsFetcher: fetchOpenAICompatibleModels,
    requiresApiKey: false,
  },
};

function isProviderName(value: string): value is AiProviderName {
  return value in PROVIDERS;
}

/** Built-in or saved-custom provider reference. */
function isProviderRef(value: string): boolean {
  if (isProviderName(value)) {
    return true;
  }
  if (!isCustomAiProviderId(value)) {
    return false;
  }
  return getCustomProviderDef(value) !== undefined;
}

function getCustomProviders(): CustomAiProvider[] {
  const stored = store.get("customProviders", defaults.customProviders);
  return Array.isArray(stored) ? stored : [];
}

function getCustomProviderDef(id: string): CustomAiProvider | undefined {
  return getCustomProviders().find((p) => p.id === id);
}

/** Hostnames that mean "runs on this machine" (no DNS lookup involved). */
const LOCAL_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
]);

/** Whether the base URL points at the local machine. */
export function isLocalBaseURL(baseURL: string): boolean {
  try {
    return LOCAL_HOSTNAMES.has(new URL(baseURL).hostname.toLowerCase());
  } catch {
    return false;
  }
}

function getCustomModels(providerName: string): string[] {
  return store.get("customModels", {})[providerName] ?? [];
}

function isModelAllowedForProvider(
  providerRef: string,
  modelId: string
): boolean {
  if (!modelId.trim()) {
    return false;
  }
  if (isCustomAiProviderId(providerRef)) {
    return true;
  }
  if (!isProviderName(providerRef)) {
    return false;
  }
  const entry = PROVIDERS[providerRef];
  if (entry.allowCustomModel) {
    return true;
  }
  const custom = getCustomModels(providerRef);
  if (custom.includes(modelId)) {
    return true;
  }
  return STATIC_MODELS[providerRef]?.some((m) => m.id === modelId) ?? false;
}

// ---------------------------------------------------------------------------
// Model discovery — polls provider APIs at runtime
// ---------------------------------------------------------------------------

async function fetchWithError(
  timeout: number,
  url: string,
  options?: RequestInit
): Promise<Response> {
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
async function fetchOpenAiModels(
  apiKey?: string,
  baseURL = "https://api.openai.com/v1"
): Promise<AiModelEntry[]> {
  const headers: Record<string, string> = {
    "HTTP-Referer": "http://localhost",
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  const res = await fetchWithError(3000, `${baseURL}/models`, { headers });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    data?: Array<{ id: string; id_name?: string }>;
  };
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
async function fetchOpenAICompatibleModels(
  apiKey?: string,
  baseURL?: string
): Promise<AiModelEntry[]> {
  if (!baseURL) {
    throw new Error("Base URL required for OpenAI-compatible provider");
  }
  const res = await fetchOpenAiModels(apiKey, baseURL);
  if (res.length === 0) {
    return STATIC_MODELS.openai;
  }
  return res;
}

/** Fetch models from Ollama API */
async function fetchOllamaModels(
  _apiKey?: string,
  baseURL?: string
): Promise<AiModelEntry[]> {
  const url = baseURL || OLLAMA_BASE_URL;
  const res = await fetchWithError(3000, `${url}/api/tags`);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const data = (await res.json()) as { models?: Array<{ name: string }> };
  return (data.models ?? []).map((m) => ({ id: m.name, label: m.name }));
}

/** Fetch available models for a provider (with fallback to static catalog). */
export async function fetchProviderModels(
  providerName: AiProviderName,
  apiKey?: string,
  baseURL?: string
): Promise<AiModelEntry[]> {
  const entry = PROVIDERS[providerName];
  if (!entry.modelsFetcher) {
    return [];
  }
  try {
    const models = await entry.modelsFetcher(apiKey, baseURL);
    if (models.length > 0) {
      return models;
    }
  } catch {
    // fetch failed — fall through to static catalog
  }
  return STATIC_MODELS[providerName] ?? [];
}

/** Validate an API key against the provider's format regex. */
export function validateApiKey(
  providerName: AiProviderName,
  key: string
): { valid: boolean; error?: string } {
  const entry = PROVIDERS[providerName];
  if (!entry.apiKeyFormat) {
    return { valid: true };
  }
  if (!key.trim()) {
    return { valid: !entry.requiresApiKey };
  }
  if (!entry.apiKeyFormat.pattern.test(key)) {
    return { error: "Invalid API key format for this provider", valid: false };
  }
  return { valid: true };
}

// ---------------------------------------------------------------------------
// Settings storage helpers
// ---------------------------------------------------------------------------

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeBaseURL(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function validateCustomProviderInput(input: {
  label?: string;
  baseURL?: string;
  defaultModel?: string;
  ignoreId?: string;
}): { label: string; baseURL: string; defaultModel: string } {
  const label = (input.label ?? "").trim();
  if (!label) {
    throw new Error("Custom provider name is required.");
  }
  if (label.length > 60) {
    throw new Error("Custom provider name must be 60 characters or less.");
  }
  const duplicate = getCustomProviders().some(
    (p) =>
      p.id !== input.ignoreId && p.label.toLowerCase() === label.toLowerCase()
  );
  if (duplicate) {
    throw new Error(`A custom provider named '${label}' already exists.`);
  }
  const baseURL = normalizeBaseURL(input.baseURL ?? "");
  if (!(baseURL && isValidHttpUrl(baseURL))) {
    throw new Error("Invalid base URL. Use a valid http(s) URL.");
  }
  const defaultModel = (input.defaultModel ?? "").trim();
  return { baseURL, defaultModel, label };
}

// ---------------------------------------------------------------------------
// Custom providers — user-saved named OpenAI-compatible endpoints
// ---------------------------------------------------------------------------

export interface AddCustomProviderInput {
  apiKey?: string;
  baseURL: string;
  defaultModel?: string;
  label: string;
}

/** Save a new custom provider endpoint. Returns the saved definition. */
export function addCustomProvider(
  input: AddCustomProviderInput
): CustomAiProvider {
  const validated = validateCustomProviderInput(input);
  const def: CustomAiProvider = {
    id: `${CUSTOM_AI_PROVIDER_PREFIX}${randomUUID()}`,
    ...validated,
  };
  store.set("customProviders", [...getCustomProviders(), def]);
  const apiKey = input.apiKey?.trim();
  if (apiKey) {
    const apiKeys = getStoredApiKeys();
    apiKeys[def.id] = apiKey;
    setStoredApiKeys(apiKeys);
  }
  syncLegacyAiSettings(getLegacySettingsSnapshot());
  return def;
}

export interface UpdateCustomProviderInput {
  baseURL?: string;
  defaultModel?: string;
  id: string;
  label?: string;
}

/** Update a saved custom provider's label, URL or default model. */
export function updateCustomProvider(
  input: UpdateCustomProviderInput
): CustomAiProvider {
  const existing = getCustomProviderDef(input.id);
  if (!existing) {
    throw new Error("Custom provider not found.");
  }
  const validated = validateCustomProviderInput({
    baseURL: input.baseURL ?? existing.baseURL,
    defaultModel: input.defaultModel ?? existing.defaultModel,
    ignoreId: input.id,
    label: input.label ?? existing.label,
  });
  const next: CustomAiProvider = { id: existing.id, ...validated };
  store.set(
    "customProviders",
    getCustomProviders().map((p) => (p.id === input.id ? next : p))
  );
  syncLegacyAiSettings(getLegacySettingsSnapshot());
  return next;
}

/** Remove a saved custom provider (and its key). Falls back to OpenAI if selected. */
export function removeCustomProvider(id: string): void {
  const remaining = getCustomProviders().filter((p) => p.id !== id);
  store.set("customProviders", remaining);
  const apiKeys = getStoredApiKeys();
  if (apiKeys[id]) {
    delete apiKeys[id];
    setStoredApiKeys(apiKeys);
  }
  if (store.get("provider", defaults.provider) === id) {
    store.set("provider", "openai");
    store.set("model", PROVIDERS.openai.defaultModel);
  }
  syncLegacyAiSettings(getLegacySettingsSnapshot());
}

/** Set (or clear) the API key for a saved custom provider. */
export function setCustomProviderApiKey(id: string, key: string): void {
  if (!getCustomProviderDef(id)) {
    throw new Error("Custom provider not found.");
  }
  const apiKeys = getStoredApiKeys();
  if (key.trim()) {
    apiKeys[id] = key.trim();
  } else {
    delete apiKeys[id];
  }
  setStoredApiKeys(apiKeys);
  syncLegacyAiSettings(getLegacySettingsSnapshot());
}

// ---------------------------------------------------------------------------
// Endpoint reachability — "is the local provider running?"
// ---------------------------------------------------------------------------

export interface ProviderEndpointStatus {
  /** Which probe answered: the OpenAI-style list or Ollama's tags API */
  endpoint: "v1/models" | "api/tags" | null;
  models: AiModelEntry[];
  reachable: boolean;
}

/**
 * Probe an OpenAI-compatible (or Ollama) base URL to check whether anything
 * is listening. Tries `/v1/models` first, then Ollama's `/api/tags`.
 */
export async function checkProviderEndpoint(
  baseURL: string,
  timeoutMs = 2500
): Promise<ProviderEndpointStatus> {
  const base = normalizeBaseURL(baseURL);
  if (!(base && isValidHttpUrl(base))) {
    throw new Error("Invalid base URL. Use a valid http(s) URL.");
  }
  const withoutV1Suffix = base.replace(/\/v1$/, "");
  const probes: Array<{
    endpoint: ProviderEndpointStatus["endpoint"];
    url: string;
  }> = [
    { endpoint: "v1/models", url: `${withoutV1Suffix}/v1/models` },
    { endpoint: "api/tags", url: `${withoutV1Suffix}/api/tags` },
  ];
  for (const probe of probes) {
    try {
      const res = await fetchWithError(timeoutMs, probe.url);
      if (!res.ok) {
        continue;
      }
      const data = (await res.json()) as {
        data?: Array<{ id: string }>;
        models?: Array<{ name: string }>;
      };
      const models: AiModelEntry[] = [
        ...(data.data ?? []).map((m) => ({ id: m.id, label: m.id })),
        ...(data.models ?? []).map((m) => ({ id: m.name, label: m.name })),
      ];
      return { endpoint: probe.endpoint, models, reachable: true };
    } catch {
      // try the next probe
    }
  }
  return { endpoint: null, models: [], reachable: false };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Get the current AI settings */
export function getAiSettings(): AiSettings {
  migrateAiConnections();
  return {
    apiKeys: getStoredApiKeys(),
    customModels: store.get("customModels", defaults.customModels),
    customProviders: store.get("customProviders", defaults.customProviders),
    model: store.get("model", defaults.model),
    ollamaBaseURL: store.get("ollamaBaseURL", defaults.ollamaBaseURL),
    ollamaDetected: store.get("ollamaDetected", defaults.ollamaDetected),
    ollamaModels: store.get("ollamaModels", defaults.ollamaModels),
    openaiCompatibleBaseURL: store.get(
      "openaiCompatibleBaseURL",
      defaults.openaiCompatibleBaseURL
    ),
    privacyPreset: store.get("privacyPreset", defaults.privacyPreset),
    privacySettings: store.get("privacySettings", defaults.privacySettings),
    provider: store.get("provider", defaults.provider),
  };
}

/** Update AI settings */
export function updateAiSettings(input: Partial<AiSettings>): AiSettings {
  const current = getAiSettings();
  const nextProviderRaw = input.provider ?? current.provider;

  if (!isProviderRef(nextProviderRaw)) {
    throw new Error(`Invalid AI provider '${nextProviderRaw}'.`);
  }

  const nextOpenAICompatibleBaseURL =
    input.openaiCompatibleBaseURL?.trim() ?? current.openaiCompatibleBaseURL;

  if (!isValidHttpUrl(nextOpenAICompatibleBaseURL)) {
    throw new Error(
      "Invalid OpenAI-compatible base URL. Use a valid http(s) URL."
    );
  }

  const nextProvider: string = nextProviderRaw;
  const defaultModelFor = (ref: string): string => {
    const custom = isCustomAiProviderId(ref)
      ? getCustomProviderDef(ref)
      : undefined;
    if (custom) {
      return custom.defaultModel;
    }
    return isProviderName(ref) ? PROVIDERS[ref].defaultModel : "";
  };
  const nextModel =
    input.model ??
    (input.provider ? defaultModelFor(nextProvider) : current.model);

  if (nextModel && !isModelAllowedForProvider(nextProvider, nextModel)) {
    throw new Error(
      `Model '${nextModel}' is not available for provider '${nextProvider}'.`
    );
  }

  if (input.provider) {
    store.set("provider", nextProvider);
  }
  if (input.model || input.provider) {
    store.set("model", nextModel);
  }
  if (input.apiKeys) {
    setStoredApiKeys(input.apiKeys);
  }
  if (input.openaiCompatibleBaseURL) {
    store.set("openaiCompatibleBaseURL", nextOpenAICompatibleBaseURL);
  }
  if (input.ollamaBaseURL !== undefined) {
    const trimmed = input.ollamaBaseURL.trim();
    if (trimmed && !isValidHttpUrl(trimmed)) {
      throw new Error(
        "Invalid Ollama base URL. Use a valid http(s) URL or leave empty for localhost."
      );
    }
    store.set("ollamaBaseURL", trimmed);
  }
  syncLegacyAiSettings(getLegacySettingsSnapshot());
  return getAiSettings();
}

/** Set API key for a specific provider */
export function setApiKey(provider: AiProviderName, key: string): void {
  const apiKeys = getStoredApiKeys();
  apiKeys[provider] = key;
  setStoredApiKeys(apiKeys);
  syncLegacyAiSettings(getLegacySettingsSnapshot());
}

/** Get API key for a specific provider */
export function getApiKey(provider: AiProviderName): string {
  return getStoredApiKeys()[provider] ?? "";
}

/** Add a custom model ID for a provider (persists across restarts) */
export function addCustomModel(provider: string, modelId: string): void {
  const id = modelId.trim();
  if (!id) {
    return;
  }
  if (!isProviderRef(provider)) {
    throw new Error(`Invalid AI provider '${provider}'.`);
  }
  const all = store.get("customModels", {});
  const list: string[] = all[provider] ?? [];
  if (!list.includes(id)) {
    list.push(id);
    all[provider] = list;
    store.set("customModels", all);
    syncLegacyAiSettings(getLegacySettingsSnapshot());
  }
}

/** Remove a custom model ID for a provider */
export function removeCustomModel(provider: string, modelId: string): void {
  if (!isProviderRef(provider)) {
    throw new Error(`Invalid AI provider '${provider}'.`);
  }
  const all = store.get("customModels", {});
  const list: string[] = all[provider] ?? [];
  const filtered = list.filter((m) => m !== modelId);
  if (filtered.length !== list.length) {
    all[provider] = filtered;
    store.set("customModels", all);
    syncLegacyAiSettings(getLegacySettingsSnapshot());
  }
}

/** Resolve a LanguageModel for one saved AI connection profile. */
export function getModelForConnection(
  connectionId: string,
  modelId?: string
): LanguageModel {
  return resolveApiModel({ connectionId, modelId }).model;
}

/**
 * Compatibility wrapper for callers that still use the global AI selection.
 * The migrated default profile is now the source of truth.
 */
export function getCurrentModel(): LanguageModel {
  const connectionId = getDefaultConnectionId();
  if (!connectionId) {
    throw new Error(
      "No AI connection is configured. Create an AI connection in Settings → AI."
    );
  }
  return resolveApiModel({ connectionId }).model;
}

/** Check if AI is configured (has at least one API key or Ollama detected) */
export function isAiConfigured(): boolean {
  const settings = getAiSettings();
  if (settings.provider === "ollama" && settings.ollamaDetected) {
    return true;
  }
  const apiKeys = settings.apiKeys;
  if (
    settings.provider === "openai-compatible" &&
    settings.openaiCompatibleBaseURL.trim().length > 0
  ) {
    return true;
  }
  const selectedCustom = isCustomAiProviderId(settings.provider)
    ? getCustomProviderDef(settings.provider)
    : undefined;
  if (selectedCustom && selectedCustom.baseURL.trim().length > 0) {
    return true;
  }
  return Object.values(apiKeys).some((k) => k && k.trim().length > 0);
}

/** Get available providers info for the renderer */
export function getProvidersInfo() {
  const settings = getAiSettings();
  return {
    current: {
      model: settings.model,
      ollamaBaseURL: settings.ollamaBaseURL,
      openaiCompatibleBaseURL: settings.openaiCompatibleBaseURL,
      provider: settings.provider,
    },
    customProviders: settings.customProviders.map((custom) => {
      const addedModels = (settings.customModels[custom.id] ?? []).map(
        (id) => ({
          id,
          isCustom: true,
          label: id,
        })
      );
      return {
        ...custom,
        customModels: addedModels satisfies AiModelEntry[],
        hasApiKey: !!settings.apiKeys[custom.id]?.trim(),
        isLocal: isLocalBaseURL(custom.baseURL),
      };
    }),
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
    ollamaDetected: settings.ollamaDetected,
    ollamaModels: settings.ollamaModels,
    providers: Object.entries(PROVIDERS).map(([name, entry]) => {
      const custom = settings.customModels[name] ?? [];
      const customModelEntries: AiModelEntry[] = custom.map((id) => ({
        id,
        isCustom: true,
        label: id,
      }));
      return {
        allowCustomModel: entry.allowCustomModel,
        apiKeyFormat: entry.apiKeyFormat
          ? { placeholder: entry.apiKeyFormat.placeholder }
          : undefined,
        customModels: customModelEntries,
        defaultModel: entry.defaultModel,
        hasApiKey: !!settings.apiKeys[name]?.trim(),
        label: entry.label,
        models: [],
        name: name as AiProviderName,
        requiresApiKey: entry.requiresApiKey,
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
    ? settings.ollamaBaseURL.replace(/\/v1$/, "")
    : OLLAMA_BASE_URL;
  try {
    const status = await checkProviderEndpoint(baseURL, 2000);
    if (!status.reachable) {
      store.set("ollamaDetected", false);
      store.set("ollamaModels", []);
      syncLegacyAiSettings(getLegacySettingsSnapshot());
      return { detected: false, models: [] };
    }

    const models = status.models.map((m) => m.id);

    store.set("ollamaDetected", true);
    store.set("ollamaModels", models);
    syncLegacyAiSettings(getLegacySettingsSnapshot());

    return { detected: true, models };
  } catch {
    store.set("ollamaDetected", false);
    store.set("ollamaModels", []);
    syncLegacyAiSettings(getLegacySettingsSnapshot());
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
  preset?: PrivacyPreset | null
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
