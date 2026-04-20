import { Database, Pencil, Play, Plus, Trash2, Copy, Check, Pause, Globe, Download } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Neon } from "@/components/icons/Neon";
import { Supabase } from "@/components/icons/Supabase";
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
  onCloneToLocal?: (connection: Connection) => void;
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
  onCloneToLocal,
}: {
  connection: Connection;
  localDbInfo?: LocalDbInfo;
  onEdit: (c: Connection) => void;
  onDelete: (id: string) => void;
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
  const displayColor = connection.color && /^#[0-9a-fA-F]{6}$/.test(connection.color)
    ? connection.color
    : "#64748b";
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
    <div className="group flex items-center gap-2 py-1.5 px-4 -mx-4 rounded-md hover:bg-muted/30 transition-colors duration-100 sm:px-16 sm:-mx-16 md:px-36 md:-mx-36 lg:px-52 lg:-mx-52">
      <button
        type="button"
        className="flex-1 min-w-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 rounded-sm"
        onClick={() => onSelect(connection)}
      >
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: displayColor }} />
          <span className="font-medium text-[13px] truncate">{connection.name}</span>
          {connection.tag && (
            <span className="text-[9px] text-muted-foreground/50 font-mono" title={connection.tag}>{connection.tag}</span>
          )}
          {provider === "neon" && (
            <Neon className="h-3.5 w-3.5" />
          )}
          {provider === "supabase" && (
            <Supabase className="h-3.5 w-3.5" />
          )}
          {isLocal && (
            <span className={`text-[9px] font-mono ${isRunning ? "text-emerald-600/60" : "text-muted-foreground/50"}`}>
              {isRunning ? "●" : "○"}
            </span>
          )}
          {provider === "url" && (
            <Globe className="h-3 w-3 text-muted-foreground/40" />
          )}
        </div>
        <p className="text-[10px] text-muted-foreground/50 truncate font-mono ml-4">{displayInfo}</p>
      </button>

      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
        {isLocal && (onStartLocal || onPauseLocal) && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={handleToggleLocalState}
            aria-label={`${isRunning ? "Pause" : "Start"} ${connection.name}`}
            title={isRunning ? "Pause local database" : "Start local database"}
            disabled={isTogglingState || !isStatusKnown}
          >
            {isRunning ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
          </Button>
        )}
        {!isLocal && onCloneToLocal && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => onCloneToLocal(connection)}
            aria-label={`Clone ${connection.name} to local`}
            title="Clone to local database"
          >
            <Download className="h-3 w-3" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={handleCopy}
          aria-label={`Copy connection string for ${connection.name}`}
          title={copied ? "Copied" : "Copy connection string"}
        >
          {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => onEdit(connection)}
          aria-label={`Edit ${connection.name}`}
        >
          <Pencil className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-destructive hover:text-destructive"
          onClick={() => onDelete(connection.id)}
          aria-label={`Delete ${connection.name}`}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

function ConnectionCardSkeleton() {
  return (
    <div className="flex items-center gap-2 py-1.5 px-4 -mx-4 sm:px-16 sm:-mx-16 md:px-36 md:-mx-36 lg:px-52 lg:-mx-52">
      <Skeleton className="h-2 w-2 rounded-full shrink-0" />
      <div className="flex-1 min-w-0 space-y-0.5">
        <Skeleton className="h-3 w-2/5" />
        <Skeleton className="h-2 w-3/4 ml-4" />
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
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <Database className="h-3.5 w-3.5 text-muted-foreground/40 mb-2" />
        <p className="text-[11px] text-muted-foreground mb-2">No connections yet</p>
        <Button size="sm" variant="outline" onClick={onAdd}>
          <Plus className="h-3 w-3 mr-1" />
          Add Connection
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-px">
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
  );
}
