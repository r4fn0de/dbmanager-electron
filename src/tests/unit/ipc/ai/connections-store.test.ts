import { beforeEach, describe, expect, test, vi } from "vitest";

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

type ConnectionsStoreModule = typeof import("@/ipc/ai/connections-store");

let connectionsStore: ConnectionsStoreModule;

beforeEach(async () => {
  mocks.stores.clear();
  vi.resetModules();
  connectionsStore = await import("@/ipc/ai/connections-store");
});

describe("AI connections store", () => {
  test("migrates legacy settings into one stable default profile", () => {
    const legacy = {
      apiKeys: { "openai-compatible": "sk-local-secret" },
      customModels: { "openai-compatible": ["custom-a", "custom-b"] },
      model: "custom-a",
      ollamaBaseURL: "",
      openaiCompatibleBaseURL: "http://localhost:1234/v1",
      provider: "openai-compatible",
    };

    const first = connectionsStore.migrateLegacyAiSettings(legacy);
    const second = connectionsStore.migrateLegacyAiSettings(legacy);

    expect(first).toMatchObject({
      baseUrl: legacy.openaiCompatibleBaseURL,
      defaultModelId: legacy.model,
      id: connectionsStore.DEFAULT_AI_CONNECTION_ID,
      provider: "openai-compatible",
      type: "api",
    });
    expect(first.models.map((model) => model.id)).toEqual([
      "custom-a",
      "custom-b",
    ]);
    expect(second.id).toBe(first.id);
    expect(connectionsStore.listConnections()).toHaveLength(1);
    expect(connectionsStore.getConnectionApiKey(first.id)).toBe(
      "sk-local-secret"
    );
    expect(connectionsStore.getSerializedConnectionMetadata()).not.toContain(
      "sk-local-secret"
    );
    expect(JSON.stringify(first)).not.toContain("sk-local-secret");
  });

  test("keeps model defaults and favorites scoped to each profile", () => {
    const first = connectionsStore.createConnection({
      baseUrl: "http://localhost:1234/v1",
      defaultModelId: "first-model",
      models: [
        {
          capabilities: [],
          displayName: "First model",
          id: "first-model",
          isCustom: true,
          isFavorite: false,
        },
      ],
      name: "Local one",
      provider: "openai-compatible",
    });
    const second = connectionsStore.createConnection({
      baseUrl: "http://localhost:5678/v1",
      defaultModelId: "second-model",
      models: [
        {
          capabilities: [],
          displayName: "Second model",
          id: "second-model",
          isCustom: true,
          isFavorite: true,
        },
      ],
      name: "Local two",
      provider: "openai-compatible",
    });

    connectionsStore.setConnectionModels(first.id, [
      {
        capabilities: [],
        displayName: "First model",
        id: "first-model",
        isCustom: true,
        isFavorite: true,
      },
    ]);
    connectionsStore.setDefaultModel(first.id, "first-model");

    expect(connectionsStore.getConnection(first.id)).toMatchObject({
      baseUrl: "http://localhost:1234/v1",
      defaultModelId: "first-model",
      models: [{ id: "first-model", isFavorite: true }],
    });
    expect(connectionsStore.getConnection(second.id)).toMatchObject({
      baseUrl: "http://localhost:5678/v1",
      defaultModelId: "second-model",
      models: [{ id: "second-model", isFavorite: true }],
    });
  });

  test("deleting one profile removes only its credential", () => {
    const first = connectionsStore.createConnection({
      apiKey: "first-secret",
      baseUrl: "http://localhost:1234/v1",
      name: "First",
      provider: "openai-compatible",
    });
    const second = connectionsStore.createConnection({
      apiKey: "second-secret",
      baseUrl: "http://localhost:5678/v1",
      name: "Second",
      provider: "openai-compatible",
    });

    connectionsStore.deleteConnection(first.id);

    expect(connectionsStore.getConnection(first.id)).toBeUndefined();
    expect(connectionsStore.getConnectionApiKey(second.id)).toBe(
      "second-secret"
    );
  });
});
