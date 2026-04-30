import {
  createRootRoute,
  Outlet,
  useRouterState,
  useParams,
  useNavigate,
} from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AnimatePresence, motion } from "motion/react";
import { ThemeProvider } from "@/features/settings";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TitleBar } from "@/components/TitleBar";
import { Toaster } from "@/components/ui/sonner";
import { TabbedConnectionView } from "@/features/database";
import { AiChatPanel } from "@/features/ai";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  type GroupImperativeHandle,
  type Layout,
  type PanelImperativeHandle,
} from "@/components/ui/resizable";
import { useAiChatGlobalStore } from "@/lib/stores/ai-chat-global";
import { useAppearanceStore } from "@/lib/stores/appearance";
import { ipc } from "@/ipc/manager";
import { useConnectionTabsStore, detectConnectionProvider } from "@/lib/stores/connection-tabs";
import { useConnectionsList } from "@/features/connection";
import { useLocalDatabases } from "@/features/localDb";
import { cn } from "@/lib/utils";
import type { Connection, DatabaseType } from "@/ipc/db/types";
import type { UserConnectionsContext } from "@/shared/ai/streaming-contracts";

import "../styles/global.css";

// CSS transition values — runs off main thread (Emil: "CSS animations beat JS under load")
// Strong ease-out curve for both panels + clip-path reveal
const AI_PANEL_TRANSITION = "transition-[flex-grow,clip-path] duration-[220ms] ease-[cubic-bezier(0.23,1,0.32,1)]";

function isAiChatShortcut(event: KeyboardEvent): boolean {
  if (event.isComposing || event.repeat) return false;
  if (!(event.metaKey || event.ctrlKey)) return false;
  if (event.shiftKey || event.altKey) return false;

  // `code` is layout-independent (physical key), `key` is fallback.
  return event.code === "KeyJ" || event.key.toLowerCase() === "j";
}

function isLocalHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "0.0.0.0";
}

function isLikelyCloudProvider(provider: string): boolean {
  return provider === "neon" || provider === "supabase";
}

function resolveConnectionScope(connection: Connection, provider: string): "local" | "remote" {
  if (isLocalHost(connection.host)) return "local";

  if (connection.url) {
    try {
      const url = new URL(connection.url);
      if (isLocalHost(url.hostname)) return "local";
    } catch {
      // Ignore invalid URL values and continue with other signals.
    }
  }

  // Cloud providers should be treated as remote unless host/URL is explicitly local.
  if (isLikelyCloudProvider(provider)) return "remote";

  if (connection.is_local === true) return "local";
  if (connection.is_local === false) return "remote";

  // Safe default: unknown external hosts are remote.
  return "remote";
}

function buildUserConnectionsContext(input: {
  connections: Connection[];
  localDbById: Map<string, { engine: "postgresql" | "sqlite" }>;
}): UserConnectionsContext {
  const byProvider = new Map<string, number>();
  const byDbType = new Map<DatabaseType, number>();

  const summaryConnections = input.connections.map((connection) => {
    const provider = detectConnectionProvider(connection) ?? "manual";
    const scope = resolveConnectionScope(connection, provider);
    const isLocal = scope === "local";
    const localEngine = isLocal ? input.localDbById.get(connection.id)?.engine : undefined;
    const dbType = (localEngine ?? connection.db_type ?? "postgresql") as DatabaseType;

    byProvider.set(provider, (byProvider.get(provider) ?? 0) + 1);
    byDbType.set(dbType, (byDbType.get(dbType) ?? 0) + 1);

    return {
      id: connection.id,
      name: connection.name?.trim() || connection.database?.trim() || connection.id,
      dbType,
      provider,
      scope,
    };
  });

  const local = summaryConnections.filter((connection) => connection.scope === "local").length;
  const remote = summaryConnections.length - local;

  return {
    total: summaryConnections.length,
    local,
    remote,
    byProvider: Array.from(byProvider.entries())
      .map(([provider, count]) => ({ provider, count }))
      .sort((a, b) => b.count - a.count || a.provider.localeCompare(b.provider)),
    byDbType: Array.from(byDbType.entries())
      .map(([dbType, count]) => ({ dbType, count }))
      .sort((a, b) => b.count - a.count || a.dbType.localeCompare(b.dbType)),
    connections: summaryConnections,
  };
}

