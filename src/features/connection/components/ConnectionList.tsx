import { type ComponentType, useCallback, useState } from "react";
import { ClickHouse } from "@/components/icons/ClickHouse";
import { MySql } from "@/components/icons/MySql";
import { Neon } from "@/components/icons/Neon";
import { PostgreSql } from "@/components/icons/PostgreSql";
import { Redis } from "@/components/icons/Redis";
import { Sqlite } from "@/components/icons/Sqlite";
import { Supabase } from "@/components/icons/Supabase";
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
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Icon } from "@/components/ui/Icon";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CreateBranchDialog } from "@/features/localDb/components/CreateBranchDialog";
import type {
  BranchDeletePreview,
  BranchInfo,
  Connection,
  LocalDbInfo,
} from "@/ipc/db/types";
import { getClickhouseEffectivePort } from "@/ipc/db/types";
import { ipc } from "@/ipc/manager";
import { cn } from "@/lib/utils";

interface ConnectionListProps {
  branchesByDbId?: Record<string, BranchInfo[]>;
  connections: Connection[];
  isFilteredEmpty?: boolean;
  isLoading: boolean;
  lastOpenedById?: Record<string, number>;
  localDbById?: Record<string, LocalDbInfo>;
  onAdd: () => void;
  onClearFilters?: () => void;
  onCloneToLocal?: (connection: Connection) => void;
  onCreateBranch?: (
    localDbId: string,
    input: {
      name: string;
      description?: string;
      parentBranchId?: string;
      dataTables?: Array<{ schema: string; table: string }>;
    }
  ) => Promise<BranchInfo>;
  onDelete: (connection: Connection) => void;
  onDeleteBranch?: (localDbId: string, branchId: string) => Promise<void>;
  onEdit: (connection: Connection) => void;
  onPauseLocal?: (id: string) => Promise<void>;
  onPreviewDeleteBranch?: (
    localDbId: string,
    branchId: string
  ) => Promise<BranchDeletePreview>;
  onSelect: (connection: Connection) => void;
  onStartLocal?: (id: string) => Promise<void>;
  onSwitchBranch?: (localDbId: string, branchId: string) => Promise<BranchInfo>;
  variant?: "list" | "grid";
}

type ConnectionProvider =
  | "neon"
  | "supabase"
  | "mysql"
  | "mariadb"
  | "clickhouse"
  | "redis"
  | "url"
  | "direct";

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

const MASKED_PASSWORD_PATTERN = /^\*+$/;
const LEADING_SLASHES_PATTERN = /^\/+/;
const NEON_POOLER_REGION_PATTERN = /\.c-\d+\.([a-z]{2}-[a-z]+-\d+)\./;
const HOSTED_REGION_PATTERN = /\.([a-z]{2}-[a-z]+-\d+)\./;

function hasMaskedPasswordInUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    // Backends often mask secrets as "***"/"****" when returning connection strings.
    return (
      parsed.password.length > 0 &&
      MASKED_PASSWORD_PATTERN.test(parsed.password)
    );
  } catch {
    return false;
  }
}

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

function connectionDisplayMeta(connection: Connection): {
  database: string;
  detail: string;
  engine: string;
  host: string;
  region: string | null;
} {
  const { host: storedHost, database: storedDatabase } = connection;
  let host = storedHost;
  let database = storedDatabase;
  if (connection.url) {
    try {
      const parsed = new URL(connection.url);
      if (parsed.hostname) {
        host = parsed.hostname;
      }
      const pathDatabase = decodeURIComponent(parsed.pathname).replace(
        LEADING_SLASHES_PATTERN,
        ""
      );
      if (pathDatabase) {
        database = pathDatabase;
      }
    } catch {
      // Keep stored host/database when the URL cannot be parsed.
    }
  }
  const detail = connection.url
    ? `${host} • ${database}`
    : `${connection.username}@${host}:${connection.port}/${database}`;
  const engine =
    connection.db_type === "postgresql"
      ? (connection.engine_version ??
        connection.postgres_version ??
        "PostgreSQL")
      : connection.db_type;
  const region = connection.url ? parseHostRegion(host) : null;
  return { database, detail, engine, host, region };
}

