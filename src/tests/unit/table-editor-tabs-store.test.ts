import { beforeEach, describe, expect, it } from "vitest";
import {
  buildTableEditorTab,
  useTableEditorTabsStore,
} from "@/lib/stores/table-editor-tabs";

describe("table-editor-tabs store", () => {
  beforeEach(() => {
    useTableEditorTabsStore.setState({ byConnectionId: {} });
  });

  it("opens without duplicates and focuses existing tab", () => {
    const connectionId = "c1";
    const tab = buildTableEditorTab("public", "users");
    useTableEditorTabsStore.getState().openTab(connectionId, tab);
    useTableEditorTabsStore.getState().openTab(connectionId, tab);

    const state = useTableEditorTabsStore.getState().byConnectionId[connectionId];
    expect(state.openTabs).toHaveLength(1);
    expect(state.activeTabKey).toBe(tab.key);
  });

  it("closes active tab and falls back to neighbor", () => {
    const connectionId = "c1";
    const a = buildTableEditorTab("public", "users");
    const b = buildTableEditorTab("public", "orders");
    const c = buildTableEditorTab("public", "products");
    const store = useTableEditorTabsStore.getState();
    store.openTab(connectionId, a);
    store.openTab(connectionId, b);
    store.openTab(connectionId, c);
    store.activateTab(connectionId, b.key);
    store.closeTab(connectionId, b.key);

    const state = useTableEditorTabsStore.getState().byConnectionId[connectionId];
    expect(state.openTabs.map((t) => t.key)).toEqual([a.key, c.key]);
    expect(state.activeTabKey).toBe(c.key);
  });

  it("supports closeOthers and closeAll", () => {
    const connectionId = "c1";
    const a = buildTableEditorTab("public", "users");
    const b = buildTableEditorTab("public", "orders");
    const store = useTableEditorTabsStore.getState();
    store.openTab(connectionId, a);
    store.openTab(connectionId, b);
    store.closeOthers(connectionId, a.key);

    let state = useTableEditorTabsStore.getState().byConnectionId[connectionId];
    expect(state.openTabs).toHaveLength(1);
    expect(state.activeTabKey).toBe(a.key);

    store.closeAll(connectionId);
    state = useTableEditorTabsStore.getState().byConnectionId[connectionId];
    expect(state.openTabs).toHaveLength(0);
    expect(state.activeTabKey).toBeNull();
  });
});
