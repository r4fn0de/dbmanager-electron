import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface TableEditorTab {
  key: string; // schema.table
  label: string;
  schema: string;
  table: string;
}

interface TableEditorTabsConnectionState {
  activeTabKey: string | null;
  openTabs: TableEditorTab[];
}

interface TableEditorTabsState {
  activateTab: (connectionId: string, key: string | null) => void;
  byConnectionId: Record<string, TableEditorTabsConnectionState>;
  closeAll: (connectionId: string) => void;
  closeOthers: (connectionId: string, keepKey: string) => void;
  closeTab: (connectionId: string, key: string) => void;
  openTab: (connectionId: string, tab: TableEditorTab) => void;
  removeMissingTabs: (
    connectionId: string,
    existingKeys: Set<string>
  ) => string[];
  reorderTabs: (
    connectionId: string,
    fromIndex: number,
    toIndex: number
  ) => void;
  replaceTabKey: (
    connectionId: string,
    oldKey: string,
    nextTab: TableEditorTab
  ) => void;
}

function getOrInitConnectionState(
  byConnectionId: Record<string, TableEditorTabsConnectionState>,
  connectionId: string
): TableEditorTabsConnectionState {
  return byConnectionId[connectionId] ?? { activeTabKey: null, openTabs: [] };
}

export const useTableEditorTabsStore = create<TableEditorTabsState>()(
  persist(
    (set) => ({
      activateTab: (connectionId, key) =>
        set((state) => {
          const current = getOrInitConnectionState(
            state.byConnectionId,
            connectionId
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
      byConnectionId: {},

      closeAll: (connectionId) =>
        set((state) => ({
          byConnectionId: {
            ...state.byConnectionId,
            [connectionId]: { activeTabKey: null, openTabs: [] },
          },
        })),

      closeOthers: (connectionId, keepKey) =>
        set((state) => {
          const current = getOrInitConnectionState(
            state.byConnectionId,
            connectionId
          );
          const keep = current.openTabs.find((t) => t.key === keepKey);
          if (!keep) {
            return state;
          }
          return {
            byConnectionId: {
              ...state.byConnectionId,
              [connectionId]: {
                activeTabKey: keep.key,
                openTabs: [keep],
              },
            },
          };
        }),

      closeTab: (connectionId, key) =>
        set((state) => {
          const current = getOrInitConnectionState(
            state.byConnectionId,
            connectionId
          );
          const idx = current.openTabs.findIndex((t) => t.key === key);
          if (idx < 0) {
            return state;
          }

          const openTabs = current.openTabs.filter((t) => t.key !== key);
          let activeTabKey = current.activeTabKey;
          if (current.activeTabKey === key) {
            const next = openTabs[idx] ?? openTabs[idx - 1] ?? null;
            activeTabKey = next?.key ?? null;
          }

          return {
            byConnectionId: {
              ...state.byConnectionId,
              [connectionId]: { activeTabKey, openTabs },
            },
          };
        }),

      openTab: (connectionId, tab) =>
        set((state) => {
          const current = getOrInitConnectionState(
            state.byConnectionId,
            connectionId
          );
          const exists = current.openTabs.some((t) => t.key === tab.key);
          const openTabs = exists
            ? current.openTabs
            : [...current.openTabs, tab];
          return {
            byConnectionId: {
              ...state.byConnectionId,
              [connectionId]: {
                activeTabKey: tab.key,
                openTabs,
              },
            },
          };
        }),

      removeMissingTabs: (connectionId, existingKeys) => {
        const removed: string[] = [];
        set((state) => {
          const current = getOrInitConnectionState(
            state.byConnectionId,
            connectionId
          );
          const openTabs = current.openTabs.filter((tab) => {
            const keep = existingKeys.has(tab.key);
            if (!keep) {
              removed.push(tab.key);
            }
            return keep;
          });

          if (removed.length === 0) {
            return state;
          }

          const activeTabKey = openTabs.some(
            (t) => t.key === current.activeTabKey
          )
            ? current.activeTabKey
            : (openTabs[0]?.key ?? null);

          return {
            byConnectionId: {
              ...state.byConnectionId,
              [connectionId]: { activeTabKey, openTabs },
            },
          };
        });
        return removed;
      },

      reorderTabs: (connectionId, fromIndex, toIndex) =>
        set((state) => {
          const current = getOrInitConnectionState(
            state.byConnectionId,
            connectionId
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
          if (!moved) {
            return state;
          }
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
            connectionId
          );
          const idx = current.openTabs.findIndex((t) => t.key === oldKey);
          if (idx < 0) {
            return state;
          }
          const openTabs = [...current.openTabs];
          openTabs[idx] = nextTab;
          return {
            byConnectionId: {
              ...state.byConnectionId,
              [connectionId]: {
                activeTabKey:
                  current.activeTabKey === oldKey
                    ? nextTab.key
                    : current.activeTabKey,
                openTabs,
              },
            },
          };
        }),
    }),
    {
      name: "table-editor-tabs",
    }
  )
);

export function buildTableEditorTab(
  schema: string,
  table: string
): TableEditorTab {
  return {
    key: `${schema}.${table}`,
    label: `${schema}.${table}`,
    schema,
    table,
  };
}
