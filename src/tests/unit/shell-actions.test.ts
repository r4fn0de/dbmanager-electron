import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock IPC manager before importing actions
vi.mock("@/ipc/manager", () => ({
  ipc: {
    client: {
      app: {
        appVersion: vi.fn().mockReturnValue("1.0.0"),
        currentPlatfom: vi.fn().mockReturnValue("darwin"),
      },
      shell: {
        openExternalLink: vi.fn().mockResolvedValue(undefined),
      },
      window: {
        closeWindow: vi.fn().mockResolvedValue(undefined),
        maximizeWindow: vi.fn().mockResolvedValue(undefined),
        minimizeWindow: vi.fn().mockResolvedValue(undefined),
        setUnsavedChanges: vi.fn().mockResolvedValue(undefined),
      },
    },
  },
}));

import { getAppVersion, getPlatform } from "@/features/shell/actions/app";
import { openExternalLink } from "@/features/shell/actions/shell";
import {
  closeWindow,
  maximizeWindow,
  minimizeWindow,
  setUnsavedChanges,
} from "@/features/shell/actions/window";
import { ipc } from "@/ipc/manager";

describe("shell actions — window", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("minimizeWindow calls IPC", async () => {
    await minimizeWindow();
    expect(ipc.client.window.minimizeWindow).toHaveBeenCalledOnce();
  });

  it("maximizeWindow calls IPC", async () => {
    await maximizeWindow();
    expect(ipc.client.window.maximizeWindow).toHaveBeenCalledOnce();
  });

  it("closeWindow calls IPC", async () => {
    await closeWindow();
    expect(ipc.client.window.closeWindow).toHaveBeenCalledOnce();
  });

  it("setUnsavedChanges calls IPC with correct args", async () => {
    await setUnsavedChanges("sql-editor", true);
    expect(ipc.client.window.setUnsavedChanges).toHaveBeenCalledWith({
      dirty: true,
      scope: "sql-editor",
    });
  });
});

describe("shell actions — app", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getPlatform returns platform string", () => {
    const result = getPlatform();
    expect(result).toBe("darwin");
    expect(ipc.client.app.currentPlatfom).toHaveBeenCalledOnce();
  });

  it("getAppVersion returns version string", () => {
    const result = getAppVersion();
    expect(result).toBe("1.0.0");
    expect(ipc.client.app.appVersion).toHaveBeenCalledOnce();
  });
});

describe("shell actions — shell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("openExternalLink calls IPC with url", async () => {
    await openExternalLink("https://example.com");
    expect(ipc.client.shell.openExternalLink).toHaveBeenCalledWith({
      url: "https://example.com",
    });
  });
});
