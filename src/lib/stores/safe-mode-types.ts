export type SafeModeLevel = "off" | "silent" | "alert" | "readonly";

export interface SafeModeConfig {
  level: SafeModeLevel;
}

export const SAFE_MODE_LABELS: Record<SafeModeLevel, string> = {
  off: "Off",
  silent: "Silent",
  alert: "Alert",
  readonly: "Read-only",
};

export const SAFE_MODE_DESCRIPTIONS: Record<SafeModeLevel, string> = {
  off: "No safety checks — all queries run freely.",
  silent: "No warnings — destructive queries run silently.",
  alert: "Confirmation required for destructive queries (DROP, DELETE, etc.).",
  readonly: "Only SELECT and read-only queries are allowed.",
};
