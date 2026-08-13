import { describe, expect, test } from "vitest";
import {
  AI_API_PROVIDERS,
  AI_CLI_AGENT_PROVIDERS,
  AI_CONNECTION_PROVIDERS,
  AI_MODEL_CAPABILITIES,
  AI_PERMISSION_SCOPES,
  aiConnectionSchema,
  aiModelSchema,
  aiSessionScopeSchema,
} from "@/shared/ai/connection-contracts";
import type {
  AiChatDonePayload,
  ChatStartInput,
} from "@/shared/ai/streaming-contracts";

const model = {
  capabilities: ["tools", "reasoning"] as const,
  displayName: "Example model",
  id: "model-1",
  isCustom: false,
  isFavorite: true,
};

const apiConnection = {
  authStatus: "authenticated" as const,
  baseUrl: "https://api.example.com/v1",
  capabilities: ["tools", "reasoning"] as const,
  id: "connection-api",
  models: [model],
  name: "Example API",
  provider: "openai" as const,
  type: "api" as const,
};

const cliConnection = {
  authStatus: "not-configured" as const,
  capabilities: ["tools", "terminal", "files"] as const,
  executablePath: "opencode",
  id: "connection-cli",
  models: [model],
  name: "Local agent",
  provider: "opencode" as const,
  type: "cli-agent" as const,
  workspacePath: "/Users/example/project",
};

describe("AI connection contracts", () => {
  test("accepts API and CLI connection discriminated unions", () => {
    expect(aiConnectionSchema.parse(apiConnection)).toMatchObject(
      apiConnection
    );
    expect(aiConnectionSchema.parse(cliConnection)).toMatchObject(
      cliConnection
    );
  });

  test("supports every planned provider", () => {
    expect(AI_CONNECTION_PROVIDERS).toEqual([
      ...AI_API_PROVIDERS,
      ...AI_CLI_AGENT_PROVIDERS,
    ]);

    for (const provider of AI_API_PROVIDERS) {
      expect(
        aiConnectionSchema.parse({
          ...apiConnection,
          id: `api-${provider}`,
          provider,
        })
      ).toMatchObject({ provider, type: "api" });
    }

    for (const provider of AI_CLI_AGENT_PROVIDERS) {
      expect(
        aiConnectionSchema.parse({
          ...cliConnection,
          id: `cli-${provider}`,
          provider,
        })
      ).toMatchObject({ provider, type: "cli-agent" });
    }
  });

  test("validates model display metadata, flags, and capabilities", () => {
    const parsed = aiModelSchema.parse(model);

    expect(parsed).toMatchObject({
      capabilities: ["tools", "reasoning"],
      displayName: "Example model",
      id: "model-1",
      isCustom: false,
      isFavorite: true,
    });
    expect(AI_MODEL_CAPABILITIES).toEqual([
      "tools",
      "terminal",
      "files",
      "reasoning",
    ]);
  });

  test("does not accept raw secrets in public connection profiles", () => {
    expect(() =>
      aiConnectionSchema.parse({
        ...apiConnection,
        apiKey: "sk-do-not-expose",
      })
    ).toThrow();

    expect(aiConnectionSchema.parse(apiConnection)).not.toHaveProperty(
      "apiKey"
    );
    expect(aiConnectionSchema.parse(apiConnection)).not.toHaveProperty("token");
  });

  test("rejects invalid providers and unknown capabilities", () => {
    expect(() =>
      aiConnectionSchema.parse({
        ...apiConnection,
        provider: "unknown-provider",
      })
    ).toThrow();

    expect(() =>
      aiConnectionSchema.parse({
        ...cliConnection,
        provider: "openai",
      })
    ).toThrow();

    expect(() =>
      aiModelSchema.parse({
        ...model,
        capabilities: ["tools", "unknown-capability"],
      })
    ).toThrow();
  });

  test("rejects empty IDs", () => {
    expect(() => aiModelSchema.parse({ ...model, id: "" })).toThrow();
    expect(() =>
      aiConnectionSchema.parse({ ...apiConnection, id: "   " })
    ).toThrow();
    expect(() =>
      aiSessionScopeSchema.parse({
        connectionId: "connection-1",
        conversationId: "conversation-1",
        modelId: "",
        permissions: [],
      })
    ).toThrow();
  });

  test("validates session scope and permission categories", () => {
    const scope = aiSessionScopeSchema.parse({
      connectionId: "connection-1",
      conversationId: "conversation-1",
      modelId: "model-1",
      permissions: AI_PERMISSION_SCOPES,
      workspacePath: "/Users/example/project",
    });

    expect(scope).toMatchObject({
      connectionId: "connection-1",
      conversationId: "conversation-1",
      modelId: "model-1",
      permissions: [
        "database",
        "editor",
        "workspace",
        "terminal",
        "credentials",
      ],
      workspacePath: "/Users/example/project",
    });
  });

  test("rejects relative, traversing, and empty workspace paths", () => {
    for (const workspacePath of [
      "project",
      "../project",
      "/Users/example/../outside",
      "",
    ]) {
      expect(() =>
        aiSessionScopeSchema.parse({
          connectionId: "connection-1",
          conversationId: "conversation-1",
          modelId: "model-1",
          permissions: [],
          workspacePath,
        })
      ).toThrow();
    }
  });

  test("keeps connection and session metadata optional in streaming contracts", () => {
    const input: ChatStartInput = {
      aiConnectionId: "connection-1",
      chatId: "chat-1",
      connectionId: null,
      dbType: "postgresql",
      messages: [],
      modelId: "model-1",
      sessionMetadata: {
        connectionId: "connection-1",
        modelId: "model-1",
        sessionId: "session-1",
        source: "cli-agent",
      },
    };
    const done: AiChatDonePayload = {
      chatId: input.chatId,
      connectionId: "connection-1",
      modelId: "model-1",
      sessionId: "session-1",
      source: "cli-agent",
    };

    expect(input.sessionMetadata?.sessionId).toBe("session-1");
    expect(done.source).toBe("cli-agent");
  });
});
