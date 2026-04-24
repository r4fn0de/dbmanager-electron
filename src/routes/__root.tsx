import {
  createRootRoute,
  Outlet,
  useRouterState,
  useParams,
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
import { useConnectionsList } from "@/hooks/useConnectionsList";
import { cn } from "@/utils/tailwind";
import type { DatabaseType } from "@/ipc/db/types";

import "../styles/global.css";

function isAiChatShortcut(event: KeyboardEvent): boolean {
  if (event.isComposing || event.repeat) return false;
  if (!(event.metaKey || event.ctrlKey)) return false;
  if (event.shiftKey || event.altKey) return false;

  // `code` is layout-independent (physical key), `key` is fallback.
  return event.code === "KeyJ" || event.key.toLowerCase() === "j";
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
      return {
        connectionId: activeConnection.id,
        connectionLabel: activeConnection.name?.trim()
          || activeConnection.database?.trim()
          || activeConnection.id,
        dbType: (activeConnection.db_type || "postgresql") as DatabaseType,
        // Use store's schemaContext if available for the same connection, otherwise undefined
        schemaContext: storeContext.connectionId === activeConnection.id
          ? storeContext.schemaContext
          : undefined,
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
      contextPreview: storeContext.contextPreview,
    };
  }, [activeConnection, storeContext]);

  const panelGroupRef = useRef<GroupImperativeHandle>(null);
  const aiPanelRef = useRef<PanelImperativeHandle>(null);
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
      }, 300);
    }
  }, [isAiChatOpen, handleAiChatClose, setAiChatOpen, clearAiPanelAnimTimeout]);

  // Clean up animation timeout on unmount
  useEffect(() => {
    return () => {
      clearAiPanelAnimTimeout();
    };
  }, [clearAiPanelAnimTimeout]);

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
                <ResizablePanel id="root-main" className={cn("min-h-0 min-w-0", isAiPanelAnimating && "transition-[flex-grow] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]")}>
                  {isDatabaseRoute ? <TabbedConnectionView /> : <Outlet />}</ResizablePanel>

                <ResizableHandle
                  withHandle
                  className={cn(
                    [
                      "!bg-transparent hover:!bg-transparent justify-end",
                      // Keep the drag hit-area but hide idle visuals.
                      "after:w-1 after:rounded-full after:bg-transparent",
                      // During drag, show a solid vertical guide line like the reference.
                      "data-[resize-handle-state=drag]:after:w-[3px]",
                      "data-[resize-handle-state=drag]:after:bg-border/80",
                      "data-[resize-handle-state=drag]:after:shadow-[0_0_0_1px_rgba(120,120,130,0.12)]",
                      // Pin the visual guide closer to the chat panel side.
                      "data-[resize-handle-state=drag]:after:translate-x-[1px]",
                      // Hide the small pill while dragging to keep only the vertical line.
                      "[&>div]:translate-x-1/2 data-[resize-handle-state=drag]:[&>div]:opacity-0",
                    ].join(" "),
                    !(isAiChatOpen || isAiPanelAnimating) && "pointer-events-none opacity-0",
                  )}
                />
                <ResizablePanel
                  id="root-ai-chat"
                  defaultSize={`${aiPanelSize}%`}
                  minSize="15%"
                  maxSize="45%"
                  collapsible
                  collapsedSize={0}
                  panelRef={aiPanelRef}
                  onResize={(size, _id, prevSize) => {
                    const wasCollapsed = prevSize ? prevSize.asPercentage === 0 : false;
                    const isCollapsed = size.asPercentage === 0;

                    if (!isCollapsed) {
                      setAiPanelSize(size.asPercentage);
                    }

                    if (wasCollapsed !== isCollapsed) {
                      setAiChatOpen(!isCollapsed);
                    }
                  }}
                  className={cn("min-h-0 min-w-0 ", isAiPanelAnimating && "transition-[flex-grow] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]")}
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
                      }, 300);
                    }}
                  >
                    {isAiChatOpen && (
                      <AiChatPanel
                        key="ai-chat-panel"
                        connectionId={effectiveContext.connectionId}
                        connectionLabel={effectiveContext.connectionLabel}
                        dbType={effectiveContext.dbType}
                        schemaContext={effectiveContext.schemaContext}
                        contextPreview={effectiveContext.contextPreview}
                        isOpen={isAiChatOpen}
                        className="-mt-[6px] h-[calc(100%+6px)] px-1.5"
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
