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

type ConfigModule = typeof import("@/ipc/ai/config");
type ConnectionsStoreModule = typeof import("@/ipc/ai/connections-store");

let config: ConfigModule;
let connectionsStore: ConnectionsStoreModule;

beforeEach(async () => {
  mocks.stores.clear();
  mocks.stores.set("ai-settings", {
    apiKeys: { "openai-compatible": "legacy-secret" },
    customModels: { "openai-compatible": ["legacy-custom"] },
    model: "legacy-custom",
    ollamaBaseURL: "",
    ollamaDetected: false,
    ollamaModels: [],
    openaiCompatibleBaseURL: "http://localhost:4321/v1",
    privacyPreset: "full",
    privacySettings: {
      connectionInfo: true,
      connectionsList: true,
      memory: true,
      schema: true,
    },
    provider: "openai-compatible",
  });
  vi.resetModules();
  config = await import("@/ipc/ai/config");
  connectionsStore = await import("@/ipc/ai/connections-store");
});

describe("legacy AI config migration", () => {
  test("keeps legacy settings readable and creates the migrated default", () => {
    const settings = config.getAiSettings();
    const defaultConnection = connectionsStore.getDefaultConnection();

    expect(settings).toMatchObject({
      apiKeys: { "openai-compatible": "legacy-secret" },
      customModels: { "openai-compatible": ["legacy-custom"] },
      model: "legacy-custom",
      openaiCompatibleBaseURL: "http://localhost:4321/v1",
      provider: "openai-compatible",
    });
    expect(JSON.stringify(mocks.stores.get("ai-settings"))).not.toContain(
      "legacy-secret"
    );
    expect(defaultConnection).toMatchObject({
      baseUrl: "http://localhost:4321/v1",
      defaultModelId: "legacy-custom",
      id: connectionsStore.DEFAULT_AI_CONNECTION_ID,
      provider: "openai-compatible",
    });
    expect(connectionsStore.listConnections()).toHaveLength(1);
  });

  test("is idempotent and does not expose migrated credentials", () => {
    config.getAiSettings();
    config.getAiSettings();
    const publicInfo = config.getProvidersInfo();

    expect(connectionsStore.listConnections()).toHaveLength(1);
    expect(JSON.stringify(publicInfo)).not.toContain("legacy-secret");
    expect(connectionsStore.getSerializedConnectionMetadata()).not.toContain(
      "legacy-secret"
    );
  });

  test("keeps compatibility writes synchronized with the default profile", () => {
    config.updateAiSettings({
      model: "new-custom",
      openaiCompatibleBaseURL: "http://localhost:9876/v1",
    });
    config.addCustomModel("openai-compatible", "new-custom");
    config.setApiKey("openai-compatible", "new-secret");

    const defaultConnection = connectionsStore.getDefaultConnection();
    expect(defaultConnection).toMatchObject({
      baseUrl: "http://localhost:9876/v1",
      defaultModelId: "new-custom",
    });
    expect(defaultConnection?.models).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "new-custom" })])
    );
    expect(config.getApiKey("openai-compatible")).toBe("new-secret");
    expect(JSON.stringify(mocks.stores.get("ai-settings"))).not.toContain(
      "new-secret"
    );
  });
});
