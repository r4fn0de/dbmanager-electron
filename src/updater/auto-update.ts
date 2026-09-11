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
  availableVersion: string | null;
  currentVersion: string;
  downloadProgress: number;
  enabled: boolean;
  feedUrl: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  stage: UpdateStage;
}

const updateStatus: UpdateStatus = {
  availableVersion: null,
  currentVersion: app.getVersion(),
  downloadProgress: 0,
  enabled: false,
  feedUrl: null,
  lastCheckedAt: null,
  lastError: "Automatic updates are disabled. Use latest.json manual updates.",
  stage: "disabled",
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
