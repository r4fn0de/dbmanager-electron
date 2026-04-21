import {
  Cable,
  Check,
  Copy,
  Download,
  FolderOpen,
  Globe,
  Pencil,
  Play,
  Plus,
  Server,
  Trash2,
  Pause,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Neon } from "@/components/icons/Neon";
import { Supabase } from "@/components/icons/Supabase";
import { MySql } from "@/components/icons/MySql";
import type { Connection, LocalDbInfo } from "@/ipc/db/types";

interface ConnectionListProps {
  connections: Connection[];
  localDbById?: Record<string, LocalDbInfo>;
  isLoading: boolean;
  onAdd: () => void;
  onEdit: (connection: Connection) => void;
  onDelete: (connection: Connection) => void;
  onSelect: (connection: Connection) => void;
  onStartLocal?: (id: string) => Promise<void>;
  onPauseLocal?: (id: string) => Promise<void>;
  onCloneToLocal?: (connection: Connection) => void;
}

type ConnectionProvider = "neon" | "supabase" | "mysql" | "mariadb" | "url" | "direct";

function resolveProviderHost(connection: Connection): string {
  if (connection.url) {
    try {
      return new URL(connection.url).hostname.toLowerCase();
    } catch {
      // fall back to parsed host
    }
  }
  return connection.host.toLowerCase();
}

function detectConnectionProvider(connection: Connection): ConnectionProvider {
  const host = resolveProviderHost(connection);
  if (host.includes("neon.tech")) return "neon";
  if (host.includes("supabase.co") || host.includes("supabase.com"))
    return "supabase";
  // Detect by db_type for MySQL/MariaDB
  if (connection.db_type === "mysql") return "mysql";
  if (connection.db_type === "mariadb") return "mariadb";
  return connection.url ? "url" : "direct";
}

function buildConnectionStringFromConnection(connection: Connection): string {
  if (connection.connection_string) return connection.connection_string;
  if (connection.url) return connection.url;
  const username = encodeURIComponent(connection.username);
  const password = encodeURIComponent(connection.password);
  const hasPassword = connection.password.length > 0;
  const auth = hasPassword ? `${username}:${password}` : username;
  const protocol = connection.db_type === "mysql" || connection.db_type === "mariadb" ? "mysql" : "postgresql";
  const sslParam = protocol === "mysql" ? `ssl=${connection.ssl_mode === "disable" ? "false" : "true"}` : `sslmode=${connection.ssl_mode}`;
  return `${protocol}://${auth}@${connection.host}:${connection.port}/${connection.database}?${sslParam}`;
}

function connectionCopyValue(connection: Connection): string {
  return buildConnectionStringFromConnection(connection);
}

function ProviderIcon({ provider }: { provider: ConnectionProvider }) {
  switch (provider) {
    case "neon":
      return <Neon className="h-4 w-4 shrink-0" />;
    case "supabase":
      return <Supabase className="h-4 w-4 shrink-0" />;
    case "mysql":
      return <MySql className="h-4 w-4 shrink-0" />;
    case "mariadb":
      return <MySql className="h-4 w-4 shrink-0" />;
    case "url":
      return <Globe className="h-4 w-4 shrink-0 text-muted-foreground/50" />;
    default:
      return <Cable className="h-4 w-4 shrink-0 text-muted-foreground/50" />;
  }
}

