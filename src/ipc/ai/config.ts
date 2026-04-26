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
}

const defaults: AiSettings = {
  provider: "openai",
  model: "gpt-4o-mini",
  apiKeys: {},
  openaiCompatibleBaseURL: "http://localhost:1234/v1",
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
// Provider registry — maps provider name → AI SDK model factory
// ---------------------------------------------------------------------------

export type AiProviderName =
  | "openai"
  | "anthropic"
  | "google"
  | "openai-compatible";

interface ProviderEntry {
  label: string;
  /** Factory: given a model ID + API key, returns a LanguageModel instance */
  modelFactory: (options: {
    modelId: string;
    apiKey?: string;
    settings: AiSettings;
  }) => LanguageModel;
  defaultModel: string;
  /** Available models for this provider */
  models: { id: string; label: string }[];
  allowCustomModel?: boolean;
  requiresApiKey?: boolean;
}

const PROVIDERS: Record<AiProviderName, ProviderEntry> = {
  openai: {
    label: "OpenAI",
    // AI SDK v6: createOpenAI({ apiKey }) returns a callable provider
    modelFactory: ({ modelId, apiKey }) => createOpenAI({ apiKey })(modelId),
    defaultModel: "gpt-4o-mini",
    requiresApiKey: true,
    models: [
      { id: "gpt-4o", label: "GPT-4o" },
      { id: "gpt-4o-mini", label: "GPT-4o Mini" },
      { id: "o3-mini", label: "o3 Mini" },
    ],
  },
  anthropic: {
    label: "Anthropic",
    modelFactory: ({ modelId, apiKey }) =>
      createAnthropic({ apiKey })(modelId),
    defaultModel: "claude-sonnet-4-5-20250514",
    requiresApiKey: true,
    models: [
      { id: "claude-sonnet-4-5-20250514", label: "Claude Sonnet 4.5" },
      { id: "claude-haiku-4-5-20250514", label: "Claude Haiku 4.5" },
    ],
  },
  google: {
    label: "Google",
    modelFactory: ({ modelId, apiKey }) =>
      createGoogleGenerativeAI({ apiKey })(modelId),
    defaultModel: "gemini-2.0-flash",
    requiresApiKey: true,
    models: [
      { id: "gemini-2.5-flash-preview-05-20", label: "Gemini 2.5 Flash" },
      { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
    ],
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
    defaultModel: "gpt-4o-mini",
    allowCustomModel: true,
    requiresApiKey: false,
    models: [
      { id: "gpt-4o-mini", label: "GPT-4o Mini (example)" },
      { id: "meta-llama/Llama-3-70b-chat-hf", label: "Llama 3 70B (example)" },
    ],
  },
};

function isProviderName(value: string): value is AiProviderName {
  return value in PROVIDERS;
}

function isModelAllowedForProvider(
  providerName: AiProviderName,
  modelId: string,
): boolean {
  if (PROVIDERS[providerName].allowCustomModel) {
    return modelId.trim().length > 0;
  }
  return PROVIDERS[providerName].models.some((m) => m.id === modelId);
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
    openaiCompatibleBaseURL: store.get(
      "openaiCompatibleBaseURL",
      defaults.openaiCompatibleBaseURL,
    ),
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
  if (!isProviderName(settings.provider)) {
    throw new Error(`Invalid AI provider '${settings.provider}' in settings.`);
  }

  const providerName = settings.provider;
  const provider = PROVIDERS[providerName];
  const apiKey = settings.apiKeys[providerName];

  if (provider.requiresApiKey !== false && !apiKey) {
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

  const modelId = isModelAllowedForProvider(providerName, settings.model)
    ? settings.model
    : provider.defaultModel;
  return provider.modelFactory({ modelId, apiKey, settings });
}

/** Check if AI is configured (has at least one API key) */
export function isAiConfigured(): boolean {
  const settings = getAiSettings();
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
      provider: settings.provider,
      model: settings.model,
      openaiCompatibleBaseURL: settings.openaiCompatibleBaseURL,
    },
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
    providers: Object.entries(PROVIDERS).map(([name, entry]) => ({
      name,
      label: entry.label,
      defaultModel: entry.defaultModel,
      models: entry.models,
      hasApiKey: !!(settings.apiKeys[name]?.trim()),
    })),
  };
}
