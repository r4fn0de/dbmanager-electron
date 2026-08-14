import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const stores = new Map<string, Record<string, unknown>>();
  const createModel = (provider: string) =>
    vi.fn((modelId: string) => ({ modelId, provider }));
  const providerMocks = {
    createAnthropic: vi.fn((options: Record<string, unknown>) => {
      const providerModel = createModel("anthropic");
      return Object.assign(providerModel, { options });
    }),
    createGoogleGenerativeAI: vi.fn((options: Record<string, unknown>) => {
      const providerModel = createModel("google");
      return Object.assign(providerModel, { options });
    }),
    createOpenAI: vi.fn((options: Record<string, unknown>) => {
      const providerModel = createModel("openai");
      return Object.assign(providerModel, { options });
    }),
    createOpenAICompatible: vi.fn((options: Record<string, unknown>) => ({
      chatModel: createModel(String(options.name)),
    })),
  };

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

  return { MockStore, providerMocks, stores };
});

vi.mock("electron-store", () => ({ default: mocks.MockStore }));
vi.mock("electron", () => ({
  safeStorage: {
    decryptString: (value: Buffer) => value.toString(),
    encryptString: (value: string) => Buffer.from(value),
    isEncryptionAvailable: () => true,
  },
}));
vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: mocks.providerMocks.createAnthropic,
}));
vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: mocks.providerMocks.createGoogleGenerativeAI,
}));
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: mocks.providerMocks.createOpenAI,
}));
vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: mocks.providerMocks.createOpenAICompatible,
}));
vi.mock("ai", () => ({
  generateText: vi.fn(),
  streamText: vi.fn(),
}));

type AdapterModule = typeof import("@/ipc/ai/adapters/api-provider-adapter");
type ConnectionsStoreModule = typeof import("@/ipc/ai/connections-store");

type ApiProvider =
  | "anthropic"
  | "google"
  | "ollama"
  | "openai"
  | "openai-compatible";

let adapter: AdapterModule;
let connectionsStore: ConnectionsStoreModule;

function makeModel(
  id: string,
  capabilities: ("files" | "reasoning" | "terminal" | "tools")[] = []
) {
  return {
    capabilities,
    displayName: id,
    id,
    isCustom: true,
    isFavorite: false,
  } as const;
}

function createApiConnection(
  provider: ApiProvider,
  options: { apiKey?: string; baseUrl?: string; modelId?: string } = {}
) {
  const modelId = options.modelId ?? `${provider}-model`;
  return connectionsStore.createConnection({
    ...(options.apiKey ? { apiKey: options.apiKey } : {}),
    ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
    capabilities: ["tools"],
    defaultModelId: modelId,
    models: [makeModel(modelId, ["reasoning"])],
    name: `${provider} connection`,
    provider,
  });
}

beforeEach(async () => {
  mocks.stores.clear();
  vi.clearAllMocks();
  vi.resetModules();
  connectionsStore = await import("@/ipc/ai/connections-store");
  adapter = await import("@/ipc/ai/adapters/api-provider-adapter");
});

