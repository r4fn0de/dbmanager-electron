import {
  useMatchRoute,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { Globe, HardDrive, Server, X } from "lucide-react";
import { Neon } from "@/components/icons/Neon";
import { Supabase } from "@/components/icons/Supabase";
import type { ConnectionProvider } from "@/lib/stores/connection-tabs";
import type { Connection } from "@/ipc/db/types";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useConnections } from "@/hooks/useConnections";
import { useConnectionTabsStore } from "@/lib/stores/connection-tabs";
import { cn } from "@/utils/tailwind";

function resolveProviderHost(conn: Connection): string {
  if (conn.url) {
    try {
      return new URL(conn.url).hostname.toLowerCase();
    } catch {
      // fall back to parsed host from backend when URL cannot be parsed.
    }
  }
  return conn.host.toLowerCase();
}

function detectConnectionProvider(conn: Connection): ConnectionProvider {
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

export function ConnectionTabs() {
  const { tabs, activeTabId, removeTab, setActiveTab } =
    useConnectionTabsStore();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const matchRoute = useMatchRoute();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const dbMatch = matchRoute({ to: "/database/$connectionId", fuzzy: true });
  const currentConnectionId =
    dbMatch && typeof dbMatch === "object" && "connectionId" in dbMatch
      ? (dbMatch.connectionId as string)
      : null;

  // Sync active tab with current route
  useEffect(() => {
    if (currentConnectionId && currentConnectionId !== activeTabId) {
      setActiveTab(currentConnectionId);
    } else if (!currentConnectionId && activeTabId && pathname === "/") {
      setActiveTab(null);
    }
  }, [currentConnectionId, activeTabId, setActiveTab, pathname]);

  const handleTabClick = useCallback(
    (id: string) => {
      setActiveTab(id);
      navigate({
        to: "/database/$connectionId",
        params: { connectionId: id },
      });
    },
    [navigate, setActiveTab],
  );

  const handleClose = useCallback(
    (e: React.MouseEvent | React.KeyboardEvent, id: string) => {
      e.stopPropagation();
      const wasActive = activeTabId === id;
      const idx = tabs.findIndex((t) => t.id === id);
      const remaining = tabs.filter((t) => t.id !== id);

      removeTab(id);

      // If we closed the active tab, navigate to the nearest sibling or home
      if (wasActive) {
        if (remaining.length > 0) {
          const nextIdx = Math.min(idx, remaining.length - 1);
          const nextTab = remaining[nextIdx];
          if (nextTab) {
            navigate({
              to: "/database/$connectionId",
              params: { connectionId: nextTab.id },
            });
          }
        } else {
          navigate({ to: "/" });
        }
      }
    },
    [activeTabId, tabs, removeTab, navigate],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, id: string) => {
      // Middle-click to close
      if (e.button === 1) {
        e.preventDefault();
        handleClose(e, id);
      }
    },
    [handleClose],
  );

  const handleTabKeyDown = useCallback(
    (e: React.KeyboardEvent, id: string) => {
      const idx = tabs.findIndex((t) => t.id === id);
      if (idx < 0) return;

      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleTabClick(id);
        return;
      }

      if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        handleClose(e, id);
        return;
      }

      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      const dir = e.key === "ArrowRight" ? 1 : -1;
      const nextIdx = (idx + dir + tabs.length) % tabs.length;
      const next = tabs[nextIdx];
      if (!next) return;
      handleTabClick(next.id);
      tabRefs.current[next.id]?.focus();
    },
    [tabs, handleClose, handleTabClick],
  );

  useEffect(() => {
    if (!activeTabId) return;
    tabRefs.current[activeTabId]?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "nearest",
    });
  }, [activeTabId, tabs.length]);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const el = containerRef.current;
    if (!el) return;
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    e.preventDefault();
    el.scrollLeft += e.deltaY;
  }, []);

  if (tabs.length === 0) return null;

  return (
    <div
      ref={containerRef}
      role="tablist"
      aria-label="Connection tabs"
      onWheel={handleWheel}
      className="flex items-center h-full gap-1 overflow-x-auto scrollbar-none pl-0 pr-1 pt-2 pb-2"
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        const colorDot = tab.color || (tab.isLocal ? "#22c55e" : undefined);

        return (
          <div
            key={tab.id}
            ref={(el) => {
              tabRefs.current[tab.id] = el;
            }}
            role="tab"
            tabIndex={isActive ? 0 : -1}
            aria-selected={isActive}
            onClick={() => handleTabClick(tab.id)}
            onKeyDown={(e) => handleTabKeyDown(e, tab.id)}
            onMouseDown={(e) => handleMouseDown(e, tab.id)}
            className={cn(
              "group relative flex items-center gap-1.5 h-[32px] px-2.5 pr-1 text-xs font-medium transition-all",
              "rounded-lg shrink-0 outline-none cursor-default",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
              isActive
                ? "bg-background text-foreground"
                : "text-muted-foreground hover:bg-muted/40",
            )}
            style={{ overflow: "visible" }}
            title={tab.name}
          >
            {/* Provider icon or color indicator */}
            {tab.provider === "neon" ? (
              <Neon className="h-3.5 w-3.5 shrink-0" />
            ) : tab.provider === "supabase" ? (
              <Supabase className="h-3.5 w-3.5 shrink-0" />
            ) : tab.isLocal ? (
              <HardDrive className="h-3 w-3 shrink-0 text-green-500" />
            ) : colorDot ? (
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: colorDot }}
              />
            ) : tab.provider === "url" ? (
              <Globe className="h-3 w-3 shrink-0 text-muted-foreground" />
            ) : (
              <Server className="h-3 w-3 shrink-0 text-muted-foreground" />
            )}

            <span className="truncate max-w-[140px]">{tab.name}</span>

            {/* Close button */}
            <button
              type="button"
              onClick={(e) => handleClose(e, tab.id)}
              onMouseDown={(e) => e.stopPropagation()}
              className={cn(
                "ml-0.5 rounded-sm p-0.5 transition-opacity outline-none",
                "focus-visible:ring-2 focus-visible:ring-ring",
                "hover:bg-muted hover:text-foreground",
                isActive
                  ? "opacity-60 hover:opacity-100"
                  : "opacity-0 group-hover:opacity-70 hover:!opacity-100",
              )}
              aria-label={`Close ${tab.name}`}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Hook that auto-adds a tab when navigating to a database page.
 * Must be used inside a component that has access to useConnections.
 */
