import type { ModelMessage } from "ai";
import type { DatabaseType } from "@/ipc/db/types";
import type { AiSessionMetadata } from "@/shared/ai/connection-contracts";

export type AiStreamSessionMetadata = AiSessionMetadata;

export type Unsubscribe = () => void;

export interface UserConnectionSummaryItem {
  dbType: DatabaseType;
  id: string;
  name: string;
  provider: string;
  scope: "local" | "remote";
}

export interface UserConnectionsContext {
  byDbType: Array<{ dbType: DatabaseType; count: number }>;
  byProvider: Array<{ provider: string; count: number }>;
  connections: UserConnectionSummaryItem[];
  local: number;
  remote: number;
  total: number;
}

export interface ChatStartInput {
  /** Selected AI connection profile, when different from the legacy default. */
  aiConnectionId?: string | null;
  chatId: string;
  /** Active database connection ID; optional for global chat mode. */
  connectionId?: string | null;
  connectionInfo?: {
    name: string;
    host: string;
    port: number;
    database: string;
    isLocal?: boolean;
    branch?: string | null;
  };
  dbType: DatabaseType;
  mentionedConnectionId?: string | null;
  messages: ModelMessage[];
  /** Selected model within the AI connection profile. */
  modelId?: string | null;
  /** Privacy settings for context gating */
  privacySettings?: PrivacySettings;
  schemaContext?: string;
  /** Existing agent/session metadata, retained as optional during migration. */
  sessionMetadata?: AiSessionMetadata;
  userConnectionsContext?: UserConnectionsContext;
}

export interface InlineGenerateStartInput {
  /** Explicit alias for callers that distinguish AI and database connections. */
  aiConnectionId?: string | null;
  /** Selected AI connection profile, when different from the legacy default. */
  connectionId?: string | null;
  dbType: DatabaseType;
  /** Selected model within the AI connection profile. */
  modelId?: string | null;
  prompt: string;
  requestId: string;
  schemaContext?: string;
  sessionMetadata?: AiSessionMetadata;
  sql?: string;
}

/** Which context categories the user allows to send to the AI provider. */
export interface PrivacySettings {
  /** Include connection metadata (host, port, database name, local/remote). Default: true */
  connectionInfo: boolean;
  /** Include the full user connections inventory. Default: true */
  connectionsList: boolean;
  /** Include memory context (recent messages, similar queries). Default: true */
  memory: boolean;
  /** Include database schema (table names, columns, types). Default: true */
  schema: boolean;
}

/** Predefined privacy presets. */
export type PrivacyPreset = "full" | "minimal" | "private";

export const PRIVACY_PRESETS: Record<PrivacyPreset, PrivacySettings> = {
  full: {
    connectionInfo: true,
    connectionsList: true,
    memory: true,
    schema: true,
  },
  minimal: {
    connectionInfo: true,
    connectionsList: false,
    memory: true,
    schema: false,
  },
  private: {
    connectionInfo: false,
    connectionsList: false,
    memory: false,
    schema: false,
  },
};

/** Snapshot of what context will be sent, for the preview UI. */
export interface ContextPreview {
  connectionInfo: { included: boolean; summary: string };
  connectionsList: { included: boolean; count: number };
  /** Whether data will leave the local machine (false for Ollama) */
  dataLeavesMachine: boolean;
  memory: { included: boolean };
  schema: { included: boolean; charCount: number; tables: string[] };
}

export interface AiUsage {
  cachedInputTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
}

export interface AiChatDonePayload extends AiSessionMetadata {
  chatId: string;
  finishReason?: string | null;
  sessionMetadata?: AiSessionMetadata;
  usage?: AiUsage | null;
}

export interface AiInlineDonePayload extends AiSessionMetadata {
  finishReason?: string | null;
  requestId: string;
  sessionMetadata?: AiSessionMetadata;
  usage?: AiUsage | null;
}

