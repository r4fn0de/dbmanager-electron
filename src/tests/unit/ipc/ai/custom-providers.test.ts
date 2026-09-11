import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  CUSTOM_AI_PROVIDER_PREFIX,
  isCustomAiProviderId,
} from "@/shared/ai/streaming-contracts";

const mocks = vi.hoisted(() => {
  const stores = new Map<string, Record<string, unknown>>();

  class MockStore<T extends Record<string, unknown>> {
    private readonly data: Record<string, unknown>;

    constructor(options: { name: string; defaults: T }) {
      this.data = stores.get(options.name) ?? { ...options.defaults };
      stores.set(options.name, this.data);
    }

    get<K extends keyof T>(key: K, fallback?: T[K]): T[K] {
      return (
        Object.hasOwn(this.data, key) ? this.data[String(key)] : fallback
      ) as T[K];
    }

    set<K extends keyof T>(key: K, value: T[K]): void {
      this.data[String(key)] = value;
    }

    get store(): T {
      return this.data as T;
    }
  }

  return { MockStore, stores };
});

vi.mock("electron-store", () => ({ default: mocks.MockStore }));
vi.mock("electron", () => ({
  safeStorage: {
    decryptString: (value: Buffer) =>
      value.toString().slice("encrypted:".length),
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
    isEncryptionAvailable: () => true,
  },
}));

type ConfigModule = typeof import("@/ipc/ai/config");
type ConnectionsStoreModule = typeof import("@/ipc/ai/connections-store");

let config: ConfigModule;
let connectionsStore: ConnectionsStoreModule;

beforeEach(async () => {
  mocks.stores.clear();
  vi.resetModules();
  vi.unstubAllGlobals();
  config = await import("@/ipc/ai/config");
  connectionsStore = await import("@/ipc/ai/connections-store");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("custom AI provider ids", () => {
  test("prefix helper detects custom ids", () => {
    expect(CUSTOM_AI_PROVIDER_PREFIX).toBe("custom:");
    expect(isCustomAiProviderId("custom:123")).toBe(true);
    expect(isCustomAiProviderId("openai")).toBe(false);
    expect(isCustomAiProviderId("")).toBe(false);
  });
});

describe("isLocalBaseURL", () => {
  test.each([
    "http://localhost:1234/v1",
    "http://localhost:11434",
    "http://127.0.0.1:8080",
    "http://0.0.0.0:1234",
    "http://[::1]:11434",
  ])("treats %s as local", (url) => {
    expect(config.isLocalBaseURL(url)).toBe(true);
  });

  test.each([
    "https://api.openai.com/v1",
    "http://192.168.1.10:1234/v1",
    "http://my-server.local:11434",
    "not-a-url",
    "",
  ])("treats %s as non-local", (url) => {
    expect(config.isLocalBaseURL(url)).toBe(false);
  });
});

describe("custom provider CRUD", () => {
  test("adds, updates and removes a custom provider", () => {
    const created = config.addCustomProvider({
      apiKey: "lm-key",
      baseURL: "http://localhost:1234/v1",
      defaultModel: "qwen3",
      label: "LM Studio",
    });
    expect(created.id.startsWith("custom:")).toBe(true);
    expect(created.label).toBe("LM Studio");

    const info = config.getProvidersInfo();
    expect(info.customProviders).toHaveLength(1);
    expect(info.customProviders[0]).toMatchObject({
      hasApiKey: true,
      id: created.id,
      isLocal: true,
      label: "LM Studio",
    });

    const updated = config.updateCustomProvider({
      id: created.id,
      label: "LM Studio local",
    });
    expect(updated.label).toBe("LM Studio local");
    expect(updated.baseURL).toBe("http://localhost:1234/v1");

    config.removeCustomProvider(created.id);
    expect(config.getProvidersInfo().customProviders).toHaveLength(0);
  });

  test("rejects duplicates and invalid input", () => {
    config.addCustomProvider({
      baseURL: "http://10.0.0.5:8000/v1",
      label: "VLLM",
    });
    expect(() =>
      config.addCustomProvider({
        baseURL: "http://10.0.0.6:8000/v1",
        label: "vllm",
      })
    ).toThrow(/already exists/);
    expect(() =>
      config.addCustomProvider({ baseURL: "notaurl", label: "Bad" })
    ).toThrow(/Invalid base URL/);
    expect(() =>
      config.addCustomProvider({ baseURL: "http://x/v1", label: "" })
    ).toThrow(/name is required/);
    expect(() =>
      config.updateCustomProvider({ id: "custom:missing", label: "X" })
    ).toThrow(/not found/);
  });

  test("selecting a custom provider persists and falls back on removal", () => {
    const created = config.addCustomProvider({
      baseURL: "https://llm.example.com/v1",
      defaultModel: "gpt-x",
      label: "Remote",
    });
    config.updateAiSettings({ provider: created.id });
    expect(config.getAiSettings().provider).toBe(created.id);
    expect(config.getAiSettings().model).toBe("gpt-x");

    config.removeCustomProvider(created.id);
    expect(config.getAiSettings().provider).toBe("openai");
  });

  test("rejects selecting an unknown custom id", () => {
    expect(() =>
      config.updateAiSettings({ provider: "custom:does-not-exist" })
    ).toThrow(/Invalid AI provider/);
  });

  test("stores the custom key encrypted and reports hasApiKey", () => {
    const created = config.addCustomProvider({
      baseURL: "https://llm.example.com/v1",
      label: "Keyed",
    });
    expect(config.getProvidersInfo().customProviders[0]?.hasApiKey).toBe(false);
    config.setCustomProviderApiKey(created.id, "secret-1");
    expect(config.getProvidersInfo().customProviders[0]?.hasApiKey).toBe(true);
    expect(config.getApiKey(created.id as never)).toBe("secret-1");
  });
});

describe("checkProviderEndpoint", () => {
  test("prefers /v1/models and falls back to Ollama /api/tags", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("connection refused"))
      .mockResolvedValueOnce({
        json: async () => ({ models: [{ name: "llama3" }] }),
        ok: true,
      });
    vi.stubGlobal("fetch", fetchMock);

    const status = await config.checkProviderEndpoint("http://localhost:11434");
    expect(status).toMatchObject({ endpoint: "api/tags", reachable: true });
    expect(status.models).toEqual([{ id: "llama3", label: "llama3" }]);
  });

  test("reports unreachable when every probe fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("connection refused"))
    );
    const status = await config.checkProviderEndpoint(
      "http://localhost:9999/v1"
    );
    expect(status).toEqual({ endpoint: null, models: [], reachable: false });
  });

  test("rejects invalid URLs", async () => {
    await expect(config.checkProviderEndpoint("notaurl")).rejects.toThrow(
      /Invalid base URL/
    );
  });
});

