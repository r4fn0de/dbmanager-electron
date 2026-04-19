import {
  ChevronRight,
  Copy,
  Database,
  Eye,
  EyeOff,
  HardDrive,
  Loader2,
  Lock,
  Pause,
  Play,
  RefreshCw,
  Server,
  Table2,
  Terminal,
} from "lucide-react";
import { useMemo, useState } from "react";
import type {
  Connection,
  DatabaseInfo,
  LocalDbInfo,
  SchemaSummary,
} from "@/ipc/db/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

interface DatabaseOverviewProps {
  connection: Connection;
  schemaSummary: SchemaSummary | null;
  databaseInfo: DatabaseInfo | null;
  isLoadingDatabaseInfo: boolean;
  localDbStatus: LocalDbInfo | null;
  isLoadingLocalDbStatus: boolean;
  isTogglingLocalDbStatus: boolean;
  onNewQuery: () => void;
  onTestConnection: () => void;
  onViewTables: () => void;
  onStartLocalDb: () => Promise<void>;
  onPauseLocalDb: () => Promise<void>;
  connectionString?: string;
  copyConnectionStringFeedback: null | "copied" | "failed";
  onCopyConnectionString: () => Promise<void> | void;
}

function StatCard({
  label,
  value,
  icon: Icon,
  isLoading,
}: {
  label: string;
  value: string | number;
  icon?: React.ComponentType<{ className?: string }>;
  isLoading?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-muted/20 px-3 py-2.5">
      {Icon && (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted/60">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
      )}
      <div className="min-w-0">
        {isLoading ? (
          <Skeleton className="mb-0.5 h-4 w-12" />
        ) : (
          <p className="font-heading text-sm font-semibold tabular-nums leading-none">
            {value}
          </p>
        )}
        <p className="mt-0.5 text-[11px] text-muted-foreground leading-none">
          {label}
        </p>
      </div>
    </div>
  );
}

