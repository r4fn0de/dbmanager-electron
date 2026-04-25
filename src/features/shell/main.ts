import path from "node:path";
import { app, BrowserWindow, dialog, Menu, nativeTheme, session } from "electron";
import { ipcMain } from "electron/main";
import { downloadChromeExtension } from "electron-devtools-installer/dist/downloadChromeExtension";
import { ipcContext } from "@/ipc/context";
import { IPC_CHANNELS, inDevelopment } from "@/constants";
import { getBasePath } from "@/lib/path";
import { localDbManager } from "@/ipc/db/local-db-manager";
import { registerDrivers } from "@/ipc/db/registry";
import { closeAllPools } from "@/ipc/db/kysely-factory";
import { registerAiStreamingHandlers } from "@/ipc/ai";
import { APP_DISPLAY_NAME } from "@/appBranding";
import { configurePrivateUpdates } from "@/updater/private-update";

const REACT_DEVELOPER_TOOLS_EXTENSION_ID = "fmkadmapgofadopljbjfkapdkoienihi";
const SHUTDOWN_TIMEOUT_MS = 5000;

let splashWindow: BrowserWindow | null = null;
let isShutdownInProgress = false;
let hasRunSyncShutdown = false;

async function runAsyncShutdown(reason: string): Promise<void> {
  console.log(`[shutdown] Starting async shutdown (${reason})...`);
  const startTime = Date.now();

  try {
    await Promise.race([
      localDbManager.stopAll(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("stopAll timeout")), SHUTDOWN_TIMEOUT_MS);
      }),
    ]);
    console.log(`[shutdown] localDbManager.stopAll completed in ${Date.now() - startTime}ms`);
  } catch (error) {
    console.error("[shutdown] localDbManager.stopAll failed:", error);
  }

  try {
    await Promise.race([
      closeAllPools(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("closeAllPools timeout")), SHUTDOWN_TIMEOUT_MS);
      }),
    ]);
    console.log(`[shutdown] closeAllPools completed in ${Date.now() - startTime}ms`);
  } catch (error) {
    console.error("[shutdown] closeAllPools failed:", error);
  }
}

function runSyncShutdown(reason: string): void {
  if (hasRunSyncShutdown) return;
  hasRunSyncShutdown = true;
  console.log(`[shutdown] Running sync shutdown (${reason})...`);

  localDbManager.stopAllSync();
  closeAllPools().catch((error) => {
    console.error("[shutdown] closeAllPools failed during sync shutdown:", error);
  });
}

