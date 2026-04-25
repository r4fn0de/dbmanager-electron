import {
  useMatchRoute,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { motion, Reorder } from "motion/react";
import { Icon } from "@/components/ui/Icon";
import { Neon } from "@/components/icons/Neon";
import { Supabase } from "@/components/icons/Supabase";
import { MySql } from "@/components/icons/MySql";
import { ClickHouse } from "@/components/icons/ClickHouse";
import { Redis } from "@/components/icons/Redis";
import { PostgreSql } from "@/components/icons/PostgreSql";
import { Sqlite } from "@/components/icons/Sqlite";
import type { ConnectionProvider } from "@/lib/stores/connection-tabs";
import type { Connection } from "@/ipc/db/types";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useConnectionsList } from "@/hooks/useConnectionsList";
import { useLocalDatabases } from "@/hooks/useLocalDatabases";
import {
  detectConnectionProvider,
  useConnectionTabsStore,
} from "@/lib/stores/connection-tabs";
import { cn } from "@/lib/utils";
import type { ConnectionTab } from "@/lib/stores/connection-tabs";

interface ConnectionTabsProps {
  gooeyFilterId?: string;
}

export function ConnectionTabs({ gooeyFilterId }: ConnectionTabsProps) {
  const { tabs, activeTabId, removeTab, setActiveTab, reorderTabsByIds } =
    useConnectionTabsStore();
  const { connections } = useConnectionsList();
  const { databases: localDatabases } = useLocalDatabases();
  const suppressClickRef = useRef(false);
  const navigate = useNavigate();
  const containerRef = useRef<HTMLUListElement | null>(null);
  const tabRefs = useRef<Record<string, HTMLLIElement | null>>({});
  const matchRoute = useMatchRoute();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const dbMatch = matchRoute({ to: "/database/$connectionId", fuzzy: true });
  const currentConnectionId =
    dbMatch && typeof dbMatch === "object" && "connectionId" in dbMatch
      ? (dbMatch.connectionId as string)
      : null;

  // Derive the effective active tab: if the URL shows a database page, that
  // connection is active; otherwise (home page) no tab is visually active.
  // This replaces an Effect that called setActiveTab — derived state should
  // be calculated during render, not set via Effect.
  const effectiveActiveId = currentConnectionId ?? activeTabId;
  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === effectiveActiveId) ?? null,
    [tabs, effectiveActiveId],
  );
  const [activeTabOverlapsSidebar, setActiveTabOverlapsSidebar] = useState(false);

  // Only sync the store's activeTabId when the user explicitly interacts
  // (click tab, close tab) or when navigating from a database page to home.
  // The navigation-to-home case needs an Effect because it's synchronizing
  // with the router (external system).
  useEffect(() => {
    if (!currentConnectionId && pathname === "/" && activeTabId) {
      setActiveTab(null);
    }
  }, [currentConnectionId, pathname, activeTabId, setActiveTab]);

  const handleTabClick = useCallback(
    (id: string) => {
      if (suppressClickRef.current) return;
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
    if (!effectiveActiveId) return;
    tabRefs.current[effectiveActiveId]?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "nearest",
    });
  }, [effectiveActiveId, tabs.length]);

  const measureActiveTabOverlap = useCallback(() => {
    if (!effectiveActiveId || !activeTab?.chrome) {
      setActiveTabOverlapsSidebar(false);
      return;
    }
    const sidebarWidth = activeTab.chromeWidthPx ?? 0;
    if (sidebarWidth <= 0) {
      setActiveTabOverlapsSidebar(false);
      return;
    }

    const activeEl = tabRefs.current[effectiveActiveId];
    if (!activeEl) {
      setActiveTabOverlapsSidebar(false);
      return;
    }

    const rect = activeEl.getBoundingClientRect();
    const sidebarLeft = 0;
    const sidebarRight = sidebarWidth;
    const overlaps = rect.left < sidebarRight && rect.right > sidebarLeft;
    setActiveTabOverlapsSidebar(overlaps);
  }, [effectiveActiveId, activeTab]);

  useLayoutEffect(() => {
    measureActiveTabOverlap();

    const onWindowResize = () => measureActiveTabOverlap();
    window.addEventListener("resize", onWindowResize);

    const container = containerRef.current;
    const onScroll = () => measureActiveTabOverlap();
    container?.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      window.removeEventListener("resize", onWindowResize);
      container?.removeEventListener("scroll", onScroll);
    };
  }, [measureActiveTabOverlap, pathname, tabs.length]);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLUListElement>) => {
    const el = containerRef.current;
    if (!el) return;
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    e.preventDefault();
    el.scrollLeft += e.deltaY;
  }, []);

  if (tabs.length === 0) return null;
  const tabIds = useMemo(() => tabs.map((tab) => tab.id), [tabs]);
  const connectionsById = useMemo(
    () => new Map(connections.map((connection) => [connection.id, connection])),
    [connections],
  );
  const localDbsById = useMemo(
    () => new Map(localDatabases.map((localDb) => [localDb.id, localDb])),
    [localDatabases],
  );
  const handleReorder = useCallback(
    (nextOrder: string[]) => {
      reorderTabsByIds(nextOrder);
    },
    [reorderTabsByIds],
  );

  return (
    <Reorder.Group
      axis="x"
      values={tabIds}
      onReorder={handleReorder}
      layoutScroll
      ref={containerRef}
      role="tablist"
      aria-label="Connection tabs"
      onWheel={handleWheel}
      className={cn(
        "flex items-center h-full gap-1 overflow-x-auto scrollbar-none pl-0 pr-1 pt-2 pb-2",
        gooeyFilterId &&
          "items-end pt-0 pb-0 px-1 -translate-y-[5px] mb-[-6px] gap-[3px]",
      )}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === effectiveActiveId;
        const colorDot = tab.color || (tab.isLocal ? "#22c55e" : undefined);
        const localDbType =
          localDbsById.get(tab.id)?.engine
          ?? (connectionsById.get(tab.id)?.db_type === "sqlite" ? "sqlite" : "postgresql");
        const LocalDbTypeIcon = localDbType === "sqlite" ? Sqlite : PostgreSql;
        const shouldUseSidebarTint = isActive && activeTabOverlapsSidebar && !!tab.chrome;
        const activeChromeClass =
          shouldUseSidebarTint && tab.chrome === "tables-sidebar"
            ? "bg-sidebar"
            : shouldUseSidebarTint && tab.chrome === "sql-sidebar"
              ? "bg-sidebar"
              : "bg-background";

        return (
          <Reorder.Item
            key={tab.id}
            value={tab.id}
            layout="position"
            dragMomentum={false}
            dragElastic={0}
            dragConstraints={containerRef}
            whileDrag={{ zIndex: 40 }}
            transition={{ type: "spring", stiffness: 550, damping: 42, mass: 0.7 }}
            ref={(el: HTMLLIElement | null) => {
              tabRefs.current[tab.id] = el;
            }}
            role="tab"
            tabIndex={isActive ? 0 : -1}
            aria-selected={isActive}
            onDragStart={() => {
              suppressClickRef.current = true;
            }}
            onDragEnd={() => {
              requestAnimationFrame(() => {
                suppressClickRef.current = false;
              });
            }}
            onClick={() => handleTabClick(tab.id)}
            onKeyDown={(e) => handleTabKeyDown(e, tab.id)}
            onMouseDown={(e) => handleMouseDown(e, tab.id)}
            className={cn(
              "group relative flex items-center justify-center gap-1.5 h-[39px] w-[128px] px-0 text-xs font-medium",
              "rounded-sm shrink-0 outline-none cursor-default",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
              "transition-colors duration-150",
              isActive
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
              !isActive &&
                "isolate after:absolute after:inset-x-0 after:top-[1px] after:bottom-[4px] after:rounded-md after:bg-transparent after:transition-colors hover:after:bg-muted/60",
              gooeyFilterId &&
                (isActive
                  ? "rounded-t-[5px] rounded-b-[5px]"
                  : "rounded-[5px]"),
            )}
            style={{
              overflow: "visible",
            }}
            title={tab.name}
          >
            {gooeyFilterId && isActive && (
              <div
                className="absolute inset-0 pointer-events-none z-0"
                style={{ filter: `url(#${gooeyFilterId})` }}
                aria-hidden="true"
              >
                <motion.div
                  layoutId="titlebar-gooey-active-tab"
                  className={cn("absolute inset-0 rounded-t-[8px] rounded-b-[4px]", activeChromeClass)}
                  transition={{
                    type: "spring",
                    bounce: 0,
                    duration: 0.35,
                  }}
                />
                <motion.div
                  layoutId="titlebar-gooey-active-tab-bridge"
                  className={cn("absolute -left-4 -right-4 -bottom-5 h-5 rounded-b-[22px]", activeChromeClass)}
                  transition={{
                    type: "spring",
                    bounce: 0,
                    duration: 0.35,
                  }}
                />
              </div>
            )}

            <div className="relative z-10 flex w-full min-w-0 -translate-y-[2px] items-center justify-start gap-1.5 pl-3 pr-3">
              {tab.provider === "neon" ? (
                <Neon className="size-3.5 shrink-0" />
              ) : tab.provider === "supabase" ? (
                <Supabase className="size-3.5 shrink-0" />
              ) : tab.provider === "mysql" || tab.provider === "mariadb" ? (
                <MySql className="size-3.5 shrink-0" />
              ) : tab.provider === "clickhouse" ? (
                <ClickHouse className="size-3.5 shrink-0" />
              ) : tab.provider === "redis" ? (
                <Redis className="size-3.5 shrink-0" />
              ) : tab.isLocal ? (
                <LocalDbTypeIcon className="size-3.5 shrink-0" />
              ) : colorDot ? (
                <span
                  className="size-2 rounded-full shrink-0"
                  style={{ backgroundColor: colorDot }}
                />
              ) : tab.provider === "url" ? (
                <Icon name="globe" className="size-3 shrink-0 text-current/70 transition-colors group-hover:text-current" />
              ) : (
                <Icon name="server" className="size-3 shrink-0 text-current/70 transition-colors group-hover:text-current" />
              )}

              <div className="relative min-w-0 flex-1 pr-1 transition-[padding-right] duration-150 group-hover:pr-5">
                <span
                  className="block truncate"
                  style={{
                    WebkitMaskImage:
                      "linear-gradient(to right, black 0%, black 78%, transparent 100%)",
                    maskImage:
                      "linear-gradient(to right, black 0%, black 78%, transparent 100%)",
                  }}
                >
                  {tab.name}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={(e) => handleClose(e, tab.id)}
              onMouseDown={(e) => e.stopPropagation()}
              className={cn(
                "absolute right-1.5 top-[calc(50%-2px)] -translate-y-1/2 z-10 inline-flex size-5 items-center justify-center rounded-sm p-0.5 transition-opacity outline-none",
                "focus-visible:ring-2 focus-visible:ring-ring",
                "text-muted-foreground hover:bg-muted hover:text-foreground",
                "opacity-0 group-hover:opacity-80 hover:!opacity-100 focus-visible:opacity-100",
              )}
              aria-label={`Close ${tab.name}`}
            >
              <Icon name="x" className="size-3" />
            </button>
          </Reorder.Item>
        );
      })}
    </Reorder.Group>
  );
}

