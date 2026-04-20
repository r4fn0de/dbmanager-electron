import { inDevelopment } from "./constants";

const APP_BASE_NAME = "TarsDB";

export function resolveAppStageLabel(): string {
  if (inDevelopment) {
    return "DEV";
  }
  return "Alpha";
}

export function resolveAppBranding(): {
  baseName: string;
  stageLabel: string;
  displayName: string;
} {
  const stageLabel = resolveAppStageLabel();
  return {
    baseName: APP_BASE_NAME,
    stageLabel,
    displayName: `${APP_BASE_NAME} (${stageLabel})`,
  };
}

export const APP_DISPLAY_NAME = resolveAppBranding().displayName;
