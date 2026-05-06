#!/usr/bin/env node
// Patches the system Electron.app bundle on macOS to show correct app name in dock

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Only run on macOS
if (process.platform !== "darwin") {
  console.log("[patch-electron] Skipping (not macOS)");
  process.exit(0);
}

const APP_BASE_NAME = "Tars";
const APP_DISPLAY_NAME = `${APP_BASE_NAME} (DEV)`;
const APP_BUNDLE_ID = "com.tarsdb.app.dev";
const PATCH_VERSION = 1;

function setPlistString(plistPath, key, value) {
  const replaceResult = spawnSync(
    "plutil",
    ["-replace", key, "-string", value, plistPath],
    { encoding: "utf8" }
  );
  if (replaceResult.status === 0) return;

  const insertResult = spawnSync(
    "plutil",
    ["-insert", key, "-string", value, plistPath],
    { encoding: "utf8" }
  );
  if (insertResult.status === 0) return;

  throw new Error(
    `Failed to update plist: ${replaceResult.stderr || insertResult.stderr}`
  );
}

function findIconPath() {
  const rootDir = resolve(__dirname, "..");
  const paths = [
    join(rootDir, "icons", "app-icon.icns"),
    join(rootDir, "icons", "app-icon.png"),
  ];
  for (const p of paths) {
    if (existsSync(p)) return p;
  }
  return null;
}

function getElectronBundlePath() {
  try {
    const require = createRequire(import.meta.url);
    const electronPath = require("electron");
    // electronPath points to Electron.app/Contents/MacOS/Electron
    return resolve(electronPath, "../../..");
  } catch (e) {
    console.error("[patch-electron] Could not find Electron:", e.message);
    return null;
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function main() {
  const electronBundlePath = getElectronBundlePath();
  if (!electronBundlePath) {
    console.error("[patch-electron] Electron bundle not found");
    process.exit(1);
  }

  const patchMarkerPath = join(electronBundlePath, ".tarsdb-patch.json");
  const infoPlistPath = join(electronBundlePath, "Contents", "Info.plist");
  const iconPath = findIconPath();

  // Check if already patched with current version
  const currentPatch = readJson(patchMarkerPath);
  const expectedPatch = {
    version: PATCH_VERSION,
    appName: APP_DISPLAY_NAME,
    bundleId: APP_BUNDLE_ID,
    electronMtime: statSync(electronBundlePath).mtimeMs,
    iconPath: iconPath || null,
    iconMtime: iconPath ? statSync(iconPath).mtimeMs : 0,
  };

  if (
    currentPatch &&
    JSON.stringify(currentPatch) === JSON.stringify(expectedPatch)
  ) {
    console.log("[patch-electron] Already patched, skipping");
    return;
  }

  console.log(`[patch-electron] Patching: ${electronBundlePath}`);
  console.log(`[patch-electron] App name: ${APP_DISPLAY_NAME}`);

  try {
    // Update Info.plist
    setPlistString(infoPlistPath, "CFBundleDisplayName", APP_DISPLAY_NAME);
    setPlistString(infoPlistPath, "CFBundleName", APP_DISPLAY_NAME);
    setPlistString(infoPlistPath, "CFBundleIdentifier", APP_BUNDLE_ID);

    // Copy icon if available
    if (iconPath) {
      const resourcesDir = join(electronBundlePath, "Contents", "Resources");
      const destIconName = iconPath.endsWith(".icns")
        ? "electron.icns"
        : "electron.png";
      copyFileSync(iconPath, join(resourcesDir, destIconName));
      setPlistString(infoPlistPath, "CFBundleIconFile", destIconName);
      console.log(`[patch-electron] Copied icon: ${iconPath}`);
    }

    // Write patch marker
    writeFileSync(patchMarkerPath, JSON.stringify(expectedPatch, null, 2));

    console.log("[patch-electron] Patching complete!");
    console.log("[patch-electron] NOTE: If Electron was updated, you may need to restart");
  } catch (error) {
    console.error("[patch-electron] Failed to patch:", error.message);
    // Don't exit with error - let electron-forge try anyway
  }
}

main();