function formatRelativeTime(timestamp: number): string {
  const delta = Date.now() - timestamp;
  if (delta < 60_000) {
    return "Just now";
  }
  if (delta < 3_600_000) {
    const minutes = Math.floor(delta / 60_000);
    return `${minutes}m ago`;
  }
  if (delta < 86_400_000) {
    const hours = Math.floor(delta / 3_600_000);
    return `${hours}h ago`;
  }
  const days = Math.floor(delta / 86_400_000);
  return days === 1 ? "Yesterday" : `${days}d ago`;
}

function parseHostRegion(host: string): string | null {
  const normalized = host.toLowerCase();
  const poolMatch = normalized.match(NEON_POOLER_REGION_PATTERN);
  if (poolMatch?.[1]) {
    return poolMatch[1];
  }
  const directMatch = normalized.match(HOSTED_REGION_PATTERN);
  return directMatch?.[1] ?? null;
}

function detectConnectionProvider(connection: Connection): ConnectionProvider {
  const host = resolveProviderHost(connection);
  if (host.includes("neon.tech")) {
    return "neon";
  }
  if (host.includes("supabase.co") || host.includes("supabase.com")) {
    return "supabase";
  }
  // Detect by db_type for MySQL/MariaDB/ClickHouse/Redis
  if (connection.db_type === "mysql") {
    return "mysql";
  }
  if (connection.db_type === "mariadb") {
    return "mariadb";
  }
  if (connection.db_type === "clickhouse") {
    return "clickhouse";
  }
  if (connection.db_type === "redis") {
    return "redis";
  }
  return connection.url ? "url" : "direct";
}

function buildConnectionStringFromConnection(connection: Connection): string {
  if (
    connection.connection_string &&
    !hasMaskedPasswordInUrl(connection.connection_string)
  ) {
    return connection.connection_string;
  }
  if (connection.url && !hasMaskedPasswordInUrl(connection.url)) {
    return connection.url;
  }
  const username = encodeURIComponent(connection.username);
  const password = encodeURIComponent(connection.password);
  const hasPassword = connection.password.length > 0;
  const auth = hasPassword ? `${username}:${password}` : username;
  const protocol =
    connection.db_type === "mysql" || connection.db_type === "mariadb"
      ? "mysql"
      : connection.db_type === "clickhouse"
        ? connection.ssl_mode === "require"
          ? "clickhouses"
          : "clickhouse"
        : "postgresql";
  const port =
    connection.db_type === "clickhouse"
      ? getClickhouseEffectivePort(connection.ssl_mode, connection.port)
      : connection.port;
  const sslParam =
    protocol === "mysql"
      ? `ssl=${connection.ssl_mode === "disable" ? "false" : "true"}`
      : protocol.startsWith("clickhouse")
        ? connection.ssl_mode === "require"
          ? "ssl=true"
          : ""
        : `sslmode=${connection.ssl_mode}`;
  const queryPart = sslParam ? `?${sslParam}` : "";
  return `${protocol}://${auth}@${connection.host}:${port}/${connection.database}${queryPart}`;
}

function ProviderIcon({
  provider,
  className,
}: {
  provider: ConnectionProvider;
  className?: string;
}) {
  const iconClassName = className ?? "size-4 shrink-0";
  switch (provider) {
    case "neon":
      return <Neon className={iconClassName} />;
    case "supabase":
      return <Supabase className={iconClassName} />;
    case "mysql":
      return <MySql className={iconClassName} />;
    case "mariadb":
      return <MySql className={iconClassName} />;
    case "clickhouse":
      return <ClickHouse className={iconClassName} />;
    case "redis":
      return <Redis className={iconClassName} />;
    case "url":
      return (
        <Icon
          className={cn(iconClassName, "text-muted-foreground")}
          name="world"
        />
      );
    default:
      return (
        <Icon
          className={cn(iconClassName, "text-muted-foreground")}
          name="plug-connected"
        />
      );
  }
}

