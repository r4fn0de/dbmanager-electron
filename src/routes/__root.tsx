import {
  createRootRoute,
  Outlet,
  useRouterState,
} from "@tanstack/react-router";
import { Bot } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

import { ThemeProvider } from "@/components/ThemeProvider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TitleBar } from "@/components/TitleBar";
import { Toaster } from "@/components/ui/sonner";
import { TabbedConnectionView } from "@/components/TabbedConnectionView";
import { AiChatPanel } from "@/components/AiChatPanel";
import { Button } from "@/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  type GroupImperativeHandle,
  type Layout,
} from "@/components/ui/resizable";
import { useAiChatGlobalStore } from "@/lib/stores/ai-chat-global";
import { cn } from "@/utils/tailwind";

import "../styles/global.css";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;

  if (target.isContentEditable) return true;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;

  return Boolean(
    target.closest(".monaco-editor")
      || target.closest("[data-monaco-editor]")
      || target.closest("[contenteditable='true']"),
  );
}

function Root() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isDatabaseRoute = pathname.startsWith("/database/");

  const isAiChatOpen = useAiChatGlobalStore((state) => state.isOpen);
  const aiPanelSize = useAiChatGlobalStore((state) => state.panelSize);
  const setAiChatOpen = useAiChatGlobalStore((state) => state.setOpen);
  const toggleAiChat = useAiChatGlobalStore((state) => state.toggleOpen);
  const setAiPanelSize = useAiChatGlobalStore((state) => state.setPanelSize);
  const chatContext = useAiChatGlobalStore((state) => state.currentContext);

  const panelGroupRef = useRef<GroupImperativeHandle>(null);

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

  useEffect(() => {
    if (!panelGroupRef.current) return;

    if (isAiChatOpen) {
      panelGroupRef.current.setLayout({
        "root-main": 100 - aiPanelSize,
        "root-ai-chat": aiPanelSize,
      });
      return;
    }

    panelGroupRef.current.setLayout({
      "root-main": 100,
      "root-ai-chat": 0,
    });
  }, [aiPanelSize, isAiChatOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isShortcut = (event.metaKey || event.ctrlKey)
        && !event.shiftKey
        && !event.altKey
        && event.key.toLowerCase() === "j";

      if (!isShortcut) return;
      if (isEditableTarget(event.target)) return;

      event.preventDefault();
      toggleAiChat();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleAiChat]);

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
                <ResizablePanel id="root-main" className="min-h-0 min-w-0">
                  {isDatabaseRoute ? <TabbedConnectionView /> : <Outlet />}
                </ResizablePanel>

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
                    !isAiChatOpen && "pointer-events-none opacity-0",
                  )}
                />
                <ResizablePanel
                  id="root-ai-chat"
                  defaultSize={`${aiPanelSize}%`}
                  minSize="15%"
                  maxSize="45%"
                  collapsible
                  collapsedSize={0}
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
                  className="min-h-0 min-w-0"
                >
                  {isAiChatOpen && (
                    <div className="h-full pl-1.5">
                      <AiChatPanel
                        connectionId={chatContext.connectionId}
                        connectionLabel={chatContext.connectionLabel}
                        dbType={chatContext.dbType}
                        schemaContext={chatContext.schemaContext}
                        contextPreview={chatContext.contextPreview}
                        isOpen={isAiChatOpen}
                        onClose={() => setAiChatOpen(false)}
                      />
                    </div>
                  )}
                </ResizablePanel>
              </ResizablePanelGroup>

              <div className="absolute right-3 bottom-3 z-40">
                <Button
                  type="button"
                  variant={isAiChatOpen ? "default" : "outline"}
                  size="sm"
                  onClick={toggleAiChat}
                  className="gap-2 shadow-sm"
                >
                  <Bot className="size-4" />
                  AI Chat
                  <span className="text-[10px] opacity-80">⌘/Ctrl + J</span>
                </Button>
              </div>
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
