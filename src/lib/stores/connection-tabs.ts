import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ConnectionProvider = "neon" | "supabase" | "url" | "direct";

export type SidebarSection = "overview" | "tables" | "sql-editor" | "visualizer" | "settings";

export interface ConnectionTab {
  id: string;
  name: string;
  isLocal?: boolean;
  color?: string;
  provider?: ConnectionProvider;
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