/**
 * Keeps tab data in sync with the latest connection info and removes
 * stale tabs for deleted connections. When a stale tab is the currently
 * active route, navigates to the nearest sibling or home.
 */
export function useConnectionTabSync() {
  const { tabs, updateTab, removeTab } = useConnectionTabsStore();
  const { connections, isLoading } = useConnectionsList();
  const navigate = useNavigate();
  const matchRoute = useMatchRoute();

  const connectionIds = useMemo(
    () => new Set(connections.map((c) => c.id)),
    [connections],
  );

  // Keep a ref to the current tabs so the navigation helper can read the
  // latest state without being a dependency of the Effect.
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  // Navigate away from a deleted connection's page to the nearest sibling
  // or the home page.
  const navigateAwayFromDeleted = useCallback(
    (deletedId: string) => {
      const currentTabs = tabsRef.current;
      const remaining = currentTabs.filter((t: ConnectionTab) => t.id !== deletedId);
      const dbMatch = matchRoute({ to: "/database/$connectionId", fuzzy: true });
      const currentConnectionId =
        dbMatch && typeof dbMatch === "object" && "connectionId" in dbMatch
          ? (dbMatch.connectionId as string)
          : null;

      // Only navigate if the user is currently viewing the deleted connection
      if (currentConnectionId !== deletedId) return;

      if (remaining.length > 0) {
        const deletedIdx = currentTabs.findIndex((t: ConnectionTab) => t.id === deletedId);
        const nextIdx = Math.min(deletedIdx, remaining.length - 1);
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
    },
    [matchRoute, navigate],
  );

  // Sync existing tabs with fresh connection data and remove stale tabs.
  // This is synchronizing with an external system (IPC backend) — valid Effect.
  useEffect(() => {
    if (isLoading) return;

    // Remove tabs for connections that no longer exist
    if (connections.length > 0) {
      for (const tab of tabs) {
        if (!connectionIds.has(tab.id)) {
          removeTab(tab.id);
          navigateAwayFromDeleted(tab.id);
        }
      }
    }

    // Update existing tabs with fresh connection data
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
  }, [connections, connectionIds, isLoading, tabs, updateTab, removeTab, navigateAwayFromDeleted]);
}