describe("custom models on custom providers", () => {
  test("adds, lists and removes models on a custom id", () => {
    const created = config.addCustomProvider({
      baseURL: "http://localhost:1234/v1",
      label: "Models",
    });
    config.addCustomModel(created.id, "qwen3:8b");
    config.addCustomModel(created.id, "qwen3:8b");
    let info = config.getProvidersInfo();
    expect(info.customProviders[0]?.customModels).toEqual([
      { id: "qwen3:8b", isCustom: true, label: "qwen3:8b" },
    ]);
    config.removeCustomModel(created.id, "qwen3:8b");
    info = config.getProvidersInfo();
    expect(info.customProviders[0]?.customModels).toEqual([]);
  });

  test("rejects unknown provider refs", () => {
    expect(() => config.addCustomModel("custom:nope", "m")).toThrow(
      /Invalid AI provider/
    );
    expect(() => config.removeCustomModel("nope", "m")).toThrow(
      /Invalid AI provider/
    );
  });
});

describe("legacy sync for custom providers", () => {
  // Importing `@/ipc/ai/config` runs the empty-defaults migration at module
  // load, which marks the shared ai-connections store as migrated. Reset it
  // so this test exercises a real migration. The store instance holds a
  // reference to the map entry, so mutate it in place.
  function resetConnectionStores(): void {
    const connections = mocks.stores.get("ai-connections") as
      | Record<string, unknown>
      | undefined;
    if (connections) {
      for (const key of Object.keys(connections)) {
        delete connections[key];
      }
      Object.assign(connections, {
        connections: [],
        defaultConnectionId: null,
        legacyMigrationVersion: 0,
        version: 0,
      });
    }
    const secrets = mocks.stores.get("ai-connection-secrets") as
      | Record<string, unknown>
      | undefined;
    if (secrets) {
      for (const key of Object.keys(secrets)) {
        delete secrets[key];
      }
      Object.assign(secrets, { values: {} });
    }
  }

  test("maps a selected custom provider onto the default connection", () => {
    resetConnectionStores();
    const legacy = {
      apiKeys: { "custom:abc": "custom-secret" },
      customModels: {},
      customProviders: [
        {
          baseURL: "http://localhost:1234/v1",
          defaultModel: "qwen3",
          id: "custom:abc",
          label: "Local LLM",
        },
      ],
      model: "",
      ollamaBaseURL: "",
      openaiCompatibleBaseURL: "http://localhost:1234/v1",
      provider: "custom:abc",
    };

    const profile = connectionsStore.migrateLegacyAiSettings(legacy);
    expect(profile).toMatchObject({
      baseUrl: "http://localhost:1234/v1",
      defaultModelId: "qwen3",
      id: connectionsStore.DEFAULT_AI_CONNECTION_ID,
      provider: "openai-compatible",
      type: "api",
    });
    expect(connectionsStore.getConnectionApiKey(profile.id)).toBe(
      "custom-secret"
    );
  });

  test("carries custom-added models onto the default connection", () => {
    resetConnectionStores();
    const created = config.addCustomProvider({
      baseURL: "http://localhost:1234/v1",
      defaultModel: "qwen3",
      label: "WithModels",
    });
    config.addCustomModel(created.id, "extra-model");
    config.updateAiSettings({ provider: created.id });

    const profile = connectionsStore.migrateLegacyAiSettings(
      config.getAiSettings()
    );
    expect(profile.models.map((m) => m.id)).toContain("extra-model");
    expect(profile.models.map((m) => m.id)).toContain("qwen3");
  });
});
