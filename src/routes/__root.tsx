import {
  createRootRoute,
  Outlet,
  useNavigate,
  useParams,
  useRouterState,
} from "@tanstack/react-router";
import type { Size } from "motion-panels/react";
import { useCallback, useEffect, useMemo } from "react";
import { TitleBar } from "@/components/TitleBar";
import { Panel, PanelGroup } from "@/components/ui/motion-panels";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AiChatPanel } from "@/features/ai";
import { useConnectionsList } from "@/features/connection";
import { TabbedConnectionView } from "@/features/database";
import { useLocalDatabases } from "@/features/localDb";
import { ThemeProvider, UpdateToastListener } from "@/features/settings";
import type { Connection, DatabaseType } from "@/ipc/db/types";
import { ipc } from "@/ipc/manager";
import { useAiChatGlobalStore } from "@/lib/stores/ai-chat-global";
import { useAppearanceStore } from "@/lib/stores/appearance";
import type { ConnectionTab } from "@/lib/stores/connection-tabs";
import {
  detectConnectionProvider,
  isSettingsTab,
  useConnectionTabsStore,
} from "@/lib/stores/connection-tabs";
import type { UserConnectionsContext } from "@/shared/ai/streaming-contracts";

import "../styles/global.css";

// The AI panel folds to zero width, so its content slides out through the seam.
// motion-panels owns the fold; these are only the content poses.
const AI_PANEL_EASE: [number, number, number, number] = [0.23, 1, 0.32, 1];
const AI_PANEL_OPEN = { opacity: 1, x: 0 };
const AI_PANEL_CLOSED = { opacity: 0, x: "100%" };
const AI_PANEL_FADE_IN = { duration: 0.22, ease: AI_PANEL_EASE };
const AI_PANEL_FADE_OUT = { duration: 0.18, ease: AI_PANEL_EASE };

function isAiChatShortcut(event: KeyboardEvent): boolean {
  if (event.isComposing || event.repeat) {
    return false;
  }
  if (!(event.metaKey || event.ctrlKey)) {
    return false;
  }
  if (event.shiftKey || event.altKey) {
    return false;
  }

  // `code` is layout-independent (physical key), `key` is fallback.
  return event.code === "KeyJ" || event.key.toLowerCase() === "j";
}

function isLocalHost(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "0.0.0.0"
  );
}

function isLikelyCloudProvider(provider: string): boolean {
  return provider === "neon" || provider === "supabase";
}

