import { useNavigate } from "@tanstack/react-router";
import { motion } from "motion/react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { ClickHouse } from "@/components/icons/ClickHouse";
import { MySql } from "@/components/icons/MySql";
import { Neon } from "@/components/icons/Neon";
import { Redis } from "@/components/icons/Redis";
import { Settings } from "@/components/icons/Settings";
import { Supabase } from "@/components/icons/Supabase";
import { Button } from "@/components/ui/button";
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
import { Icon } from "@/components/ui/Icon";
import { Kbd } from "@/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ConnectionTabs,
  useConnectionsList,
  useConnectionTabSync,
} from "@/features/connection";
import { useLocalDatabases } from "@/features/localDb";
import { ThemeToggle } from "@/features/settings";
import { closeWindow, maximizeWindow, minimizeWindow } from "@/features/shell";
import type { Connection } from "@/ipc/db/types";
import { useAppearanceStore } from "@/lib/stores/appearance";
import type { ConnectionProvider } from "@/lib/stores/connection-tabs";
import {
  buildConnectionTab,
  detectConnectionProvider,
  useConnectionTabsStore,
} from "@/lib/stores/connection-tabs";
import { cn } from "@/lib/utils";

type Platform = "macos" | "windows" | "linux" | "unknown";

function detectPlatform(): Platform {
  const electronPlatform = window.electron?.platform?.toLowerCase() ?? "";
  const uaDataPlatform =
    (
      navigator as Navigator & { userAgentData?: { platform?: string } }
    ).userAgentData?.platform?.toLowerCase() ?? "";
  const uaPlatform = navigator.userAgent.toLowerCase();
  const platform = electronPlatform || uaDataPlatform || uaPlatform;

  if (platform === "darwin" || platform.includes("mac")) {
    return "macos";
  }
  if (platform === "win32" || platform.includes("win")) {
    return "windows";
  }
  if (platform === "linux" || platform.includes("linux")) {
    return "linux";
  }
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
    case "redis":
      return <Redis className={cls} />;
    case "url":
      return (
        <Icon className={`${cls} text-muted-foreground/50`} name="globe" />
      );
    default:
      return (
        <Icon
          className={`${cls} text-muted-foreground/50`}
          name="plug-connected"
        />
      );
  }
}