function ConnectionCard({
  connection,
  localDbInfo,
  onEdit,
  onDelete,
  onSelect,
  onStartLocal,
  onPauseLocal,
  onCloneToLocal,
}: {
  connection: Connection;
  localDbInfo?: LocalDbInfo;
  onEdit: (c: Connection) => void;
  onDelete: (connection: Connection) => void;
  onSelect: (connection: Connection) => void;
  onStartLocal?: (id: string) => Promise<void>;
  onPauseLocal?: (id: string) => Promise<void>;
  onCloneToLocal?: (connection: Connection) => void;
}) {
  const isUrl = !!connection.url;
  const isLocal = connection.is_local === true;
  const provider = detectConnectionProvider(connection);
  const displayInfo = isUrl
    ? (connection.url ?? "").replace(/:[^:]*@/, ":****@")
    : `${connection.username}@${connection.host}:${connection.port}/${connection.database}`;
  const [copied, setCopied] = useState(false);
  const [isTogglingState, setIsTogglingState] = useState(false);
  const isStatusKnown = Boolean(localDbInfo);
  const isRunning = localDbInfo?.running ?? false;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(connectionCopyValue(connection));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const handleToggleLocalState = async () => {
    if (!isLocal || !connection.id) return;
    setIsTogglingState(true);
    try {
      if (isRunning) {
        await onPauseLocal?.(connection.id);
      } else {
        await onStartLocal?.(connection.id);
      }
    } finally {
      setIsTogglingState(false);
    }
  };

  return (
    <div className="group relative flex items-stretch gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/80">
      {/* Click area — name, provider, info */}
      <button
        type="button"
        className="flex-1 min-w-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 rounded-sm"
        onClick={() => onSelect(connection)}
      >
        <div className="flex items-center gap-2">
          <ProviderIcon provider={provider} />
          <span className="font-medium text-sm truncate">
            {connection.name}
          </span>
          {connection.tag && (
            <Badge variant="outline" className="text-[10px] h-4 px-1 font-mono">
              {connection.tag}
            </Badge>
          )}
          {isLocal && (
            <span
              className={`inline-flex items-center gap-1 text-[10px] font-medium ${
                isRunning
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-muted-foreground"
              }`}
            >
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${
                  isRunning
                    ? "bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.5)]"
                    : "bg-muted-foreground/40"
                }`}
              />
              {isRunning ? "Running" : "Stopped"}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground truncate font-mono mt-0.5 pl-6">
          {displayInfo}
        </p>
      </button>

      {/* Action buttons — visible on hover */}
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150 self-center">
        {isLocal && (onStartLocal || onPauseLocal) && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={handleToggleLocalState}
                  disabled={isTogglingState || !isStatusKnown}
                />
              }
            >
              {isRunning ? (
                <Pause className="h-3.5 w-3.5" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={4}>
              {isRunning ? "Pause database" : "Start database"}
            </TooltipContent>
          </Tooltip>
        )}
        {!isLocal && onCloneToLocal && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onCloneToLocal(connection)}
                />
              }
            >
              <Download className="h-3.5 w-3.5" />
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={4}>
              Clone to local
            </TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleCopy}
              />
            }
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-emerald-500" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={4}>
            {copied ? "Copied!" : "Copy connection string"}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => onEdit(connection)}
              />
            }
          >
            <Pencil className="h-3.5 w-3.5" />
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={4}>
            Edit connection
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => onDelete(connection)}
              />
            }
          >
            <Trash2 className="h-3.5 w-3.5" />
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={4}>
            Delete connection
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

function ConnectionCardSkeleton() {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <Skeleton className="h-4 w-4 rounded shrink-0" />
      <div className="flex-1 min-w-0 space-y-1">
        <Skeleton className="h-3.5 w-2/5" />
        <Skeleton className="h-2.5 w-3/4" />
      </div>
    </div>
  );
}

function ConnectionGroup({
  label,
  icon: Icon,
  connections,
  localDbById,
  onEdit,
  onDelete,
  onSelect,
  onStartLocal,
  onPauseLocal,
  onCloneToLocal,
}: {
  label: string;
  icon: typeof Server;
  connections: Connection[];
  localDbById?: Record<string, LocalDbInfo>;
  onEdit: (c: Connection) => void;
  onDelete: (connection: Connection) => void;
  onSelect: (c: Connection) => void;
  onStartLocal?: (id: string) => Promise<void>;
  onPauseLocal?: (id: string) => Promise<void>;
  onCloneToLocal?: (c: Connection) => void;
}) {
  if (connections.length === 0) return null;
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="h-3 w-3 text-muted-foreground/60" />
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          {label}
        </span>
        <span className="text-[10px] text-muted-foreground/50">
          {connections.length}
        </span>
      </div>
      <div className="space-y-0.5">
        {connections.map((conn) => (
          <ConnectionCard
            key={conn.id}
            connection={conn}
            localDbInfo={conn.is_local ? localDbById?.[conn.id] : undefined}
            onEdit={onEdit}
            onDelete={onDelete}
            onSelect={onSelect}
            onStartLocal={onStartLocal}
            onPauseLocal={onPauseLocal}
            onCloneToLocal={onCloneToLocal}
          />
        ))}
      </div>
    </div>
  );
}

export function ConnectionList({
  connections,
  localDbById,
  isLoading,
  onAdd,
  onEdit,
  onDelete,
  onSelect,
  onStartLocal,
  onPauseLocal,
  onCloneToLocal,
}: ConnectionListProps) {
  if (isLoading) {
    return (
      <div className="space-y-1">
        {Array.from({ length: 3 }).map((_, i) => (
          <ConnectionCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (connections.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="rounded-full bg-muted/60 p-3 mb-3">
          <FolderOpen className="h-5 w-5 text-muted-foreground/60" />
        </div>
        <p className="text-sm text-muted-foreground mb-1">
          No connections yet
        </p>
        <p className="text-xs text-muted-foreground/60 mb-4 max-w-[220px]">
          Add a database connection (PostgreSQL, MySQL, MariaDB) or create a local instance to get
          started.
        </p>
        <Button size="sm" onClick={onAdd}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Add Connection
        </Button>
      </div>
    );
  }

  // Split connections into local and remote groups
  const localConnections = connections.filter((c) => c.is_local === true);
  const remoteConnections = connections.filter((c) => c.is_local !== true);

  const sharedProps = {
    localDbById,
    onEdit,
    onDelete,
    onSelect,
    onStartLocal,
    onPauseLocal,
    onCloneToLocal,
  };

  return (
    <div className="space-y-4">
      <ConnectionGroup
        label="Local"
        icon={Server}
        connections={localConnections}
        {...sharedProps}
      />
      <ConnectionGroup
        label="Remote"
        icon={Globe}
        connections={remoteConnections}
        {...sharedProps}
      />
    </div>
  );
}
