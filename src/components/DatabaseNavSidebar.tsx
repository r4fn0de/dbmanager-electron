import { useNavigate } from "@tanstack/react-router";
import { motion } from "motion/react";
import {
  ChevronLeft,
  Copy,
  Database,
  GitGraph,
  HardDrive,
  RefreshCw,
  Settings,
  Table2,
  Terminal,
} from "lucide-react";
import { Neon } from "@/components/icons/Neon";
import { Supabase } from "@/components/icons/Supabase";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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

const NAV_ITEMS: {
  section: SidebarSection;
  icon: typeof Database;
  label: string;
  shortcut: string;
}[] = [
  { section: "overview", icon: Database, label: "Overview", shortcut: "1" },
  { section: "tables", icon: Table2, label: "Tables", shortcut: "2" },
  { section: "sql-editor", icon: Terminal, label: "SQL Editor", shortcut: "3" },
  { section: "visualizer", icon: GitGraph, label: "Visualizer", shortcut: "4" },
  { section: "settings", icon: Settings, label: "Settings", shortcut: "5" },
];

function ProviderIcon({ provider, isLocal }: { provider?: ConnectionProvider; isLocal?: boolean }) {
  if (provider === "neon") return <Neon className="h-[18px] w-[18px]" />;
  if (provider === "supabase") return <Supabase className="h-[18px] w-[18px]" />;
  if (isLocal) return <HardDrive className="h-[18px] w-[18px] text-emerald-500" />;
  return <Database className="h-[18px] w-[18px] text-muted-foreground" />;
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
      className="min-h-0 flex flex-col bg-transparent items-center py-2 shrink-0 text-foreground/90 overflow-hidden"
      initial={{ width: 0, x: -10 }}
      animate={{ width: 48, x: 0 }}
      exit={{ width: 0, x: -10 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* ── Connection identity ────────────────────────────── */}
      <div className="flex flex-col items-center gap-1 pl-[1px] pr-1.5 mb-1">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                className="group relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-white/10"
                onClick={() => navigate({ to: "/" })}
              >
                {/* Color ring */}
                {colorDot && (
                  <span
                    className="absolute inset-0 rounded-lg ring-1 ring-inset opacity-30 group-hover:opacity-50 transition-opacity"
                    style={{ backgroundColor: "transparent", borderColor: colorDot }}
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
                <span className="text-[11px] text-foreground/55">
                  {provider}
                </span>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Separator */}
      <div className="w-6 h-px bg-white/25 my-1 pl-[1px] pr-1.5" />

      {/* ── Navigation ─────────────────────────────────────── */}
      <nav className="flex flex-col gap-0.5 pl-[1px] pr-1.5">
        {NAV_ITEMS.map(({ section, icon: Icon, label, shortcut }) => {
          const isActive = activeSection === section;
          return (
            <Tooltip key={section}>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    onClick={() => onSectionChange(section)}
                    className={`
                      group relative flex h-9 w-9 items-center justify-center rounded-lg
                      transition-all duration-150 outline-none
                      focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1
                      ${isActive
                        ? "bg-white/20 text-foreground"
                        : "text-foreground/60 hover:bg-white/16 hover:text-foreground"
                      }
                    `}
                  >
                    <Icon className="h-[18px] w-[18px]" />
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
      <div className="w-6 h-px bg-white/15 my-1 pl-[1px] pr-1.5" />

      {/* ── Bottom actions ─────────────────────────────────── */}
      <div className="flex flex-col gap-0.5 pl-[1px] pr-1.5">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 text-foreground/60 hover:text-foreground/95 hover:bg-white/10"
                onClick={onRefresh}
                disabled={isRefreshing}
              >
                <RefreshCw className={`h-[18px] w-[18px] ${isRefreshing ? "animate-spin" : ""}`} />
              </Button>
            }
          />
          <TooltipContent side="right" sideOffset={8}>Refresh</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className={`h-9 w-9 transition-colors ${
                  copyFeedback === "copied"
                    ? "text-emerald-500"
                    : copyFeedback === "failed"
                      ? "text-destructive"
                      : "text-foreground/60 hover:text-foreground/95 hover:bg-white/10"
                }`}
                onClick={onCopyConnection}
              >
                <Copy className="h-[18px] w-[18px]" />
              </Button>
            }
          />
          <TooltipContent side="right" sideOffset={8}>
            {copyFeedback === "copied" ? "Copied!" : copyFeedback === "failed" ? "Copy failed" : "Copy connection string"}
          </TooltipContent>
        </Tooltip>

        {/* Separator */}
        <div className="w-6 h-px bg-white/15 my-1" />

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 text-foreground/60 hover:text-foreground/95 hover:bg-white/10"
                onClick={() => {
                  if (onBackToConnections) {
                    onBackToConnections();
                    return;
                  }
                  navigate({ to: "/" });
                }}
              >
                <ChevronLeft className="h-[18px] w-[18px]" />
              </Button>
            }
          />
          <TooltipContent side="right" sideOffset={8}>Back to connections</TooltipContent>
        </Tooltip>
      </div>
    </motion.aside>
  );
}
