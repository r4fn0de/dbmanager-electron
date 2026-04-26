import type { ModelMessage } from "ai";
import type { DatabaseType } from "@/ipc/db/types";

export type Unsubscribe = () => void;

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
  messages: ModelMessage[];
}

export interface InlineGenerateStartInput {
  requestId: string;
  dbType: DatabaseType;
  prompt: string;
  sql?: string;
  schemaContext?: string;
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
}
