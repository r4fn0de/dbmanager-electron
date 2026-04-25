import {
  createRootRoute,
  Outlet,
  useRouterState,
  useParams,
  useNavigate,
} from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AnimatePresence } from "motion/react";
import { ThemeProvider } from "@/components/ThemeProvider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TitleBar } from "@/components/TitleBar";
import { Toaster } from "@/components/ui/sonner";
import { TabbedConnectionView } from "@/components/TabbedConnectionView";
import { AiChatPanel } from "@/components/AiChatPanel";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  type GroupImperativeHandle,
  type Layout,
  type PanelImperativeHandle,
} from "@/components/ui/resizable";
import { useAiChatGlobalStore } from "@/lib/stores/ai-chat-global";
import { useConnectionTabsStore, detectConnectionProvider } from "@/lib/stores/connection-tabs";
import { useConnectionsList } from "@/hooks/useConnectionsList";
import { cn } from "@/utils/tailwind";
import type { DatabaseType } from "@/ipc/db/types";

import "../styles/global.css";

const AI_PANEL_ANIM_DURATION_MS = 180;

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

function Root() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isDatabaseRoute = pathname.startsWith("/database/");

  // Derive connectionId from route params during render (not from store)
  const params = useParams({ strict: false });
  const routeConnectionId = params.connectionId as string | undefined;

  // Get connections list to find connection details
  const { connections } = useConnectionsList();

  const isAiChatOpen = useAiChatGlobalStore((state) => state.isOpen);
  const aiPanelSize = useAiChatGlobalStore((state) => state.panelSize);
  const setAiChatOpen = useAiChatGlobalStore((state) => state.setOpen);
  const setAiPanelSize = useAiChatGlobalStore((state) => state.setPanelSize);
  const storeContext = useAiChatGlobalStore((state) => state.currentContext);

  // Derive effective context: route params are source of truth for connectionId
  const activeConnection = routeConnectionId
    ? connections.find((c) => c.id === routeConnectionId)
    : undefined;

  const effectiveContext = useMemo(() => {
    if (activeConnection) {
      const provider = detectConnectionProvider(activeConnection);
      const isLocal = activeConnection.is_local ?? isLocalHost(activeConnection.host);
      return {
        connectionId: activeConnection.id,
        connectionLabel: activeConnection.name?.trim()
          || activeConnection.database?.trim()
          || activeConnection.id,
        dbType: (activeConnection.db_type || "postgresql") as DatabaseType,
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
          dbType: (activeConnection.db_type || "postgresql") as DatabaseType,
          selectionPreview: storeContext.connectionId === activeConnection.id
            ? storeContext.contextPreview?.selectionPreview
            : undefined,
          errorPreview: storeContext.connectionId === activeConnection.id
            ? storeContext.contextPreview?.errorPreview
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
  }, [activeConnection, storeContext]);

  const panelGroupRef = useRef<GroupImperativeHandle>(null);
  const aiPanelRef = useRef<PanelImperativeHandle>(null);
  const aiResizeDraggingRef = useRef(false);
  const [isAiHandleDragging, setIsAiHandleDragging] = useState(false);
  const [isAiPanelAnimating, setIsAiPanelAnimating] = useState(false);
  const aiPanelAnimTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

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

  // Layout is controlled via panel imperative handle (expand/collapse),
  // not groupRef.setLayout — this ensures CSS transition-[flex-grow] works.

  const clearAiPanelAnimTimeout = useCallback(() => {
    if (aiPanelAnimTimeoutRef.current) {
      clearTimeout(aiPanelAnimTimeoutRef.current);
      aiPanelAnimTimeoutRef.current = undefined;
    }
  }, []);

  const stopAiPanelAnimation = useCallback(() => {
    clearAiPanelAnimTimeout();
    setIsAiPanelAnimating(false);
  }, [clearAiPanelAnimTimeout]);

  const handleAiChatClose = useCallback(() => {
    // Close: AiChatPanel plays exit animation first,
    // then panel collapses via CSS transition on flex-grow.
    setIsAiPanelAnimating(true);
    setAiChatOpen(false);
  }, [setAiChatOpen]);

  const handleAiChatToggle = useCallback(() => {
    if (isAiChatOpen) {
      handleAiChatClose();
    } else {
      // Open: expand panel via imperative handle (triggers CSS flex-grow transition)
      // and render AiChatPanel simultaneously.
      setIsAiPanelAnimating(true);
      setAiChatOpen(true);
      aiPanelRef.current?.expand();
      clearAiPanelAnimTimeout();
      aiPanelAnimTimeoutRef.current = setTimeout(() => {
        setIsAiPanelAnimating(false);
        aiPanelAnimTimeoutRef.current = undefined;
      }, AI_PANEL_ANIM_DURATION_MS);
    }
  }, [isAiChatOpen, handleAiChatClose, setAiChatOpen, clearAiPanelAnimTimeout]);

  // Clean up animation timeout on unmount
  useEffect(() => {
    return () => {
      aiResizeDraggingRef.current = false;
      setIsAiHandleDragging(false);
      clearAiPanelAnimTimeout();
    };
  }, [clearAiPanelAnimTimeout]);

  useEffect(() => {
    const finishResizeDrag = () => {
      aiResizeDraggingRef.current = false;
      setIsAiHandleDragging(false);
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

  // ── Tab navigation keyboard shortcuts ────────────────────────────
  const navigate = useNavigate();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isCtrl = event.ctrlKey || event.metaKey;

      // ── Ctrl+Tab / Ctrl+Shift+Tab: MRU tab switching ──
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

      // ── Cmd/Ctrl+W: Close current tab ──
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

      // ── Next/Previous tab (visual order) ──
      // macOS: Cmd+Shift+] / [  ·  Windows/Linux: Ctrl+PageDown / PageUp
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
        <div className="h-screen flex flex-col overflow-hidden bg-transparent antialiased">
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
                <ResizablePanel id="root-main" className={cn("min-h-0 min-w-0", isAiPanelAnimating && "transition-[flex-grow] duration-180 ease-[cubic-bezier(0.23,1,0.32,1)]")}>
                  {isDatabaseRoute ? <TabbedConnectionView /> : <Outlet />}</ResizablePanel>

                <ResizableHandle
                  onPointerDownCapture={() => {
                    aiResizeDraggingRef.current = true;
                    setIsAiHandleDragging(true);
                    if (isAiPanelAnimating) {
                      stopAiPanelAnimation();
                    }
                  }}
                  className={cn(
                    [
                      "!bg-transparent hover:!bg-transparent justify-center",
                      // Single center guide shown only during drag.
                      "after:absolute after:inset-y-0 after:left-1/2 after:-translate-x-1/2 after:w-[3px] after:rounded-full after:transition-colors after:duration-150",
                      isAiHandleDragging
                        ? "after:bg-primary/55"
                        : "after:bg-transparent",
                    ].join(" "),
                    !isAiHandleDragging && "opacity-0",
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

                    // Keep collapse explicit (button/shortcut). During drag,
                    // force panel back to min width instead of collapsing.
                    if (aiResizeDraggingRef.current && size.asPercentage === 0) {
                      aiPanelRef.current?.resize("15%");
                    }
                  }}
                  className={cn("min-h-0 min-w-0 ", isAiPanelAnimating && "transition-[flex-grow] duration-180 ease-[cubic-bezier(0.23,1,0.32,1)]")}
                >
                  <AnimatePresence
                    initial={false}
                    onExitComplete={() => {
                      // After exit animation finishes, collapse the panel
                      // via imperative handle — CSS transition animates flex-grow.
                      aiPanelRef.current?.collapse();
                      clearAiPanelAnimTimeout();
                      aiPanelAnimTimeoutRef.current = setTimeout(() => {
                        setIsAiPanelAnimating(false);
                        aiPanelAnimTimeoutRef.current = undefined;
                      }, AI_PANEL_ANIM_DURATION_MS);
                    }}
                  >
                    {isAiChatOpen && (
                      <AiChatPanel
                        key="ai-chat-panel"
                        connectionId={effectiveContext.connectionId}
                        connectionLabel={effectiveContext.connectionLabel}
                        dbType={effectiveContext.dbType}
                        provider={effectiveContext.provider}
                        schemaContext={effectiveContext.schemaContext}
                        connectionInfo={effectiveContext.connectionInfo}
                        contextPreview={effectiveContext.contextPreview}
                        isOpen={isAiChatOpen}
                        className="-mt-[6px] h-[calc(100%+6px)] pl-2 pr-0"
                        onClose={handleAiChatClose}
                      />
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
