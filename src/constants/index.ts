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

/** Database query cancellation IPC channel names. */
export const DB_IPC_CHANNELS = {
  QUERY_CANCEL: "db:query:cancel",
} as const;

export const ENVIRONMENT_VARIABLES = {
  NODE_ENV: process.env.NODE_ENV,
};

export const inDevelopment = ENVIRONMENT_VARIABLES.NODE_ENV === "development";

/** Database type display labels — shared across components. */
export const DB_TYPE_LABELS: Record<string, string> = {
  postgresql: "PostgreSQL",
  mysql: "MySQL",
  mariadb: "MariaDB",
  clickhouse: "ClickHouse",
  sqlite: "SQLite",
  redis: "Redis",
};

/** Format large row counts compactly (e.g. 1.2K, 3.4M, ~0). */
export function formatRowCount(count: number): string {
  if (count < 1_000) return String(count);
  if (count < 1_000_000) return `${(count / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  if (count < 1_000_000_000) return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  return `${(count / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
}

/** Format seconds into a human-readable uptime string (e.g. "3 days, 2:14:30"). */
export function formatUptime(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86400);
  const remainder = totalSeconds % 86400;
  const hours = Math.floor(remainder / 3600);
  const mins = Math.floor((remainder % 3600) / 60);
  const secs = Math.floor(remainder % 60);
  const time = `${hours}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return days > 0 ? `${days} day${days !== 1 ? "s" : ""}, ${time}` : time;
}