describe("ApiProviderAdapter", () => {
  test.each([
    ["openai", "https://openai.example/v1", "openai-secret"],
    ["anthropic", "https://anthropic.example/v1", "anthropic-secret"],
    ["google", "https://google.example/v1", "google-secret"],
  ] as const)(
    "constructs a %s model from its connection profile",
    (provider, baseUrl, apiKey) => {
      const connection = createApiConnection(provider, { apiKey, baseUrl });

      const resolved = new adapter.ApiProviderAdapter().resolveModel({
        connectionId: connection.id,
      });

      expect(resolved.connectionId).toBe(connection.id);
      expect(resolved.modelId).toBe(`${provider}-model`);
      expect(resolved.capabilities).toEqual(["tools", "reasoning"]);

      let factory = mocks.providerMocks.createGoogleGenerativeAI;
      if (provider === "openai") {
        factory = mocks.providerMocks.createOpenAI;
      } else if (provider === "anthropic") {
        factory = mocks.providerMocks.createAnthropic;
      }
      expect(factory).toHaveBeenCalledWith({ apiKey, baseURL: baseUrl });
    }
  );

  test("constructs Ollama and OpenAI-compatible models from per-connection URLs", () => {
    const ollama = createApiConnection("ollama", {
      baseUrl: "http://ollama.example",
    });
    const compatible = createApiConnection("openai-compatible", {
      apiKey: "compatible-secret",
      baseUrl: "https://profile.example/v1",
    });
    const instance = new adapter.ApiProviderAdapter();

    instance.resolveModel({ connectionId: ollama.id });
    instance.resolveModel({ connectionId: compatible.id });

    expect(mocks.providerMocks.createOpenAICompatible).toHaveBeenNthCalledWith(
      1,
      {
        apiKey: "ollama",
        baseURL: "http://ollama.example/v1",
        name: "ollama",
      }
    );
    expect(mocks.providerMocks.createOpenAICompatible).toHaveBeenNthCalledWith(
      2,
      {
        apiKey: "compatible-secret",
        baseURL: "https://profile.example/v1",
        name: "openai-compatible",
      }
    );
  });

  test("never reads the legacy global URL for a custom OpenAI-compatible profile", () => {
    mocks.stores.set("ai-settings", {
      openaiCompatibleBaseURL: "https://legacy.example/v1",
    });
    const connection = createApiConnection("openai-compatible", {
      baseUrl: "https://profile.example/v1",
    });

    new adapter.ApiProviderAdapter().resolveModel({
      connectionId: connection.id,
    });

    expect(mocks.providerMocks.createOpenAICompatible).toHaveBeenCalledWith({
      baseURL: "https://profile.example/v1",
      name: "openai-compatible",
    });
    expect(
      mocks.providerMocks.createOpenAICompatible.mock.calls[0]?.[0]
    ).not.toMatchObject({ baseURL: "https://legacy.example/v1" });
  });

  test("rejects missing credentials before creating a provider model", () => {
    const connection = createApiConnection("openai", {
      baseUrl: "https://openai.example/v1",
    });

    expect(() =>
      new adapter.ApiProviderAdapter().resolveModel({
        connectionId: connection.id,
      })
    ).toThrow("API key not configured");
    expect(mocks.providerMocks.createOpenAI).not.toHaveBeenCalled();
  });

  test("rejects invalid URLs and models before creating a provider model", () => {
    const connection = createApiConnection("openai-compatible", {
      baseUrl: "https://profile.example/v1",
    });
    const stored = mocks.stores.get("ai-connections") as {
      connections: Array<{ profile: { baseUrl?: string } }>;
    };
    const instance = new adapter.ApiProviderAdapter();
    expect(() =>
      instance.resolveModel({
        connectionId: connection.id,
        modelId: "missing-model",
      })
    ).toThrow("is not available");

    const firstConnection = stored.connections.at(0);
    if (!firstConnection) {
      throw new Error("Expected a stored AI connection");
    }
    const { profile } = firstConnection;
    profile.baseUrl = "ftp://profile.example/v1";
    expect(() =>
      instance.resolveModel({ connectionId: connection.id })
    ).toThrow("Invalid base URL");
    expect(mocks.providerMocks.createOpenAICompatible).not.toHaveBeenCalled();
  });

  test("returns public model metadata without credentials", async () => {
    const secret = "profile-secret";
    const connection = createApiConnection("openai-compatible", {
      apiKey: secret,
      baseUrl: "https://profile.example/v1",
    });
    const instance = new adapter.ApiProviderAdapter();
    const resolved = instance.resolveModel({ connectionId: connection.id });
    const listed = await instance.listModels(connection.id);

    expect(resolved.connection).not.toHaveProperty("apiKey");
    expect(resolved).not.toHaveProperty("apiKey");
    expect(listed).not.toContainEqual(
      expect.objectContaining({ apiKey: secret })
    );
    expect(JSON.stringify(resolved.connection)).not.toContain(secret);
    expect(instance.getCapabilities(connection.id)).toEqual([
      "tools",
      "reasoning",
    ]);
  });

  test("keeps getCurrentModel as a wrapper around the migrated default profile", async () => {
    mocks.stores.set("ai-settings", {
      apiKeys: { openai: "legacy-secret" },
      customModels: {},
      model: "gpt-4o-mini",
      ollamaBaseURL: "",
      ollamaModels: [],
      openaiCompatibleBaseURL: "https://legacy.example/v1",
      provider: "openai",
    });
    vi.resetModules();
    const config = await import("@/ipc/ai/config");

    config.getCurrentModel();

    expect(mocks.providerMocks.createOpenAI).toHaveBeenCalledWith({
      apiKey: "legacy-secret",
    });
  });
});