export interface AiChatErrorPayload extends AiSessionMetadata {
  chatId: string;
  message: string;
  sessionMetadata?: AiSessionMetadata;
}

export interface AiInlineErrorPayload extends AiSessionMetadata {
  message: string;
  requestId: string;
  sessionMetadata?: AiSessionMetadata;
}

type StreamChunkCommon =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "reasoning";
      text: string;
    }
  | {
      type: "source";
      source: unknown;
    }
  | {
      type: "tool-call";
      toolCallId?: string;
      toolName?: string;
      input?: unknown;
    }
  | {
      type: "tool-call-streaming-start";
      toolCallId?: string;
      toolName?: string;
      input?: unknown;
    }
  | {
      type: "tool-call-delta";
      toolCallId?: string;
      toolName?: string;
      input?: unknown;
      argsTextDelta?: string;
    }
  | {
      type: "tool-result";
      toolCallId?: string;
      toolName?: string;
      input?: unknown;
      result?: unknown;
    };

// `source` is already used by the source chunk payload, so lifecycle metadata
// is attached to done/error events rather than intersected into every chunk.
export type AiChatChunkPayload = { chatId: string } & StreamChunkCommon;
export type AiInlineChunkPayload = { requestId: string } & StreamChunkCommon;

export interface ToolApprovalRequestPayload extends AiSessionMetadata {
  args: unknown;
  chatId: string;
  /** Human-readable description of what the tool will do */
  description: string;
  /** The SQL or command that will be executed (if applicable) */
  preview?: string;
  toolCallId: string;
  toolName: string;
  /** Warnings about the proposed action */
  warnings?: string[];
}

export interface ToolApprovalResponsePayload {
  approved: boolean;
  chatId: string;
  /** Optional for compatibility with older renderer approval responders. */
  sessionId?: string;
  toolCallId: string;
}

export interface AiRendererApi {
  chat: {
    start: (input: ChatStartInput) => void;
    abort: (chatId: string) => void;
    onChunk: (listener: (payload: AiChatChunkPayload) => void) => Unsubscribe;
    onDone: (listener: (payload: AiChatDonePayload) => void) => Unsubscribe;
    onError: (listener: (payload: AiChatErrorPayload) => void) => Unsubscribe;
  };
  inline: {
    start: (input: InlineGenerateStartInput) => void;
    abort: (requestId: string) => void;
    onChunk: (listener: (payload: AiInlineChunkPayload) => void) => Unsubscribe;
    onDone: (listener: (payload: AiInlineDonePayload) => void) => Unsubscribe;
    onError: (listener: (payload: AiInlineErrorPayload) => void) => Unsubscribe;
  };
  toolApproval: {
    /** Respond to an approval request — approve or reject the tool call */
    respond: (payload: ToolApprovalResponsePayload) => void;
    /** Listen for approval requests from the main process */
    onRequest: (
      listener: (payload: ToolApprovalRequestPayload) => void
    ) => Unsubscribe;
  };
}

/** The canonical list of AI provider identifiers used across the app. */
export type AiProviderName =
  | "openai"
  | "anthropic"
  | "google"
  | "openai-compatible"
  | "ollama";

/** A model entry returned by a provider's model-list API or static catalog. */
export interface AiModelEntry {
  id: string;
  /** Whether this model was added by the user (custom) */
  isCustom?: boolean;
  label: string;
}

/** Prefix for user-saved custom provider IDs (`custom:<uuid>`). */
export const CUSTOM_AI_PROVIDER_PREFIX = "custom:";

/** A user-saved custom (OpenAI-compatible) AI provider endpoint. No secrets. */
export interface CustomAiProvider {
  baseURL: string;
  defaultModel: string;
  id: string;
  label: string;
}

/** Whether the provider id refers to a user-saved custom provider. */
export function isCustomAiProviderId(providerId: string): boolean {
  return providerId.startsWith(CUSTOM_AI_PROVIDER_PREFIX);
}
