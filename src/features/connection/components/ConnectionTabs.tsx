import {
  useMatchRoute,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { motion, Reorder } from "motion/react";
import { useTheme } from "next-themes";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ClickHouse } from "@/components/icons/ClickHouse";
import { MySql } from "@/components/icons/MySql";
import { Neon } from "@/components/icons/Neon";
import { PostgreSql } from "@/components/icons/PostgreSql";
import { Redis } from "@/components/icons/Redis";
import { Sqlite } from "@/components/icons/Sqlite";
import { Supabase } from "@/components/icons/Supabase";
import { Icon } from "@/components/ui/Icon";
import { useLocalDatabases } from "@/features/localDb";
import { useAppearanceStore } from "@/lib/stores/appearance";
import type { ConnectionTab } from "@/lib/stores/connection-tabs";
import {
  detectConnectionProvider,
  isSettingsTab,
  SETTINGS_TAB_ID,
  useConnectionTabsStore,
} from "@/lib/stores/connection-tabs";
import { cn } from "@/lib/utils";
import { useConnectionsList } from "../hooks/useConnectionsList";

interface ConnectionTabsProps {
  gooeyFilterId?: string;
}

export function ConnectionTabs({ gooeyFilterId }: ConnectionTabsProps) {
  const {
    tabs,
    activeTabId,
    recentTabIds,
    removeTab,
    setActiveTab,
    reorderTabsByIds,
  } = useConnectionTabsStore();
  const { connections } = useConnectionsList();
  const { databases: localDatabases } = useLocalDatabases();
  const suppressClickRef = useRef(false);
  const navigate = useNavigate();
  const containerRef = useRef<HTMLUListElement | null>(null);
  const tabRefs = useRef<Record<string, HTMLLIElement | null>>({});
  // Track new tab IDs for entrance animation
  const prevTabIdsRef = useRef<Set<string>>(new Set());
  const [newTabIds, setNewTabIds] = useState<Set<string>>(new Set());
  // Track closing tab IDs for exit animation
  const [closingTabIds, setClosingTabIds] = useState<Set<string>>(new Set());
  const tabIds = useMemo(() => tabs.map((tab) => tab.id), [tabs]);
  const [orderedTabIds, setOrderedTabIds] = useState(tabIds);
  const orderedTabIdsRef = useRef(tabIds);
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
  const matchRoute = useMatchRoute();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { resolvedTheme } = useTheme();
  const solidBackground = useAppearanceStore((s) => s.solidBackground);
  const themePreset = useAppearanceStore((s) => s.themePreset);
  const isNeoTheme = themePreset === "neo";
  const _isDarkMode = resolvedTheme === "dark";
  const shouldShowNeoTabBorder = isNeoTheme;

  const dbMatch = matchRoute({ fuzzy: true, to: "/database/$connectionId" });
  const currentConnectionId =
    dbMatch && typeof dbMatch === "object" && "connectionId" in dbMatch
      ? (dbMatch.connectionId as string)
      : null;

  // Derive the effective active tab from the current route when possible.
  const isSettingsRoute = pathname === "/settings";
  const effectiveActiveId =
    currentConnectionId ??
    (isSettingsRoute ? SETTINGS_TAB_ID : null) ??
    activeTabId;
  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === effectiveActiveId) ?? null,
    [tabs, effectiveActiveId]
  );
  const [activeTabOverlapsSidebar, setActiveTabOverlapsSidebar] =
    useState(false);

  // Only sync the store's activeTabId when the user explicitly interacts
  // (click tab, close tab) or when navigating from a database page to home.
  // The navigation-to-home case needs an Effect because it's synchronizing
  // with the router (external system).
  useEffect(() => {
    if (!currentConnectionId && pathname === "/" && activeTabId) {
      setActiveTab(null);
    }
  }, [currentConnectionId, pathname, activeTabId, setActiveTab]);

  const navigateToTab = useCallback(
    (tab: ConnectionTab) => {
      if (isSettingsTab(tab)) {
        navigate({ to: "/settings" });
        return;
      }
      navigate({
        params: { connectionId: tab.id },
        to: "/database/$connectionId",
      });
    },
    [navigate]
  );

  const handleTabClick = useCallback(
    (id: string) => {
      if (suppressClickRef.current) {
        return;
      }
      const tab = tabs.find((candidate) => candidate.id === id);
      if (!tab) {
        return;
      }
      setActiveTab(id);
      navigateToTab(tab);
    },
    [navigateToTab, setActiveTab, tabs]
  );

  const handleClose = useCallback(
    (e: React.MouseEvent | React.KeyboardEvent, id: string) => {
      e.stopPropagation();
      const wasActive = effectiveActiveId === id;
      const idx = tabs.findIndex((t) => t.id === id);
      const tab = tabs.find((candidate) => candidate.id === id);
      const isClosingSettings = tab ? isSettingsTab(tab) : false;
      const remaining = tabs.filter((t) => t.id !== id);
      const recentFallback = isClosingSettings
        ? recentTabIds
            .filter((candidateId) => candidateId !== id)
            .map((candidateId) =>
              remaining.find((candidate) => candidate.id === candidateId)
            )
            .find((candidate): candidate is ConnectionTab => Boolean(candidate))
        : undefined;
      const nextTab =
        recentFallback ?? remaining[Math.min(idx, remaining.length - 1)];

      // Trigger exit animation before actual removal
      setClosingTabIds((prev) => new Set([...prev, id]));

      // Animate out, then remove
      const timer = setTimeout(() => {
        removeTab(id);
        setClosingTabIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });

        if (wasActive) {
          if (nextTab) {
            navigateToTab(nextTab);
          } else {
            navigate({ to: "/" });
          }
        }
      }, 300);

      // Store timer for cleanup if needed
      closeTimersRef.current[id] = timer;
    },
    [effectiveActiveId, navigate, navigateToTab, recentTabIds, removeTab, tabs]
  );

  // Ref to store close timers for cleanup
  const closeTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>(
    {}
  );

  // Cleanup all close timers on unmount to prevent memory leaks
  useEffect(
    () => () => {
      Object.values(closeTimersRef.current).forEach(clearTimeout);
    },
    []
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, id: string) => {
      if (e.button === 1) {
        e.preventDefault();
        handleClose(e, id);
      }
    },
    [handleClose]
  );

  const handleTabKeyDown = useCallback(
    (e: React.KeyboardEvent, id: string) => {
      const idx = tabs.findIndex((t) => t.id === id);
      if (idx < 0) {
        return;
      }

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

      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") {
        return;
      }
      e.preventDefault();
      const dir = e.key === "ArrowRight" ? 1 : -1;
      const nextIdx = (idx + dir + tabs.length) % tabs.length;
      const next = tabs[nextIdx];
      if (!next) {
        return;
      }
      handleTabClick(next.id);
      tabRefs.current[next.id]?.focus();
    },
    [tabs, handleClose, handleTabClick]
  );

  useEffect(() => {
    if (!effectiveActiveId) {
      return;
    }
    tabRefs.current[effectiveActiveId]?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "nearest",
    });
  }, [effectiveActiveId, tabs.length]);

  const measureActiveTabOverlap = useCallback(() => {
    if (!(effectiveActiveId && activeTab?.chrome)) {
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
    if (!el) {
      return;
    }
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) {
      return;
    }
    e.preventDefault();
    el.scrollLeft += e.deltaY;
  }, []);

  // Detect new tabs and clear the animation flag after animation completes
  useEffect(() => {
    const currentIds = new Set(tabs.map((t) => t.id));
    const newIds = [...currentIds].filter(
      (id) => !prevTabIdsRef.current.has(id)
    );

    if (newIds.length > 0) {
      setNewTabIds(new Set(newIds));

      // Clear the "new" flag and update ref after animation completes
      const timer = setTimeout(() => {
        setNewTabIds(new Set());
        prevTabIdsRef.current = currentIds;
      }, 250);

      return () => clearTimeout(timer);
    }

    prevTabIdsRef.current = currentIds;
  }, [tabs]);

  useEffect(() => {
    if (draggingTabId) {
      return;
    }

    const isSameOrder =
      orderedTabIdsRef.current.length === tabIds.length &&
      orderedTabIdsRef.current.every((id, index) => id === tabIds[index]);
    if (isSameOrder) {
      return;
    }

    orderedTabIdsRef.current = tabIds;
    setOrderedTabIds(tabIds);
  }, [draggingTabId, tabIds]);

  const connectionsById = useMemo(
    () => new Map(connections.map((connection) => [connection.id, connection])),
    [connections]
  );
  const localDbsById = useMemo(
    () => new Map(localDatabases.map((localDb) => [localDb.id, localDb])),
    [localDatabases]
  );
  const tabsById = useMemo(
    () => new Map(tabs.map((tab) => [tab.id, tab] as const)),
    [tabs]
  );
  const orderedTabs = useMemo(
    () =>
      orderedTabIds
        .map((id) => tabsById.get(id))
        .filter((tab): tab is (typeof tabs)[number] => Boolean(tab)),
    [orderedTabIds, tabsById]
  );
  const handleReorder = useCallback((nextOrder: string[]) => {
    orderedTabIdsRef.current = nextOrder;
    setOrderedTabIds(nextOrder);
  }, []);

  const handleDragEnd = useCallback(() => {
    reorderTabsByIds(orderedTabIdsRef.current);
    setDraggingTabId(null);
    requestAnimationFrame(() => {
      suppressClickRef.current = false;
    });
  }, [reorderTabsByIds]);

  const handleDragCancel = useCallback(() => {
    orderedTabIdsRef.current = tabIds;
    setOrderedTabIds(tabIds);
    setDraggingTabId(null);
    suppressClickRef.current = false;
  }, [tabIds]);
  if (tabs.length === 0) {
    return null;
  }

  return (
    <Reorder.Group
      aria-label="Application tabs"
      axis="x"
      className={cn(
        "scrollbar-none flex h-full items-center overflow-x-auto pt-2 pr-1 pb-2 pl-0",
        gooeyFilterId
          ? "mb-[-6px] -translate-y-[5px] items-end gap-[3px] px-1 pt-0 pb-0"
          : "gap-[5px]"
      )}
      layoutScroll
      onReorder={handleReorder}
      onWheel={handleWheel}
      ref={containerRef}
      role="tablist"
      values={orderedTabIds}
    >
      {orderedTabs.map((tab) => {
        const isActive = tab.id === effectiveActiveId;
        const colorDot = tab.color || (tab.isLocal ? "#22c55e" : undefined);
        const localDbType =
          localDbsById.get(tab.id)?.engine ??
          (connectionsById.get(tab.id)?.db_type === "sqlite"
            ? "sqlite"
            : "postgresql");
        const LocalDbTypeIcon = localDbType === "sqlite" ? Sqlite : PostgreSql;
        const shouldUseSidebarTint =
          isActive && activeTabOverlapsSidebar && !!tab.chrome;
        const activeChromeClass =
          shouldUseSidebarTint && tab.chrome === "tables-sidebar"
            ? "bg-sidebar"
            : shouldUseSidebarTint && tab.chrome === "sql-sidebar"
              ? "bg-sidebar"
              : "bg-background";

        const isNewTab = newTabIds.has(tab.id);
        const isClosing = closingTabIds.has(tab.id);

        return (
          <Reorder.Item
            animate={
              isClosing
                ? { opacity: 0, scale: 0.88, y: -2 }
                : { opacity: 1, scale: 1, y: 0 }
            }
            aria-selected={isActive}
            className={cn(
              "group relative flex h-[39px] w-[128px] items-center justify-center gap-1.5 px-0 font-medium text-xs",
              "shrink-0 cursor-default rounded-sm outline-none",
              draggingTabId === tab.id && "cursor-grabbing",
              shouldShowNeoTabBorder &&
                isActive &&
                "border border-border border-b-0",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
              "transition-[background-color,color,opacity] duration-150 ease-out",
              isActive
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
              "active:scale-[0.98] active:duration-75",
              !isActive &&
                cn(
                  "isolate after:absolute after:inset-x-0 after:top-[1px] after:bottom-[4px] after:bg-transparent after:transition-[background-color,opacity] after:duration-150 after:ease-out",
                  themePreset === "neo"
                    ? "after:rounded-none"
                    : "after:rounded-md",
                  solidBackground
                    ? "hover:after:bg-muted/85"
                    : "hover:after:bg-muted/60"
                ),
              gooeyFilterId &&
                (isActive
                  ? themePreset === "neo"
                    ? "rounded-t-[3px] rounded-b-0"
                    : "rounded-t-[5px] rounded-b-[5px]"
                  : themePreset === "neo"
                    ? "rounded-t-[3px] rounded-b-0"
                    : "rounded-[5px]")
            )}
            dragConstraints={containerRef}
            dragElastic={0}
            dragMomentum={false}
            initial={isNewTab ? { opacity: 0, scale: 0.92, y: -4 } : false}
            key={tab.id}
            layout="position"
            onClick={() => handleTabClick(tab.id)}
            onDragEnd={handleDragEnd}
            onDragStart={() => {
              setDraggingTabId(tab.id);
              suppressClickRef.current = true;
            }}
            onKeyDown={(event) => handleTabKeyDown(event, tab.id)}
            onMouseDown={(event) => handleMouseDown(event, tab.id)}
            onPointerCancel={handleDragCancel}
            ref={(element: HTMLLIElement | null) => {
              tabRefs.current[tab.id] = element;
            }}
            role="tab"
            tabIndex={isActive ? 0 : -1}
            title={tab.name}
            transition={{
              layout: {
                duration: 0.08,
                ease: [0.23, 1, 0.32, 1],
              },
            }}
            value={tab.id}
            whileDrag={{
              boxShadow:
                "0 8px 24px hsl(var(--foreground) / 0.08), 0 2px 8px hsl(var(--foreground) / 0.06)",
              scale: 1.04,
              zIndex: 40,
            }}
          >
            {gooeyFilterId && isActive && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 z-0"
                style={{
                  filter: isNeoTheme ? "none" : `url(#${gooeyFilterId})`,
                }}
              >
                <motion.div
                  className={cn(
                    "absolute inset-0",
                    isNeoTheme
                      ? "rounded-t-[3px] rounded-b-0"
                      : "rounded-t-[8px] rounded-b-[4px]",
                    activeChromeClass
                  )}
                  layoutId="titlebar-gooey-active-tab"
                  transition={{
                    bounce: 0,
                    damping: 35,
                    mass: 0.9,
                    stiffness: 400,
                    type: "spring",
                  }}
                />
                {!isNeoTheme && (
                  <motion.div
                    className={cn(
                      "absolute -right-4 -bottom-5 -left-4 h-5 rounded-b-[22px]",
                      activeChromeClass
                    )}
                    layoutId="titlebar-gooey-active-tab-bridge"
                    transition={{
                      bounce: 0,
                      damping: 35,
                      mass: 0.9,
                      stiffness: 400,
                      type: "spring",
                    }}
                  />
                )}
              </div>
            )}
            <div
              className={cn(
                "relative z-10 flex w-full min-w-0 items-center justify-start gap-1.5 pr-3 pl-3",
                gooeyFilterId && "-translate-y-[3px]"
              )}
            >
              {isSettingsTab(tab) ? (
                <Icon className="size-3.5 shrink-0" name="settings" />
              ) : tab.provider === "neon" ? (
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
                  className="relative size-2 shrink-0 rounded-full"
                  style={{
                    backgroundColor: colorDot,
                    boxShadow: `inset 0 0 0 0.5px ${colorDot}80, 0 0 3px ${colorDot}40`,
                  }}
                />
              ) : tab.provider === "url" ? (
                <Icon
                  className="size-3 shrink-0 text-current/70 transition-colors group-hover:text-current"
                  name="globe"
                />
              ) : (
                <Icon
                  className="size-3 shrink-0 text-current/70 transition-colors group-hover:text-current"
                  name="server"
                />
              )}

              <div className="relative min-w-0 flex-1 pr-1 transition-[padding-right] duration-150 ease-out group-hover:pr-5">
                <span
                  className="block truncate"
                  style={{
                    maskImage:
                      "linear-gradient(to right, black 0%, black 82%, transparent 94%)",
                    WebkitMaskImage:
                      "linear-gradient(to right, black 0%, black 82%, transparent 94%)",
                  }}
                >
                  {tab.name}
                </span>
              </div>
            </div>

            <button
              aria-label={`Close ${tab.name}`}
              className={cn(
                "absolute top-1/2 right-2 z-10 inline-flex size-5 items-center justify-center rounded-sm p-0.5 outline-none",
                gooeyFilterId
                  ? "-translate-y-[calc(50%+2px)]"
                  : "-translate-y-1/2",
                "transition-[opacity,transform,background-color] duration-150 ease-out",
                "focus-visible:ring-2 focus-visible:ring-ring",
                solidBackground
                  ? "text-muted-foreground hover:bg-muted/85 hover:text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
                "hover:!opacity-100 hover:!scale-105 scale-75 opacity-0 focus-visible:scale-100 focus-visible:opacity-100 group-hover:scale-100 group-hover:opacity-80"
              )}
              onClick={(e) => handleClose(e, tab.id)}
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              type="button"
            >
              <Icon className="size-3" name="x" />
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
    [connections]
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
      const remaining = currentTabs.filter(
        (t: ConnectionTab) => t.id !== deletedId
      );
      const dbMatch = matchRoute({
        fuzzy: true,
        to: "/database/$connectionId",
      });
      const currentConnectionId =
        dbMatch && typeof dbMatch === "object" && "connectionId" in dbMatch
          ? (dbMatch.connectionId as string)
          : null;

      // Only navigate if the user is currently viewing the deleted connection
      if (currentConnectionId !== deletedId) {
        return;
      }

      if (remaining.length > 0) {
        const deletedIdx = currentTabs.findIndex(
          (t: ConnectionTab) => t.id === deletedId
        );
        const nextIdx = Math.min(deletedIdx, remaining.length - 1);
        const nextTab = remaining[nextIdx];
        if (nextTab) {
          if (isSettingsTab(nextTab)) {
            navigate({ to: "/settings" });
          } else {
            navigate({
              params: { connectionId: nextTab.id },
              to: "/database/$connectionId",
            });
          }
        }
      } else {
        navigate({ to: "/" });
      }
    },
    [matchRoute, navigate]
  );

  // Sync existing tabs with fresh connection data and remove stale tabs.
  // This is synchronizing with an external system (IPC backend) — valid Effect.
  useEffect(() => {
    if (isLoading) {
      return;
    }
    const connectionsById = new Map(
      connections.map((connection) => [connection.id, connection])
    );

    // Remove tabs for connections that no longer exist
    if (connections.length > 0) {
      for (const tab of tabs) {
        if (isSettingsTab(tab)) {
          continue;
        }
        if (!connectionIds.has(tab.id)) {
          removeTab(tab.id);
          navigateAwayFromDeleted(tab.id);
        }
      }
    }

    for (const tab of tabs) {
      if (isSettingsTab(tab)) {
        continue;
      }
      const conn = connectionsById.get(tab.id);
      if (!conn) {
        continue;
      }

      const freshProvider = detectConnectionProvider(conn);
      const needsUpdate =
        tab.name !== conn.name ||
        tab.provider !== freshProvider ||
        tab.color !== conn.color ||
        tab.isLocal !== conn.is_local;

      if (needsUpdate) {
        updateTab(tab.id, {
          color: conn.color,
          isLocal: conn.is_local,
          name: conn.name,
          provider: freshProvider,
        });
      }
    }
  }, [
    connections,
    connectionIds,
    isLoading,
    tabs,
    updateTab,
    removeTab,
    navigateAwayFromDeleted,
  ]);
}
