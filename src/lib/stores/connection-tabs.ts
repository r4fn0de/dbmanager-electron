import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ConnectionProvider = "neon" | "supabase" | "url" | "direct";

export type SidebarSection = "overview" | "tables" | "sql-editor" | "settings";

export interface ConnectionTab {
  id: string;
  name: string;
  isLocal?: boolean;
  color?: string;
  provider?: ConnectionProvider;
  lastSection?: SidebarSection;
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
  clearTabs: () => void;
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

          // If closing the active tab, focus the nearest sibling
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
