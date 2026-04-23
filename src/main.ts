import path from "node:path";
import { app, BrowserWindow, dialog, Menu, nativeTheme } from "electron";
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
import { registerAiStreamingHandlers } from "./ipc/ai";
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
  let isQuitting = false;

  let windowShown = false;
  const showMainWindow = () => {
    if (windowShown || mainWindow.isDestroyed()) return;
    windowShown = true;
    mainWindow.show();
    mainWindow.focus();
  };

  mainWindow.once("ready-to-show", showMainWindow);
  // Fallback for cases where renderer never emits ready-to-show in dev.
  setTimeout(showMainWindow, 3000);

  mainWindow.on("close", (event) => {
    if (isQuitting) return;

    const hasUnsavedChanges = ipcContext.hasUnsavedChanges;
    const runningLocalDbs = localDbManager.getRunningInstancesSnapshot();
    const hasRunningLocalDbs = runningLocalDbs.length > 0;

    if (!hasUnsavedChanges && !hasRunningLocalDbs) return;

    event.preventDefault();

    const details: string[] = [];

    if (hasUnsavedChanges) {
      const unsavedScopes = ipcContext.unsavedScopeKeys;
      const summarizedScopes = unsavedScopes.slice(0, 3).map((scope) => {
        if (!scope.startsWith("table:")) return scope;
        const [, , tableRef] = scope.split(":");
        return tableRef ?? scope;
      });
      const hasMoreScopes = unsavedScopes.length > summarizedScopes.length;

      details.push("Closing now may discard pending edits.", "");
      details.push(...summarizedScopes.map((scope) => `• ${scope}`));
      if (hasMoreScopes) {
        details.push(`• +${unsavedScopes.length - summarizedScopes.length} more`);
      }
    }

    if (hasRunningLocalDbs) {
      const summarizedRunningDbs = runningLocalDbs
        .slice(0, 3)
        .map((db) => `${db.name} (${db.engine})`);
      const hasMoreRunningDbs = runningLocalDbs.length > summarizedRunningDbs.length;

      if (details.length > 0) details.push("");
      details.push(
        "There are local databases still running.",
        "The app will pause closing and stop them safely before exiting.",
        "",
      );
      details.push(...summarizedRunningDbs.map((dbLabel) => `• ${dbLabel}`));
      if (hasMoreRunningDbs) {
        details.push(`• +${runningLocalDbs.length - summarizedRunningDbs.length} more`);
      }
    }

    details.push("", "Do you want to quit anyway?");

    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: "warning",
      buttons: ["Cancel", "Quit Anyway"],
      defaultId: 0,
      cancelId: 0,
      title: APP_DISPLAY_NAME,
      message: "Confirm app close",
      detail: details.join("\n"),
      noLink: true,
    });

    if (choice === 0) return;

    isQuitting = true;
    void (async () => {
      try {
        if (hasRunningLocalDbs) {
          await localDbManager.stopAll();
        }
      } catch (error) {
        console.error("[shutdown] Failed to stop local DBs before close:", error);
      } finally {
        ipcContext.clearUnsavedScopes();
        if (!mainWindow.isDestroyed()) {
          mainWindow.close();
        }
      }
    })();
  });

  // Força o título da janela para o nome do app
  mainWindow.on("page-title-updated", (event) => {
    event.preventDefault();
    mainWindow.setTitle(APP_DISPLAY_NAME);
  });
  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow.setTitle(APP_DISPLAY_NAME);
  });
  mainWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL) => {
      console.error("[window] failed to load renderer", {
        errorCode,
        errorDescription,
        validatedURL,
      });
      showMainWindow();
    },
  );
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("[window] renderer process gone", details);
  });

  // Force DevTools to always open in detached window to preserve
  // vibrancy/transparency on the main window. Docked DevTools breaks
  // the transparent compositing mode.
  if (inDevelopment) {
    let isReopeningDevTools = false;
    mainWindow.webContents.on("devtools-opened", () => {
      if (isReopeningDevTools) {
        isReopeningDevTools = false;
        return;
      }
      isReopeningDevTools = true;
      mainWindow.webContents.closeDevTools();
      mainWindow.webContents.openDevTools({ mode: "detach" });
      // Fallback: if the reopened event never fires, unstick the flag
      setTimeout(() => {
        isReopeningDevTools = false;
      }, 1000);
    });
  }

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

async function runPostWindowInitialization() {
  try {
    await installExtensions();
  } catch (error) {
    console.error("[startup] Failed to install dev extensions:", error);
  }

  try {
    checkForUpdates();
  } catch (error) {
    console.error("[startup] Failed to configure auto-updates:", error);
  }

  try {
    // Register database drivers (PostgreSQL, MySQL, MariaDB)
    await registerDrivers();
  } catch (error) {
    console.error("[startup] Failed to register DB drivers:", error);
  }

  try {
    // Register AI streaming chat handlers (IPC event-based)
    registerAiStreamingHandlers();
  } catch (error) {
    console.error("[startup] Failed to register AI handlers:", error);
  }

  try {
    // Hydrate local databases (auto-start instances that were running before)
    await localDbManager.hydrate();
  } catch (error) {
    console.error("[startup] Failed to hydrate local databases:", error);
  }
}

function setupMenu() {
  const isMac = process.platform === "darwin";

  const template: Electron.MenuItemConstructorOptions[] = [];

  // macOS app menu
  if (isMac) {
    template.push({
      label: APP_DISPLAY_NAME,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    });
  }

  // View menu
  const viewSubmenu: Electron.MenuItemConstructorOptions[] = [];
  if (inDevelopment) {
    viewSubmenu.push(
      {
        label: "Toggle Developer Tools",
        accelerator: isMac ? "Alt+Cmd+I" : "Ctrl+Shift+I",
        click: (_menuItem: Electron.MenuItem, focusedWindow: Electron.BaseWindow | undefined) => {
          if (focusedWindow instanceof Electron.BrowserWindow) {
            focusedWindow.webContents.toggleDevTools();
          }
        },
      },
      { type: "separator" },
    );
  }
  viewSubmenu.push(
    { role: "reload" },
    { role: "forceReload" },
    { type: "separator" },
    { role: "resetZoom" },
    { role: "zoomIn" },
    { role: "zoomOut" },
    { type: "separator" },
    { role: "togglefullscreen" },
  );
  template.push({ label: "View", submenu: viewSubmenu });

  // Window menu
  const windowSubmenu: Electron.MenuItemConstructorOptions[] = [
    { role: "minimize" },
    { role: "zoom" },
  ];
  if (isMac) {
    windowSubmenu.push({ type: "separator" }, { role: "front" });
  } else {
    windowSubmenu.push({ role: "close" });
  }
  template.push({ label: "Window", submenu: windowSubmenu });

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
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
    // Register IPC handlers before creating the renderer window so
    // initial theme sync events from the renderer are not lost.
    await setupORPC();
    createWindow();
    setupMenu();
    // Keep the window startup path fast and run non-critical setup in background.
    void runPostWindowInitialization();
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
