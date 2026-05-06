import { os } from "@orpc/server";
import { app } from "electron";
import { z } from "zod";
import {
  checkForUpdatesNow,
  getAutoUpdateStatus,
  restartToApplyUpdate,
} from "@/updater/auto-update";
import { checkManualUpdate } from "@/updater/manual-update";

export const currentPlatfom = os.handler(() => {
  return process.platform;
});

export const appVersion = os.handler(() => {
  return app.getVersion();
});

export const updateStatus = os.handler(() => {
  return getAutoUpdateStatus();
});

export const checkForUpdates = os.handler(async () => {
  return await checkForUpdatesNow();
});

export const restartAndInstallUpdate = os
  .input(z.object({ confirm: z.literal(true) }))
  .handler(() => {
    restartToApplyUpdate();
  });

export const checkManualUpdateInfo = os.handler(async () => {
  return await checkManualUpdate();
});
