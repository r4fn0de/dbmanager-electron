import { os } from "@orpc/server";
import { app } from "electron";
import { z } from "zod";
import {
  checkForUpdatesNow,
  getAutoUpdateStatus,
  restartToApplyUpdate,
} from "@/updater/auto-update";
import { checkManualUpdate } from "@/updater/manual-update";

export const currentPlatfom = os.handler(() => process.platform);

export const appVersion = os.handler(() => app.getVersion());

export const updateStatus = os.handler(() => getAutoUpdateStatus());

export const checkForUpdates = os.handler(
  async () => await checkForUpdatesNow()
);

export const restartAndInstallUpdate = os
  .input(z.object({ confirm: z.literal(true) }))
  .handler(() => {
    restartToApplyUpdate();
  });

export const checkManualUpdateInfo = os.handler(
  async () => await checkManualUpdate()
);
