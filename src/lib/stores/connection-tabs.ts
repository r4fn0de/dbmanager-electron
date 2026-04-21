import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ConnectionProvider = "neon" | "supabase" | "mysql" | "mariadb" | "url" | "direct";
export type ConnectionTabChrome = "tables-sidebar" | "sql-sidebar";

export type SidebarSection = "overview" | "tables" | "sql-editor" | "visualizer" | "settings";

export interface ConnectionTab {
  id: string;
  name: string;
  isLocal?: boolean;
  color?: string;
  provider?: ConnectionProvider;
  chrome?: ConnectionTabChrome;
  chromeWidthPx?: number;
  lastSection?: SidebarSection;
  lastSchema?: string;
  lastTable?: string;
}

interface ConnectionTabsState {
  tabs: ConnectionTab[];
  activeTabId: string | null;

  addTab: (tab: ConnectionTab) => void;
  removeTab: (id: string) => void;
  setActiveTab: (id: string | null) => void;
  renameTab: (id: string, name: string) => void;
  updateTab: (id: string, data: Partial<Omit<ConnectionTab, "id">>) => void;
  setTabSection: (id: string, section: SidebarSection) => void;
  setTabNavState: (id: string, state: { section: SidebarSection; schema?: string; table?: string }) => void;
  reorderTabs: (fromIndex: number, toIndex: number) => void;
  reorderTabsByIds: (orderedIds: string[]) => void;
  clearTabs: () => void;
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

  // Detect by db_type for MySQL/MariaDB
  if (conn.db_type === "mysql") return "mysql";
  if (conn.db_type === "mariadb") return "mariadb";

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
    id: conn.id,
    name: conn.name,
    isLocal: conn.is_local,
    color: conn.color,
    provider: detectConnectionProvider(conn),
  };
}

export const useConnectionTabsStore = create<ConnectionTabsState>()(
  persist(
    (set) => ({
      tabs: [],
      activeTabId: null,

      addTab: (tab) =>
        set((state) => {
          if (state.tabs.some((t) => t.id === tab.id)) {
            return { activeTabId: tab.id };
          }
          return {
            tabs: [...state.tabs, tab],
            activeTabId: tab.id,
          };
        }),

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

          return { tabs: next, activeTabId: nextActive };
        }),

      setActiveTab: (id) => set({ activeTabId: id }),

      renameTab: (id, name) =>
        set((state) => ({
          tabs: state.tabs.map((t) => (t.id === id ? { ...t, name } : t)),
        })),

      updateTab: (id, data) =>
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === id ? { ...t, ...data } : t,
          ),
        })),

      setTabSection: (id, section) =>
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === id ? { ...t, lastSection: section } : t,
          ),
        })),

      setTabNavState: (id, nav) =>
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === id
              ? { ...t, lastSection: nav.section, lastSchema: nav.schema, lastTable: nav.table }
              : t,
          ),
        })),

      reorderTabs: (fromIndex, toIndex) =>
        set((state) => {
          if (fromIndex === toIndex) return state;
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
          if (!moved) return state;
          next.splice(toIndex, 0, moved);
          return { tabs: next };
        }),

      reorderTabsByIds: (orderedIds) =>
        set((state) => {
          if (orderedIds.length !== state.tabs.length) return state;

          const byId = new Map(state.tabs.map((tab) => [tab.id, tab] as const));
          const next = orderedIds
            .map((id) => byId.get(id))
            .filter((tab): tab is ConnectionTab => Boolean(tab));

          if (next.length !== state.tabs.length) return state;
          return { tabs: next };
        }),

      clearTabs: () => set({ tabs: [], activeTabId: null }),
    }),
    {
      name: "connection-tabs",
      partialize: (state) => ({
        tabs: state.tabs,
        activeTabId: state.activeTabId,
      }),
    },
  ),
);
