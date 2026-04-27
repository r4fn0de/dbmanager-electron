import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS, AI_IPC_CHANNELS, DB_IPC_CHANNELS } from "@/constants";

// Import new AI streaming preload (exposes window.ai)
import "@/preload/ai";

contextBridge.exposeInMainWorld("electron", {
  platform: process.platform,
  setNativeThemeSource: (themeSource: "system" | "light" | "dark") => {
    ipcRenderer.send(IPC_CHANNELS.SET_NATIVE_THEME_SOURCE, themeSource);
  },

  // AI streaming chat — bridge IPC events to renderer
  aiChat: {
    start: (input: unknown) => ipcRenderer.send(AI_IPC_CHANNELS.CHAT_START, input),
    abort: (chatId: string) => ipcRenderer.send(AI_IPC_CHANNELS.CHAT_ABORT, chatId),
    onChunk: (callback: (chunk: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, chunk: unknown) => callback(chunk);
      ipcRenderer.on(AI_IPC_CHANNELS.CHAT_CHUNK, handler);
      return () => ipcRenderer.removeListener(AI_IPC_CHANNELS.CHAT_CHUNK, handler);
    },
    onDone: (callback: (result: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, result: unknown) => callback(result);
      ipcRenderer.on(AI_IPC_CHANNELS.CHAT_DONE, handler);
      return () => ipcRenderer.removeListener(AI_IPC_CHANNELS.CHAT_DONE, handler);
    },
    onError: (callback: (error: { chatId: string; message: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, error: { chatId: string; message: string }) => callback(error);
      ipcRenderer.on(AI_IPC_CHANNELS.CHAT_ERROR, handler);
      return () => ipcRenderer.removeListener(AI_IPC_CHANNELS.CHAT_ERROR, handler);
    },
  },

  // AI inline SQL generation streaming — used by SqlEditor floating prompt
  aiInline: {
    start: (input: unknown) => ipcRenderer.send(AI_IPC_CHANNELS.INLINE_START, input),
    abort: (requestId: string) => ipcRenderer.send(AI_IPC_CHANNELS.INLINE_ABORT, requestId),
    onChunk: (callback: (chunk: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, chunk: unknown) => callback(chunk);
      ipcRenderer.on(AI_IPC_CHANNELS.INLINE_CHUNK, handler);
      return () => ipcRenderer.removeListener(AI_IPC_CHANNELS.INLINE_CHUNK, handler);
    },
    onDone: (callback: (result: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, result: unknown) => callback(result);
      ipcRenderer.on(AI_IPC_CHANNELS.INLINE_DONE, handler);
      return () => ipcRenderer.removeListener(AI_IPC_CHANNELS.INLINE_DONE, handler);
    },
    onError: (callback: (error: { requestId: string; message: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, error: { requestId: string; message: string }) => callback(error);
      ipcRenderer.on(AI_IPC_CHANNELS.INLINE_ERROR, handler);
      return () => ipcRenderer.removeListener(AI_IPC_CHANNELS.INLINE_ERROR, handler);
    },
  },

  // Database query cancellation — renderer sends requestId to abort a running query
  dbCancel: {
    cancelQuery: (requestId: string) => ipcRenderer.send(DB_IPC_CHANNELS.QUERY_CANCEL, { requestId }),
  },
});

window.addEventListener("message", (event) => {
  if (event.data === IPC_CHANNELS.START_ORPC_SERVER) {
    const [serverPort] = event.ports;

    ipcRenderer.postMessage(IPC_CHANNELS.START_ORPC_SERVER, null, [serverPort]);
  }
});