function CardActionButtons({
  activeBranch,
  branches,
  branchesOpen,
  canCloneToLocal,
  connection,
  hasBranches,
  isLocalPg,
  isRunning,
  isStatusKnown,
  isTogglingState,
  onCloneToLocal,
  onCreateBranch,
  copied,
  onCopy,
  onDelete,
  onEdit,
  onToggleLocalState,
  showStartPause,
}: {
  activeBranch?: BranchInfo | null;
  branches?: BranchInfo[];
  branchesOpen: boolean;
  canCloneToLocal: boolean;
  connection: Connection;
  hasBranches?: boolean;
  isLocalPg: boolean;
  isRunning: boolean;
  isStatusKnown: boolean;
  isTogglingState: boolean;
  onCloneToLocal?: (connection: Connection) => void;
  onCreateBranch?: (
    localDbId: string,
    input: {
      name: string;
      description?: string;
      parentBranchId?: string;
      dataTables?: Array<{ schema: string; table: string }>;
    }
  ) => Promise<BranchInfo>;
  copied: boolean;
  onCopy: () => void;
  onDelete: (connection: Connection) => void;
  onEdit: (c: Connection) => void;
  onToggleLocalState: () => void;
  showStartPause: boolean;
}) {
  return (
    <>
      {hasBranches ? (
        <CollapsibleTrigger
          render={
            <Button
              className={cn(branchesOpen && "text-primary")}
              size="icon-xs"
              variant="ghost"
            />
          }
        >
          <Icon className="size-3" name="git-branch" />
        </CollapsibleTrigger>
      ) : null}
      {isLocalPg && isRunning && onCreateBranch && connection.id ? (
        <CreateBranchDialog
          activeBranch={activeBranch ?? null}
          branches={branches ?? []}
          connectionId={connection.id}
          localDbName={connection.name}
          onCreate={(input) => onCreateBranch(connection.id!, input)}
          tooltipLabel="Create branch"
        />
      ) : null}
      {showStartPause ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                disabled={isTogglingState || !isStatusKnown}
                onClick={onToggleLocalState}
                size="icon-xs"
                variant="ghost"
              />
            }
          >
            {isTogglingState ? (
              <Icon className="size-3 animate-spin" name="loader" />
            ) : isRunning ? (
              <Icon className="size-3" name="pause" />
            ) : (
              <Icon className="size-3" name="play" />
            )}
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={4}>
            {isRunning ? "Pause database" : "Start database"}
          </TooltipContent>
        </Tooltip>
      ) : null}
      {canCloneToLocal && onCloneToLocal ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                onClick={() => onCloneToLocal(connection)}
                size="icon-xs"
                variant="ghost"
              />
            }
          >
            <Icon className="size-3" name="download" />
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={4}>
            Clone to local
          </TooltipContent>
        </Tooltip>
      ) : null}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              onClick={() => onEdit(connection)}
              size="icon-xs"
              variant="ghost"
            />
          }
        >
          <Icon className="size-3" name="pencil" />
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={4}>
          Edit connection
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              className={cn(
                copied && "text-emerald-600 dark:text-emerald-400"
              )}
              onClick={onCopy}
              size="icon-xs"
              variant="ghost"
            />
          }
        >
          <Icon className="size-3" name={copied ? "check" : "copy"} />
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={4}>
          {copied ? "Copied!" : "Copy connection string"}
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              className="text-muted-foreground hover:text-destructive"
              onClick={() => onDelete(connection)}
              size="icon-xs"
              variant="ghost"
            />
          }
        >
          <Icon className="size-3" name="trash" />
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={4}>
          Delete connection
        </TooltipContent>
      </Tooltip>
    </>
  );
}

