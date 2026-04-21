import { useNavigate } from "@tanstack/react-router";
import { Copy, Minus, Plus, X } from "lucide-react";
import { useState } from "react";
import {
  ConnectionTabs,
  useConnectionTabSync,
} from "@/components/ConnectionTabs";
import { ThemeToggle } from "@/components/ThemeToggle";
import GooeySvgFilter from "@/components/ui/gooey-svg-filter";
import { Button } from "@/components/ui/button";

type Platform = "macos" | "windows" | "linux" | "unknown";

function detectPlatform(): Platform {
  const electronPlatform = window.electron?.platform?.toLowerCase() ?? "";
  const uaDataPlatform = (
    navigator as Navigator & { userAgentData?: { platform?: string } }
  ).userAgentData?.platform?.toLowerCase() ?? "";
  const uaPlatform = navigator.userAgent.toLowerCase();
  const platform = electronPlatform || uaDataPlatform || uaPlatform;

  if (platform === "darwin" || platform.includes("mac")) return "macos";
  if (platform === "win32" || platform.includes("win")) return "windows";
  if (platform === "linux" || platform.includes("linux")) return "linux";
  return "unknown";
}

export function TitleBar() {
  const titlebarGooeyFilterId = "titlebar-tabs-gooey";
  const [platform] = useState<Platform>(() => detectPlatform());
  const [isMaximized, setIsMaximized] = useState(false);
  const navigate = useNavigate();

  // Auto-add tabs when navigating to database pages
  useConnectionTabSync();

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
    <div className="min-w-0 flex-1 h-full flex items-end gap-0.5 pl-0 draglayer">
      <GooeySvgFilter id={titlebarGooeyFilterId} strength={5} />
      <div className="no-drag h-full flex items-end">
        <ConnectionTabs gooeyFilterId={titlebarGooeyFilterId} />
      </div>
      <button
        type="button"
        onClick={handleOpenConnections}
        className="shrink-0 h-[37px] px-3 rounded-md text-foreground/75 dark:text-muted-foreground hover:text-foreground transition-colors no-drag self-end flex items-center justify-center relative isolate after:absolute after:inset-x-0 after:top-[1px] after:bottom-[4px] after:rounded-md after:bg-transparent after:transition-colors hover:after:bg-muted/60"
        aria-label="Open connections"
        title="Open connections"
      >
        <Plus className="h-3.5 w-3.5 -translate-y-[2px]" />
      </button>
    </div>
  );

  // macOS: native traffic lights area, with tabs and browser-style "+"
  if (platform === "macos") {
    return (
      <div className="z-50 select-none">
        <div className="h-10 bg-background/5 flex items-center pr-3">
          <div className="w-[78px] shrink-0 h-full draglayer" />
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
    <div className="z-50 select-none">
      <div className="h-7 bg-background/20 backdrop-blur-md flex items-center justify-between">
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
