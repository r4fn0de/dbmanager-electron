import { beforeEach, describe, expect, it } from "vitest";
import {
  SETTINGS_TAB_ID,
  isSettingsTab,
  useConnectionTabsStore,
} from "@/lib/stores/connection-tabs";

describe("connection tabs store", () => {
  beforeEach(() => {
    useConnectionTabsStore.setState({
      tabs: [],
      activeTabId: null,
      recentTabIds: [],
    });
  });

  it("opens Settings once and focuses the existing tab", () => {
    const store = useConnectionTabsStore.getState();

    store.openSettingsTab();
    store.openSettingsTab();

    const state = useConnectionTabsStore.getState();
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0]?.id).toBe(SETTINGS_TAB_ID);
    expect(state.tabs[0] && isSettingsTab(state.tabs[0])).toBe(true);
    expect(state.activeTabId).toBe(SETTINGS_TAB_ID);
    expect(state.recentTabIds[0]).toBe(SETTINGS_TAB_ID);
  });

  it("keeps connection tabs compatible with the Settings discriminator", () => {
    const store = useConnectionTabsStore.getState();
    store.addTab({ id: "connection-1", name: "Database" });

    const tab = useConnectionTabsStore.getState().tabs[0];
    expect(tab && isSettingsTab(tab)).toBe(false);
  });
});
