import { app } from "electron";

export type UpdateStage =
  | "idle"
  | "disabled"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "downloaded"
  | "error";

export interface UpdateStatus {
  stage: UpdateStage;
  enabled: boolean;
  currentVersion: string;
  availableVersion: string | null;
  downloadProgress: number;
  lastCheckedAt: string | null;
  lastError: string | null;
  feedUrl: string | null;
}

const updateStatus: UpdateStatus = {
  stage: "disabled",
  enabled: false,
  currentVersion: app.getVersion(),
  availableVersion: null,
  downloadProgress: 0,
  lastCheckedAt: null,
  lastError: "Automatic updates are disabled. Use latest.json manual updates.",
  feedUrl: null,
};

export function initializeAutoUpdates(): void {
  updateStatus.currentVersion = app.getVersion();
  updateStatus.stage = "disabled";
  updateStatus.enabled = false;
}

export function getAutoUpdateStatus(): UpdateStatus {
  return { ...updateStatus };
}

export async function checkForUpdatesNow(): Promise<UpdateStatus> {
  updateStatus.lastCheckedAt = new Date().toISOString();
  updateStatus.stage = "disabled";
  return getAutoUpdateStatus();
}

export function restartToApplyUpdate(): void {
  // no-op: automatic updates disabled
}
