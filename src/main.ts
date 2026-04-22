import path from "node:path";
import { app, BrowserWindow, dialog, nativeTheme } from "electron";
import { ipcMain } from "electron/main";
import {
  installExtension,
  REACT_DEVELOPER_TOOLS,
} from "electron-devtools-installer";
import { UpdateSourceType, updateElectronApp } from "update-electron-app";
import { ipcContext } from "@/ipc/context";
import { IPC_CHANNELS, inDevelopment } from "./constants";
import { getBasePath } from "./utils/path";
import { localDbManager } from "./ipc/db/local-db-manager";
import { registerDrivers } from "./ipc/db/registry";
import { closeAllPools } from "./ipc/db/kysely-factory";
import { APP_DISPLAY_NAME } from "./appBranding";

function createWindow() {
  const basePath = getBasePath();
  const preload = path.join(basePath, "preload.js");

  // Configurações específicas por plataforma - transparência com blur
  const platformOptions: Electron.BrowserWindowConstructorOptions =
    process.platform === "darwin"
      ? {
          // macOS: vibrancy com blur nativo
          transparent: true,
          vibrancy: "fullscreen-ui",
          visualEffectState: "active", // mantém o blur mesmo quando a janela perde foco
          backgroundColor: "#00000000",
          titleBarStyle: "hiddenInset",
          trafficLightPosition: { x: 14, y: 12 },
        }
      : process.platform === "win32"
        ? {
            // Windows: transparência com blur
            transparent: true,
            backgroundMaterial: "acrylic",
            backgroundColor: "#00000000",
            titleBarStyle: "hidden",
          }
        : {
            // Linux: transparência básica
            transparent: true,
            backgroundColor: "#00000000",
            titleBarStyle: "hidden",
          };

  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    icon: path.join(basePath, "../icons/app-icon.png"),
    webPreferences: {
      devTools: inDevelopment,
      contextIsolation: true,
      nodeIntegration: true,
      nodeIntegrationInSubFrames: false,
      preload,
    },
    ...platformOptions,
  });
  ipcContext.setMainWindow(mainWindow);

  mainWindow.on("close", (event) => {
    if (!ipcContext.hasUnsavedChanges) return;
    const unsavedScopes = ipcContext.unsavedScopeKeys;
    const summarizedScopes = unsavedScopes.slice(0, 3).map((scope) => {
      if (!scope.startsWith("table:")) return scope;
      const [, , tableRef] = scope.split(":");
      return tableRef ?? scope;
    });
    const hasMoreScopes = unsavedScopes.length > summarizedScopes.length;
    const details = [
      "Closing now may discard pending edits.",
      "",
      ...summarizedScopes.map((scope) => `• ${scope}`),
    ];
    if (hasMoreScopes) {
      details.push(`• +${unsavedScopes.length - summarizedScopes.length} more`);
    }
    details.push("", "Do you want to quit anyway?");

    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: "warning",
      buttons: ["Cancel", "Quit Anyway"],
      defaultId: 0,
      cancelId: 0,
      title: APP_DISPLAY_NAME,
      message: "You have unsaved changes.",
      detail: details.join("\n"),
      noLink: true,
    });
    if (choice === 0) {
      event.preventDefault();
      return;
    }
    ipcContext.clearUnsavedScopes();
  });

  // Força o título da janela para o nome do app
  mainWindow.on("page-title-updated", (event) => {
    event.preventDefault();
    mainWindow.setTitle(APP_DISPLAY_NAME);
  });
  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow.setTitle(APP_DISPLAY_NAME);
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(basePath, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    );
  }
}

async function installExtensions() {
  try {
    const result = await installExtension(REACT_DEVELOPER_TOOLS);
    console.log(`Extensions installed successfully: ${result.name}`);
  } catch {
    console.error("Failed to install extensions");
  }
}

function checkForUpdates() {
  updateElectronApp({
    updateSource: {
      type: UpdateSourceType.ElectronPublicUpdateService,
      repo: "LuanRoger/electron-shadcn",
    },
  });
}

async function setupORPC() {
  const { rpcHandler } = await import("./ipc/handler");

  ipcMain.on(IPC_CHANNELS.START_ORPC_SERVER, (event) => {
    const [serverPort] = event.ports;

    serverPort.start();
    rpcHandler.upgrade(serverPort);
  });

  ipcMain.on(
    IPC_CHANNELS.SET_NATIVE_THEME_SOURCE,
    (_event, themeSource: "system" | "light" | "dark") => {
      nativeTheme.themeSource = themeSource;
    }
  );
}

function configureAppIdentity(): void {
  app.setName(APP_DISPLAY_NAME);
  app.setAboutPanelOptions({
    applicationName: APP_DISPLAY_NAME,
    applicationVersion: app.getVersion(),
  });
}

app.whenReady().then(async () => {
  try {
    configureAppIdentity();
    createWindow();
    await installExtensions();
    checkForUpdates();
    await setupORPC();
    // Register database drivers (PostgreSQL, MySQL, MariaDB)
    await registerDrivers();
    // Hydrate local databases (auto-start instances that were running before)
    await localDbManager.hydrate();
  } catch (error) {
    console.error("Error during app initialization:", error);
  }
});

// Stop all local DB instances and close database pools on quit
// (sync — Electron won't await async handlers)
app.on("will-quit", () => {
  localDbManager.stopAllSync();
  // Close all memoized database pools (pg, mysql, clickhouse)
  closeAllPools().catch(() => {});
});

//osX only
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
//osX only ends
