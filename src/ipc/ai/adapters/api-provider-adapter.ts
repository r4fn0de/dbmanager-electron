import { randomUUID } from "node:crypto";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel, ModelMessage } from "ai";
import { generateText, streamText } from "ai";
import type {
  AgentInstallation,
  AgentMessage,
  AgentResponse,
  AgentSession,
  AiProviderAdapter,
  AuthResult,
  StartSessionInput,
} from "@/ipc/ai/adapters/types";
import {
  getConnection,
  getConnectionApiKey,
  getDefaultConnectionId,
} from "@/ipc/ai/connections-store";
import type {
  AiApiConnection,
  AiConnection,
  AiModel,
  AiModelCapability,
} from "@/shared/ai/connection-contracts";

const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434/v1";
const REQUIRED_API_KEY_PROVIDERS = new Set<AiApiConnection["provider"]>([
  "openai",
  "anthropic",
  "google",
]);

interface ApiSession extends AgentSession {
  model: LanguageModel;
}

export interface ResolveApiModelInput {
  connectionId?: string;
  modelId?: string;
}

export interface ResolvedApiModel {
  capabilities: AiModelCapability[];
  connection: AiApiConnection;
  connectionId: string;
  model: LanguageModel;
  modelId: string;
  modelInfo: AiModel;
}

export interface GenerateApiModelInput extends ResolveApiModelInput {
  prompt: string;
}

function isApiConnection(
  connection: AiConnection | undefined
): connection is AiApiConnection {
  return connection?.type === "api";
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function normalizeModelId(
  modelId: string | undefined,
  connection: AiApiConnection
): string {
  const resolved = modelId?.trim() || connection.defaultModelId?.trim();
  if (!resolved) {
    throw new Error(
      `No model is configured for AI connection '${connection.name}'. Select or add a model before starting a request.`
    );
  }
  return resolved;
}

function getModelInfo(connection: AiApiConnection, modelId: string): AiModel {
  const model = connection.models.find((candidate) => candidate.id === modelId);
  if (!model) {
    throw new Error(
      `Model '${modelId}' is not available for AI connection '${connection.name}'. Select a model from this connection's catalog.`
    );
  }
  return model;
}

function mergeCapabilities(
  connection: AiApiConnection,
  model: AiModel
): AiModelCapability[] {
  return [...new Set([...connection.capabilities, ...model.capabilities])];
}

function getApiConnection(connectionId?: string): {
  connection: AiApiConnection;
  connectionId: string;
} {
  const resolvedConnectionId = connectionId?.trim() || getDefaultConnectionId();
  if (!resolvedConnectionId) {
    throw new Error(
      "No AI connection is configured. Create an AI connection in Settings → AI."
    );
  }

  const connection = getConnection(resolvedConnectionId);
  if (!connection) {
    throw new Error(`AI connection '${resolvedConnectionId}' was not found.`);
  }
  if (!isApiConnection(connection)) {
    throw new Error(
      `AI connection '${resolvedConnectionId}' is a CLI agent and cannot be used with an API provider adapter.`
    );
  }

  return { connection, connectionId: resolvedConnectionId };
}

function getBaseUrl(connection: AiApiConnection): string | undefined {
  const configured = connection.baseUrl?.trim();
  if (configured && !isValidHttpUrl(configured)) {
    throw new Error(
      `Invalid base URL for AI connection '${connection.name}'. Use a valid http(s) URL without credentials.`
    );
  }

  if (connection.provider === "openai-compatible" && !configured) {
    throw new Error(
      `Base URL is required for OpenAI-compatible AI connection '${connection.name}'.`
    );
  }

  if (connection.provider === "ollama") {
    if (!configured) {
      return DEFAULT_OLLAMA_BASE_URL;
    }
    return configured.endsWith("/v1") ? configured : `${configured}/v1`;
  }

  return configured;
}

function getApiKey(connectionId: string, connection: AiApiConnection): string {
  const apiKey = getConnectionApiKey(connectionId).trim();
  if (REQUIRED_API_KEY_PROVIDERS.has(connection.provider) && !apiKey) {
    throw new Error(
      `API key not configured for ${connection.name}. Set it in Settings → AI before starting a request.`
    );
  }
  return apiKey;
}

function createModel(
  connection: AiApiConnection,
  apiKey: string,
  modelId: string,
  baseURL: string | undefined
): LanguageModel {
  switch (connection.provider) {
    case "openai": {
      const provider = createOpenAI({
        ...(apiKey ? { apiKey } : {}),
        ...(baseURL ? { baseURL } : {}),
      });
      return provider(modelId);
    }
    case "anthropic": {
      const provider = createAnthropic({
        ...(apiKey ? { apiKey } : {}),
        ...(baseURL ? { baseURL } : {}),
      });
      return provider(modelId);
    }
    case "google": {
      const provider = createGoogleGenerativeAI({
        ...(apiKey ? { apiKey } : {}),
        ...(baseURL ? { baseURL } : {}),
      });
      return provider(modelId);
    }
    case "openai-compatible": {
      const provider = createOpenAICompatible({
        ...(apiKey ? { apiKey } : {}),
        baseURL: baseURL as string,
        name: "openai-compatible",
      });
      return provider.chatModel(modelId);
    }
    case "ollama": {
      const provider = createOpenAICompatible({
        apiKey: "ollama",
        baseURL: baseURL as string,
        name: "ollama",
      });
      return provider.chatModel(modelId);
    }
    default:
      throw new Error(`Unsupported API provider '${connection.provider}'.`);
  }
}

function toUsage(usage: {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}): AgentResponse["usage"] {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
  };
}

