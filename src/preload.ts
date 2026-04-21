import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS } from "./constants";

contextBridge.exposeInMainWorld("electron", {
  platform: process.platform,
  setNativeThemeSource: (themeSource: "system" | "light" | "dark") => {
    ipcRenderer.send(IPC_CHANNELS.SET_NATIVE_THEME_SOURCE, themeSource);
  },
});

window.addEventListener("message", (event) => {
  if (event.data === IPC_CHANNELS.START_ORPC_SERVER) {
    const [serverPort] = event.ports;

    ipcRenderer.postMessage(IPC_CHANNELS.START_ORPC_SERVER, null, [serverPort]);
  }
});
