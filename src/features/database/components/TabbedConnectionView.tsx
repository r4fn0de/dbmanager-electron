import { useRouterState } from "@tanstack/react-router";
import { memo, useEffect, useState } from "react";
import { useConnectionTabsStore } from "@/lib/stores/connection-tabs";
import { DatabasePageContent } from "@/routes/database/-DatabasePageContent";

/**
 * Memoized wrapper — inactive tabs skip re-renders entirely.
 */
const TabPage = memo(function TabPage({
  connectionId,
  isActive,
  animateNavOnMount,
}: {
  connectionId: string;
  isActive: boolean;
  animateNavOnMount: boolean;
}) {
  return (
    <div className={isActive ? "h-full" : "hidden"}>
      <DatabasePageContent
        connectionId={connectionId}
        isActive={isActive}
        animateNavOnMount={animateNavOnMount}
      />
    </div>
  );
});

/**
 * Renders all open connection tabs simultaneously, keeping them mounted
 * so their state is preserved when switching between tabs.
 *
 * Source of truth for the ACTIVE tab is the URL pathname, not the store.
 * This avoids hydration timing issues on reload where the store starts empty
 * before zustand persist rehydrates from localStorage.
 */
export function TabbedConnectionView() {
  const tabs = useConnectionTabsStore((s) => s.tabs);
  const storeActiveTabId = useConnectionTabsStore((s) => s.activeTabId);

  // Read pathname directly and parse /database/<id> — more reliable than
  // useMatchRoute during initial mounts.
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const urlConnectionId = (() => {
    const m = pathname.match(/^\/database\/([^/]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  })();

  // Prefer URL over store — the URL is authoritative for which tab is visible
  const activeTabId = urlConnectionId ?? storeActiveTabId;

  const [mountedTabs, setMountedTabs] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    if (activeTabId) initial.add(activeTabId);
    return initial;
  });

  // Ensure the active tab is mounted (handles hydration, URL changes, etc.)
  useEffect(() => {
    if (!activeTabId) return;
    setMountedTabs((prev) => {
      if (prev.has(activeTabId)) return prev;
      return new Set([...prev, activeTabId]);
    });
  }, [activeTabId]);

  // Unmount tabs that have been closed in the store
  useEffect(() => {
    const openIds = new Set(tabs.map((t) => t.id));
    // Preserve the URL connectionId even if not yet in tabs (hydration race)
    if (activeTabId) openIds.add(activeTabId);

    setMountedTabs((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const id of prev) {
        if (!openIds.has(id)) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [tabs, activeTabId]);

  return (
    <div className="h-full relative">
      {[...mountedTabs].map((id) => (
        <TabPage
          key={id}
          connectionId={id}
          isActive={id === activeTabId}
          animateNavOnMount={mountedTabs.size === 1}
        />
      ))}
    </div>
  );
}
