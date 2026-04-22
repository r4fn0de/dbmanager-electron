import { os } from "@orpc/server";
import type { BrowserWindow } from "electron";

class IPCContext {
  mainWindow: BrowserWindow | undefined;
  private unsavedScopes = new Map<string, boolean>();

  setMainWindow(window: BrowserWindow) {
    this.mainWindow = window;
  }

  setUnsavedScope(scope: string, dirty: boolean) {
    if (!scope) return;
    if (dirty) {
      this.unsavedScopes.set(scope, true);
    } else {
      this.unsavedScopes.delete(scope);
    }
  }

  clearUnsavedScopes() {
    this.unsavedScopes.clear();
  }

  get hasUnsavedChanges(): boolean {
    return this.unsavedScopes.size > 0;
  }

  get unsavedScopeKeys(): string[] {
    return [...this.unsavedScopes.keys()];
  }

  get mainWindowContext() {
    const window = this.mainWindow;
    if (!window) {
      throw new Error("Main window is not set in IPC context.");
    }

    return os.middleware(({ next }) =>
      next({
        context: {
          window,
        },
      })
    );
  }
}

export const ipcContext = new IPCContext();
