import { useNavigate } from "@tanstack/react-router";
import { Cable, Copy, Globe, HardDrive, Minus, Plus, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ConnectionTabs,
  useConnectionTabSync,
} from "@/components/ConnectionTabs";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SettingsDialog } from "@/components/SettingsDialog";
import { ClickHouse } from "@/components/icons/ClickHouse";
import { MySql } from "@/components/icons/MySql";
import { Neon } from "@/components/icons/Neon";
import { Supabase } from "@/components/icons/Supabase";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import GooeySvgFilter from "@/components/ui/gooey-svg-filter";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useConnectionsList } from "@/hooks/useConnectionsList";
import { useLocalDatabases } from "@/hooks/useLocalDatabases";
import {
  buildConnectionTab,
  detectConnectionProvider,
  useConnectionTabsStore,
} from "@/lib/stores/connection-tabs";
import type { ConnectionProvider } from "@/lib/stores/connection-tabs";
import type { Connection } from "@/ipc/db/types";

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

function ProviderIcon({
  provider,
  className,
}: {
  provider: ConnectionProvider;
  className?: string;
}) {
  const cls = className ?? "size-3.5 shrink-0";
  switch (provider) {
    case "neon":
      return <Neon className={cls} />;
    case "supabase":
      return <Supabase className={cls} />;
    case "mysql":
    case "mariadb":
      return <MySql className={cls} />;
    case "clickhouse":
      return <ClickHouse className={cls} />;
    case "url":
      return <Globe className={`${cls} text-muted-foreground/50`} />;
    default:
      return <Cable className={`${cls} text-muted-foreground/50`} />;
  }
}

export function TitleBar() {
  const titlebarGooeyFilterId = "titlebar-tabs-gooey";
  const [platform] = useState<Platform>(() => detectPlatform());
  const [isMaximized, setIsMaximized] = useState(false);
  const [isConnectionMenuOpen, setIsConnectionMenuOpen] = useState(false);
  const navigate = useNavigate();

  // Auto-add tabs when navigating to database pages
  useConnectionTabSync();

  const { connections } = useConnectionsList();
  const { databases: localDbs } = useLocalDatabases();
  const tabs = useConnectionTabsStore((s) => s.tabs);

  const localDbById = useMemo(() => {
    const map: Record<string, (typeof localDbs)[number]> = {};
    for (const db of localDbs) {
      map[db.id] = db;
    }
    return map;
  }, [localDbs]);

  // Connections not already open as tabs
  const openTabIds = useMemo(() => new Set(tabs.map((t) => t.id)), [tabs]);
  const unopenedConnections = useMemo(
    () => connections.filter((c) => !openTabIds.has(c.id)),
    [connections, openTabIds],
  );

  const localUnopened = useMemo(
    () => unopenedConnections.filter((c) => c.is_local),
    [unopenedConnections],
  );
  const remoteUnopened = useMemo(
    () => unopenedConnections.filter((c) => !c.is_local),
    [unopenedConnections],
  );

  const handleOpenConnection = useCallback(
    (connection: Connection) => {
      if (connection.is_local) {
        const localDb = localDbById[connection.id];
        if (!localDb?.running) {
          toast.error(
            `Local database "${connection.name}" is not running. Start it before opening.`,
          );
          return;
        }
      }
      useConnectionTabsStore.getState().addTab(buildConnectionTab(connection));
      navigate({
        to: "/database/$connectionId",
        params: { connectionId: connection.id },
      });
    },
    [localDbById, navigate],
  );

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
      <DropdownMenu
        open={isConnectionMenuOpen}
        onOpenChange={(open) => {
          // Only accept close events (Escape, click-outside, etc.).
          // Open requests from the default trigger click are suppressed —
          // left-click navigates home instead; right-click opens the menu
          // directly via onContextMenu.
          if (open) return;
          setIsConnectionMenuOpen(false);
        }}
      >
        <TooltipProvider delay={500}>
          <Tooltip open={isConnectionMenuOpen ? false : undefined}>
            <TooltipTrigger
              render={
                <DropdownMenuTrigger
                  render={
                    <button
                      type="button"
                      onClick={() => {
                        if (isConnectionMenuOpen) {
                          setIsConnectionMenuOpen(false);
                        } else {
                          handleOpenConnections();
                        }
                      }}
                      onContextMenu={(e) => {
                        if (unopenedConnections.length > 0) {
                          e.preventDefault();
                          setIsConnectionMenuOpen(true);
                        }
                      }}
                      className="shrink-0 h-[37px] px-3 rounded-md text-foreground/75 dark:text-muted-foreground hover:text-foreground transition-colors duration-150 no-drag self-end flex items-center justify-center relative isolate after:absolute after:inset-x-0 after:top-[1px] after:bottom-[4px] after:rounded-md after:bg-transparent after:transition-colors after:duration-150 hover:after:bg-muted/60 active:scale-[0.97] after:active:bg-muted/40"
                      aria-label="Open connections"
                    >
                      <Plus className="h-3.5 w-3.5 -translate-y-[2px]" />
                    </button>
                  }
                />
              }
            />
            <TooltipContent side="bottom" sideOffset={8}>
              <span>Open connections</span>
              <Kbd>Right-click</Kbd>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <DropdownMenuContent
          align="start"
          sideOffset={6}
          className="w-56 origin-(--transform-origin)"
        >
          {remoteUnopened.length > 0 && (
            <DropdownMenuGroup>
              <DropdownMenuLabel>Remote</DropdownMenuLabel>
              {remoteUnopened.map((conn) => (
                <DropdownMenuItem
                  key={conn.id}
                  onClick={() => handleOpenConnection(conn)}
                  className="gap-2"
                >
                  <ProviderIcon
                    provider={detectConnectionProvider(conn)}
                    className="size-3.5 shrink-0"
                  />
                  <span className="truncate text-xs">{conn.name}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          )}
          {localUnopened.length > 0 && remoteUnopened.length > 0 && (
            <DropdownMenuSeparator />
          )}
          {localUnopened.length > 0 && (
            <DropdownMenuGroup>
              <DropdownMenuLabel>Local</DropdownMenuLabel>
              {localUnopened.map((conn) => {
                const isRunning = localDbById[conn.id]?.running ?? false;
                return (
                  <DropdownMenuItem
                    key={conn.id}
                    onClick={() => handleOpenConnection(conn)}
                    className="gap-2"
                  >
                    <HardDrive className="size-3.5 shrink-0 text-emerald-500" />
                    <span className="truncate text-xs">{conn.name}</span>
                    <span
                      className={
                        isRunning
                          ? "ml-auto text-[10px] font-medium text-emerald-600 dark:text-emerald-400"
                          : "ml-auto text-[10px] font-medium text-muted-foreground"
                      }
                    >
                      {isRunning ? "Running" : "Stopped"}
                    </span>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  // macOS: native traffic lights area, with tabs and browser-style "+"
  if (platform === "macos") {
    return (
      <div className="z-50 select-none">
        <div className="h-10 bg-transparent flex items-center pr-1">
          <div className="w-[78px] shrink-0 h-full draglayer" />
          {tabsSlot}
          <div className="ml-auto flex items-center no-drag pl-0">
            <SettingsDialog />
            <ThemeToggle className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:text-foreground cursor-default" />
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
          <div className="flex items-center px-0 gap-0.5">
            <SettingsDialog />
            <ThemeToggle className="inline-flex size-8 items-center justify-center rounded-none text-muted-foreground transition-colors duration-150 hover:text-foreground cursor-default" />
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
