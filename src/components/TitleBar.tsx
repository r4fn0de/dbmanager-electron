import { useNavigate } from "@tanstack/react-router";
import { Copy, Minus, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  ConnectionTabs,
  useConnectionTabSync,
} from "@/components/ConnectionTabs";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";

type Platform = "macos" | "windows" | "linux" | "unknown";

function detectPlatform(): Platform {
  const platform = navigator.platform.toLowerCase();
  if (platform.includes("mac") || platform.includes("darwin")) return "macos";
  if (platform.includes("win")) return "windows";
  if (platform.includes("linux")) return "linux";
  return "unknown";
}

export function TitleBar() {
  const [platform] = useState<Platform>(() => detectPlatform());
  const [isMaximized, setIsMaximized] = useState(false);
  const navigate = useNavigate();

  // Auto-add tabs when navigating to database pages
  useConnectionTabSync();

  // Sync maximize state with Electron window
  useEffect(() => {
    // Electron window state sync would go here
    // For now, just track state locally
  }, []);

  const handleMinimize = () => {
    // Electron minimize - to be implemented with IPC
    console.log("Minimize window");
  };

  const handleMaximize = () => {
    // Electron maximize - to be implemented with IPC
    console.log("Toggle maximize");
    setIsMaximized((prev) => !prev);
  };

  const handleClose = () => {
    // Electron close - to be implemented with IPC
    console.log("Close window");
  };

  const handleOpenConnections = () => {
    navigate({ to: "/" });
  };

  const tabsSlot = (
    <div className="min-w-0 flex-1 h-full flex items-end gap-1 pl-0 draglayer">
      <div className="no-drag h-full flex items-center">
        <ConnectionTabs />
      </div>
      <button
        type="button"
        onClick={handleOpenConnections}
        className="shrink-0 h-[28px] px-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors no-drag mb-1"
        aria-label="Open connections"
        title="Open connections"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  // macOS: native traffic lights area, with tabs and browser-style "+"
  if (platform === "macos") {
    return (
      <div className="z-50 select-none">
        <div className="h-10 bg-background/60 backdrop-blur-md flex items-center pr-3">
          <div className="w-[82px] shrink-0 h-full draglayer" />
          {tabsSlot}
          <div className="ml-auto flex items-center no-drag pl-2">
            <ThemeToggle />
          </div>
        </div>
      </div>
    );
  }

  // Windows / Linux: custom window controls
  return (
    <div className="z-50 select-none draglayer">
      <div className="h-8 bg-background/20 backdrop-blur-md flex items-center justify-between">
        <div className="min-w-0 flex-1 flex items-center gap-2 px-3">
          <div className="w-4 h-4 rounded bg-primary/20 flex items-center justify-center no-drag">
            <span className="text-[10px] font-bold text-primary">DB</span>
          </div>
          {tabsSlot}
        </div>

        <div className="flex items-center shrink-0 no-drag">
          <div className="flex items-center px-2">
            <ThemeToggle />
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-none hover:bg-muted no-drag"
            onClick={handleMinimize}
            aria-label="Minimize"
          >
            <Minus className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-none hover:bg-muted no-drag"
            onClick={handleMaximize}
            aria-label={isMaximized ? "Restore" : "Maximize"}
          >
            {isMaximized ? (
              <Copy className="h-3 w-3 rotate-90" />
            ) : (
              <span className="block h-3 w-3 border border-current" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-none hover:bg-destructive hover:text-destructive-foreground no-drag"
            onClick={handleClose}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