export function TitleBar() {
  const titlebarGooeyFilterId = "titlebar-tabs-gooey";
  const [platform] = useState<Platform>(() => detectPlatform());
  const [isMaximized, setIsMaximized] = useState(false);
  const [isConnectionMenuOpen, setIsConnectionMenuOpen] = useState(false);
  const solidBackground = useAppearanceStore((s) => s.solidBackground);
  const themePreset = useAppearanceStore((s) => s.themePreset);
  const navigate = useNavigate();
  const handleOpenSettings = useCallback(() => {
    useConnectionTabsStore.getState().openSettingsTab();
    navigate({ to: "/settings" });
  }, [navigate]);

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
    [connections, openTabIds]
  );

  const localUnopened = useMemo(
    () => unopenedConnections.filter((c) => c.is_local),
    [unopenedConnections]
  );
  const remoteUnopened = useMemo(
    () => unopenedConnections.filter((c) => !c.is_local),
    [unopenedConnections]
  );

  const handleOpenConnection = useCallback(
    (connection: Connection) => {
      if (connection.is_local) {
        const localDb = localDbById[connection.id];
        if (!localDb?.running) {
          toast.error(
            `Local database "${connection.name}" is not running. Start it before opening.`
          );
          return;
        }
      }
      useConnectionTabsStore.getState().addTab(buildConnectionTab(connection));
      navigate({
        params: { connectionId: connection.id },
        to: "/database/$connectionId",
      });
    },
    [localDbById, navigate]
  );

  const handleMinimize = () => {
    minimizeWindow();
  };

  const handleMaximize = async () => {
    await maximizeWindow();
    setIsMaximized((prev) => !prev);
  };

  const handleClose = () => {
    closeWindow();
  };

  const handleOpenConnections = () => {
    navigate({ to: "/" });
  };

  const tabsSlot = (
    <div className="draglayer flex h-full min-w-0 flex-1 items-end gap-0.5 pl-0">
      <GooeySvgFilter
        borderColor="var(--border)"
        id={titlebarGooeyFilterId}
        strength={5}
      />
      <div className="no-drag flex h-full items-end">
        <ConnectionTabs gooeyFilterId={titlebarGooeyFilterId} />
      </div>
      <DropdownMenu
        onOpenChange={(open) => {
          // Only accept close events (Escape, click-outside, etc.).
          // Open requests from the default trigger click are suppressed —
          // left-click navigates home instead; right-click opens the menu
          // directly via onContextMenu.
          if (open) {
            return;
          }
          setIsConnectionMenuOpen(false);
        }}
        open={isConnectionMenuOpen}
      >
        <TooltipProvider delay={500}>
          <Tooltip open={isConnectionMenuOpen ? false : undefined}>
            <TooltipTrigger
              render={
                <DropdownMenuTrigger
                  render={
                    <motion.button
                      aria-label="Open connections"
                      className={cn(
                        "no-drag relative isolate flex h-[37px] shrink-0 items-center justify-center self-end px-3 text-foreground/75 transition-colors duration-150 after:absolute after:inset-x-0 after:top-[1px] after:bottom-[4px] after:bg-transparent after:transition-colors after:duration-150 hover:text-foreground/75 dark:text-muted-foreground dark:hover:text-muted-foreground",
                        themePreset === "neo"
                          ? "rounded-none after:rounded-none"
                          : "rounded-md after:rounded-md",
                        solidBackground
                          ? "hover:after:bg-muted/65"
                          : "hover:after:bg-muted/35"
                      )}
                      layout
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
                      transition={{
                        bounce: 0.1,
                        damping: 25,
                        stiffness: 400,
                        type: "spring",
                      }}
                      type="button"
                      whileTap={{ scale: 0.95 }}
                    >
                      <Icon
                        className="h-3.5 w-3.5 -translate-y-[2px]"
                        name="plus"
                      />
                    </motion.button>
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
          className="w-56 origin-(--transform-origin)"
          sideOffset={6}
        >
          {remoteUnopened.length > 0 && (
            <DropdownMenuGroup>
              <DropdownMenuLabel>Remote</DropdownMenuLabel>
              {remoteUnopened.map((conn) => (
                <DropdownMenuItem
                  className="gap-2"
                  key={conn.id}
                  onClick={() => handleOpenConnection(conn)}
                >
                  <ProviderIcon
                    className="size-3.5 shrink-0"
                    provider={detectConnectionProvider(conn)}
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
                    className="gap-2"
                    key={conn.id}
                    onClick={() => handleOpenConnection(conn)}
                  >
                    <Icon
                      className="size-3.5 shrink-0 text-emerald-500"
                      name="hard-drive"
                    />
                    <span className="truncate text-xs">{conn.name}</span>
                    <span
                      className={
                        isRunning
                          ? "ml-auto font-medium text-[10px] text-emerald-600 dark:text-emerald-400"
                          : "ml-auto font-medium text-[10px] text-muted-foreground"
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
        <div className="flex h-10 items-center bg-transparent pr-1">
          <div className="draglayer h-full w-[78px] shrink-0" />
          {tabsSlot}
          <div className="no-drag ml-auto flex items-center pl-0">
            <button
              aria-label="Settings"
              className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground active:scale-[0.97]"
              onClick={handleOpenSettings}
              type="button"
            >
              <Settings className="size-4" />
            </button>
            <ThemeToggle className="inline-flex size-9 cursor-default items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:text-foreground" />
          </div>
        </div>
      </div>
    );
  }

  // Windows / Linux: custom window controls
  return (
    <div className="z-50 select-none">
      <div className="flex h-7 items-center justify-between bg-background/20 backdrop-blur-md">
        <div className="flex min-w-0 flex-1 items-center gap-2 px-3">
          <div className="no-drag flex h-4 w-4 items-center justify-center rounded bg-primary/20">
            <span className="font-bold text-[10px] text-primary">DB</span>
          </div>
          {tabsSlot}
        </div>

        <div className="no-drag flex shrink-0 items-center">
          <div className="flex items-center gap-0.5 px-0">
            <button
              aria-label="Settings"
              className="inline-flex size-8 items-center justify-center rounded-none text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground active:scale-[0.97]"
              onClick={handleOpenSettings}
              type="button"
            >
              <Settings className="size-4" />
            </button>
            <ThemeToggle className="inline-flex size-8 cursor-default items-center justify-center rounded-none text-muted-foreground transition-colors duration-150 hover:text-foreground" />
          </div>
          <Button
            aria-label="Minimize"
            className={cn(
              "no-drag h-8 w-8 rounded-none",
              solidBackground ? "hover:bg-muted/85" : "hover:bg-muted"
            )}
            onClick={handleMinimize}
            size="icon"
            variant="ghost"
          >
            <Icon className="h-4 w-4" name="minus" />
          </Button>
          <Button
            aria-label={isMaximized ? "Restore" : "Maximize"}
            className={cn(
              "no-drag h-8 w-8 rounded-none",
              solidBackground ? "hover:bg-muted/85" : "hover:bg-muted"
            )}
            onClick={handleMaximize}
            size="icon"
            variant="ghost"
          >
            {isMaximized ? (
              <Icon className="h-3 w-3 rotate-90" name="copy" />
            ) : (
              <span className="block h-3 w-3 border border-current" />
            )}
          </Button>
          <Button
            aria-label="Close"
            className="no-drag h-8 w-8 rounded-none hover:bg-destructive hover:text-destructive-foreground"
            onClick={handleClose}
            size="icon"
            variant="ghost"
          >
            <Icon className="h-4 w-4" name="x" />
          </Button>
        </div>
      </div>
    </div>
  );
}
