import { randomUUID } from "node:crypto";
import type { LanguageModel } from "ai";
import {
  getApiProviderAdapter,
  type ResolveApiModelInput,
  type ResolvedApiModel,
} from "@/ipc/ai/adapters/api-provider-adapter";
import type {
  AgentMessage,
  AgentResponse,
  AgentSession,
  AiProviderAdapter,
  StartSessionInput,
} from "@/ipc/ai/adapters/types";
import {
  getConnection,
  getDefaultConnectionId,
} from "@/ipc/ai/connections-store";
import type {
  AiConnection,
  AiConnectionProvider,
  AiSessionMetadata,
} from "@/shared/ai/connection-contracts";

export interface ConnectionHubStartInput {
  connectionId?: string | null;
  modelId?: string | null;
  sessionId?: string | null;
  workspacePath?: string;
}

export interface ResolvedAiStreamingConnection {
  capabilities: ResolvedApiModel["capabilities"];
  connectionId: string;
  model: LanguageModel;
  modelId: string;
  provider: AiConnectionProvider;
  source: "api";
}

export interface AiStreamingSession extends ResolvedAiStreamingConnection {
  sessionId: string;
}

interface ApiStreamingAdapter
  extends Pick<
    AiProviderAdapter,
    "abort" | "dispose" | "send" | "startSession"
  > {
  resolveModel: (input: ResolveApiModelInput) => ResolvedApiModel;
}

interface HubSession {
  abortController?: AbortController;
  adapter: ApiStreamingAdapter;
  session: AiStreamingSession;
}

function normalizeOptionalId(
  value: string | null | undefined
): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function cliConnectionError(connection: AiConnection): Error {
  if (connection.type !== "cli-agent") {
    return new Error("Expected a CLI agent connection.");
  }

  return new Error(
    `AI connection '${connection.id}' uses CLI agent '${connection.provider}'. CLI streaming is not available yet; select an API connection. The request was not routed to an API connection.`
  );
}

function connectionNotFoundError(connectionId: string): Error {
  return new Error(`AI connection '${connectionId}' was not found.`);
}

function noDefaultConnectionError(): Error {
  return new Error(
    "No AI connection is configured. Create an AI connection in Settings → AI."
  );
}

/**
 * Resolves AI connection profiles and owns the lifecycle of streaming sessions.
 * The hub intentionally knows only the API adapter until CLI adapters are
 * implemented; a CLI profile is an explicit error rather than an API fallback.
 */
export class AiConnectionHub {
  private readonly sessions = new Map<string, HubSession>();

  constructor(
    private readonly apiAdapter: ApiStreamingAdapter = getApiProviderAdapter()
  ) {}

  resolve(input: ConnectionHubStartInput = {}): ResolvedAiStreamingConnection {
    const requestedConnectionId = normalizeOptionalId(input.connectionId);
    const connectionId = requestedConnectionId ?? getDefaultConnectionId();

    if (!connectionId) {
      throw noDefaultConnectionError();
    }

    const connection = getConnection(connectionId);
    if (!connection) {
      throw connectionNotFoundError(connectionId);
    }

    if (connection.type !== "api") {
      throw cliConnectionError(connection);
    }

    const resolved = this.apiAdapter.resolveModel({
      connectionId,
      modelId: normalizeOptionalId(input.modelId),
    });

    return {
      capabilities: resolved.capabilities,
      connectionId: resolved.connectionId,
      model: resolved.model,
      modelId: resolved.modelId,
      provider: connection.provider,
      source: "api",
    };
  }

  async startSession(
    input: ConnectionHubStartInput = {}
  ): Promise<AiStreamingSession> {
    const resolved = this.resolve(input);
    const sessionId = normalizeOptionalId(input.sessionId) ?? randomUUID();
    const adapterInput: StartSessionInput = {
      connectionId: resolved.connectionId,
      modelId: resolved.modelId,
      sessionId,
      ...(input.workspacePath ? { workspacePath: input.workspacePath } : {}),
    };
    const adapterSession: AgentSession =
      await this.apiAdapter.startSession(adapterInput);
    const session: AiStreamingSession = {
      ...resolved,
      sessionId: adapterSession.sessionId,
    };

    this.sessions.set(session.sessionId, {
      adapter: this.apiAdapter,
      session,
    });

    return session;
  }

  getSession(sessionId: string): AiStreamingSession | undefined {
    return this.sessions.get(sessionId)?.session;
  }

  getSessionMetadata(sessionId: string): AiSessionMetadata | undefined {
    const session = this.getSession(sessionId);
    if (!session) {
      return;
    }

    return {
      connectionId: session.connectionId,
      modelId: session.modelId,
      sessionId: session.sessionId,
      source: session.source,
    };
  }

  attachAbortController(sessionId: string, controller: AbortController): void {
    const entry = this.sessions.get(sessionId);
    if (entry) {
      entry.abortController = controller;
    }
  }

  async send(sessionId: string, input: AgentMessage): Promise<AgentResponse> {
    const entry = this.sessions.get(sessionId);
    if (!entry) {
      throw new Error(`AI streaming session '${sessionId}' was not found.`);
    }

    return entry.adapter.send(sessionId, input);
  }

  async abort(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (!entry) {
      return;
    }

    entry.abortController?.abort();
    await entry.adapter.abort(sessionId);
  }

  async dispose(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (!entry) {
      return;
    }

    this.sessions.delete(sessionId);
    await entry.adapter.dispose(sessionId);
  }

  async abortAll(): Promise<void> {
    await Promise.all(
      [...this.sessions.keys()].map((sessionId) => this.abort(sessionId))
    );
  }
}

let defaultConnectionHub: AiConnectionHub | undefined;

export function getAiConnectionHub(): AiConnectionHub {
  defaultConnectionHub ??= new AiConnectionHub();
  return defaultConnectionHub;
}

export function resetAiConnectionHubForTests(): void {
  defaultConnectionHub = undefined;
}

export function toAiSessionMetadata(
  session: AiStreamingSession
): AiSessionMetadata {
  return {
    connectionId: session.connectionId,
    modelId: session.modelId,
    sessionId: session.sessionId,
    source: session.source,
  };
}
