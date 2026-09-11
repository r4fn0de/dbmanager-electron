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

const LEGACY_BASE_URL = "http://localhost:4321/v1";

beforeEach(async () => {
  mocks.stores.clear();
  mocks.stores.set("ai-settings", {
    apiKeys: { "openai-compatible": "legacy-secret" },
    customModels: { "openai-compatible": ["legacy-custom"] },
    model: "legacy-custom",
    ollamaBaseURL: "",
    ollamaDetected: false,
    ollamaModels: [],
    openaiCompatibleBaseURL: LEGACY_BASE_URL,
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

describe("retired openai-compatible migration", () => {
  test("moves a retired setup onto an equivalent custom provider", () => {
    const settings = config.getAiSettings();
    const [migrated] = settings.customProviders;
    const migratedId = migrated?.id as string;

    expect(migratedId.startsWith("custom:")).toBe(true);
    expect(migrated).toMatchObject({
      baseURL: LEGACY_BASE_URL,
      label: "OpenAI-Compatible",
    });

    // The endpoint, key and custom models all follow the new provider id.
    expect(settings.provider).toBe(migratedId);
    expect(settings.model).toBe("legacy-custom");
    expect(settings.openaiCompatibleBaseURL).toBe(LEGACY_BASE_URL);
    expect(settings.apiKeys).toEqual({ [migratedId]: "legacy-secret" });
    expect(settings.customModels).toEqual({ [migratedId]: ["legacy-custom"] });
    expect(settings.apiKeys["openai-compatible"]).toBeUndefined();
    expect(settings.customModels["openai-compatible"]).toBeUndefined();
  });

  test("keeps the default connection pointing at the same endpoint", () => {
    config.getAiSettings();
    const defaultConnection = connectionsStore.getDefaultConnection();

    // Custom providers are stored as openai-compatible connections, so the
    // connection-layer provider is unchanged by this migration.
    expect(defaultConnection).toMatchObject({
      baseUrl: LEGACY_BASE_URL,
      defaultModelId: "legacy-custom",
      id: connectionsStore.DEFAULT_AI_CONNECTION_ID,
      provider: "openai-compatible",
    });
    expect(connectionsStore.listConnections()).toHaveLength(1);
  });

  test("is idempotent, creates no duplicate and hides the retired entry", () => {
    config.getAiSettings();
    config.getAiSettings();
    const publicInfo = config.getProvidersInfo();

    expect(publicInfo.customProviders).toHaveLength(1);
    expect(publicInfo.providers.map((p) => p.name)).not.toContain(
      "openai-compatible"
    );
    expect(connectionsStore.listConnections()).toHaveLength(1);
    expect(JSON.stringify(publicInfo)).not.toContain("legacy-secret");
    expect(JSON.stringify(mocks.stores.get("ai-settings"))).not.toContain(
      "legacy-secret"
    );
    expect(connectionsStore.getSerializedConnectionMetadata()).not.toContain(
      "legacy-secret"
    );
  });

  test("keeps compatibility writes synchronized with the default profile", () => {
    const migratedId = config.getAiSettings().customProviders[0]?.id as string;

    config.updateAiSettings({ model: "new-custom" });
    config.addCustomModel(migratedId, "new-custom");
    config.setCustomProviderApiKey(migratedId, "new-secret");

    const defaultConnection = connectionsStore.getDefaultConnection();
    expect(defaultConnection).toMatchObject({
      baseUrl: LEGACY_BASE_URL,
      defaultModelId: "new-custom",
    });
    expect(defaultConnection?.models).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "new-custom" })])
    );
    expect(config.getApiKey(migratedId as never)).toBe("new-secret");
    expect(JSON.stringify(mocks.stores.get("ai-settings"))).not.toContain(
      "new-secret"
    );
  });

  test("falls back to the default provider when there is no usable endpoint", async () => {
    const settings = mocks.stores.get("ai-settings") ?? {};
    mocks.stores.set("ai-settings", {
      ...settings,
      openaiCompatibleBaseURL: "",
    });

    // The migration runs at module load, so it has to be re-imported against
    // the edited store rather than mutated after the fact.
    vi.resetModules();
    const freshConfig = await import("@/ipc/ai/config");
    const next = freshConfig.getAiSettings();

    expect(next.provider).toBe("openai");
    expect(next.customProviders).toHaveLength(0);
    expect(next.apiKeys["openai-compatible"]).toBeUndefined();
  });
});
