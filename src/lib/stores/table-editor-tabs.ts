import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface TableEditorTab {
  key: string; // schema.table
  schema: string;
  table: string;
  label: string;
}

interface TableEditorTabsConnectionState {
  openTabs: TableEditorTab[];
  activeTabKey: string | null;
}

interface TableEditorTabsState {
  byConnectionId: Record<string, TableEditorTabsConnectionState>;
  openTab: (connectionId: string, tab: TableEditorTab) => void;
  activateTab: (connectionId: string, key: string | null) => void;
  closeTab: (connectionId: string, key: string) => void;
  closeOthers: (connectionId: string, keepKey: string) => void;
  closeAll: (connectionId: string) => void;
  reorderTabs: (
    connectionId: string,
    fromIndex: number,
    toIndex: number,
  ) => void;
  replaceTabKey: (
    connectionId: string,
    oldKey: string,
    nextTab: TableEditorTab,
  ) => void;
  removeMissingTabs: (
    connectionId: string,
    existingKeys: Set<string>,
  ) => string[];
}

function getOrInitConnectionState(
  byConnectionId: Record<string, TableEditorTabsConnectionState>,
  connectionId: string,
): TableEditorTabsConnectionState {
  return byConnectionId[connectionId] ?? { openTabs: [], activeTabKey: null };
}

export const useTableEditorTabsStore = create<TableEditorTabsState>()(
  persist(
    (set) => ({
      byConnectionId: {},

      openTab: (connectionId, tab) =>
        set((state) => {
          const current = getOrInitConnectionState(
            state.byConnectionId,
            connectionId,
          );
          const exists = current.openTabs.some((t) => t.key === tab.key);
          const openTabs = exists ? current.openTabs : [...current.openTabs, tab];
          return {
            byConnectionId: {
              ...state.byConnectionId,
              [connectionId]: {
                openTabs,
                activeTabKey: tab.key,
              },
            },
          };
        }),

      activateTab: (connectionId, key) =>
        set((state) => {
          const current = getOrInitConnectionState(
            state.byConnectionId,
            connectionId,
          );
          return {
            byConnectionId: {
              ...state.byConnectionId,
              [connectionId]: {
                ...current,
                activeTabKey: key,
              },
            },
          };
        }),

      closeTab: (connectionId, key) =>
        set((state) => {
          const current = getOrInitConnectionState(
            state.byConnectionId,
            connectionId,
          );
          const idx = current.openTabs.findIndex((t) => t.key === key);
          if (idx < 0) return state;

          const openTabs = current.openTabs.filter((t) => t.key !== key);
          let activeTabKey = current.activeTabKey;
          if (current.activeTabKey === key) {
            const next = openTabs[idx] ?? openTabs[idx - 1] ?? null;
            activeTabKey = next?.key ?? null;
          }

          return {
            byConnectionId: {
              ...state.byConnectionId,
              [connectionId]: { openTabs, activeTabKey },
            },
          };
        }),

      closeOthers: (connectionId, keepKey) =>
        set((state) => {
          const current = getOrInitConnectionState(
            state.byConnectionId,
            connectionId,
          );
          const keep = current.openTabs.find((t) => t.key === keepKey);
          if (!keep) return state;
          return {
            byConnectionId: {
              ...state.byConnectionId,
              [connectionId]: {
                openTabs: [keep],
                activeTabKey: keep.key,
              },
            },
          };
        }),

      closeAll: (connectionId) =>
        set((state) => ({
          byConnectionId: {
            ...state.byConnectionId,
            [connectionId]: { openTabs: [], activeTabKey: null },
          },
        })),

      reorderTabs: (connectionId, fromIndex, toIndex) =>
        set((state) => {
          const current = getOrInitConnectionState(
            state.byConnectionId,
            connectionId,
          );
          if (
            fromIndex === toIndex ||
            fromIndex < 0 ||
            toIndex < 0 ||
            fromIndex >= current.openTabs.length ||
            toIndex >= current.openTabs.length
          ) {
            return state;
          }
          const next = [...current.openTabs];
          const [moved] = next.splice(fromIndex, 1);
          if (!moved) return state;
          next.splice(toIndex, 0, moved);
          return {
            byConnectionId: {
              ...state.byConnectionId,
              [connectionId]: {
                ...current,
                openTabs: next,
              },
            },
          };
        }),

      replaceTabKey: (connectionId, oldKey, nextTab) =>
        set((state) => {
          const current = getOrInitConnectionState(
            state.byConnectionId,
            connectionId,
          );
          const idx = current.openTabs.findIndex((t) => t.key === oldKey);
          if (idx < 0) return state;
          const openTabs = [...current.openTabs];
          openTabs[idx] = nextTab;
          return {
            byConnectionId: {
              ...state.byConnectionId,
              [connectionId]: {
                openTabs,
                activeTabKey:
                  current.activeTabKey === oldKey
                    ? nextTab.key
                    : current.activeTabKey,
              },
            },
          };
        }),

      removeMissingTabs: (connectionId, existingKeys) => {
        let removed: string[] = [];
        set((state) => {
          const current = getOrInitConnectionState(
            state.byConnectionId,
            connectionId,
          );
          const openTabs = current.openTabs.filter((tab) => {
            const keep = existingKeys.has(tab.key);
            if (!keep) removed.push(tab.key);
            return keep;
          });

          if (removed.length === 0) return state;

          const activeTabKey = openTabs.some((t) => t.key === current.activeTabKey)
            ? current.activeTabKey
            : (openTabs[0]?.key ?? null);

          return {
            byConnectionId: {
              ...state.byConnectionId,
              [connectionId]: { openTabs, activeTabKey },
            },
          };
        });
        return removed;
      },
    }),
    {
      name: "table-editor-tabs",
    },
  ),
);

export function buildTableEditorTab(schema: string, table: string): TableEditorTab {
  return {
    key: `${schema}.${table}`,
    schema,
    table,
    label: `${schema}.${table}`,
  };
}
