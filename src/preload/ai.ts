import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { AI_IPC_CHANNELS } from "@/constants";
import type {
  AiChatChunkPayload,
  AiChatDonePayload,
  AiChatErrorPayload,
  AiInlineChunkPayload,
  AiInlineDonePayload,
  AiInlineErrorPayload,
  AiRendererApi,
  ChatStartInput,
  InlineGenerateStartInput,
  ToolApprovalRequestPayload,
  ToolApprovalResponsePayload,
  Unsubscribe,
} from "@/shared/ai/streaming-contracts";

function subscribe<T>(
  channel: string,
  listener: (payload: T) => void,
): Unsubscribe {
  const wrapped = (_event: IpcRendererEvent, payload: T) => {
    listener(payload);
  };

  ipcRenderer.on(channel, wrapped);

  return () => {
    ipcRenderer.removeListener(channel, wrapped);
  };
}

const aiApi: AiRendererApi = {
  chat: {
    start(input: ChatStartInput) {
      ipcRenderer.send(AI_IPC_CHANNELS.CHAT_START, input);
    },

    abort(chatId: string) {
      ipcRenderer.send(AI_IPC_CHANNELS.CHAT_ABORT, chatId);
    },

    onChunk(listener: (payload: AiChatChunkPayload) => void) {
      return subscribe<AiChatChunkPayload>(
        AI_IPC_CHANNELS.CHAT_CHUNK,
        listener,
      );
    },

    onDone(listener: (payload: AiChatDonePayload) => void) {
      return subscribe<AiChatDonePayload>(
        AI_IPC_CHANNELS.CHAT_DONE,
        listener,
      );
    },

    onError(listener: (payload: AiChatErrorPayload) => void) {
      return subscribe<AiChatErrorPayload>(
        AI_IPC_CHANNELS.CHAT_ERROR,
        listener,
      );
    },
  },

  inline: {
    start(input: InlineGenerateStartInput) {
      ipcRenderer.send(AI_IPC_CHANNELS.INLINE_START, input);
    },

    abort(requestId: string) {
      ipcRenderer.send(AI_IPC_CHANNELS.INLINE_ABORT, requestId);
    },

    onChunk(listener: (payload: AiInlineChunkPayload) => void) {
      return subscribe<AiInlineChunkPayload>(
        AI_IPC_CHANNELS.INLINE_CHUNK,
        listener,
      );
    },

    onDone(listener: (payload: AiInlineDonePayload) => void) {
      return subscribe<AiInlineDonePayload>(
        AI_IPC_CHANNELS.INLINE_DONE,
        listener,
      );
    },

    onError(listener: (payload: AiInlineErrorPayload) => void) {
      return subscribe<AiInlineErrorPayload>(
        AI_IPC_CHANNELS.INLINE_ERROR,
        listener,
      );
    },
  },

  toolApproval: {
    respond(payload: ToolApprovalResponsePayload) {
      ipcRenderer.send(AI_IPC_CHANNELS.TOOL_APPROVAL_RESPONSE, payload);
    },

    onRequest(listener: (payload: ToolApprovalRequestPayload) => void) {
      return subscribe<ToolApprovalRequestPayload>(
        AI_IPC_CHANNELS.TOOL_APPROVAL_REQUEST,
        listener,
      );
    },
  },
};

contextBridge.exposeInMainWorld("ai", aiApi);
