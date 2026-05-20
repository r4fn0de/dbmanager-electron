import type { ModelMessage } from "ai";
import type { DatabaseType } from "@/ipc/db/types";

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
  connectionId: string | null;
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

export interface AiChatDonePayload {
  chatId: string;
  finishReason?: string | null;
  usage?: AiUsage | null;
}

export interface AiInlineDonePayload {
  requestId: string;
  finishReason?: string | null;
  usage?: AiUsage | null;
}

export interface AiChatErrorPayload {
  chatId: string;
  message: string;
}

export interface AiInlineErrorPayload {
  requestId: string;
  message: string;
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
