import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ConnectionProvider =
  | "neon"
  | "supabase"
  | "mysql"
  | "mariadb"
  | "clickhouse"
  | "redis"
  | "url"
  | "direct";
export type ConnectionTabChrome = "tables-sidebar" | "sql-sidebar";

export type SidebarSection =
  | "overview"
  | "tables"
  | "keys"
  | "sql-editor"
  | "commands"
  | "visualizer"
  | "definitions";

export const SETTINGS_TAB_ID = "__settings__";

type ConnectionTabKind = "connection" | "settings";

export interface ConnectionTab {
  chrome?: ConnectionTabChrome;
  chromeWidthPx?: number;
  color?: string;
  id: string;
  isLocal?: boolean;
  kind?: ConnectionTabKind;
  lastSchema?: string;
  lastSection?: SidebarSection;
  lastTable?: string;
  name: string;
  provider?: ConnectionProvider;
}

export function buildSettingsTab(): ConnectionTab {
  return {
    id: SETTINGS_TAB_ID,
    kind: "settings",
    name: "Settings",
  };
}

export function isSettingsTab(
  tab: Pick<ConnectionTab, "id" | "kind">
): boolean {
  return tab.id === SETTINGS_TAB_ID || tab.kind === "settings";
}

interface ConnectionTabsState {
  activeTabId: string | null;

  addTab: (tab: ConnectionTab) => void;
  clearTabs: () => void;
  openSettingsTab: () => void;
  /** Tab IDs ordered by most-recently-active first (MRU stack). Not persisted. */
  recentTabIds: string[];
  removeTab: (id: string) => void;
  renameTab: (id: string, name: string) => void;
  reorderTabs: (fromIndex: number, toIndex: number) => void;
  reorderTabsByIds: (orderedIds: string[]) => void;
  setActiveTab: (id: string | null) => void;
  setTabNavState: (
    id: string,
    state: { section: SidebarSection; schema?: string; table?: string }
  ) => void;
  setTabSection: (id: string, section: SidebarSection) => void;
  tabs: ConnectionTab[];
  updateTab: (id: string, data: Partial<Omit<ConnectionTab, "id">>) => void;
}

export function resolveProviderHost(conn: {
  url?: string;
  host: string;
}): string {
  if (conn.url) {
    try {
      return new URL(conn.url).hostname.toLowerCase();
    } catch {
      // fall back to parsed host from backend
    }
  }
  return conn.host.toLowerCase();
}

export function detectConnectionProvider(conn: {
  url?: string;
  host: string;
  db_type?: string;
}): ConnectionProvider {
  const host = resolveProviderHost(conn);

  if (host.includes("neon.tech")) {
    return "neon";
  }

  if (
    host.includes("supabase.co") ||
    host.includes("supabase.com") ||
    host.includes("supabase.in")
  ) {
    return "supabase";
  }

  // Detect by db_type for MySQL/MariaDB/ClickHouse/Redis
  if (conn.db_type === "mysql") {
    return "mysql";
  }
  if (conn.db_type === "mariadb") {
    return "mariadb";
  }
  if (conn.db_type === "clickhouse") {
    return "clickhouse";
  }
  if (conn.db_type === "redis") {
    return "redis";
  }

  return conn.url ? "url" : "direct";
}

/** Build a ConnectionTab from a Connection-like object. */
export function buildConnectionTab(conn: {
  id: string;
  name: string;
  is_local?: boolean;
  color?: string;
  url?: string;
  host: string;
  db_type?: string;
}): ConnectionTab {
  return {
    color: conn.color,
    id: conn.id,
    isLocal: conn.is_local,
    name: conn.name,
    provider: detectConnectionProvider(conn),
  };
}

