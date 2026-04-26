export const LOCAL_STORAGE_KEYS = {
  LANGUAGE: "lang",
  THEME: "theme",
};

export const IPC_CHANNELS = {
  START_ORPC_SERVER: "start-orpc-server",
  SET_NATIVE_THEME_SOURCE: "set-native-theme-source",
};

/** AI streaming chat IPC channel names — shared between main & renderer. */
export const AI_IPC_CHANNELS = {
  CHAT_START: "ai:chat:start",
  CHAT_CHUNK: "ai:chat:chunk",
  CHAT_DONE: "ai:chat:done",
  CHAT_ERROR: "ai:chat:error",
  CHAT_ABORT: "ai:chat:abort",
  INLINE_START: "ai:inline:start",
  INLINE_CHUNK: "ai:inline:chunk",
  INLINE_DONE: "ai:inline:done",
  INLINE_ERROR: "ai:inline:error",
  INLINE_ABORT: "ai:inline:abort",

  // Tool approval flow — renderer ↔ main IPC
  TOOL_APPROVAL_REQUEST: "ai:tool:approval-request",
  TOOL_APPROVAL_RESPONSE: "ai:tool:approval-response",
} as const;

export const ENVIRONMENT_VARIABLES = {
  NODE_ENV: process.env.NODE_ENV,
};

export const inDevelopment = ENVIRONMENT_VARIABLES.NODE_ENV === "development";
