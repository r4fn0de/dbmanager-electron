import type { ModelMessage } from "ai";
import type { DatabaseType } from "@/ipc/db/types";
import type { AiSessionMetadata } from "@/shared/ai/connection-contracts";

export type AiStreamSessionMetadata = AiSessionMetadata;

export type Unsubscribe = () => void;

export interface UserConnectionSummaryItem {
  id: string;
  name: string;
  dbType: DatabaseType;
  provider: string;
  scope: "local" | "remote";
}

export interface UserConnectionsContext {
  total: number;
  local: number;
  remote: number;
  byProvider: Array<{ provider: string; count: number }>;
  byDbType: Array<{ dbType: DatabaseType; count: number }>;
  connections: UserConnectionSummaryItem[];
}

export interface ChatStartInput {
  chatId: string;
  /** Active database connection ID; optional for global chat mode. */
  connectionId?: string | null;
  /** Selected AI connection profile, when different from the legacy default. */
  aiConnectionId?: string | null;
  /** Selected model within the AI connection profile. */
  modelId?: string | null;
  /** Existing agent/session metadata, retained as optional during migration. */
  sessionMetadata?: AiSessionMetadata;
  mentionedConnectionId?: string | null;
  dbType: DatabaseType;
  schemaContext?: string;
  connectionInfo?: {
    name: string;
    host: string;
    port: number;
    database: string;
    isLocal?: boolean;
  };
  userConnectionsContext?: UserConnectionsContext;
  messages: ModelMessage[];
  /** Privacy settings for context gating */
  privacySettings?: PrivacySettings;
}

export interface InlineGenerateStartInput {
  requestId: string;
  /** Selected AI connection profile, when different from the legacy default. */
  connectionId?: string | null;
  /** Explicit alias for callers that distinguish AI and database connections. */
  aiConnectionId?: string | null;
  /** Selected model within the AI connection profile. */
  modelId?: string | null;
  sessionMetadata?: AiSessionMetadata;
  dbType: DatabaseType;
  prompt: string;
  sql?: string;
  schemaContext?: string;
}

/** Which context categories the user allows to send to the AI provider. */
export interface PrivacySettings {
  /** Include database schema (table names, columns, types). Default: true */
  schema: boolean;
  /** Include connection metadata (host, port, database name, local/remote). Default: true */
  connectionInfo: boolean;
  /** Include the full user connections inventory. Default: true */
  connectionsList: boolean;
  /** Include memory context (recent messages, similar queries). Default: true */
  memory: boolean;
}

/** Predefined privacy presets. */
export type PrivacyPreset = "full" | "minimal" | "private";

export const PRIVACY_PRESETS: Record<PrivacyPreset, PrivacySettings> = {
  full: { schema: true, connectionInfo: true, connectionsList: true, memory: true },
  minimal: { schema: false, connectionInfo: true, connectionsList: false, memory: true },
  private: { schema: false, connectionInfo: false, connectionsList: false, memory: false },
};

/** Snapshot of what context will be sent, for the preview UI. */
export interface ContextPreview {
  schema: { included: boolean; charCount: number; tables: string[] };
  connectionInfo: { included: boolean; summary: string };
  connectionsList: { included: boolean; count: number };
  memory: { included: boolean };
  /** Whether data will leave the local machine (false for Ollama) */
  dataLeavesMachine: boolean;
}

export interface AiUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
}

export interface AiChatDonePayload extends AiSessionMetadata {
  chatId: string;
  finishReason?: string | null;
  usage?: AiUsage | null;
  sessionMetadata?: AiSessionMetadata;
}

export interface AiInlineDonePayload extends AiSessionMetadata {
  requestId: string;
  finishReason?: string | null;
  usage?: AiUsage | null;
  sessionMetadata?: AiSessionMetadata;
}

export interface AiChatErrorPayload extends AiSessionMetadata {
  chatId: string;
  message: string;
  sessionMetadata?: AiSessionMetadata;
}

export interface AiInlineErrorPayload extends AiSessionMetadata {
  requestId: string;
  message: string;
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

export interface ToolApprovalRequestPayload {
  chatId: string;
  toolCallId: string;
  toolName: string;
  args: unknown;
  /** Human-readable description of what the tool will do */
  description: string;
  /** The SQL or command that will be executed (if applicable) */
  preview?: string;
  /** Warnings about the proposed action */
  warnings?: string[];
}

export interface ToolApprovalResponsePayload {
  chatId: string;
  toolCallId: string;
  approved: boolean;
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
    onRequest: (listener: (payload: ToolApprovalRequestPayload) => void) => Unsubscribe;
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
  label: string;
  /** Whether this model was added by the user (custom) */
  isCustom?: boolean;
}
