import { beforeEach, describe, expect, test, vi } from "vitest";
import type {
  AiApiConnection,
  AiCliAgentConnection,
  AiModel,
} from "@/shared/ai/connection-contracts";

const mocks = vi.hoisted(() => ({
  apiAdapter: {
    authenticate: vi.fn(),
    listModels: vi.fn(),
  },
  connectionStore: {
    createConnection: vi.fn(),
    deleteConnection: vi.fn(),
    getConnection: vi.fn(),
    listConnections: vi.fn(),
    setConnectionModels: vi.fn(),
    setDefaultModel: vi.fn(),
    updateConnection: vi.fn(),
  },
}));

vi.mock("@/ipc/ai/connections-store", () => ({
  createConnection: mocks.connectionStore.createConnection,
  deleteConnection: mocks.connectionStore.deleteConnection,
  getConnection: mocks.connectionStore.getConnection,
  listConnections: mocks.connectionStore.listConnections,
  setConnectionModels: mocks.connectionStore.setConnectionModels,
  setDefaultModel: mocks.connectionStore.setDefaultModel,
  updateConnection: mocks.connectionStore.updateConnection,
}));

vi.mock("@/ipc/ai/adapters/api-provider-adapter", () => ({
  getApiProviderAdapter: () => mocks.apiAdapter,
}));

import {
  aiCreateConnection,
  aiDeleteConnection,
  aiDiscoverModels,
  aiGetConnection,
  aiListConnectionModels,
  aiListConnections,
  aiSetConnectionModels,
  aiSetDefaultModel,
  aiTestConnection,
  aiUpdateConnection,
  createAiConnectionInputSchema,
} from "@/ipc/ai/connection-handlers";

interface HandlerContext {
  context: unknown;
  input: unknown;
}

type Handler = (context: HandlerContext) => Promise<unknown>;

function getHandler(procedure: unknown): Handler {
  const orpc = (procedure as Record<string, unknown>)["~orpc"];
  if (
    !orpc ||
    typeof (orpc as Record<string, unknown>).handler !== "function"
  ) {
    throw new Error("Could not extract handler from oRPC procedure.");
  }
  return (orpc as Record<string, unknown>).handler as Handler;
}

function makeModel(id: string): AiModel {
  return {
    capabilities: ["tools"],
    displayName: id,
    id,
    isCustom: true,
    isFavorite: false,
  };
}

function makeApiConnection(id = "api-1"): AiApiConnection {
  return {
    authStatus: "authenticated",
    baseUrl: "https://api.example/v1",
    capabilities: ["tools"],
    defaultModelId: "model-a",
    id,
    models: [makeModel("model-a")],
    name: "API connection",
    provider: "openai-compatible",
    type: "api",
  };
}

function makeCliConnection(id = "cli-1"): AiCliAgentConnection {
  return {
    authStatus: "not-configured",
    capabilities: [],
    id,
    models: [makeModel("cli-model")],
    name: "CLI connection",
    provider: "codex",
    type: "cli-agent",
  };
}

const context = { context: {}, input: {} };

