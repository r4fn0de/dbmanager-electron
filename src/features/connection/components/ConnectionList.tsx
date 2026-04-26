import { useState, useCallback, type ComponentType } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/Icon";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { CreateBranchDialog } from "@/features/localDb/components/CreateBranchDialog";
import { Neon } from "@/components/icons/Neon";
import { Supabase } from "@/components/icons/Supabase";
import { MySql } from "@/components/icons/MySql";
import { ClickHouse } from "@/components/icons/ClickHouse";
import { Redis } from "@/components/icons/Redis";
import { PostgreSql } from "@/components/icons/PostgreSql";
import { Sqlite } from "@/components/icons/Sqlite";
import { cn } from "@/lib/utils";
import type { BranchInfo, Connection, LocalDbInfo } from "@/ipc/db/types";
import { getClickhouseEffectivePort } from "@/ipc/db/types";

interface ConnectionListProps {
  connections: Connection[];
  localDbById?: Record<string, LocalDbInfo>;
  branchesByDbId?: Record<string, BranchInfo[]>;
  isLoading: boolean;
  onAdd: () => void;
  onEdit: (connection: Connection) => void;
  onDelete: (connection: Connection) => void;
  onSelect: (connection: Connection) => void;
  onStartLocal?: (id: string) => Promise<void>;
  onPauseLocal?: (id: string) => Promise<void>;
  onCloneToLocal?: (connection: Connection) => void;
  onCreateBranch?: (localDbId: string, input: { name: string; description?: string; parentBranchId?: string }) => Promise<BranchInfo>;
  onSwitchBranch?: (localDbId: string, branchId: string) => Promise<BranchInfo>;
  onDeleteBranch?: (localDbId: string, branchId: string) => Promise<void>;
}

type ConnectionProvider = "neon" | "supabase" | "mysql" | "mariadb" | "clickhouse" | "redis" | "url" | "direct";

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
  // Detect by db_type for MySQL/MariaDB/ClickHouse/Redis
  if (connection.db_type === "mysql") return "mysql";
  if (connection.db_type === "mariadb") return "mariadb";
  if (connection.db_type === "clickhouse") return "clickhouse";
  if (connection.db_type === "redis") return "redis";
  return connection.url ? "url" : "direct";
}

function buildConnectionStringFromConnection(connection: Connection): string {
  if (connection.connection_string) return connection.connection_string;
  if (connection.url) return connection.url;
  const username = encodeURIComponent(connection.username);
  const password = encodeURIComponent(connection.password);
  const hasPassword = connection.password.length > 0;
  const auth = hasPassword ? `${username}:${password}` : username;
  const protocol = connection.db_type === "mysql" || connection.db_type === "mariadb" ? "mysql" : connection.db_type === "clickhouse" ? (connection.ssl_mode === "require" ? "clickhouses" : "clickhouse") : "postgresql";
  const port = connection.db_type === "clickhouse" ? getClickhouseEffectivePort(connection.ssl_mode, connection.port) : connection.port;
  const sslParam = protocol === "mysql" ? `ssl=${connection.ssl_mode === "disable" ? "false" : "true"}` : protocol.startsWith("clickhouse") ? (connection.ssl_mode === "require" ? "ssl=true" : "") : `sslmode=${connection.ssl_mode}`;
  const queryPart = sslParam ? `?${sslParam}` : "";
  return `${protocol}://${auth}@${connection.host}:${port}/${connection.database}${queryPart}`;
}

function connectionCopyValue(connection: Connection): string {
  return buildConnectionStringFromConnection(connection);
}

function ProviderIcon({ provider }: { provider: ConnectionProvider }) {
  switch (provider) {
    case "neon":
      return <Neon className="size-4 shrink-0" />;
    case "supabase":
      return <Supabase className="size-4 shrink-0" />;
    case "mysql":
      return <MySql className="size-4 shrink-0" />;
    case "mariadb":
      return <MySql className="size-4 shrink-0" />;
    case "clickhouse":
      return <ClickHouse className="size-4 shrink-0" />;
    case "redis":
      return <Redis className="size-4 shrink-0" />;
    case "url":
      return <Icon name="world" className="size-4 shrink-0 text-muted-foreground/50" />;
    default:
      return <Icon name="plug-connected" className="size-4 shrink-0 text-muted-foreground/50" />;
  }
}

