import { useNavigate } from "@tanstack/react-router";
import { motion } from "motion/react";
import { Grid8 } from "reicon-react";
import { Braces } from "@/components/icons/Braces";
import { Branch } from "@/components/icons/Branch";
import { ClickHouse } from "@/components/icons/ClickHouse";
import { Database } from "@/components/icons/Database";
import { MySql } from "@/components/icons/MySql";
import { Neon } from "@/components/icons/Neon";
import { PostgreSql } from "@/components/icons/PostgreSql";
import { Redis } from "@/components/icons/Redis";
import { Sqlite } from "@/components/icons/Sqlite";
import { Supabase } from "@/components/icons/Supabase";
import { Kbd } from "@/components/ui/kbd";
import { ReIcon } from "@/components/ui/ReIcon";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Connection } from "@/ipc/db/types";
import type {
  ConnectionProvider,
  SidebarSection,
} from "@/lib/stores/connection-tabs";
import { cn } from "@/lib/utils";

interface DatabaseNavSidebarProps {
  activeSection: SidebarSection;
  connection: Connection;
  copyFeedback?: null | "copied" | "failed";
  isRefreshing?: boolean;
  onBackToConnections?: () => void;
  onCopyConnection: () => void;
  onRefresh: () => void;
  onSectionChange: (section: SidebarSection) => void;
  provider?: ConnectionProvider;
}

interface NavItem {
  section: SidebarSection;
  icon: (className: string) => React.ReactNode;
  label: string;
  shortcut: string;
}

// `ReIcon` entries use `weight="Filled"` so they match the solid visual
// language of the hand-written `@/components/icons` glyphs next to them.
const SQL_NAV_ITEMS: NavItem[] = [
  {
    icon: (className) => (
      <ReIcon className={className} name="database" weight="Filled" />
    ),
    label: "Overview",
    section: "overview",
    shortcut: "1",
  },
  {
    icon: (className) => <Grid8 className={className} weight="Filled" />,
    label: "Tables",
    section: "tables",
    shortcut: "2",
  },
  {
    icon: (className) => (
      <ReIcon className={className} name="terminal" weight="Filled" />
    ),
    label: "SQL Editor",
    section: "sql-editor",
    shortcut: "3",
  },
  {
    icon: (className) => <Branch className={className} />,
    label: "Visualizer",
    section: "visualizer",
    shortcut: "4",
  },
  {
    icon: (className) => <Braces className={className} />,
    label: "Definitions",
    section: "definitions",
    shortcut: "5",
  },
];

const REDIS_NAV_ITEMS: NavItem[] = [
  {
    icon: (className) => (
      <ReIcon className={className} name="database" weight="Filled" />
    ),
    label: "Overview",
    section: "overview",
    shortcut: "1",
  },
  {
    icon: (className) => (
      <ReIcon className={className} name="key" weight="Filled" />
    ),
    label: "Keys",
    section: "keys",
    shortcut: "2",
  },
  {
    icon: (className) => (
      <ReIcon className={className} name="terminal" weight="Filled" />
    ),
    label: "Commands",
    section: "commands",
    shortcut: "3",
  },
];

function getNavItems(dbType?: string): NavItem[] {
  if (dbType === "redis") {
    return REDIS_NAV_ITEMS;
  }
  return SQL_NAV_ITEMS;
}

function ProviderIcon({
  provider,
  isLocal,
  localEngine,
}: {
  provider?: ConnectionProvider;
  isLocal?: boolean;
  localEngine?: string;
}) {
  if (provider === "neon") {
    return <Neon className="size-[18px]" />;
  }
  if (provider === "supabase") {
    return <Supabase className="size-[18px]" />;
  }
  if (provider === "mysql") {
    return <MySql className="size-[18px]" />;
  }
  if (provider === "mariadb") {
    return <MySql className="size-[18px]" />;
  }
  if (provider === "clickhouse") {
    return <ClickHouse className="size-[18px]" />;
  }
  if (provider === "redis") {
    return <Redis className="size-[18px]" />;
  }
  if (isLocal) {
    if (localEngine === "sqlite") {
      return <Sqlite className="size-[18px]" />;
    }
    return <PostgreSql className="size-[18px]" />;
  }
  return <Database className="size-[18px] text-foreground/60" />;
}