describe("AI connection oRPC handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("lists and gets public connection profiles", async () => {
    const apiConnection = makeApiConnection();
    const cliConnection = makeCliConnection();
    mocks.connectionStore.listConnections.mockReturnValue([
      apiConnection,
      cliConnection,
    ]);
    mocks.connectionStore.getConnection.mockReturnValue(apiConnection);

    const list = await getHandler(aiListConnections)(context);
    const get = await getHandler(aiGetConnection)({
      context: {},
      input: { connectionId: apiConnection.id },
    });

    expect(list).toEqual([apiConnection, cliConnection]);
    expect(get).toEqual(apiConnection);
    expect(JSON.stringify(list)).not.toContain("apiKey");
    expect(mocks.connectionStore.getConnection).toHaveBeenCalledWith(
      apiConnection.id
    );
  });

  test("creates, updates, and deletes connections without returning secrets", async () => {
    const apiConnection = makeApiConnection();
    const createInput = {
      apiKey: "never-return-this-secret",
      baseUrl: "https://api.example/v1",
      defaultModelId: "model-a",
      name: "API connection",
      provider: "openai-compatible" as const,
    };
    mocks.connectionStore.createConnection.mockReturnValue(apiConnection);
    mocks.connectionStore.updateConnection.mockReturnValue({
      ...apiConnection,
      name: "Renamed connection",
    });

    const created = await getHandler(aiCreateConnection)({
      context: {},
      input: createInput,
    });
    const updated = await getHandler(aiUpdateConnection)({
      context: {},
      input: {
        connectionId: apiConnection.id,
        patch: { name: "Renamed connection" },
      },
    });
    const deleted = await getHandler(aiDeleteConnection)({
      context: {},
      input: { connectionId: apiConnection.id },
    });

    expect(created).toEqual(apiConnection);
    expect(updated).toMatchObject({ name: "Renamed connection" });
    expect(deleted).toEqual({ success: true });
    expect(JSON.stringify(created)).not.toContain("never-return-this-secret");
    expect(mocks.connectionStore.createConnection).toHaveBeenCalledWith(
      createInput
    );
    expect(mocks.connectionStore.updateConnection).toHaveBeenCalledWith(
      apiConnection.id,
      { name: "Renamed connection" }
    );
    expect(mocks.connectionStore.deleteConnection).toHaveBeenCalledWith(
      apiConnection.id
    );
  });

  test("updates the default model and saved model catalog", async () => {
    const apiConnection = makeApiConnection();
    const nextConnection = {
      ...apiConnection,
      defaultModelId: "model-b",
      models: [makeModel("model-b")],
    };
    mocks.connectionStore.setDefaultModel.mockReturnValue(nextConnection);
    mocks.connectionStore.setConnectionModels.mockReturnValue(nextConnection);
    mocks.connectionStore.getConnection.mockReturnValue(nextConnection);

    const defaultModel = await getHandler(aiSetDefaultModel)({
      context: {},
      input: { connectionId: apiConnection.id, modelId: "model-b" },
    });
    const savedModels = await getHandler(aiSetConnectionModels)({
      context: {},
      input: { connectionId: apiConnection.id, models: [makeModel("model-b")] },
    });
    const listedModels = await getHandler(aiListConnectionModels)({
      context: {},
      input: { connectionId: apiConnection.id },
    });

    expect(defaultModel).toEqual(nextConnection);
    expect(savedModels).toEqual(nextConnection);
    expect(listedModels).toEqual({
      connectionId: apiConnection.id,
      models: [makeModel("model-b")],
    });
    expect(mocks.connectionStore.setDefaultModel).toHaveBeenCalledWith(
      apiConnection.id,
      "model-b"
    );
    expect(mocks.connectionStore.setConnectionModels).toHaveBeenCalledWith(
      apiConnection.id,
      [makeModel("model-b")]
    );
  });

  test("tests and discovers models only for API connections", async () => {
    const apiConnection = makeApiConnection();
    const discoveredModels = [makeModel("discovered-model")];
    mocks.connectionStore.getConnection.mockReturnValue(apiConnection);
    mocks.apiAdapter.authenticate.mockResolvedValue({
      message: "Connection is ready",
      status: "authenticated",
    });
    mocks.apiAdapter.listModels.mockResolvedValue(discoveredModels);

    const testResult = await getHandler(aiTestConnection)({
      context: {},
      input: { connectionId: apiConnection.id },
    });
    const discoveryResult = await getHandler(aiDiscoverModels)({
      context: {},
      input: { connectionId: apiConnection.id },
    });

    expect(testResult).toEqual({
      connectionId: apiConnection.id,
      message: "Connection is ready",
      status: "authenticated",
    });
    expect(discoveryResult).toEqual({
      connectionId: apiConnection.id,
      models: discoveredModels,
    });
    expect(mocks.apiAdapter.authenticate).toHaveBeenCalledWith(
      apiConnection.id
    );
    expect(mocks.apiAdapter.listModels).toHaveBeenCalledWith(apiConnection.id);
  });

  test("rejects CLI connections for test and discovery procedures", async () => {
    const cliConnection = makeCliConnection();
    mocks.connectionStore.getConnection.mockReturnValue(cliConnection);

    await expect(
      getHandler(aiTestConnection)({
        context: {},
        input: { connectionId: cliConnection.id },
      })
    ).rejects.toMatchObject({ code: "METHOD_NOT_SUPPORTED" });
    await expect(
      getHandler(aiDiscoverModels)({
        context: {},
        input: { connectionId: cliConnection.id },
      })
    ).rejects.toMatchObject({ code: "METHOD_NOT_SUPPORTED" });

    expect(mocks.apiAdapter.authenticate).not.toHaveBeenCalled();
    expect(mocks.apiAdapter.listModels).not.toHaveBeenCalled();
  });

  test("maps missing connections and store failures to ORPC errors", async () => {
    mocks.connectionStore.getConnection.mockReturnValue(undefined);
    let missingError: unknown;
    try {
      await getHandler(aiGetConnection)({
        context: {},
        input: { connectionId: "missing" },
      });
    } catch (error) {
      missingError = error;
    }
    expect((missingError as { code?: unknown }).code).toBe("NOT_FOUND");

    mocks.connectionStore.listConnections.mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    let storageError: unknown;
    try {
      await getHandler(aiListConnections)(context);
    } catch (error) {
      storageError = error;
    }
    expect((storageError as { code?: unknown }).code).toBe("BAD_REQUEST");
    expect((storageError as { message?: unknown }).message).toBe(
      "storage unavailable"
    );
  });

  test("validates provider input with Zod", () => {
    expect(() =>
      createAiConnectionInputSchema.parse({ provider: "unknown-provider" })
    ).toThrow();
    expect(() =>
      createAiConnectionInputSchema.parse({
        provider: "openai",
        workspacePath: "relative/path",
      })
    ).toThrow();
  });
});