export function DatabaseOverview({
  connection,
  schemaSummary,
  databaseInfo,
  isLoadingDatabaseInfo,
  localDbStatus,
  isLoadingLocalDbStatus,
  isTogglingLocalDbStatus,
  onNewQuery,
  onTestConnection,
  onViewTables,
  onStartLocalDb,
  onPauseLocalDb,
  connectionString,
  copyConnectionStringFeedback,
  onCopyConnectionString,
}: DatabaseOverviewProps) {
  const [showConnectionString, setShowConnectionString] = useState(false);
  const totalSchemas = schemaSummary?.schemas.length ?? 0;
  const totalTables = schemaSummary?.tables.length ?? 0;
  const tablesWithRls =
    schemaSummary?.tables.filter((t) => t.has_rls).length ?? 0;

  const schemasWithCounts = schemaSummary
    ? schemaSummary.schemas.map((schema) => ({
        name: schema,
        count: schemaSummary.tables.filter((t) => t.schema === schema).length,
        rlsCount: schemaSummary.tables.filter(
          (t) => t.schema === schema && t.has_rls,
        ).length,
      }))
    : [];

  const shortVersion = databaseInfo?.version?.split(" on ")?.[0] ?? null;
  const colorBadge =
    connection.color && /^#[0-9a-fA-F]{6}$/.test(connection.color)
      ? connection.color
      : null;
  const isLocal = connection.is_local === true;
  const isRunning = localDbStatus?.running ?? false;
  const externalEndpoint =
    localDbStatus?.external_host && localDbStatus?.external_port
      ? `${localDbStatus.external_host}:${localDbStatus.external_port}`
      : null;
  const maskedConnectionString = useMemo(() => {
    if (!connectionString) return null;
    return connectionString.replace(/(\/\/[^:/?#]+:)([^@]*)(@)/, "$1****$3");
  }, [connectionString]);

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-2xl px-6 py-8 space-y-8">
        {/* Header */}
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5 min-w-0">
              {colorBadge && (
                <span
                  className="inline-block h-3 w-3 rounded-full shrink-0 ring-2 ring-muted-foreground/10"
                  style={{ backgroundColor: colorBadge }}
                />
              )}
              <h1 className="font-heading text-xl font-semibold tracking-tight truncate">
                {connection.name}
              </h1>
            </div>
            <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
              {connection.is_local && (
                <Badge
                  variant="outline"
                  className="font-mono text-[10px] h-5 px-1.5"
                >
                  LOCAL
                </Badge>
              )}
              {connection.tag && (
                <Badge variant="secondary" className="text-[10px] h-5 px-1.5">
                  {connection.tag}
                </Badge>
              )}
              {connection.postgres_version && (
                <Badge
                  variant="secondary"
                  className="font-mono text-[10px] h-5 px-1.5"
                >
                  PG {connection.postgres_version}
                </Badge>
              )}
              <Badge
                variant="outline"
                className="font-mono text-[10px] h-5 px-1.5"
              >
                {connection.ssl_mode}
              </Badge>
            </div>
          </div>
          <p className="font-mono text-xs text-muted-foreground truncate">
            {connection.username}@{connection.host}:{connection.port}/
            {connection.database}
          </p>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={onNewQuery}
              className="gap-1.5 h-7 text-xs"
            >
              <Terminal className="h-3 w-3" />
              Query
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={onViewTables}
              className="gap-1.5 h-7 text-xs"
            >
              <Table2 className="h-3 w-3" />
              Tables
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={onTestConnection}
              className="gap-1.5 h-7 text-xs text-muted-foreground"
            >
              <RefreshCw className="h-3 w-3" />
            </Button>
            {isLocal && (
              <Button
                size="sm"
                variant="ghost"
                onClick={isRunning ? onPauseLocalDb : onStartLocalDb}
                className="gap-1.5 h-7 text-xs"
                disabled={isLoadingLocalDbStatus || isTogglingLocalDbStatus}
              >
                {isTogglingLocalDbStatus ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {isRunning ? "Stopping..." : "Starting..."}
                  </>
                ) : isRunning ? (
                  <>
                    <Pause className="h-3 w-3" />
                    Pause
                  </>
                ) : (
                  <>
                    <Play className="h-3 w-3" />
                    Start
                  </>
                )}
              </Button>
            )}
          </div>
        </div>

        <Separator />

        {/* Local DB Status */}
        {isLocal && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Server className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Local Instance
              </p>
            </div>

            <div className="rounded-lg border bg-muted/10 p-4 space-y-4">
              {/* Status indicators */}
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ring-border">
                  <span
                    className={`inline-block h-1.5 w-1.5 rounded-full ${
                      isRunning ? "bg-emerald-500" : "bg-amber-500"
                    }`}
                  />
                  {isLoadingLocalDbStatus
                    ? "Loading..."
                    : isRunning
                      ? "Running"
                      : "Paused"}
                </div>
                <span className="text-xs text-muted-foreground">
                  <span className="text-muted-foreground/70">External</span>{" "}
                  {isLoadingLocalDbStatus
                    ? "Loading..."
                    : localDbStatus?.externally_connectable
                      ? "Connectable"
                      : "Unavailable"}
                </span>
                {externalEndpoint && (
                  <span className="rounded-md bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                    {externalEndpoint}
                  </span>
                )}
              </div>

              {/* Connection string */}
              {connectionString && (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Connection string
                  </p>
                  <div className="flex items-center gap-1.5">
                    <code className="flex-1 min-w-0 truncate rounded-md border bg-muted/30 px-2.5 py-1.5 font-mono text-xs leading-relaxed">
                      {showConnectionString
                        ? connectionString
                        : (maskedConnectionString ?? connectionString)}
                    </code>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 w-7 p-0 shrink-0"
                      onClick={() => setShowConnectionString((value) => !value)}
                    >
                      {showConnectionString ? (
                        <EyeOff className="h-3 w-3" />
                      ) : (
                        <Eye className="h-3 w-3" />
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 w-7 p-0 shrink-0"
                      onClick={onCopyConnectionString}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                  {copyConnectionStringFeedback && (
                    <p className="text-[11px] text-muted-foreground">
                      {copyConnectionStringFeedback === "copied"
                        ? "Connection string copied."
                        : "Failed to copy connection string."}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Stats */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Database className="h-3.5 w-3.5 text-muted-foreground" />
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Overview
            </p>
          </div>
          <div
            className={`grid grid-cols-2 gap-2 ${tablesWithRls > 0 ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}
          >
            <StatCard label="Schemas" value={totalSchemas} icon={Database} />
            <StatCard label="Tables" value={totalTables} icon={Table2} />
            {tablesWithRls > 0 && (
              <StatCard label="RLS enabled" value={tablesWithRls} icon={Lock} />
            )}
            <StatCard
              label="Size"
              value={databaseInfo?.size ?? "—"}
              icon={HardDrive}
              isLoading={isLoadingDatabaseInfo}
            />
          </div>
        </div>

        {/* Server info */}
        {(isLoadingDatabaseInfo || databaseInfo) && (
          <div className="space-y-3">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Server
            </p>
            {isLoadingDatabaseInfo ? (
              <div className="flex gap-4">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-3 w-28" />
              </div>
            ) : databaseInfo ? (
              <div className="rounded-lg border bg-muted/10 divide-y">
                <div className="grid grid-cols-3 divide-x">
                  <div className="px-3 py-2.5">
                    <p className="text-[11px] text-muted-foreground">Version</p>
                    <p className="font-mono text-xs font-medium text-foreground">
                      {shortVersion ?? databaseInfo.version}
                    </p>
                  </div>
                  <div className="px-3 py-2.5">
                    <p className="text-[11px] text-muted-foreground">
                      Encoding
                    </p>
                    <p className="font-mono text-xs font-medium text-foreground">
                      {databaseInfo.encoding}
                    </p>
                  </div>
                  <div className="px-3 py-2.5">
                    <p className="text-[11px] text-muted-foreground">
                      Timezone
                    </p>
                    <p className="font-mono text-xs font-medium text-foreground">
                      {databaseInfo.timezone}
                    </p>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        )}

        {/* Schema list */}
        {schemasWithCounts.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Schemas
              </p>
              <Badge
                variant="secondary"
                className="font-mono text-[10px] h-5 px-1.5"
              >
                {schemasWithCounts.length}
              </Badge>
            </div>
            <div className="rounded-lg border bg-muted/10 divide-y">
              {schemasWithCounts.map((schema) => (
                <button
                  key={schema.name}
                  type="button"
                  onClick={() => onViewTables()}
                  className="group w-full flex items-center gap-2.5 py-2.5 px-3 first:rounded-t-lg last:rounded-b-lg hover:bg-muted/30 transition-colors text-left text-sm"
                >
                  <span className="flex-1 truncate font-medium">
                    {schema.name}
                  </span>
                  <span className="rounded-md bg-muted/60 px-1.5 py-0.5 text-[11px] tabular-nums text-muted-foreground">
                    {schema.count}
                  </span>
                  {schema.rlsCount > 0 && (
                    <Lock className="h-2.5 w-2.5 text-cyan-500/60" />
                  )}
                  <ChevronRight className="h-3 w-3 text-muted-foreground/30 group-hover:text-muted-foreground transition-colors" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