export function DatabaseNavSidebar({
  connection,
  provider,
  activeSection,
  onSectionChange,
  onRefresh,
  onCopyConnection,
  isRefreshing = false,
  copyFeedback = null,
  onBackToConnections,
}: DatabaseNavSidebarProps) {
  const navigate = useNavigate();
  const _colorDot = connection.color;

  return (
    <motion.aside
      animate={{ opacity: 1, x: 0 }}
      className="-ml-1 flex min-h-0 w-12 shrink-0 flex-col items-center overflow-hidden bg-transparent pt-0 pb-0 text-foreground"
      exit={{ opacity: 0, x: -48 }}
      initial={false}
      transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
    >
      {/* ── Connection identity ────────────────────────────── */}
      <div className="flex flex-col items-center gap-1 px-1.5">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                className="group relative flex size-9 items-center justify-center rounded-lg transition-colors hover:bg-foreground/15"
                onClick={() => navigate({ to: "/" })}
                type="button"
              >
                <ProviderIcon
                  isLocal={connection.is_local}
                  localEngine={
                    connection.db_type === "sqlite" ? "sqlite" : "postgresql"
                  }
                  provider={provider}
                />
              </button>
            }
          />
          <TooltipContent side="right" sideOffset={8}>
            <div className="flex items-center gap-1.5">
              <span className="font-medium">{connection.name}</span>
              {provider && (
                <span className="text-[11px] text-muted-foreground">
                  {provider}
                </span>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Separator */}
      <div className="my-1 h-px w-6 bg-border/30" />

      {/* ── Navigation ─────────────────────────────────────── */}
      <nav className="flex flex-col items-center gap-0.5 px-1.5">
        {getNavItems(connection.db_type).map(
          ({ section, icon, label, shortcut }) => {
            const isActive = activeSection === section;
            return (
              <div key={section}>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <motion.button
                        className={cn(
                          "group relative flex size-9 items-center justify-center rounded-lg outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                          isActive
                            ? "bg-foreground/20"
                            : "hover:bg-foreground/15"
                        )}
                        onClick={() => onSectionChange(section)}
                        transition={{
                          damping: 25,
                          stiffness: 400,
                          type: "spring",
                        }}
                        type="button"
                        whileTap={{ scale: 0.95 }}
                      >
                        {icon(
                          cn(
                            "size-[18px] transition-colors duration-150",
                            isActive ? "text-foreground" : "text-foreground/60"
                          )
                        )}
                      </motion.button>
                    }
                  />
                  <TooltipContent side="right" sideOffset={8}>
                    <span className="flex items-center gap-2">
                      {label}
                      <Kbd>{shortcut}</Kbd>
                    </span>
                  </TooltipContent>
                </Tooltip>
              </div>
            );
          }
        )}
      </nav>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Separator */}
      <div className="my-1 h-px w-6 bg-border/30" />

      {/* ── Bottom actions ─────────────────────────────────── */}
      <div className="flex flex-col items-center gap-0.5 px-1.5">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                className={cn(
                  "flex size-9 items-center justify-center rounded-lg outline-none transition-all duration-150 hover:bg-foreground/15 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                  isRefreshing && "cursor-not-allowed opacity-50"
                )}
                disabled={isRefreshing}
                onClick={onRefresh}
                type="button"
              >
                <ReIcon
                  className={cn(
                    "size-[18px] text-foreground/60",
                    isRefreshing && "animate-spin"
                  )}
                  name="refresh"
                  weight="Filled"
                />
              </button>
            }
          />
          <TooltipContent side="right" sideOffset={8}>
            Refresh
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                className={cn(
                  "flex size-9 items-center justify-center rounded-lg outline-none transition-all duration-150 hover:bg-foreground/15 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                  copyFeedback === "copied" && "text-emerald-500",
                  copyFeedback === "failed" && "text-destructive"
                )}
                onClick={onCopyConnection}
                type="button"
              >
                <ReIcon
                  className="size-[18px] text-foreground/60"
                  name="copy"
                  weight="Filled"
                />
              </button>
            }
          />
          <TooltipContent side="right" sideOffset={8}>
            {copyFeedback === "copied"
              ? "Copied!"
              : copyFeedback === "failed"
                ? "Copy failed"
                : "Copy connection string"}
          </TooltipContent>
        </Tooltip>

        {/* Separator */}
        <div className="my-1 h-px w-6 bg-border/50" />

        <Tooltip>
          <TooltipTrigger
            render={
              <button
                className="flex size-9 items-center justify-center rounded-lg outline-none transition-all duration-150 hover:bg-foreground/15 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                onClick={() => {
                  if (onBackToConnections) {
                    onBackToConnections();
                    return;
                  }
                  navigate({ to: "/" });
                }}
                type="button"
              >
                <ReIcon
                  className="size-[18px] text-foreground/60"
                  name="chevron-left"
                />
              </button>
            }
          />
          <TooltipContent side="right" sideOffset={8}>
            Back to connections
          </TooltipContent>
        </Tooltip>
      </div>
    </motion.aside>
  );
}
