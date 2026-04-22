import { os } from "@orpc/server";
import z from "zod";
import { ipcContext } from "../context";

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