export const useConnectionTabsStore = create<ConnectionTabsState>()(
  persist(
    (set) => ({
      activeTabId: null,
      addTab: (tab) =>
        set((state) => {
          const recent = [
            tab.id,
            ...state.recentTabIds.filter((rid) => rid !== tab.id),
          ];
          if (state.tabs.some((t) => t.id === tab.id)) {
            return { activeTabId: tab.id, recentTabIds: recent };
          }
          return {
            activeTabId: tab.id,
            recentTabIds: recent,
            tabs: [...state.tabs, tab],
          };
        }),

      clearTabs: () => set({ activeTabId: null, recentTabIds: [], tabs: [] }),

      openSettingsTab: () =>
        set((state) => {
          const recent = [
            SETTINGS_TAB_ID,
            ...state.recentTabIds.filter((id) => id !== SETTINGS_TAB_ID),
          ];
          if (state.tabs.some((tab) => tab.id === SETTINGS_TAB_ID)) {
            return { activeTabId: SETTINGS_TAB_ID, recentTabIds: recent };
          }
          return {
            activeTabId: SETTINGS_TAB_ID,
            recentTabIds: recent,
            tabs: [...state.tabs, buildSettingsTab()],
          };
        }),
      recentTabIds: [],

      removeTab: (id) =>
        set((state) => {
          const idx = state.tabs.findIndex((t) => t.id === id);
          const next = state.tabs.filter((t) => t.id !== id);

          let nextActive = state.activeTabId;
          if (state.activeTabId === id) {
            if (next.length === 0) {
              nextActive = null;
            } else if (idx > 0) {
              nextActive = next[idx - 1]?.id ?? null;
            } else {
              nextActive = next[0]?.id ?? null;
            }
          }

          // Update MRU: remove closed tab, move next active to front
          let recent = state.recentTabIds.filter((rid) => rid !== id);
          if (nextActive) {
            recent = [
              nextActive,
              ...recent.filter((rid) => rid !== nextActive),
            ];
          }

          return { activeTabId: nextActive, recentTabIds: recent, tabs: next };
        }),

      renameTab: (id, name) =>
        set((state) => ({
          tabs: state.tabs.map((t) => (t.id === id ? { ...t, name } : t)),
        })),

      reorderTabs: (fromIndex, toIndex) =>
        set((state) => {
          if (fromIndex === toIndex) {
            return state;
          }
          if (
            fromIndex < 0 ||
            toIndex < 0 ||
            fromIndex >= state.tabs.length ||
            toIndex >= state.tabs.length
          ) {
            return state;
          }

          const next = [...state.tabs];
          const [moved] = next.splice(fromIndex, 1);
          if (!moved) {
            return state;
          }
          next.splice(toIndex, 0, moved);
          return { tabs: next };
        }),

      reorderTabsByIds: (orderedIds) =>
        set((state) => {
          if (orderedIds.length !== state.tabs.length) {
            return state;
          }

          const byId = new Map(state.tabs.map((tab) => [tab.id, tab] as const));
          const next = orderedIds
            .map((id) => byId.get(id))
            .filter((tab): tab is ConnectionTab => Boolean(tab));

          if (next.length !== state.tabs.length) {
            return state;
          }
          return { tabs: next };
        }),

      setActiveTab: (id) =>
        set((state) => {
          if (id === state.activeTabId) {
            return state;
          }
          const recent = id
            ? [id, ...state.recentTabIds.filter((rid) => rid !== id)]
            : state.recentTabIds;
          return { activeTabId: id, recentTabIds: recent };
        }),

      setTabNavState: (id, nav) =>
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === id
              ? {
                  ...t,
                  lastSchema: nav.schema,
                  lastSection: nav.section,
                  lastTable: nav.table,
                }
              : t
          ),
        })),

      setTabSection: (id, section) =>
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === id ? { ...t, lastSection: section } : t
          ),
        })),
      tabs: [],

      updateTab: (id, data) =>
        set((state) => {
          let changed = false;
          const tabs = state.tabs.map((t) => {
            if (t.id !== id) {
              return t;
            }

            const keys = Object.keys(data) as Array<
              keyof Omit<ConnectionTab, "id">
            >;
            for (const key of keys) {
              if (!Object.is(t[key], data[key])) {
                changed = true;
                break;
              }
            }

            return changed ? { ...t, ...data } : t;
          });

          if (!changed) {
            return state;
          }
          return { tabs };
        }),
    }),
    {
      name: "connection-tabs",
      partialize: (state) => ({
        activeTabId: state.activeTabId,
        tabs: state.tabs,
      }),
    }
  )
);