function createSplashWindow(): BrowserWindow | null {
  try {
    const splash = new BrowserWindow({
      width: 320,
      height: 200,
      frame: false,
      alwaysOnTop: true,
      center: true,
      resizable: false,
      skipTaskbar: true,
      show: false,
      transparent: true,
      backgroundColor: "#00000000",
      webPreferences: {
        devTools: false,
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    // Minimalist splash - clean and simple
    const splashHtml = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{width:320px;height:200px;background:#0a0a0a;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,sans-serif}
.container{text-align:center}
.icon{font-size:32px;margin-bottom:12px;opacity:.9}
.text{color:#e5e5e5;font-size:14px;font-weight:400;letter-spacing:.5px}
</style></head>
<body><div class="container"><div class="icon">◐</div><div class="text">DBManager</div></div></body></html>`;

    splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splashHtml)}`);

    splash.once("ready-to-show", () => {
      splash.show();
    });

    // Auto-close after 10s max to prevent blocking
    setTimeout(() => {
      if (!splash.isDestroyed()) splash.close();
    }, 10000);

    return splash;
  } catch (err) {
    console.log("[startup] Failed to create splash:", err);
    return null;
  }
}

function updateSplashStatus(message: string) {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send("splash-status", message);
  }
}

function closeSplashWindow() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    // Fade out effect
    splashWindow.setOpacity(0.9);
    const fadeInterval = setInterval(() => {
      const current = splashWindow?.getOpacity() ?? 0;
      if (current <= 0.1) {
        clearInterval(fadeInterval);
        splashWindow?.close();
        splashWindow = null;
      } else {
        splashWindow?.setOpacity(current - 0.1);
      }
    }, 30);
  }
}

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
  const showMainWindow = (source: string) => {
    console.log(`[window] showMainWindow called from: ${source}`);
    if (windowShown) {
      console.log("[window] already shown, skipping");
      return;
    }
    if (mainWindow.isDestroyed()) {
      console.log("[window] destroyed, skipping");
      return;
    }
    windowShown = true;
    console.log(`[window] isVisible: ${mainWindow.isVisible()}, isLoading: ${mainWindow.webContents.isLoading()}`);

    // Even if window is visible, ensure it's shown and focused
    if (!mainWindow.isVisible()) {
      console.log("[window] showing window...");
      mainWindow.show();
    }

    // Force focus and raise to front
    mainWindow.focus();
    if (process.platform === "darwin") {
      mainWindow.setAlwaysOnTop(true);
      setTimeout(() => mainWindow.setAlwaysOnTop(false), 100);
    }
    app.focus({ steal: true });

    console.log("[window] window focused");
    closeSplashWindow();
    console.log("[window] splash closed");
  };

  mainWindow.once("ready-to-show", () => {
    console.log("[window] ready-to-show event fired");
    showMainWindow("ready-to-show");
  });

  // Fallback for cases where renderer never emits ready-to-show in dev.
  // macOS sometimes needs this due to vibrancy/transparency settings
  setTimeout(() => {
    console.log("[window] fallback timeout triggered");
    showMainWindow("fallback-timeout");
  }, 1500);

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
      showMainWindow("did-fail-load");
    },
  );

  // Ensure window shows even if something goes wrong with loading
  mainWindow.webContents.on("did-start-loading", () => {
    console.log("[window] started loading");
  });

  mainWindow.webContents.on("did-stop-loading", () => {
    console.log("[window] stopped loading");
    showMainWindow("did-stop-loading");
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("[window] renderer process gone", details);
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    console.log(`[window] loading dev server URL: ${MAIN_WINDOW_VITE_DEV_SERVER_URL}`);
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL).catch((err) => {
      console.error("[window] failed to load dev server URL:", err);
    });
  } else {
    const filePath = path.join(basePath, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`);
    console.log(`[window] loading file: ${filePath}`);
    mainWindow.loadFile(filePath).catch((err) => {
      console.error("[window] failed to load file:", err);
    });
  }
}

async function installExtensions() {
  const startTime = Date.now();
  const TIMEOUT_MS = 10000; // 10 second timeout

  try {
    const extensionApi = session.defaultSession.extensions;
    const installedExtension = extensionApi
      .getAllExtensions()
      .find((extension) => extension.id === REACT_DEVELOPER_TOOLS_EXTENSION_ID);

    // Race between download and timeout
    const extensionFolder = await Promise.race([
      downloadChromeExtension(
        REACT_DEVELOPER_TOOLS_EXTENSION_ID,
        { forceDownload: false, attempts: 3 },
      ),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Extension download timeout")), TIMEOUT_MS)
      ),
    ]);

    if (installedExtension?.id) {
      const unloadPromise = new Promise<void>((resolve) => {
        const handler = (_event: Electron.Event, extension: Electron.Extension) => {
          if (extension.id === installedExtension.id) {
            extensionApi.removeListener("extension-unloaded", handler);
            resolve();
          }
        };

        extensionApi.on("extension-unloaded", handler);
      });

      extensionApi.removeExtension(installedExtension.id);
      await unloadPromise;
    }

    const loadedExtension = await extensionApi.loadExtension(extensionFolder);
    console.log(`[startup] Extensions installed in ${Date.now() - startTime}ms: ${loadedExtension.name}`);
  } catch (error) {
    console.error(`[startup] Failed to install extensions after ${Date.now() - startTime}ms:`, error);
    // Non-fatal: continue without extensions
  }
}

async function checkForUpdates() {
  await configurePrivateUpdates();
}

async function runPostWindowInitialization() {
  const startTime = Date.now();
  console.log("[startup] Starting post-window initialization...");

  // Run independent operations in parallel
  const operations = [
    {
      name: "installExtensions",
      fn: () => installExtensions(),
      timeout: 15000,
    },
    {
      name: "checkForUpdates",
      fn: () => checkForUpdates(),
      timeout: 5000,
    },
    {
      name: "registerDrivers",
      fn: () => registerDrivers(),
      timeout: 10000,
    },
    {
      name: "registerAiHandlers",
      fn: () => registerAiStreamingHandlers(),
      timeout: 5000,
    },
    {
      name: "hydrateLocalDbs",
      fn: () => localDbManager.hydrate(),
      timeout: 30000,
    },
  ];

  const runWithTimeout = async <T>(name: string, fn: () => T | Promise<T>, timeoutMs: number) => {
    const opStart = Date.now();
    try {
      const result = await Promise.race([
        Promise.resolve(fn()),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`${name} timeout`)), timeoutMs)
        ),
      ]);
      console.log(`[startup] ${name} completed in ${Date.now() - opStart}ms`);
      return { name, success: true, duration: Date.now() - opStart };
    } catch (error) {
      console.error(`[startup] ${name} failed after ${Date.now() - opStart}ms:`, error);
      return { name, success: false, error, duration: Date.now() - opStart };
    }
  };

  // Run all operations in parallel
  const results = await Promise.all(
    operations.map(op => runWithTimeout(op.name, op.fn, op.timeout))
  );

  const totalTime = Date.now() - startTime;
  const successful = results.filter(r => r.success).length;
  console.log(`[startup] Post-window initialization complete in ${totalTime}ms (${successful}/${operations.length} ops succeeded)`);

  // Log any failures
  results.filter(r => !r.success).forEach(r => {
    console.error(`[startup] Failed operation: ${r.name}`);
  });
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

  // Edit menu — required for clipboard shortcuts (Cmd/Ctrl+C, V, X, etc.) to work
  // in renderer input fields. Without this, Electron does not handle these shortcuts.
  template.push({
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "selectAll" },
    ],
  });

  // View menu
  const viewSubmenu: Electron.MenuItemConstructorOptions[] = [];
  if (inDevelopment) {
    viewSubmenu.push(
      {
        label: "Toggle Developer Tools",
        accelerator: isMac ? "Alt+Cmd+I" : "Ctrl+Shift+I",
        click: (_menuItem: Electron.MenuItem, focusedWindow: Electron.BaseWindow | undefined) => {
          if (focusedWindow instanceof BrowserWindow) {
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
  const { rpcHandler } = await import("@/ipc/handler");

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
  const startTime = Date.now();
  console.log("[startup] App ready, starting initialization...");

  // Create splash screen immediately for visual feedback
  console.log("[startup] Creating splash screen...");
  splashWindow = createSplashWindow();

  try {
    configureAppIdentity();
    console.log("[startup] App identity configured");

    // Setup ORPC with retry logic
    let orpcRetries = 0;
    const maxRetries = 3;
    while (orpcRetries < maxRetries) {
      try {
        await setupORPC();
        console.log(`[startup] ORPC setup succeeded (attempt ${orpcRetries + 1})`);
        break;
      } catch (error) {
        orpcRetries++;
        console.error(`[startup] ORPC setup failed (attempt ${orpcRetries}/${maxRetries}):`, error);
        if (orpcRetries >= maxRetries) {
          console.error("[startup] ORPC setup failed after all retries, continuing without IPC");
        } else {
          await new Promise(r => setTimeout(r, 100 * orpcRetries)); // Exponential backoff
        }
      }
    }

    console.log("[startup] Creating window...");
    createWindow();

    console.log("[startup] Setting up menu...");
    setupMenu();

    // Keep the window startup path fast and run non-critical setup in background.
    console.log("[startup] Starting post-window initialization (background)...");
    void runPostWindowInitialization();

    console.log(`[startup] Core initialization complete in ${Date.now() - startTime}ms`);

    // Close splash when main window is ready
    setTimeout(() => {
      closeSplashWindow();
    }, 500); // Small delay for smooth transition

  } catch (error) {
    console.error("[startup] Fatal error during app initialization:", error);
    closeSplashWindow();

    // Show error dialog to user
    dialog.showErrorBox(
      "Startup Error",
      `Failed to initialize ${APP_DISPLAY_NAME}. Please check the logs and try again.\n\nError: ${error instanceof Error ? error.message : String(error)}`
    );
    app.quit();
  }
});

// Stop all local DB instances and close database pools on quit
// Prefer async cleanup in before-quit; keep will-quit as a final sync fallback.
app.on("before-quit", (event) => {
  if (isShutdownInProgress) return;

  event.preventDefault();
  isShutdownInProgress = true;

  void (async () => {
    await runAsyncShutdown("before-quit");
    app.quit();
  })();
});

app.on("will-quit", () => {
  runSyncShutdown("will-quit");
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

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    runSyncShutdown(`signal:${signal}`);
    app.exit(0);
  });
}
