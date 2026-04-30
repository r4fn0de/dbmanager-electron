import { os } from "@orpc/server";
import { nativeTheme } from "electron";
import z from "zod";
import { ipcContext } from "../context";

const VIBRANCY_DEFAULT = "fullscreen-ui" as const;

export const minimizeWindow = os
  .use(ipcContext.mainWindowContext)
  .handler(({ context }) => {
    const { window } = context;

    window.minimize();
  });

export const maximizeWindow = os
  .use(ipcContext.mainWindowContext)
  .handler(({ context }) => {
    const { window } = context;

    if (window.isMaximized()) {
      window.unmaximize();
    } else {
      window.maximize();
    }
  });

export const closeWindow = os
  .use(ipcContext.mainWindowContext)
  .handler(({ context }) => {
    const { window } = context;

    window.close();
  });

export const setUnsavedChanges = os
  .input(
    z.object({
      scope: z.string(),
      dirty: z.boolean(),
    }),
  )
  .handler(({ input }) => {
    ipcContext.setUnsavedScope(input.scope, input.dirty);
  });

export const setWindowVibrancy = os
  .use(ipcContext.mainWindowContext)
  .input(
    z.object({
      solid: z.boolean(),
    }),
  )
  .handler(({ context, input }) => {
    const { window: win } = context;

    if (process.platform === "darwin") {
      win.setVibrancy(input.solid ? null : VIBRANCY_DEFAULT);
    } else if (process.platform === "win32") {
      // Windows: backgroundMaterial cannot be changed after creation,
      // but setting a solid backgroundColor achieves the same visual effect.
      win.setBackgroundColor(input.solid ? (nativeTheme.shouldUseDarkColors ? "#1c1c1c" : "#ffffff") : "#00000000");
    }
  });