function Root() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isDatabaseRoute = pathname.startsWith("/database/");

  const params = useParams({ strict: false });
  const routeConnectionId = params.connectionId as string | undefined;

  const { connections } = useConnectionsList();
  const { databases: localDatabases } = useLocalDatabases();
  const localDbById = useMemo(
    () => new Map(localDatabases.map((db) => [db.id, db])),
    [localDatabases],
  );

  const isAiChatOpen = useAiChatGlobalStore((state) => state.isOpen);
  const aiPanelSize = useAiChatGlobalStore((state) => state.panelSize);
  const setAiChatOpen = useAiChatGlobalStore((state) => state.setOpen);
  const setAiPanelSize = useAiChatGlobalStore((state) => state.setPanelSize);
  const storeContext = useAiChatGlobalStore((state) => state.currentContext);
  const requestSqlInsertFromChat = useAiChatGlobalStore((state) => state.requestSqlInsert);

  const solidBackground = useAppearanceStore((s) => s.solidBackground);

  // Apply vibrancy setting on mount and when it changes
  useEffect(() => {
    void ipc.client.window.setWindowVibrancy({ solid: solidBackground });
  }, [solidBackground]);

  // Derive effective context: route params are source of truth for connectionId
  const activeConnection = routeConnectionId
    ? connections.find((c) => c.id === routeConnectionId)
    : undefined;

  const effectiveContext = useMemo(() => {
    if (activeConnection) {
      const provider = detectConnectionProvider(activeConnection);
      const resolvedProvider = provider ?? "manual";
      const scope = resolveConnectionScope(activeConnection, resolvedProvider);
      const isLocal = scope === "local";
      const localEngine = isLocal ? localDbById.get(activeConnection.id)?.engine : undefined;
      const effectiveDbType = (localEngine ?? activeConnection.db_type ?? "postgresql") as DatabaseType;
      return {
        connectionId: activeConnection.id,
        connectionLabel: activeConnection.name?.trim()
          || activeConnection.database?.trim()
          || activeConnection.id,
        dbType: effectiveDbType,
        provider,
        // Use store's schemaContext if available for the same connection, otherwise undefined
        schemaContext: storeContext.connectionId === activeConnection.id
          ? storeContext.schemaContext
          : undefined,
        connectionInfo: {
          name: activeConnection.name?.trim() || activeConnection.id,
          host: activeConnection.host,
          port: activeConnection.port,
          database: activeConnection.database,
          isLocal,
        },
        contextPreview: {
          connectionLabel: activeConnection.name?.trim()
            || activeConnection.database?.trim()
            || activeConnection.id,
          dbType: effectiveDbType,
          selectionPreview: storeContext.connectionId === activeConnection.id
            ? storeContext.contextPreview?.selectionPreview
            : undefined,
          errorPreview: storeContext.connectionId === activeConnection.id
            ? storeContext.contextPreview?.errorPreview
            : undefined,
          tablePreview: storeContext.connectionId === activeConnection.id
            ? storeContext.contextPreview?.tablePreview
            : undefined,
        },
      };
    }

    // Fallback to store context or default
    return {
      connectionId: storeContext.connectionId,
      connectionLabel: storeContext.connectionLabel,
      dbType: storeContext.dbType,
      schemaContext: storeContext.schemaContext,
      connectionInfo: undefined,
      contextPreview: storeContext.contextPreview,
    };
  }, [activeConnection, localDbById, storeContext]);

  const userConnectionsContext = useMemo(
    () => buildUserConnectionsContext({ connections, localDbById }),
    [connections, localDbById],
  );

  const panelGroupRef = useRef<GroupImperativeHandle>(null);
  const aiPanelRef = useRef<PanelImperativeHandle>(null);
  const aiResizeDraggingRef = useRef(false);
  const [isAiPanelAnimating, setIsAiPanelAnimating] = useState(false);

  const defaultLayout = useMemo((): Layout => {
    if (!isAiChatOpen) {
      return {
        "root-main": 100,
        "root-ai-chat": 0,
      };
    }

    return {
      "root-main": 100 - aiPanelSize,
      "root-ai-chat": aiPanelSize,
    };
  }, [isAiChatOpen, aiPanelSize]);

  const stopAiPanelAnimation = useCallback(() => {
    setIsAiPanelAnimating(false);
  }, []);

  const handleAiChatClose = useCallback(() => {
    setIsAiPanelAnimating(true);
    setAiChatOpen(false);
  }, [setAiChatOpen]);

  const handleAiChatToggle = useCallback(() => {
    if (isAiChatOpen) {
      handleAiChatClose();
    } else {
      setIsAiPanelAnimating(true);
      setAiChatOpen(true);
      aiPanelRef.current?.expand();
    }
  }, [isAiChatOpen, handleAiChatClose, setAiChatOpen]);

  useEffect(() => {
    return () => {
      aiResizeDraggingRef.current = false;
    };
  }, []);

  useEffect(() => {
    const finishResizeDrag = () => {
      aiResizeDraggingRef.current = false;
    };

    window.addEventListener("pointerup", finishResizeDrag, true);
    window.addEventListener("pointercancel", finishResizeDrag, true);
    window.addEventListener("mouseup", finishResizeDrag, true);
    window.addEventListener("blur", finishResizeDrag);
    return () => {
      window.removeEventListener("pointerup", finishResizeDrag, true);
      window.removeEventListener("pointercancel", finishResizeDrag, true);
      window.removeEventListener("mouseup", finishResizeDrag, true);
      window.removeEventListener("blur", finishResizeDrag);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isAiChatShortcut(event)) return;

      event.preventDefault();
      event.stopPropagation();
      handleAiChatToggle();
    };

    // Capture phase makes the shortcut resilient even when components
    // intercept keydown events in bubble phase.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [handleAiChatToggle]);

  const navigate = useNavigate();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isCtrl = event.ctrlKey || event.metaKey;

      if (event.key === "Tab" && isCtrl) {
        event.preventDefault();
        event.stopPropagation();

        const store = useConnectionTabsStore.getState();
        const { tabs, activeTabId, recentTabIds, setActiveTab } = store;
        if (tabs.length <= 1) return;

        if (event.shiftKey) {
          // Ctrl+Shift+Tab: go to least-recently-used (bottom of MRU stack)
          const openIds = new Set(tabs.map((t) => t.id));
          const candidates = recentTabIds.filter((id) => openIds.has(id) && id !== activeTabId);
          const target = candidates[candidates.length - 1] ?? tabs.find((t) => t.id !== activeTabId)?.id;
          if (target) {
            setActiveTab(target);
            navigate({ to: "/database/$connectionId", params: { connectionId: target } });
          }
        } else {
          // Ctrl+Tab: go to most-recently-used (second in MRU stack)
          const openIds = new Set(tabs.map((t) => t.id));
          const candidates = recentTabIds.filter((id) => openIds.has(id) && id !== activeTabId);
          const target = candidates[0] ?? tabs.find((t) => t.id !== activeTabId)?.id;
          if (target) {
            setActiveTab(target);
            navigate({ to: "/database/$connectionId", params: { connectionId: target } });
          }
        }
        return;
      }

      if (event.key.toLowerCase() === "w" && isCtrl && !event.shiftKey && !event.altKey) {
        // Don't intercept if focus is inside an input/textarea (so users can still type W)
        const tag = (event.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        // Also skip if inside Monaco editor (code-editor context)
        if ((event.target as HTMLElement)?.closest?.(".monaco-editor")) return;

        event.preventDefault();
        event.stopPropagation();

        const store = useConnectionTabsStore.getState();
        const { tabs, activeTabId, removeTab } = store;
        if (!activeTabId || tabs.length === 0) return;

        const idx = tabs.findIndex((t) => t.id === activeTabId);
        const remaining = tabs.filter((t) => t.id !== activeTabId);
        removeTab(activeTabId);

        if (remaining.length > 0) {
          const nextIdx = Math.min(idx, remaining.length - 1);
          const nextTab = remaining[nextIdx];
          if (nextTab) {
            navigate({ to: "/database/$connectionId", params: { connectionId: nextTab.id } });
          }
        } else {
          navigate({ to: "/" });
        }
        return;
      }

      const isNextTab =
        (isCtrl && event.shiftKey && !event.altKey && (event.code === "BracketRight" || event.key === "]")) ||
        (event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.code === "PageDown");
      const isPrevTab =
        (isCtrl && event.shiftKey && !event.altKey && (event.code === "BracketLeft" || event.key === "[")) ||
        (event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.code === "PageUp");

      if (isNextTab || isPrevTab) {
        event.preventDefault();
        event.stopPropagation();

        const store = useConnectionTabsStore.getState();
        const { tabs, activeTabId, setActiveTab } = store;
        if (!activeTabId || tabs.length <= 1) return;

        const idx = tabs.findIndex((t) => t.id === activeTabId);
        const nextIdx = isNextTab
          ? (idx + 1) % tabs.length
          : (idx - 1 + tabs.length) % tabs.length;
        const next = tabs[nextIdx];
        if (next) {
          setActiveTab(next.id);
          navigate({ to: "/database/$connectionId", params: { connectionId: next.id } });
        }
        return;
      }
    };

    // Capture phase ensures these shortcuts work even when components
    // intercept keydown in bubble phase (Monaco, etc.)
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [navigate]);

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <TooltipProvider delay={500}>
        <div className="h-screen flex flex-col overflow-hidden bg-transparent antialiased" data-solid-bg={solidBackground || undefined}>
          <TitleBar />
          <div className="flex-1 min-h-0 overflow-hidden bg-transparent">
            <div className="page-frame h-full relative">
              <div className="h-full overflow-hidden rounded-md">
              <ResizablePanelGroup
                orientation="horizontal"
                className="h-full min-h-0"
                defaultLayout={defaultLayout}
                groupRef={panelGroupRef}
                onLayoutChanged={(layout) => {
                  if (!isAiChatOpen) return;
                  const next = layout["root-ai-chat"];
                  if (typeof next === "number" && next > 0) {
                    setAiPanelSize(next);
                  }
                }}
              >
                <ResizablePanel id="root-main" className={cn("min-h-0 min-w-0", isAiPanelAnimating && AI_PANEL_TRANSITION)}>
                  {isDatabaseRoute ? <TabbedConnectionView /> : <Outlet />}
                </ResizablePanel>

                <ResizableHandle
                  onPointerDownCapture={() => {
                    aiResizeDraggingRef.current = true;
                    if (isAiPanelAnimating) {
                      stopAiPanelAnimation();
                    }
                  }}
                  className={cn(
                    [
                      // Keep the native separator visually neutral; draw exactly one custom guide line.
                      "w-0! bg-transparent! hover:bg-transparent! border-0! focus-visible:ring-0! justify-center",
                      "after:absolute after:inset-y-0 after:left-1/2 after:-translate-x-1/2 after:w-0.75 after:rounded-full after:transition-colors after:duration-150",
                      "after:bg-transparent data-[separator=active]:after:bg-primary/55",
                    ].join(" "),
                    !(isAiChatOpen || isAiPanelAnimating) && "pointer-events-none opacity-0",
                  )}
                />
                <ResizablePanel
                  id="root-ai-chat"
                  defaultSize={aiPanelSize}
                  minSize="15%"
                  maxSize="45%"
                  collapsible
                  collapsedSize={0}
                  panelRef={aiPanelRef}
                  onResize={(size) => {
                    if (aiResizeDraggingRef.current && isAiPanelAnimating) {
                      stopAiPanelAnimation();
                    }

// Keep collapse explicit (button/shortcut). During drag, force panel back to min width instead of collapsing.
                    if (aiResizeDraggingRef.current && size.asPercentage === 0) {
                      aiPanelRef.current?.resize("15%");
                    }
                  }}
                  className={cn("min-h-0 min-w-0 overflow-hidden", isAiPanelAnimating && AI_PANEL_TRANSITION)}
                >
                  <AnimatePresence
                    initial={false}
                    onExitComplete={() => {
                      // After Motion exit animation finishes, collapse the panel
                      // via CSS transition on flex-grow — container shrinks smoothly.
                      aiPanelRef.current?.collapse();
                      setIsAiPanelAnimating(false);
                    }}
                  >
                    {isAiChatOpen && (
                      <motion.div
                        key="ai-panel-wrapper"
                        className="h-full"
                        initial={{ x: "100%", opacity: 0 }}
                        animate={{ x: 0, opacity: 1, transition: { duration: 0.22, ease: [0.23, 1, 0.32, 1] } }}
                        exit={{ x: "100%", opacity: 0, transition: { duration: 0.18, ease: [0.23, 1, 0.32, 1] } }}
                      >
                        <AiChatPanel
                          key="ai-chat-panel"
                          connectionId={effectiveContext.connectionId}
                          connectionLabel={effectiveContext.connectionLabel}
                          dbType={effectiveContext.dbType}
                          provider={effectiveContext.provider}
                          schemaContext={effectiveContext.schemaContext}
                          connectionInfo={effectiveContext.connectionInfo}
                          userConnectionsContext={userConnectionsContext}
                          contextPreview={effectiveContext.contextPreview}
                          isOpen={isAiChatOpen}
                          className="-mt-1.5 h-[calc(100%+6px)] pl-0 pr-0"
                          onClose={handleAiChatClose}
                          onInsertSql={requestSqlInsertFromChat}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </ResizablePanel>
              </ResizablePanelGroup>
              </div>
            </div>
          </div>
        </div>
      </TooltipProvider>
      <Toaster position="bottom-right" />
    </ThemeProvider>
  );
}

export const Route = createRootRoute({
  component: Root,
});
