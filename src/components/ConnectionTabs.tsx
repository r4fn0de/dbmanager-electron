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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConnections } from "@/hooks/useConnections";
import {
  detectConnectionProvider,
  useConnectionTabsStore,
} from "@/lib/stores/connection-tabs";
import { cn } from "@/lib/utils";
import type { ConnectionTab } from "@/lib/stores/connection-tabs";

export function ConnectionTabs() {
  const { tabs, activeTabId, removeTab, setActiveTab, reorderTabs } =
    useConnectionTabsStore();
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragSrcIndex = useRef<number | null>(null);
  const dragSrcWidth = useRef<number>(0);
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

  // Derive the effective active tab: if the URL shows a database page, that
  // connection is active; otherwise (home page) no tab is visually active.
  // This replaces an Effect that called setActiveTab — derived state should
  // be calculated during render, not set via Effect.
  const effectiveActiveId = currentConnectionId ?? activeTabId;

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

  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const el = containerRef.current;
    if (!el) return;
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    e.preventDefault();
    el.scrollLeft += e.deltaY;
  }, []);

  if (tabs.length === 0) return null;

  const isDragging = dragOverIndex !== null;
  const srcIdx = dragSrcIndex.current;
  const GAP = 4; // gap-1 = 4px

  // Compute the horizontal offset for a tab at the given index during drag.
  // Tabs between the source and the hover target shift to create a visual gap
  // at the drop position, while the source tab becomes invisible.
  function getDragOffset(tabIndex: number): number {
    if (!isDragging || srcIdx === null || dragOverIndex === null) return 0;
    if (tabIndex === srcIdx) return 0; // source stays in DOM position

    const shift = dragSrcWidth.current + GAP;

    if (srcIdx < dragOverIndex) {
      // Dragging right → tabs between src+1 and target shift left
      if (tabIndex > srcIdx && tabIndex <= dragOverIndex) return -shift;
    } else if (srcIdx > dragOverIndex) {
      // Dragging left → tabs between target and src-1 shift right
      if (tabIndex >= dragOverIndex && tabIndex < srcIdx) return shift;
    }

    return 0;
  }

  const handleDragStart = (e: React.DragEvent, index: number) => {
    dragSrcIndex.current = index;
    dragSrcWidth.current = (e.currentTarget as HTMLElement).offsetWidth;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
    // Delay opacity change so the browser ghost image captures the tab at full opacity
    requestAnimationFrame(() => {
      const el = e.currentTarget as HTMLElement;
      el.style.opacity = "0";
    });
  };

  const handleDragEnd = (e: React.DragEvent) => {
    (e.currentTarget as HTMLElement).style.opacity = "";
    setDragOverIndex(null);
    dragSrcIndex.current = null;
    dragSrcWidth.current = 0;
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverIndex(index);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    const related = e.relatedTarget as HTMLElement | null;
    if (related && (e.currentTarget as HTMLElement).contains(related)) return;
    setDragOverIndex(null);
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    const from = dragSrcIndex.current;
    // Reset drag state immediately so transforms are removed in the same render
    setDragOverIndex(null);
    dragSrcIndex.current = null;
    dragSrcWidth.current = 0;

    if (from !== null && from !== dropIndex) {
      reorderTabs(from, dropIndex);
    }
  };

  return (
    <div
      ref={containerRef}
      role="tablist"
      aria-label="Connection tabs"
      onWheel={handleWheel}
      className="flex items-center h-full gap-1 overflow-x-auto scrollbar-none pl-0 pr-1 pt-2 pb-2"
    >
      {tabs.map((tab, index) => {
        const isActive = tab.id === effectiveActiveId;
        const colorDot = tab.color || (tab.isLocal ? "#22c55e" : undefined);
        const dragOffset = getDragOffset(index);

        return (
          <div
            key={tab.id}
            ref={(el) => {
              tabRefs.current[tab.id] = el;
            }}
            role="tab"
            tabIndex={isActive ? 0 : -1}
            aria-selected={isActive}
            draggable
            onDragStart={(e) => handleDragStart(e, index)}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => handleDragOver(e, index)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, index)}
            onClick={() => handleTabClick(tab.id)}
            onKeyDown={(e) => handleTabKeyDown(e, tab.id)}
            onMouseDown={(e) => handleMouseDown(e, tab.id)}
            className={cn(
              "group relative flex items-center gap-1.5 h-[32px] px-2.5 pr-1 text-xs font-medium",
              "rounded-lg shrink-0 outline-none cursor-default",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
              // Use transition-transform for smooth drag shifts; separate from
              // the other transitions (bg, color) to avoid lag on hover/click.
              isDragging
                ? "transition-transform duration-150 ease-out"
                : "transition-all",
              isActive
                ? "bg-background text-foreground"
                : "text-muted-foreground hover:bg-muted/40",
            )}
            style={{
              overflow: "visible",
              transform: dragOffset !== 0 ? `translateX(${dragOffset}px)` : undefined,
            }}
            title={tab.name}
          >
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
 * Keeps tab data in sync with the latest connection info and removes
 * stale tabs for deleted connections. When a stale tab is the currently
 * active route, navigates to the nearest sibling or home.
 */
export function useConnectionTabSync() {
  const { tabs, updateTab, removeTab } = useConnectionTabsStore();
  const { connections, isLoading, refetch } = useConnections();
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
