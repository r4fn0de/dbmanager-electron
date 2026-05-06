import {
  appVersion,
  checkForUpdates,
  checkManualUpdateInfo,
  currentPlatfom,
  restartAndInstallUpdate,
  updateStatus,
} from "./handlers";

export const app = {
  currentPlatfom,
  appVersion,
  updateStatus,
  checkForUpdates,
  restartAndInstallUpdate,
  checkManualUpdateInfo,
};
