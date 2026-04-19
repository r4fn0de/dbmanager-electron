import { Database, Pencil, Play, Plus, Trash2, Server, Copy, Check, Pause, Globe } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import type { Connection, LocalDbInfo } from "@/ipc/db/types";

interface ConnectionListProps {
  connections: Connection[];
  localDbById?: Record<string, LocalDbInfo>;
  isLoading: boolean;
  onAdd: () => void;
  onEdit: (connection: Connection) => void;
  onDelete: (id: string) => void;
  onSelect: (connection: Connection) => void;
  onStartLocal?: (id: string) => Promise<void>;
  onPauseLocal?: (id: string) => Promise<void>;
}

type ConnectionProvider = "neon" | "supabase" | "url" | "direct";

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
  if (host.includes("supabase.co") || host.includes("supabase.com")) return "supabase";
  return connection.url ? "url" : "direct";
}

function connectionCopyValue(connection: Connection): string {
  if (connection.connection_string) return connection.connection_string;
  if (connection.url) return connection.url;
  const username = encodeURIComponent(connection.username);
  const password = encodeURIComponent(connection.password);
  const hasPassword = connection.password.length > 0;
  const auth = hasPassword ? `${username}:${password}` : username;
  return `postgresql://${auth}@${connection.host}:${connection.port}/${connection.database}?sslmode=${connection.ssl_mode}`;
}

function ConnectionCard({
  connection,
  localDbInfo,
  onEdit,
  onDelete,
  onSelect,
  onStartLocal,
  onPauseLocal,
}: {
  connection: Connection;
  localDbInfo?: LocalDbInfo;
  onEdit: (c: Connection) => void;
  onDelete: (id: string) => void;
  onSelect: (connection: Connection) => void;
  onStartLocal?: (id: string) => Promise<void>;
  onPauseLocal?: (id: string) => Promise<void>;
}) {
  const isUrl = !!connection.url;
  const isLocal = connection.is_local === true;
  const provider = detectConnectionProvider(connection);
  const displayInfo = isUrl
    ? (connection.url ?? "").replace(/:[^:]*@/, ":****@")
    : `${connection.username}@${connection.host}:${connection.port}/${connection.database}`;
  const displayColor = connection.color && /^#[0-9a-fA-F]{6}$/.test(connection.color)
    ? connection.color
    : "#64748b";
  const [copied, setCopied] = useState(false);
  const [isTogglingState, setIsTogglingState] = useState(false);
  const isStatusKnown = Boolean(localDbInfo);
  const isRunning = localDbInfo?.running ?? false;
  const stateLabel = !isStatusKnown ? "Unknown" : isRunning ? "Running" : "Paused";

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
    <div className="group flex items-center gap-3 py-2.5 px-2.5 -mx-2.5 rounded-md border-b border-border/40 last:border-0 hover:bg-muted/50 transition-colors duration-150">
      <div className="flex items-center justify-center h-8 w-8 rounded-md bg-muted/60 shrink-0 transition-colors duration-150 group-hover:bg-muted">
        {provider === "neon" ? (
          <span className="text-[10px] font-bold text-cyan-500">NEON</span>
        ) : provider === "supabase" ? (
          <span className="text-[10px] font-bold text-emerald-500">SUPA</span>
        ) : isUrl ? (
          <Globe className="h-4 w-4 text-muted-foreground" />
        ) : (
          <Server className="h-4 w-4 text-muted-foreground" />
        )}
      </div>

      <button
        type="button"
        className="flex-1 min-w-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 rounded-sm active:scale-[0.985] transition-transform duration-100"
        onClick={() => onSelect(connection)}
      >
        <div className="flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: displayColor }} />
          <span className="font-medium text-sm truncate">{connection.name}</span>
          {connection.tag && (
            <Badge variant="secondary" className="text-[10px] leading-none h-4 px-1.5 max-w-24 truncate" title={connection.tag}>
              {connection.tag}
            </Badge>
          )}
          {isLocal && (
            <Badge variant="outline" className="text-[10px] leading-none h-4 px-1.5 font-mono">LOCAL</Badge>
          )}
          {isLocal && (
            <Badge variant={isRunning ? "secondary" : "outline"} className="text-[10px] leading-none h-4 px-1.5 font-mono">
              {stateLabel}
            </Badge>
          )}
          {isUrl && (
            <Badge variant="secondary" className="text-[10px] leading-none h-4 px-1.5 font-mono">URL</Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground truncate font-mono mt-0.5">{displayInfo}</p>
      </button>

      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
        {isLocal && (onStartLocal || onPauseLocal) && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 active:scale-[0.97] transition-transform duration-100"
            onClick={handleToggleLocalState}
            aria-label={`${isRunning ? "Pause" : "Start"} ${connection.name}`}
            title={isRunning ? "Pause local database" : "Start local database"}
            disabled={isTogglingState || !isStatusKnown}
          >
            {isRunning ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 active:scale-[0.97] transition-transform duration-100"
          onClick={handleCopy}
          aria-label={`Copy connection string for ${connection.name}`}
          title={copied ? "Copied" : "Copy connection string"}
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 active:scale-[0.97] transition-transform duration-100"
          onClick={() => onEdit(connection)}
          aria-label={`Edit ${connection.name}`}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-destructive hover:text-destructive active:scale-[0.97] transition-transform duration-100"
          onClick={() => onDelete(connection.id)}
          aria-label={`Delete ${connection.name}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function ConnectionCardSkeleton() {
  return (
    <div className="flex items-center gap-3 py-2.5 px-2.5 -mx-2.5">
      <Skeleton className="h-8 w-8 rounded-md shrink-0" />
      <div className="flex-1 min-w-0 space-y-1.5">
        <Skeleton className="h-4 w-2/5" />
        <Skeleton className="h-3 w-3/4" />
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
        <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-muted/60 mb-4">
          <Database className="h-5 w-5 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium mb-1">No connections yet</p>
        <p className="text-xs text-muted-foreground mb-4">Add a database to get started</p>
        <Button size="sm" onClick={onAdd}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Add Connection
        </Button>
      </div>
    );
  }

  return (
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
        />
      ))}
    </div>
  );
}
