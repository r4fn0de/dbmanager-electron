import path from "node:path";
import { app, BrowserWindow } from "electron";
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
    // Hydrate local databases (auto-start instances that were running before)
    await localDbManager.hydrate();
  } catch (error) {
    console.error("Error during app initialization:", error);
  }
});

// Stop all local DB instances on quit (sync — Electron won't await async handlers)
app.on("will-quit", () => {
  localDbManager.stopAllSync();
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