function ConnectionCard({
  connection,
  localDbInfo,
  branches,
  onEdit,
  onDelete,
  onSelect,
  onStartLocal,
  onPauseLocal,
  onCloneToLocal,
  onCreateBranch,
  onSwitchBranch,
  onDeleteBranch,
}: {
  connection: Connection;
  localDbInfo?: LocalDbInfo;
  branches?: BranchInfo[];
  onEdit: (c: Connection) => void;
  onDelete: (connection: Connection) => void;
  onSelect: (connection: Connection) => void;
  onStartLocal?: (id: string) => Promise<void>;
  onPauseLocal?: (id: string) => Promise<void>;
  onCloneToLocal?: (connection: Connection) => void;
  onCreateBranch?: (localDbId: string, input: { name: string; description?: string; parentBranchId?: string }) => Promise<BranchInfo>;
  onSwitchBranch?: (localDbId: string, branchId: string) => Promise<BranchInfo>;
  onDeleteBranch?: (localDbId: string, branchId: string) => Promise<void>;
}) {
  const isUrl = !!connection.url;
  const isLocal = connection.is_local === true;
  const provider = detectConnectionProvider(connection);
  const displayInfo = isUrl
    ? (connection.url ?? "").replace(/:[^:]*@/, ":****@")
    : `${connection.username}@${connection.host}:${connection.port}/${connection.database}`;
  const [copied, setCopied] = useState(false);
  const [isTogglingState, setIsTogglingState] = useState(false);
  const [branchesOpen, setBranchesOpen] = useState(false);
  const [switchingBranchId, setSwitchingBranchId] = useState<string | null>(null);
  const [pendingBranchDelete, setPendingBranchDelete] = useState<{ dbId: string; branchId: string; branchName: string } | null>(null);

  // Branches are only relevant for running PostgreSQL local DBs
  const isStatusKnown = Boolean(localDbInfo);
  const isRunning = localDbInfo?.running ?? false;
  const localEngine =
    localDbInfo?.engine ?? (connection.db_type === "sqlite" ? "sqlite" : "postgresql");
  const isLocalPg = isLocal && localEngine === "postgresql";
  const hasBranches = isLocalPg && isRunning && branches && branches.length > 0;
  const activeBranch = branches?.find((b) => b.isActive);
  const LocalDbTypeIcon = localEngine === "sqlite" ? Sqlite : PostgreSql;

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

  const handleSwitchBranch = useCallback(async (branchId: string) => {
    if (!onSwitchBranch || !connection.id) return;
    setSwitchingBranchId(branchId);
    try {
      await onSwitchBranch(connection.id, branchId);
    } finally {
      setSwitchingBranchId(null);
    }
  }, [onSwitchBranch, connection.id]);

  return (
    <>
    <Collapsible open={branchesOpen} onOpenChange={setBranchesOpen}>
      <div className="group relative flex items-stretch gap-2 rounded-lg px-3 py-2 transition-colors hover:bg-muted/60">
        {/* Click area — name, provider, info */}
        <button
          type="button"
          className="flex-1 min-w-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 rounded-sm"
          onClick={() => onSelect(connection)}
        >
          <div className="flex items-center gap-2">
            {isLocal ? (
              <LocalDbTypeIcon className="size-4 shrink-0" />
            ) : (
              <ProviderIcon provider={provider} />
            )}
            <span className="font-medium text-sm truncate">
              {connection.name}
            </span>
            {connection.color && /^#[0-9a-fA-F]{6}$/.test(connection.color) && (
              <span
                className="inline-block size-2 rounded-full shrink-0 ring-2 ring-muted-foreground/10"
                style={{ backgroundColor: connection.color }}
              />
            )}
            {connection.tag && (
              <Badge variant="outline" className="text-[10px] h-4 px-1 font-mono">
                {connection.tag}
              </Badge>
            )}
            {/* Branch badge */}
            {hasBranches && activeBranch && !activeBranch.isMain && (
              <Badge variant="outline" className="text-[10px] h-4 px-1.5 gap-0.5 font-mono border-primary/30 bg-primary/5 text-primary">
                <Icon name="git-branch" className="size-2.5" />
                {activeBranch.name}
              </Badge>
            )}
            {isLocal && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 text-[10px] font-medium",
                  isRunning
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-muted-foreground"
                )}
              >
                <span
                  className={cn(
                    "inline-block size-1.5 rounded-full",
                    isRunning ? "bg-emerald-500" : "bg-muted-foreground/40"
                  )}
                />
                {isRunning ? "Running" : "Stopped"}
              </span>
            )}
          </div>
          <Tooltip>
            <TooltipTrigger
              render={
                <p
                  className={cn(
                    "text-xs truncate font-mono mt-0.5 pl-6 cursor-pointer transition-all duration-150",
                    copied
                      ? "text-emerald-600 dark:text-emerald-400 scale-[1.02]"
                      : "text-muted-foreground hover:text-foreground active:scale-[0.97]",
                  )}
                  style={{ transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)" }}
                  onClick={(e) => { e.stopPropagation(); handleCopy(); }}
                />
              }
            >
              {copied ? "Copied!" : displayInfo}
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={4}>
              {copied ? "Copied!" : "Click to copy connection string"}
            </TooltipContent>
          </Tooltip>
        </button>

        {/* Action buttons — visible on hover */}
        <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity duration-150 self-center">
          {/* Branch toggle (only for local PG with branches) */}
          {hasBranches && (
            <CollapsibleTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className={cn(branchesOpen && "text-primary")}
                />
              }
            >
              <Icon name="git-branch" className="size-3" />
            </CollapsibleTrigger>
          )}
          {/* Create branch button (only for running local PG) */}
          {isLocalPg && isRunning && onCreateBranch && connection.id && (
            <CreateBranchDialog
              localDbName={connection.name}
              branches={branches ?? []}
              activeBranch={activeBranch ?? null}
              onCreate={(input) => onCreateBranch(connection.id!, input)}
              tooltipLabel="Create branch"
            />
          )}
          {isLocal && (onStartLocal || onPauseLocal) && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={handleToggleLocalState}
                    disabled={isTogglingState || !isStatusKnown}
                  />
                }
              >
                {isTogglingState ? (
                  <Icon name="loader" className="size-3 animate-spin" />
                ) : isRunning ? (
                  <Icon name="pause" className="size-3" />
                ) : (
                  <Icon name="play" className="size-3" />
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
                    size="icon-xs"
                    onClick={() => onCloneToLocal(connection)}
                  />
                }
              >
                <Icon name="download" className="size-3" />
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
                  size="icon-xs"
                  onClick={() => onEdit(connection)}
                />
              }
            >
              <Icon name="pencil" className="size-3" />
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
                  size="icon-xs"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => onDelete(connection)}
                />
              }
            >
              <Icon name="trash" className="size-3" />
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={4}>
              Delete connection
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Branch list (expandable) */}
      {hasBranches && (
        <CollapsibleContent>
          <div className="ml-9 mr-3 mb-1 space-y-0.5 border-l-2 border-border/40 pl-3">
            {branches!.map((branch) => (
              <div
                key={branch.id}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors",
                  branch.isActive
                    ? "bg-primary/10 text-primary"
                    : "hover:bg-muted/50 text-muted-foreground",
                )}
              >
                <Icon name="git-branch" className="size-3 shrink-0" />
                <span className="font-medium truncate flex-1">{branch.name}</span>
                {branch.isActive && (
                  <span className="size-1.5 rounded-full bg-emerald-500 shrink-0" />
                )}
                {!branch.isActive && onSwitchBranch && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="opacity-0 group-hover:opacity-100"
                    disabled={switchingBranchId === branch.id}
                    onClick={() => handleSwitchBranch(branch.id)}
                  >
                    {switchingBranchId === branch.id ? (
                      <Icon name="loader" className="size-3 animate-spin" />
                    ) : (
                      <Icon name="arrow-right" className="size-3" />
                    )}
                  </Button>
                )}
                {!branch.isMain && onDeleteBranch && connection.id && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                    onClick={() => {
                      setPendingBranchDelete({ dbId: connection.id!, branchId: branch.id, branchName: branch.name });
                    }}
                  >
                    <Icon name="trash" className="size-3" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>

      {/* Branch delete confirmation */}
      <AlertDialog
        open={!!pendingBranchDelete}
        onOpenChange={(open) => { if (!open) setPendingBranchDelete(null); }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete branch?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the <strong>{pendingBranchDelete?.branchName}</strong> branch and any child branches. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (pendingBranchDelete) {
                  void onDeleteBranch?.(pendingBranchDelete.dbId, pendingBranchDelete.branchId);
                  setPendingBranchDelete(null);
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ConnectionCardSkeleton() {
  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <Skeleton className="size-4 rounded shrink-0" />
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
  branchesByDbId,
  onEdit,
  onDelete,
  onSelect,
  onStartLocal,
  onPauseLocal,
  onCloneToLocal,
  onCreateBranch,
  onSwitchBranch,
  onDeleteBranch,
}: {
  label: string;
  icon: ComponentType<{ className?: string }>;
  connections: Connection[];
  localDbById?: Record<string, LocalDbInfo>;
  branchesByDbId?: Record<string, BranchInfo[]>;
  onEdit: (c: Connection) => void;
  onDelete: (connection: Connection) => void;
  onSelect: (c: Connection) => void;
  onStartLocal?: (id: string) => Promise<void>;
  onPauseLocal?: (id: string) => Promise<void>;
  onCloneToLocal?: (c: Connection) => void;
  onCreateBranch?: (localDbId: string, input: { name: string; description?: string; parentBranchId?: string }) => Promise<BranchInfo>;
  onSwitchBranch?: (localDbId: string, branchId: string) => Promise<BranchInfo>;
  onDeleteBranch?: (localDbId: string, branchId: string) => Promise<void>;
}) {
  if (connections.length === 0) return null;
  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-1.5 px-3 py-1">
        <Icon className="size-3 text-muted-foreground/60" />
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          {label}
        </span>
        <span className="text-[10px] text-muted-foreground/50">
          {connections.length}
        </span>
      </div>
      {connections.map((conn) => (
        <ConnectionCard
          key={conn.id}
          connection={conn}
          localDbInfo={conn.is_local ? localDbById?.[conn.id] : undefined}
          branches={conn.is_local ? branchesByDbId?.[conn.id] : undefined}
          onEdit={onEdit}
          onDelete={onDelete}
          onSelect={onSelect}
          onStartLocal={onStartLocal}
          onPauseLocal={onPauseLocal}
          onCloneToLocal={onCloneToLocal}
          onCreateBranch={onCreateBranch}
          onSwitchBranch={onSwitchBranch}
          onDeleteBranch={onDeleteBranch}
        />
      ))}
    </div>
  );
}

export function ConnectionList({
  connections,
  localDbById,
  branchesByDbId,
  isLoading,
  onAdd,
  onEdit,
  onDelete,
  onSelect,
  onStartLocal,
  onPauseLocal,
  onCloneToLocal,
  onCreateBranch,
  onSwitchBranch,
  onDeleteBranch,
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
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Icon name="folder-open" className="size-5 text-muted-foreground/30 mb-3" />
        <p className="text-sm text-muted-foreground">
          No connections yet
        </p>
        <p className="text-xs text-muted-foreground/50 mt-0.5 mb-4 max-w-[240px]">
          Add a database connection or create a local instance to get started.
        </p>
        <Button size="sm" className="h-7 text-xs gap-1" onClick={onAdd}>
          <Icon name="plus" className="size-3.5" />
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
    branchesByDbId,
    onEdit,
    onDelete,
    onSelect,
    onStartLocal,
    onPauseLocal,
    onCloneToLocal,
    onCreateBranch,
    onSwitchBranch,
    onDeleteBranch,
  };

  return (
    <div className="space-y-3">
      <ConnectionGroup
        label="Local"
        icon={(props) => <Icon name="server" {...props} />}
        connections={localConnections}
        {...sharedProps}
      />
      <ConnectionGroup
        label="Remote"
        icon={(props) => <Icon name="globe" {...props} />}
        connections={remoteConnections}
        {...sharedProps}
      />
    </div>
  );
}
