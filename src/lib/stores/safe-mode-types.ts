export type SafeModeLevel = "off" | "silent" | "alert" | "readonly";

export interface SafeModeConfig {
  level: SafeModeLevel;
}

export const SAFE_MODE_LABELS: Record<SafeModeLevel, string> = {
  alert: "Alert",
  off: "Off",
  readonly: "Read-only",
  silent: "Silent",
};

export const SAFE_MODE_DESCRIPTIONS: Record<SafeModeLevel, string> = {
  alert: "Confirmation required for destructive queries (DROP, DELETE, etc.).",
  off: "No safety checks — all queries run freely.",
  readonly: "Only SELECT and read-only queries are allowed.",
  silent: "No warnings — destructive queries run silently.",
};
