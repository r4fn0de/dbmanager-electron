import { useNavigate } from "@tanstack/react-router";
import { motion } from "motion/react";
import { ChevronLeft, Key } from "lucide-react";
import { Braces } from "@/components/icons/Braces";
import { Database } from "@/components/icons/Database";
import { Table } from "@/components/icons/Table";
import { Terminal } from "@/components/icons/Terminal";
import { Branch } from "@/components/icons/Branch";
import { Refresh } from "@/components/icons/Refresh";
import { Copy } from "@/components/icons/Copy";
import { Server } from "@/components/icons/Server";
import { Neon } from "@/components/icons/Neon";
import { Supabase } from "@/components/icons/Supabase";
import { MySql } from "@/components/icons/MySql";
import { ClickHouse } from "@/components/icons/ClickHouse";
import { Redis } from "@/components/icons/Redis";
import { Kbd } from "@/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/utils/tailwind";
import type { ConnectionProvider, SidebarSection } from "@/lib/stores/connection-tabs";
import type { Connection } from "@/ipc/db/types";

interface DatabaseNavSidebarProps {
  connection: Connection;
  provider?: ConnectionProvider;
  activeSection: SidebarSection;
  onSectionChange: (section: SidebarSection) => void;
  onRefresh: () => void;
  onCopyConnection: () => void;
  isRefreshing?: boolean;
  copyFeedback?: null | "copied" | "failed";
  onBackToConnections?: () => void;
}

type NavItem = {
  section: SidebarSection;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  shortcut: string;
};

const SQL_NAV_ITEMS: NavItem[] = [
  { section: "overview", icon: Database, label: "Overview", shortcut: "1" },
  { section: "tables", icon: Table, label: "Tables", shortcut: "2" },
  { section: "sql-editor", icon: Terminal, label: "SQL Editor", shortcut: "3" },
  { section: "visualizer", icon: Branch, label: "Visualizer", shortcut: "4" },
  { section: "definitions", icon: Braces, label: "Definitions", shortcut: "5" },
];

const REDIS_NAV_ITEMS: NavItem[] = [
  { section: "overview", icon: Database, label: "Overview", shortcut: "1" },
  { section: "keys", icon: Key, label: "Keys", shortcut: "2" },
  { section: "commands", icon: Terminal, label: "Commands", shortcut: "3" },
];

function getNavItems(dbType?: string): NavItem[] {
  if (dbType === "redis") return REDIS_NAV_ITEMS;
  return SQL_NAV_ITEMS;
}

function ProviderIcon({ provider, isLocal }: { provider?: ConnectionProvider; isLocal?: boolean }) {
  if (provider === "neon") return <Neon className="size-[18px]" />;
  if (provider === "supabase") return <Supabase className="size-[18px]" />;
  if (provider === "mysql") return <MySql className="size-[18px]" />;
  if (provider === "mariadb") return <MySql className="size-[18px]" />;
  if (provider === "clickhouse") return <ClickHouse className="size-[18px]" />;
  if (provider === "redis") return <Redis className="size-[18px]" />;
  if (isLocal) return <Server className="size-[18px] text-emerald-500" />;
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
  const colorDot = connection.color;

  return (
    <motion.aside
      className="min-h-0 -ml-1 flex flex-col bg-transparent items-center py-2 shrink-0 text-foreground overflow-hidden w-12"
      initial={{ x: -48, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: -48, opacity: 0 }}
      transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
    >
      {/* ── Connection identity ────────────────────────────── */}
      <div className="flex flex-col items-center gap-1 px-1.5 mb-1">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                className="group relative flex size-9 items-center justify-center rounded-lg transition-colors hover:bg-foreground/15"
                onClick={() => navigate({ to: "/" })}
              >
                {colorDot && !connection.is_local && (
                  <span
                    className="absolute inset-0 rounded-lg ring-1 ring-inset opacity-30 group-hover:opacity-50 transition-opacity"
                    style={{ borderColor: colorDot }}
                  />
                )}
                <ProviderIcon provider={provider} isLocal={connection.is_local} />
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
      <div className="w-6 h-px bg-border/30 my-1" />

      {/* ── Navigation ─────────────────────────────────────── */}
      <nav className="flex flex-col items-center gap-0.5 px-1.5">
        {getNavItems(connection.db_type).map(({ section, icon: Icon, label, shortcut }) => {
          const isActive = activeSection === section;
          return (
            <Tooltip key={section}>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    onClick={() => onSectionChange(section)}
                    className={cn(
                      "group relative flex size-9 items-center justify-center rounded-lg transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                      isActive
                        ? "bg-foreground/20"
                        : "hover:bg-foreground/15"
                    )}
                  >
                    <Icon
                      className={cn(
                        "size-[18px]",
                        isActive ? "text-foreground" : "text-foreground/60"
                      )}
                    />
                  </button>
                }
              />
              <TooltipContent side="right" sideOffset={8}>
                <span className="flex items-center gap-2">
                  {label}
                  <Kbd>{shortcut}</Kbd>
                </span>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </nav>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Separator */}
      <div className="w-6 h-px bg-border/30 my-1" />

      {/* ── Bottom actions ─────────────────────────────────── */}
      <div className="flex flex-col items-center gap-0.5 px-1.5">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={onRefresh}
                disabled={isRefreshing}
                className={cn(
                  "flex size-9 items-center justify-center rounded-lg transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 hover:bg-foreground/15",
                  isRefreshing && "opacity-50 cursor-not-allowed"
                )}
              >
                <Refresh className={cn("size-[18px] text-foreground/60", isRefreshing && "animate-spin")} />
              </button>
            }
          />
          <TooltipContent side="right" sideOffset={8}>Refresh</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={onCopyConnection}
                className={cn(
                  "flex size-9 items-center justify-center rounded-lg transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 hover:bg-foreground/15",
                  copyFeedback === "copied" && "text-emerald-500",
                  copyFeedback === "failed" && "text-destructive"
                )}
              >
                <Copy className="size-[18px] text-foreground/60" />
              </button>
            }
          />
          <TooltipContent side="right" sideOffset={8}>
            {copyFeedback === "copied" ? "Copied!" : copyFeedback === "failed" ? "Copy failed" : "Copy connection string"}
          </TooltipContent>
        </Tooltip>

        {/* Separator */}
        <div className="w-6 h-px bg-border/50 my-1" />

        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={() => {
                  if (onBackToConnections) {
                    onBackToConnections();
                    return;
                  }
                  navigate({ to: "/" });
                }}
                className="flex size-9 items-center justify-center rounded-lg transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 hover:bg-foreground/15"
              >
                <ChevronLeft className="size-[18px] text-foreground/60" />
              </button>
            }
          />
          <TooltipContent side="right" sideOffset={8}>Back to connections</TooltipContent>
        </Tooltip>
      </div>
    </motion.aside>
  );
}