function ConnectionCard({
  connection,
  localDbInfo,
  branches,
  lastOpenedAt,
  variant,
  onEdit,
  onDelete,
  onSelect,
  onStartLocal,
  onPauseLocal,
  onCloneToLocal,
  onCreateBranch,
  onSwitchBranch,
  onPreviewDeleteBranch,
  onDeleteBranch,
}: {
  connection: Connection;
  localDbInfo?: LocalDbInfo;
  branches?: BranchInfo[];
  lastOpenedAt?: number;
  variant?: "list" | "grid";
  onEdit: (c: Connection) => void;
  onDelete: (connection: Connection) => void;
  onSelect: (connection: Connection) => void;
  onStartLocal?: (id: string) => Promise<void>;
  onPauseLocal?: (id: string) => Promise<void>;
  onCloneToLocal?: (connection: Connection) => void;
  onCreateBranch?: (
    localDbId: string,
    input: {
      name: string;
      description?: string;
      parentBranchId?: string;
      dataTables?: Array<{ schema: string; table: string }>;
    }
  ) => Promise<BranchInfo>;
  onSwitchBranch?: (localDbId: string, branchId: string) => Promise<BranchInfo>;
  onPreviewDeleteBranch?: (
    localDbId: string,
    branchId: string
  ) => Promise<BranchDeletePreview>;
  onDeleteBranch?: (localDbId: string, branchId: string) => Promise<void>;
}) {
  const isLocal = connection.is_local === true;
  const canCloneToLocal = !isLocal && connection.db_type === "postgresql";
  const provider = detectConnectionProvider(connection);
  const displayMeta = connectionDisplayMeta(connection);
  const [copied, setCopied] = useState(false);
  const [isTogglingState, setIsTogglingState] = useState(false);
  const [branchesOpen, setBranchesOpen] = useState(false);
  const [switchingBranchId, setSwitchingBranchId] = useState<string | null>(
    null
  );
  const [pendingBranchDelete, setPendingBranchDelete] = useState<{
    dbId: string;
    branchId: string;
    branchName: string;
    branchesToDelete: BranchInfo[];
  } | null>(null);
  const [loadingDeletePreview, setLoadingDeletePreview] = useState(false);

  // Branches are only relevant for running PostgreSQL local DBs
  const isStatusKnown = Boolean(localDbInfo);
  const isRunning = localDbInfo?.running ?? false;
  const localEngine =
    localDbInfo?.engine ??
    (connection.db_type === "sqlite" ? "sqlite" : "postgresql");
  const isLocalPg = isLocal && localEngine === "postgresql";
  const hasBranches = isLocalPg && isRunning && branches && branches.length > 0;
  const activeBranch = branches?.find((b) => b.isActive);
  const LocalDbTypeIcon = localEngine === "sqlite" ? Sqlite : PostgreSql;

  const handleCopy = async () => {
    try {
      // Connection list payload may contain masked/empty password fields.
      // Fetch full connection by id before copying to ensure real credentials.
      let sourceConnection = connection;
      if (connection.id) {
        try {
          const freshConnection = await ipc.client.db.getConnection({
            id: connection.id,
          });
          if (freshConnection) {
            sourceConnection = freshConnection;
          }
        } catch {
          // Fallback to current in-memory connection if refetch fails.
        }
      }

      await navigator.clipboard.writeText(
        buildConnectionStringFromConnection(sourceConnection)
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const handleToggleLocalState = async () => {
    if (!(isLocal && connection.id)) {
      return;
    }
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

  const handleSwitchBranch = useCallback(
    async (branchId: string) => {
      if (!(onSwitchBranch && connection.id)) {
        return;
      }
      setSwitchingBranchId(branchId);
      try {
        await onSwitchBranch(connection.id, branchId);
      } finally {
        setSwitchingBranchId(null);
      }
    },
    [onSwitchBranch, connection.id]
  );

  return (
    <>
      <Collapsible onOpenChange={setBranchesOpen} open={branchesOpen}>
        <div
          className={cn(
            "group relative transition-colors duration-150 focus-within:border-border/30 focus-within:bg-muted/50 hover:border-border/30 hover:bg-muted/50",
            variant === "grid"
              ? "flex h-full flex-col gap-3 rounded-xl border border-border/40 bg-card p-4 hover:bg-muted/30"
              : "flex items-stretch gap-2 rounded-xl border border-transparent px-3.5 py-2.5"
          )}
        >
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-start gap-2">
              {isLocal ? (
                <LocalDbTypeIcon className="mt-0.5 size-5 shrink-0" />
              ) : (
                <ProviderIcon
                  className={cn("shrink-0", variant === "grid" ? "size-5" : "size-4")}
                  provider={provider}
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <button
                    className="min-w-0 flex-1 truncate rounded-sm text-left font-medium text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                    onClick={() => onSelect(connection)}
                    type="button"
                  >
                    {connection.name}
                  </button>
                  {connection.color &&
                    HEX_COLOR_PATTERN.test(connection.color) && (
                      <span
                        className="inline-block size-2 shrink-0 rounded-full ring-2 ring-muted-foreground/10"
                        style={{ backgroundColor: connection.color }}
                      />
                    )}
                  {connection.tag ? (
                    <span className="inline-flex min-w-0 max-w-36 items-center truncate rounded-full border border-border/60 bg-muted/30 px-1.5 py-0 font-medium text-[10px] text-muted-foreground">
                      {connection.tag}
                    </span>
                  ) : null}
                  {hasBranches && activeBranch && !activeBranch.isMain && (
                    <span className="inline-flex min-w-0 max-w-32 items-center gap-1 truncate rounded-full border border-primary/30 bg-primary/5 px-1.5 py-0 font-medium text-[10px] text-primary">
                      <Icon className="size-2.5 shrink-0" name="git-branch" />
                      <span className="truncate">{activeBranch.name}</span>
                    </span>
                  )}
                  {isLocal && (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-1.5 py-0 font-medium text-[10px]",
                        isRunning
                          ? "border border-emerald-500/20 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400"
                          : "border border-border/40 bg-muted/30 text-muted-foreground"
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
                <button
                  className="mt-1 block w-full truncate text-left font-mono text-muted-foreground text-xs outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                  onClick={() => onSelect(connection)}
                  type="button"
                >
                  {displayMeta.detail}
                </button>
              </div>
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center rounded-md border border-border/50 bg-muted/40 px-1.5 py-0.5 font-medium text-[10px] text-muted-foreground">
                {displayMeta.engine}
              </span>
              <span className="inline-flex items-center gap-1 rounded-md border border-border/50 bg-muted/40 px-1.5 py-0.5 font-medium text-[10px] text-muted-foreground">
                <Icon className="size-2.5" name="shield" />
                {connection.ssl_mode === "disable" ? "No SSL" : "SSL"}
              </span>
              {displayMeta.region ? (
                <span className="inline-flex items-center gap-1 rounded-md border border-border/50 bg-muted/40 px-1.5 py-0.5 font-medium text-[10px] text-muted-foreground">
                  <Icon className="size-2.5" name="world" />
                  {displayMeta.region}
                </span>
              ) : null}
              {typeof lastOpenedAt === "number" && (
                <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/70">
                  <Icon className="size-2.5" name="clock" />
                  {formatRelativeTime(lastOpenedAt)}
                </span>
              )}
            </div>
          </div>
          {variant === "grid" ? (
            <div className="mt-auto flex items-center gap-2 border-border/40 border-t pt-3">
              <Button
                className="h-8 flex-1 text-xs"
                onClick={() => onSelect(connection)}
                size="sm"
              >
                Connect
              </Button>
              <div className="flex items-center">
                <CardActionButtons
                  activeBranch={activeBranch}
                  branches={branches}
                  branchesOpen={branchesOpen}
                  canCloneToLocal={canCloneToLocal}
                  connection={connection}
                  copied={copied}
                  hasBranches={hasBranches}
                  isLocalPg={isLocalPg}
                  isRunning={isRunning}
                  isStatusKnown={isStatusKnown}
                  isTogglingState={isTogglingState}
                  onCloneToLocal={onCloneToLocal}
                  onCopy={handleCopy}
                  onCreateBranch={onCreateBranch}
                  onDelete={onDelete}
                  onEdit={onEdit}
                  onToggleLocalState={handleToggleLocalState}
                  showStartPause={
                    isLocal && Boolean(onStartLocal || onPauseLocal)
                  }
                />
              </div>
            </div>
          ) : (
            <div className="absolute top-1/2 right-3 z-10 flex -translate-y-1/2 items-center gap-0.5 rounded-xl border border-border/50 bg-background p-1 opacity-0 shadow-lg transition-opacity duration-150 focus-within:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100 max-md:static max-md:translate-y-0 max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:p-0 max-md:opacity-100 max-md:shadow-none">
              <CardActionButtons
                activeBranch={activeBranch}
                branches={branches}
                branchesOpen={branchesOpen}
                canCloneToLocal={canCloneToLocal}
                connection={connection}
                copied={copied}
                hasBranches={hasBranches}
                isLocalPg={isLocalPg}
                isRunning={isRunning}
                isStatusKnown={isStatusKnown}
                isTogglingState={isTogglingState}
                onCloneToLocal={onCloneToLocal}
                onCopy={handleCopy}
                onCreateBranch={onCreateBranch}
                onDelete={onDelete}
                onEdit={onEdit}
                onToggleLocalState={handleToggleLocalState}
                showStartPause={
                  isLocal && Boolean(onStartLocal || onPauseLocal)
                }
              />
            </div>
          )}
        </div>

        {/* Branch list (expandable) */}
        {hasBranches && (
          <CollapsibleContent>
            <div className="mr-3 mb-1 ml-9 space-y-0.5 border-border/30 border-l-2 pl-3">
              {branches!.map((branch) => (
                <div
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-2 py-1 text-xs transition-colors duration-150",
                    branch.isActive
                      ? "bg-primary/8 text-primary"
                      : "text-muted-foreground hover:bg-muted/40"
                  )}
                  key={branch.id}
                >
                  <Icon className="size-3 shrink-0" name="git-branch" />
                  <span className="flex-1 truncate font-medium">
                    {branch.name}
                  </span>
                  {branch.isActive && (
                    <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" />
                  )}
                  {!branch.isActive && onSwitchBranch && (
                    <Button
                      className="opacity-0 group-hover:opacity-100"
                      disabled={switchingBranchId === branch.id}
                      onClick={() => handleSwitchBranch(branch.id)}
                      size="icon-xs"
                      variant="ghost"
                    >
                      {switchingBranchId === branch.id ? (
                        <Icon className="size-3 animate-spin" name="loader" />
                      ) : (
                        <Icon className="size-3" name="arrow-right" />
                      )}
                    </Button>
                  )}
                  {!branch.isMain && onDeleteBranch && connection.id && (
                    <Button
                      className="text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
                      onClick={async () => {
                        const dbId = connection.id!;
                        if (!onPreviewDeleteBranch) {
                          setPendingBranchDelete({
                            branchesToDelete: [branch],
                            branchId: branch.id,
                            branchName: branch.name,
                            dbId,
                          });
                          return;
                        }
                        setLoadingDeletePreview(true);
                        try {
                          const preview = await onPreviewDeleteBranch(
                            dbId,
                            branch.id
                          );
                          setPendingBranchDelete({
                            branchesToDelete: preview.branchesToDelete,
                            branchId: branch.id,
                            branchName: branch.name,
                            dbId,
                          });
                        } finally {
                          setLoadingDeletePreview(false);
                        }
                      }}
                      size="icon-xs"
                      variant="ghost"
                    >
                      {loadingDeletePreview ? (
                        <Icon className="size-3 animate-spin" name="loader" />
                      ) : (
                        <Icon className="size-3" name="trash" />
                      )}
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
        onOpenChange={(open) => {
          if (!open) {
            setPendingBranchDelete(null);
          }
        }}
        open={!!pendingBranchDelete}
      >
        <AlertDialogContent className="t-resize sm:max-w-[400px]">
          <AlertDialogHeader className="gap-2">
            <AlertDialogTitle className="flex items-center gap-2 text-sm">
              <Icon
                className="size-4 text-destructive/70"
                name="alert-triangle"
              />
              Delete branch?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs leading-relaxed">
              This will permanently delete{" "}
              <strong className="text-foreground">
                {pendingBranchDelete?.branchName}
              </strong>{" "}
              and {pendingBranchDelete?.branchesToDelete.length ?? 0} branch(es)
              total. This action cannot be undone.
            </AlertDialogDescription>
            {pendingBranchDelete &&
              pendingBranchDelete.branchesToDelete.length > 0 && (
                <div className="mt-2 max-h-28 overflow-auto rounded border border-border/60 bg-muted/20 p-2 text-[11px]">
                  {pendingBranchDelete.branchesToDelete.map((b) => (
                    <div className="truncate text-muted-foreground" key={b.id}>
                      {b.name}
                    </div>
                  ))}
                </div>
              )}
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2.5 border-t bg-muted/30 px-6 py-3.5">
            <AlertDialogCancel className="h-8 px-3 text-xs">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-8 gap-1.5 px-5 text-xs shadow-sm"
              onClick={() => {
                if (pendingBranchDelete) {
                  void onDeleteBranch?.(
                    pendingBranchDelete.dbId,
                    pendingBranchDelete.branchId
                  );
                  setPendingBranchDelete(null);
                }
              }}
              variant="destructive"
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
    <div className="flex items-center gap-3 px-3.5 py-2.5">
      <Skeleton className="size-4 shrink-0 rounded" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <Skeleton className="h-3.5 w-2/5 rounded-md" />
        <Skeleton className="h-2.5 w-3/4 rounded-md" />
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
  lastOpenedById,
  variant,
  onEdit,
  onDelete,
  onSelect,
  onStartLocal,
  onPauseLocal,
  onCloneToLocal,
  onCreateBranch,
  onSwitchBranch,
  onPreviewDeleteBranch,
  onDeleteBranch,
}: {
  label: string;
  icon: ComponentType<{ className?: string }>;
  connections: Connection[];
  localDbById?: Record<string, LocalDbInfo>;
  branchesByDbId?: Record<string, BranchInfo[]>;
  lastOpenedById?: Record<string, number>;
  variant?: "list" | "grid";
  onEdit: (c: Connection) => void;
  onDelete: (connection: Connection) => void;
  onSelect: (c: Connection) => void;
  onStartLocal?: (id: string) => Promise<void>;
  onPauseLocal?: (id: string) => Promise<void>;
  onCloneToLocal?: (c: Connection) => void;
  onCreateBranch?: (
    localDbId: string,
    input: {
      name: string;
      description?: string;
      parentBranchId?: string;
      dataTables?: Array<{ schema: string; table: string }>;
    }
  ) => Promise<BranchInfo>;
  onSwitchBranch?: (localDbId: string, branchId: string) => Promise<BranchInfo>;
  onPreviewDeleteBranch?: (
    localDbId: string,
    branchId: string
  ) => Promise<BranchDeletePreview>;
  onDeleteBranch?: (localDbId: string, branchId: string) => Promise<void>;
}) {
  if (connections.length === 0) {
    return null;
  }
  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <Icon className="size-3 text-muted-foreground" />
        <span className="font-medium text-muted-foreground text-xs">
          {label}
        </span>
        <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-muted/60 px-1 font-semibold text-[10px] text-muted-foreground tabular-nums">
          {connections.length}
        </span>
      </div>
      <div
        className={cn(
          variant === "grid"
            ? "grid grid-cols-1 gap-2 xl:grid-cols-2"
            : "space-y-0.5"
        )}
      >
        {connections.map((conn) => (
          <ConnectionCard
            branches={conn.is_local ? branchesByDbId?.[conn.id] : undefined}
            connection={conn}
            key={conn.id}
            lastOpenedAt={lastOpenedById?.[conn.id]}
            localDbInfo={conn.is_local ? localDbById?.[conn.id] : undefined}
            onCloneToLocal={onCloneToLocal}
            onCreateBranch={onCreateBranch}
            onDelete={onDelete}
            onDeleteBranch={onDeleteBranch}
            onEdit={onEdit}
            onPauseLocal={onPauseLocal}
            onPreviewDeleteBranch={onPreviewDeleteBranch}
            onSelect={onSelect}
            onStartLocal={onStartLocal}
            onSwitchBranch={onSwitchBranch}
            variant={variant}
          />
        ))}
      </div>
    </div>
  );
}

export function ConnectionList({
  connections,
  localDbById,
  branchesByDbId,
  isLoading,
  isFilteredEmpty,
  lastOpenedById,
  onAdd,
  onClearFilters,
  onEdit,
  onDelete,
  onSelect,
  onStartLocal,
  onPauseLocal,
  onCloneToLocal,
  onCreateBranch,
  onSwitchBranch,
  onPreviewDeleteBranch,
  onDeleteBranch,
  variant,
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
    if (isFilteredEmpty) {
      return (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="mb-4 rounded-2xl bg-muted/30 p-5">
            <Icon className="size-10 text-muted-foreground/70" name="search" />
          </div>
          <p className="font-medium text-foreground text-sm">
            No matches for these filters
          </p>
          <p className="mt-1 mb-5 max-w-[260px] text-muted-foreground text-xs leading-relaxed">
            Try a different search term or clear the filters to see all
            connections.
          </p>
          {onClearFilters && (
            <Button
              className="h-8 gap-1.5 px-4 text-xs"
              onClick={onClearFilters}
              size="sm"
              variant="outline"
            >
              Clear filters
            </Button>
          )}
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="mb-4 rounded-2xl bg-muted/30 p-5">
          <Icon
            className="size-10 text-muted-foreground/70"
            name="folder-open"
          />
        </div>
        <p className="font-medium text-foreground text-sm">
          No connections yet
        </p>
        <p className="mt-1 mb-5 max-w-[300px] text-muted-foreground text-xs leading-relaxed">
          Paste a Postgres URL to connect in seconds, or spin up a local
          instance for isolated development.
        </p>
        <div className="flex items-center gap-2">
          <Button
            className="h-8 gap-1.5 px-4 text-xs shadow-sm"
            onClick={onAdd}
            size="sm"
          >
            <Icon className="size-3.5" name="plus" />
            Add Connection
          </Button>
        </div>
      </div>
    );
  }

  // Split connections into local and remote groups
  const localConnections = connections.filter((c) => c.is_local === true);
  const remoteConnections = connections.filter((c) => c.is_local !== true);

  const sharedProps = {
    branchesByDbId,
    lastOpenedById,
    localDbById,
    onCloneToLocal,
    onCreateBranch,
    onDelete,
    onDeleteBranch,
    onEdit,
    onPauseLocal,
    onPreviewDeleteBranch,
    onSelect,
    onStartLocal,
    onSwitchBranch,
    variant,
  };

  return (
    <div className="space-y-3">
      <ConnectionGroup
        connections={localConnections}
        icon={(props) => <Icon name="server" {...props} />}
        label="Local"
        {...sharedProps}
      />
      <ConnectionGroup
        connections={remoteConnections}
        icon={(props) => <Icon name="world" {...props} />}
        label="Remote"
        {...sharedProps}
      />
    </div>
  );
}
