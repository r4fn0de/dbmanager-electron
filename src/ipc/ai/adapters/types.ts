import type {
  AiAuthStatus,
  AiConnectionProvider,
  AiModel,
  AiModelCapability,
} from "@/shared/ai/connection-contracts";

/** Runtime information for an API provider or local agent. */
export interface AgentInstallation {
  detected: boolean;
  provider?: AiConnectionProvider;
  version?: string;
}

/** Authentication information safe to pass outside the adapter. */
export interface AuthResult {
  message?: string;
  status: AiAuthStatus;
}

/** Transport-neutral message accepted by an adapter session. */
export interface AgentMessage {
  content: unknown;
  role: "assistant" | "system" | "tool" | "user";
}

export interface StartSessionInput {
  connectionId: string;
  modelId?: string;
  sessionId?: string;
  workspacePath?: string;
}

export interface AgentSession {
  capabilities: AiModelCapability[];
  connectionId: string;
  modelId: string;
  sessionId: string;
  source: "api" | "cli-agent";
}

export interface AgentResponse {
  finishReason?: string;
  text: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

/**
 * Common adapter lifecycle. It intentionally has no AI SDK or CLI protocol
 * types so the connection hub can use the same contract for every runtime.
 */
export interface AiProviderAdapter {
  abort: (sessionId: string) => Promise<void>;
  authenticate: (connectionId: string) => Promise<AuthResult>;
  detect: () => Promise<AgentInstallation>;
  dispose: (sessionId: string) => Promise<void>;
  getCapabilities: (
    connectionId: string,
    modelId?: string
  ) => AiModelCapability[];
  listModels: (connectionId: string) => Promise<AiModel[]>;
  send: (sessionId: string, input: AgentMessage) => Promise<AgentResponse>;
  startSession: (input: StartSessionInput) => Promise<AgentSession>;
}

/** Compatibility name used by the connection/agent design. */
export type AiAgentAdapter = AiProviderAdapter;