export function useConnectionTabSync() {
  const { tabs, addTab, updateTab } = useConnectionTabsStore();
  const { connections, isLoading } = useConnections();
  const matchRoute = useMatchRoute();

  const dbMatch = matchRoute({ to: "/database/$connectionId", fuzzy: true });
  const currentConnectionId =
    dbMatch && typeof dbMatch === "object" && "connectionId" in dbMatch
      ? (dbMatch.connectionId as string)
      : null;

  const knownTabIds = useMemo(() => new Set(tabs.map((t) => t.id)), [tabs]);

  // Add tab for the current route if it doesn't exist yet
  useEffect(() => {
    if (!currentConnectionId) return;
    if (knownTabIds.has(currentConnectionId)) return;

    const conn = connections.find((c) => c.id === currentConnectionId);
    if (!conn && isLoading) return; // wait for connections to load

    addTab({
      id: currentConnectionId,
      name: conn?.name ?? currentConnectionId.slice(0, 8),
      isLocal: conn?.is_local,
      color: conn?.color,
      provider: conn ? detectConnectionProvider(conn) : undefined,
    });
  }, [currentConnectionId, knownTabIds, connections, isLoading, addTab]);

  // Sync existing tabs with fresh connection data (name, provider, color, isLocal)
  useEffect(() => {
    if (isLoading || connections.length === 0) return;

    for (const tab of tabs) {
      const conn = connections.find((c) => c.id === tab.id);
      if (!conn) continue;

      const freshProvider = detectConnectionProvider(conn);
      const needsUpdate =
        tab.name !== conn.name ||
        tab.provider !== freshProvider ||
        tab.color !== conn.color ||
        tab.isLocal !== conn.is_local;

      if (needsUpdate) {
        updateTab(tab.id, {
          name: conn.name,
          provider: freshProvider,
          color: conn.color,
          isLocal: conn.is_local,
        });
      }
    }
  }, [connections, isLoading, tabs, updateTab]);
}