function resolveConnectionScope(
  connection: Connection,
  provider: string
): "local" | "remote" {
  if (isLocalHost(connection.host)) {
    return "local";
  }

  if (connection.url) {
    try {
      const url = new URL(connection.url);
      if (isLocalHost(url.hostname)) {
        return "local";
      }
    } catch {
      // Ignore invalid URL values and continue with other signals.
    }
  }

  // Cloud providers should be treated as remote unless host/URL is explicitly local.
  if (isLikelyCloudProvider(provider)) {
    return "remote";
  }

  if (connection.is_local === true) {
    return "local";
  }
  if (connection.is_local === false) {
    return "remote";
  }

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
    const localEngine = isLocal
      ? input.localDbById.get(connection.id)?.engine
      : undefined;
    const dbType = (localEngine ??
      connection.db_type ??
      "postgresql") as DatabaseType;

    byProvider.set(provider, (byProvider.get(provider) ?? 0) + 1);
    byDbType.set(dbType, (byDbType.get(dbType) ?? 0) + 1);

    return {
      id: connection.id,
      name:
        connection.name?.trim() || connection.database?.trim() || connection.id,
      dbType,
      provider,
      scope,
    };
  });

  const local = summaryConnections.filter(
    (connection) => connection.scope === "local"
  ).length;
  const remote = summaryConnections.length - local;

  return {
    total: summaryConnections.length,
    local,
    remote,
    byProvider: Array.from(byProvider.entries())
      .map(([provider, count]) => ({ provider, count }))
      .sort(
        (a, b) => b.count - a.count || a.provider.localeCompare(b.provider)
      ),
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
    [localDatabases]
  );

  const isAiChatOpen = useAiChatGlobalStore((state) => state.isOpen);
  const aiPanelSize = useAiChatGlobalStore((state) => state.panelSize);
  const setAiChatOpen = useAiChatGlobalStore((state) => state.setOpen);
  const setAiPanelSize = useAiChatGlobalStore((state) => state.setPanelSize);
  const storeContext = useAiChatGlobalStore((state) => state.currentContext);
  const requestSqlInsertFromChat = useAiChatGlobalStore(
    (state) => state.requestSqlInsert
  );

  const solidBackground = useAppearanceStore((s) => s.solidBackground);
  const themePreset = useAppearanceStore((s) => s.themePreset);
  const appearanceHydrated = useAppearanceStore((s) => s.hasHydrated);

  // Apply vibrancy setting on mount and when it changes
  useEffect(() => {
    if (!appearanceHydrated) {
      return;
    }
    void ipc.client.window.setWindowVibrancy({ solid: solidBackground });
  }, [appearanceHydrated, solidBackground]);

  useEffect(() => {
    if (!appearanceHydrated) {
      return;
    }
    const root = document.documentElement;
    root.classList.remove("theme-neo");
    if (themePreset === "neo") {
      root.classList.add("theme-neo");
    }
  }, [appearanceHydrated, themePreset]);

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
      const localEngine = isLocal
        ? localDbById.get(activeConnection.id)?.engine
        : undefined;
      const effectiveDbType = (localEngine ??
        activeConnection.db_type ??
        "postgresql") as DatabaseType;
      return {
        connectionId: activeConnection.id,
        connectionLabel:
          activeConnection.name?.trim() ||
          activeConnection.database?.trim() ||
          activeConnection.id,
        dbType: effectiveDbType,
        provider,
        // Use store's schemaContext if available for the same connection, otherwise undefined
        schemaContext:
          storeContext.connectionId === activeConnection.id
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
          connectionLabel:
            activeConnection.name?.trim() ||
            activeConnection.database?.trim() ||
            activeConnection.id,
          dbType: effectiveDbType,
          selectionPreview:
            storeContext.connectionId === activeConnection.id
              ? storeContext.contextPreview?.selectionPreview
              : undefined,
          errorPreview:
            storeContext.connectionId === activeConnection.id
              ? storeContext.contextPreview?.errorPreview
              : undefined,
          tablePreview:
            storeContext.connectionId === activeConnection.id
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
    [connections, localDbById]
  );

  // The panel folds to zero on close, so the AI panel needs no imperative handle:
  // `collapsed` drives the fold and `onSizeChange` reports a drag back in percent.
  const aiPanelWidth: Size = `${aiPanelSize}%`;

  const handleAiChatClose = useCallback(() => {
    setAiChatOpen(false);
  }, [setAiChatOpen]);

  const handleAiChatToggle = useCallback(() => {
    if (isAiChatOpen) {
      handleAiChatClose();
    } else {
      setAiChatOpen(true);
    }
  }, [isAiChatOpen, handleAiChatClose, setAiChatOpen]);

  // The panel reports a percentage, which is the unit the store persists.
  const handleAiPanelResize = useCallback(
    (next: Size) => {
      setAiPanelSize(typeof next === "number" ? next : Number.parseFloat(next));
    },
    [setAiPanelSize]
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isAiChatShortcut(event)) {
        return;
      }

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
  const navigateToTab = useCallback(
    (tab: ConnectionTab) => {
      if (isSettingsTab(tab)) {
        navigate({ to: "/settings" });
        return;
      }
      navigate({
        to: "/database/$connectionId",
        params: { connectionId: tab.id },
      });
    },
    [navigate]
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isCtrl = event.ctrlKey || event.metaKey;

      if (event.key === "Tab" && isCtrl) {
        event.preventDefault();
        event.stopPropagation();

        const store = useConnectionTabsStore.getState();
        const { tabs, activeTabId, recentTabIds, setActiveTab } = store;
        if (tabs.length <= 1) {
          return;
        }

        if (event.shiftKey) {
          // Ctrl+Shift+Tab: go to least-recently-used (bottom of MRU stack)
          const openIds = new Set(tabs.map((t) => t.id));
          const candidates = recentTabIds.filter(
            (id) => openIds.has(id) && id !== activeTabId
          );
          const target =
            candidates[candidates.length - 1] ??
            tabs.find((t) => t.id !== activeTabId)?.id;
          const targetTab = target
            ? tabs.find((tab) => tab.id === target)
            : undefined;
          if (targetTab) {
            setActiveTab(targetTab.id);
            navigateToTab(targetTab);
          }
        } else {
          // Ctrl+Tab: go to most-recently-used (second in MRU stack)
          const openIds = new Set(tabs.map((t) => t.id));
          const candidates = recentTabIds.filter(
            (id) => openIds.has(id) && id !== activeTabId
          );
          const target =
            candidates[0] ?? tabs.find((t) => t.id !== activeTabId)?.id;
          const targetTab = target
            ? tabs.find((tab) => tab.id === target)
            : undefined;
          if (targetTab) {
            setActiveTab(targetTab.id);
            navigateToTab(targetTab);
          }
        }
        return;
      }

      if (
        event.key.toLowerCase() === "w" &&
        isCtrl &&
        !event.shiftKey &&
        !event.altKey
      ) {
        // Don't intercept if focus is inside an input/textarea (so users can still type W)
        const tag = (event.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
          return;
        }
        // Also skip if inside Monaco editor (code-editor context)
        if ((event.target as HTMLElement)?.closest?.(".monaco-editor")) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();

        const store = useConnectionTabsStore.getState();
        const { tabs, activeTabId, recentTabIds, removeTab } = store;
        if (!activeTabId || tabs.length === 0) {
          return;
        }

        const activeTab = tabs.find((tab) => tab.id === activeTabId);
        const remaining = tabs.filter((t) => t.id !== activeTabId);
        const nextTab = isSettingsTab(activeTab ?? { id: activeTabId })
          ? (recentTabIds
              .map((id) => remaining.find((tab) => tab.id === id))
              .find((tab): tab is ConnectionTab => tab !== undefined) ??
            remaining[
              Math.min(
                tabs.findIndex((t) => t.id === activeTabId),
                remaining.length - 1
              )
            ])
          : remaining[
              Math.min(
                tabs.findIndex((t) => t.id === activeTabId),
                remaining.length - 1
              )
            ];
        removeTab(activeTabId);

        if (nextTab) {
          navigateToTab(nextTab);
        } else {
          navigate({ to: "/" });
        }
        return;
      }

      const isNextTab =
        (isCtrl &&
          event.shiftKey &&
          !event.altKey &&
          (event.code === "BracketRight" || event.key === "]")) ||
        (event.ctrlKey &&
          !event.metaKey &&
          !event.shiftKey &&
          !event.altKey &&
          event.code === "PageDown");
      const isPrevTab =
        (isCtrl &&
          event.shiftKey &&
          !event.altKey &&
          (event.code === "BracketLeft" || event.key === "[")) ||
        (event.ctrlKey &&
          !event.metaKey &&
          !event.shiftKey &&
          !event.altKey &&
          event.code === "PageUp");

      if (isNextTab || isPrevTab) {
        event.preventDefault();
        event.stopPropagation();

        const store = useConnectionTabsStore.getState();
        const { tabs, activeTabId, setActiveTab } = store;
        if (!activeTabId || tabs.length <= 1) {
          return;
        }

        const idx = tabs.findIndex((t) => t.id === activeTabId);
        const nextIdx = isNextTab
          ? (idx + 1) % tabs.length
          : (idx - 1 + tabs.length) % tabs.length;
        const next = tabs[nextIdx];
        if (next) {
          setActiveTab(next.id);
          navigateToTab(next);
        }
      }
    };

    // Capture phase ensures these shortcuts work even when components
    // intercept keydown events in bubble phase (Monaco, etc.)
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [navigate, navigateToTab]);

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <TooltipProvider delay={500}>
        <div
          className="flex h-screen flex-col overflow-hidden bg-transparent antialiased"
          data-solid-bg={solidBackground || undefined}
        >
          <TitleBar />
          <div className="min-h-0 flex-1 overflow-hidden bg-transparent">
            <div className="page-frame relative h-full">
              <div className="h-full overflow-hidden rounded-md">
                <PanelGroup className="h-full min-h-0" orientation="horizontal">
                  <Panel className="min-h-0 min-w-0">
                    {isDatabaseRoute ? <TabbedConnectionView /> : <Outlet />}
                  </Panel>

                  <Panel
                    animate={{ ...AI_PANEL_OPEN, transition: AI_PANEL_FADE_IN }}
                    className="min-h-0 min-w-0 overflow-hidden"
                    collapsed={!isAiChatOpen}
                    exit={{ ...AI_PANEL_CLOSED, transition: AI_PANEL_FADE_OUT }}
                    initial={AI_PANEL_CLOSED}
                    keepMounted={false}
                    maxSize="45%"
                    minSize="15%"
                    onSizeChange={handleAiPanelResize}
                    size={aiPanelWidth}
                    transition={AI_PANEL_FADE_IN}
                  >
                    <AiChatPanel
                      className="-mt-1.5 h-[calc(100%+6px)] pr-0 pl-0"
                      connectionId={effectiveContext.connectionId}
                      connectionInfo={effectiveContext.connectionInfo}
                      connectionLabel={effectiveContext.connectionLabel}
                      contextPreview={effectiveContext.contextPreview}
                      dbType={effectiveContext.dbType}
                      isOpen={isAiChatOpen}
                      onClose={handleAiChatClose}
                      onInsertSql={requestSqlInsertFromChat}
                      provider={effectiveContext.provider}
                      schemaContext={effectiveContext.schemaContext}
                      userConnectionsContext={userConnectionsContext}
                    />
                  </Panel>
                </PanelGroup>
              </div>
            </div>
          </div>
        </div>
      </TooltipProvider>
      <UpdateToastListener />
      <Toaster position="bottom-right" />
    </ThemeProvider>
  );
}

export const Route = createRootRoute({
  component: Root,
});
