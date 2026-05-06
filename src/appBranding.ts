import { inDevelopment } from "./constants";

const APP_BASE_NAME = "Tars";

function resolveAppBranding(): {
  baseName: string;
  stageLabel?: string;
  displayName: string;
} {
  if (inDevelopment) {
    return {
      baseName: APP_BASE_NAME,
      stageLabel: "DEV",
      displayName: `${APP_BASE_NAME} (DEV)`,
    };
  }

  return {
    baseName: APP_BASE_NAME,
    displayName: APP_BASE_NAME,
  };
}

export const APP_DISPLAY_NAME = resolveAppBranding().displayName;