/** Resolves API connection profiles without exposing their stored credentials. */
export class ApiProviderAdapter implements AiProviderAdapter {
  private readonly sessions = new Map<string, ApiSession>();
  private readonly abortControllers = new Map<string, AbortController>();

  authenticate(connectionId: string): Promise<AuthResult> {
    const { connection } = getApiConnection(connectionId);
    getBaseUrl(connection);

    try {
      getApiKey(connectionId, connection);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("API key not configured")
      ) {
        return Promise.resolve({
          message: error.message,
          status: "not-configured",
        });
      }
      throw error;
    }

    return Promise.resolve({ status: "authenticated" });
  }

  detect(): Promise<AgentInstallation> {
    return Promise.resolve({ detected: true });
  }

  async dispose(sessionId: string): Promise<void> {
    await this.abort(sessionId);
    this.sessions.delete(sessionId);
  }

  getCapabilities(connectionId: string, modelId?: string): AiModelCapability[] {
    const { connection } = getApiConnection(connectionId);
    if (!(modelId || connection.defaultModelId)) {
      return [...connection.capabilities];
    }
    const resolvedModelId = normalizeModelId(modelId, connection);
    return mergeCapabilities(
      connection,
      getModelInfo(connection, resolvedModelId)
    );
  }

  listModels(connectionId: string): Promise<AiModel[]> {
    const { connection } = getApiConnection(connectionId);
    return Promise.resolve(
      connection.models.map((model) => ({
        ...model,
        capabilities: [...model.capabilities],
      }))
    );
  }

  resolveModel(input: ResolveApiModelInput): ResolvedApiModel;
  resolveModel(connectionId: string, modelId?: string): ResolvedApiModel;
  resolveModel(
    inputOrConnectionId: ResolveApiModelInput | string,
    modelId?: string
  ): ResolvedApiModel {
    const input: ResolveApiModelInput =
      typeof inputOrConnectionId === "string"
        ? { connectionId: inputOrConnectionId, modelId }
        : inputOrConnectionId;
    const { connection, connectionId } = getApiConnection(input.connectionId);
    const resolvedModelId = normalizeModelId(input.modelId, connection);
    const modelInfo = getModelInfo(connection, resolvedModelId);
    const capabilities = mergeCapabilities(connection, modelInfo);
    const baseURL = getBaseUrl(connection);
    const apiKey = getApiKey(connectionId, connection);

    return {
      capabilities,
      connection,
      connectionId,
      model: createModel(connection, apiKey, resolvedModelId, baseURL),
      modelId: resolvedModelId,
      modelInfo,
    };
  }

  async send(sessionId: string, input: AgentMessage): Promise<AgentResponse> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`AI adapter session '${sessionId}' was not found.`);
    }

    const abortController = new AbortController();
    this.abortControllers.set(sessionId, abortController);
    try {
      const result = streamText({
        abortSignal: abortController.signal,
        messages: [input as ModelMessage],
        model: session.model,
      });
      let text = "";
      for await (const chunk of result.textStream) {
        text += chunk;
      }
      return {
        finishReason: (await result.finishReason) ?? undefined,
        text,
        usage: toUsage(await result.usage),
      };
    } finally {
      this.abortControllers.delete(sessionId);
    }
  }

  startSession(input: StartSessionInput): Promise<AgentSession> {
    const resolved = this.resolveModel({
      connectionId: input.connectionId,
      modelId: input.modelId,
    });
    const session: ApiSession = {
      capabilities: resolved.capabilities,
      connectionId: resolved.connectionId,
      model: resolved.model,
      modelId: resolved.modelId,
      sessionId: input.sessionId?.trim() || randomUUID(),
      source: "api",
    };
    this.sessions.set(session.sessionId, session);
    return Promise.resolve({
      capabilities: [...session.capabilities],
      connectionId: session.connectionId,
      modelId: session.modelId,
      sessionId: session.sessionId,
      source: session.source,
    });
  }

  abort(sessionId: string): Promise<void> {
    this.abortControllers.get(sessionId)?.abort();
    return Promise.resolve();
  }

  /** Non-streaming convenience for API-only callers; it uses the same resolver. */
  async generate(input: GenerateApiModelInput): Promise<AgentResponse> {
    const resolved = this.resolveModel(input);
    const result = await generateText({
      model: resolved.model,
      prompt: input.prompt,
    });
    return {
      finishReason: result.finishReason ?? undefined,
      text: result.text,
      usage: toUsage(result.usage),
    };
  }
}

const defaultApiProviderAdapter = new ApiProviderAdapter();

export function createApiProviderAdapter(): ApiProviderAdapter {
  return new ApiProviderAdapter();
}

export function resolveApiModel(input: ResolveApiModelInput): ResolvedApiModel {
  return defaultApiProviderAdapter.resolveModel(input);
}

export function getApiProviderAdapter(): ApiProviderAdapter {
  return defaultApiProviderAdapter;
}
