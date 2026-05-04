import { app, dialog } from "electron";
import { autoUpdater } from "electron-updater";

const DEFAULT_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const DEFAULT_HAZEL_URL = "https://hazel-six-gamma.vercel.app";

function logUpdateEvent(event: string, payload?: Record<string, unknown>) {
  const data = payload ? { ...payload } : {};
  console.info(
    JSON.stringify({
      domain: "updater",
      event,
      timestamp: new Date().toISOString(),
      ...data,
    }),
  );
}

function bindUpdaterEvents() {
  autoUpdater.on("checking-for-update", () => {
    logUpdateEvent("checking-for-update");
  });

  autoUpdater.on("update-available", (info) => {
    logUpdateEvent("update-available", { version: info.version });
    console.log(`[updater] Update available: v${info.version}`);
  });

  autoUpdater.on("update-not-available", () => {
    logUpdateEvent("update-not-available");
  });

  autoUpdater.on("error", (error) => {
    logUpdateEvent("error", { message: error?.message || String(error) });
    console.error("[updater] Error:", error);
  });

  autoUpdater.on("download-progress", (progress) => {
    logUpdateEvent("download-progress", {
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    logUpdateEvent("update-downloaded", { version: info.version });
    console.log(`[updater] Update downloaded: v${info.version}`);

    // Ask user to install now or later
    const response = dialog.showMessageBoxSync({
      type: "info",
      buttons: ["Install & Restart", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: "Update Available",
      message: `A new version (${info.version}) is available.`,
      detail: "The update has been downloaded. Would you like to install it now?",
    });

    if (response === 0) {
      autoUpdater.quitAndInstall(false, true);
    }
  });
}

function resolveUpdateIntervalMs(): number {
  const envInterval = process.env.TARSDB_UPDATE_CHECK_INTERVAL_MS;
  if (envInterval) {
    const parsed = Number.parseInt(envInterval, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_INTERVAL_MS;
}

export async function configureGitHubUpdates(): Promise<void> {
  // Skip in development
  if (!app.isPackaged) {
    console.log("[updater] Skipping auto-updater in development mode");
    return;
  }

  // Hazel endpoint (required): e.g. https://your-hazel.vercel.app
  const updateBaseUrl = (
    process.env.UPDATE_BASE_URL?.trim() || DEFAULT_HAZEL_URL
  ).replace(/\/+$/, "");

  const feedUrl = `${updateBaseUrl}/update/${process.platform}/${app.getVersion()}`;
  autoUpdater.setFeedURL({ url: feedUrl });

  // Configure auto-updater
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  bindUpdaterEvents();

  // Initial check
  try {
    logUpdateEvent("initial-check");
    await autoUpdater.checkForUpdates();
  } catch (error) {
    console.error("[updater] Initial check failed:", error);
    logUpdateEvent("initial-check-failed", {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  // Periodic checks
  const intervalMs = resolveUpdateIntervalMs();
  setInterval(async () => {
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      console.error("[updater] Periodic check failed:", error);
    }
  }, intervalMs);

  logUpdateEvent("configured", {
    intervalMs,
    feedUrl,
  });
  console.log(`[updater] Configured with ${intervalMs}ms check interval (${feedUrl})`);
}
