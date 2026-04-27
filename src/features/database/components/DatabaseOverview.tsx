import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import type {
  Connection,
  DatabaseInfo,
  LocalDbInfo,
  SchemaSummary,
} from "@/ipc/db/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/Icon";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import { DB_TYPE_LABELS, formatRowCount } from "@/constants";

// ── Props ─────────────────────────────────────────────────────────────

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

// ── StatCard ──────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon: Icon,
  isLoading,
  sublabel,
}: {
  label: string;
  value: string | number;
  icon?: ComponentType<{ className?: string }>;
  isLoading?: boolean;
  /** Optional small text below the value (e.g. "of 100") */
  sublabel?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border bg-muted/10 px-3 py-2.5 hover:bg-muted/20 transition-colors">
      <div className="flex items-center justify-between">
        {Icon && <Icon className="size-3.5 text-muted-foreground/40" />}
        {isLoading ? (
          <Skeleton className="h-4 w-10" />
        ) : (
          <p className="font-heading text-sm font-semibold tabular-nums leading-none">
            {value}
          </p>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground leading-none">
        {label}
      </p>
      {sublabel && (
        <p className="text-[10px] text-muted-foreground/60 leading-none">
          {sublabel}
        </p>
      )}
    </div>
  );
}

// ── TransactionStats ──────────────────────────────────────────────────

function TransactionStats({
  commit,
  rollback,
}: {
  commit?: number | null;
  rollback?: number | null;
}) {
  return (
    <div className="flex items-center justify-between text-xs">
      <div className="flex items-center gap-1.5">
        <Icon name="circle-check" className="size-3 text-muted-foreground/50" />
        <span className="text-muted-foreground/60">Transactions</span>
      </div>
      <span className="font-mono text-foreground">
        {commit != null && (
          <span className="text-emerald-500">{commit.toLocaleString()}</span>
        )}
        {commit != null && rollback != null && (
          <span className="text-muted-foreground/40 mx-1">/</span>
        )}
        {rollback != null && (
          <TooltipProvider delay={0}>
            <Tooltip>
              <TooltipTrigger
                render={
                  <span
                    className={cn(
                      "cursor-default",
                      rollback > 0 ? "text-amber-500" : "text-muted-foreground/40",
                    )}
                  >
                    {rollback.toLocaleString()}
                  </span>
                }
              />
              <TooltipContent side="top" sideOffset={4}>
                Rollbacks
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </span>
    </div>
  );
}

/* ── Animation variants (Emil: GPU-only, never scale(0), ≤300ms) ── */
const containerVariants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.05 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.22, ease: [0.23, 1, 0.32, 1] as [number, number, number, number] },
  },
};

// ── Main component ────────────────────────────────────────────────────

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
  const [displayInfoCopyFeedback, setDisplayInfoCopyFeedback] = useState<
    null | "copied" | "failed"
  >(null);
  const [isDisplayInfoHovered, setIsDisplayInfoHovered] = useState(false);
  const [isDisplayInfoTooltipPinned, setIsDisplayInfoTooltipPinned] =
    useState(false);
  const displayInfoTooltipTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);

  // Single-pass memoized derived values — avoids O(n×m) per render from
  // repeated .filter() calls inside .map() for each schema.
  const { totalSchemas, totalTables, tablesWithRls, totalEstimatedRows, topTables, schemasWithCounts } = useMemo(() => {
    if (!schemaSummary) return { totalSchemas: 0, totalTables: 0, tablesWithRls: 0, totalEstimatedRows: 0, topTables: [] as { name: string; schema: string; estimatedRowCount: number }[], schemasWithCounts: [] as { name: string; count: number; rlsCount: number }[] };
    let rlsCount = 0;
    let rowsSum = 0;
    const schemaMap = new Map<string, { count: number; rlsCount: number }>();
    for (const schema of schemaSummary.schemas) {
      schemaMap.set(schema, { count: 0, rlsCount: 0 });
    }
    for (const table of schemaSummary.tables) {
      const entry = schemaMap.get(table.schema);
      if (entry) {
        entry.count++;
        if (table.has_rls) {
          entry.rlsCount++;
          rlsCount++;
        }
      }
      rowsSum += table.estimated_row_count;
    }
    const counts = schemaSummary.schemas.map((name) => ({
      name,
      ...(schemaMap.get(name) ?? { count: 0, rlsCount: 0 }),
    }));
    // Top 5 tables by estimated row count
    const sorted = [...schemaSummary.tables]
      .sort((a, b) => b.estimated_row_count - a.estimated_row_count)
      .slice(0, 5)
      .map((t) => ({ name: t.name, schema: t.schema, estimatedRowCount: t.estimated_row_count }));
    return {
      totalSchemas: schemaSummary.schemas.length,
      totalTables: schemaSummary.tables.length,
      tablesWithRls: rlsCount,
      totalEstimatedRows: rowsSum,
      topTables: sorted,
      schemasWithCounts: counts,
    };
  }, [schemaSummary]);

  const shortVersion = databaseInfo?.version?.split(" on ")?.[0] ?? null;
  const colorBadge =
    connection.color && /^#[0-9a-fA-F]{6}$/.test(connection.color)
      ? connection.color
      : null;
  const isLocal = connection.is_local === true;
  const isRunning = localDbStatus?.running ?? false;
  const engineVersion = connection.engine_version ?? connection.postgres_version;
  const dbTypeLabel = DB_TYPE_LABELS[connection.db_type] ?? connection.db_type;
  const displayInfo = useMemo(() => {
    if (connection.url) {
      return connection.url.replace(/:[^:]*@/, ":****@");
    }
    return `${connection.username}@${connection.host}:${connection.port}/${connection.database}`;
  }, [
    connection.url,
    connection.username,
    connection.host,
    connection.port,
    connection.database,
  ]);

  // Connection usage percentage
  const connectionUsagePct =
    databaseInfo?.activeConnections != null && databaseInfo?.maxConnections != null
      ? Math.round((databaseInfo.activeConnections / databaseInfo.maxConnections) * 100)
      : null;

  const handleCopyDisplayInfo = async () => {
    if (displayInfoTooltipTimeoutRef.current) {
      clearTimeout(displayInfoTooltipTimeoutRef.current);
      displayInfoTooltipTimeoutRef.current = null;
    }
    setIsDisplayInfoTooltipPinned(true);
    try {
      await navigator.clipboard.writeText(displayInfo);
      setDisplayInfoCopyFeedback("copied");
    } catch {
      setDisplayInfoCopyFeedback("failed");
    } finally {
      displayInfoTooltipTimeoutRef.current = setTimeout(() => {
        setDisplayInfoCopyFeedback(null);
        setIsDisplayInfoTooltipPinned(false);
        displayInfoTooltipTimeoutRef.current = null;
      }, 1500);
    }
  };

  useEffect(() => {
    return () => {
      if (displayInfoTooltipTimeoutRef.current) {
        clearTimeout(displayInfoTooltipTimeoutRef.current);
      }
    };
  }, []);

  const isDisplayInfoTooltipOpen =
    isDisplayInfoHovered || isDisplayInfoTooltipPinned;

  return (
    <motion.div
      className="h-full overflow-auto"
      initial="hidden"
      animate="visible"
      variants={containerVariants}
    >
      <div className="mx-auto max-w-2xl px-6 py-8 space-y-6">
        {/* ── Header ──────────────────────────────────────────── */}
        <motion.div variants={itemVariants} className="space-y-3">
          {/* Name row with status */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              {colorBadge && (
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{
                    backgroundColor: colorBadge,
                    boxShadow: `0 0 0 2px color-mix(in srgb, ${colorBadge} 30%, transparent)`,
                  }}
                />
              )}
              <div className="min-w-0">
                <h1 className="font-heading text-xl font-semibold tracking-tight truncate">
                  {connection.name}
                </h1>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                    <span
                      className={cn(
                        "inline-block size-1.5 rounded-full",
                        isLoadingDatabaseInfo ? "bg-amber-500" : "bg-emerald-500"
                      )}
                    />
                    {isLoadingDatabaseInfo ? "Loading" : "Connected"}
                  </span>
                  <span className="text-muted-foreground/30">·</span>
                  <span className="text-[11px] text-muted-foreground font-mono">
                    {connection.host}:{connection.port}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
              {/* DB type badge */}
              <Badge
                variant="secondary"
                className="font-mono text-[10px] h-5 px-1.5"
              >
                {dbTypeLabel}
              </Badge>
              {isLocal && (
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
              {engineVersion && (
                <Badge
                  variant="secondary"
                  className="font-mono text-[10px] h-5 px-1.5"
                >
                  v{engineVersion}
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

          {/* Connection info */}
          <TooltipProvider delay={0}>
            <Tooltip open={isDisplayInfoTooltipOpen}>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    onClick={() => void handleCopyDisplayInfo()}
                    onMouseEnter={() => setIsDisplayInfoHovered(true)}
                    onMouseLeave={() => setIsDisplayInfoHovered(false)}
                    className="font-mono text-xs text-muted-foreground truncate text-left cursor-copy hover:text-foreground transition-colors max-w-full"
                  />
                }
              >
                {displayInfo}
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={6}>
                <span
                  key={displayInfoCopyFeedback ?? "idle"}
                  className="inline-block animate-in fade-in-0 zoom-in-95 duration-150"
                >
                  {displayInfoCopyFeedback === "copied"
                    ? "Copied!"
                    : displayInfoCopyFeedback === "failed"
                      ? "Failed to copy"
                      : "Click to copy"}
                </span>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* Actions */}
          <div className="flex items-center gap-1.5 pt-1">
            <motion.div whileTap={{ scale: 0.97 }}>
              <Button
                size="sm"
                onClick={onNewQuery}
                className="gap-1.5 h-7 text-xs"
              >
                <Icon name="terminal" className="size-3.5" />
                New query
              </Button>
            </motion.div>
            <motion.div whileTap={{ scale: 0.97 }}>
              <Button
                size="sm"
                variant="secondary"
                onClick={onViewTables}
                className="gap-1.5 h-7 text-xs"
              >
                <Icon name="table" className="size-3.5" />
                Tables
              </Button>
            </motion.div>
            <motion.div whileTap={{ scale: 0.97 }}>
              <Button
                size="sm"
                variant="ghost"
                onClick={onTestConnection}
                className="h-7 w-7 p-0 text-muted-foreground"
                title="Test connection"
              >
                <Icon name="refresh" className="size-3.5" />
              </Button>
            </motion.div>
            {isLocal && (
              <motion.div whileTap={{ scale: 0.97 }}>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={isRunning ? onPauseLocalDb : onStartLocalDb}
                  className="gap-1.5 h-7 text-xs"
                  disabled={isLoadingLocalDbStatus || isTogglingLocalDbStatus}
                >
                  {isTogglingLocalDbStatus ? (
                    <>
                      <Icon name="loader" className="size-3 animate-spin" />
                      {isRunning ? "Stopping..." : "Starting..."}
                    </>
                  ) : isRunning ? (
                    <>
                      <Icon name="pause" className="size-3" />
                      Pause
                    </>
                  ) : (
                    <>
                      <Icon name="play" className="size-3" />
                      Start
                    </>
                  )}
                </Button>
              </motion.div>
            )}
          </div>
        </motion.div>

        {/* ── Overview stats ─────────────────────────────────── */}
        <motion.div variants={itemVariants} className="space-y-3">
          <div className="flex items-center gap-2">
            <Icon name="database" className="size-3.5 text-muted-foreground" />
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Overview
            </p>
          </div>
          <div
            className={cn(
              "grid grid-cols-2 gap-2",
              totalEstimatedRows > 0 && databaseInfo?.activeConnections != null
                ? "sm:grid-cols-5"
                : totalEstimatedRows > 0 || databaseInfo?.activeConnections != null
                  ? "sm:grid-cols-4"
                  : "sm:grid-cols-3",
            )}
          >
            <StatCard label="Schemas" value={totalSchemas} icon={(props) => <Icon name="database" {...props} />} />
            <StatCard label="Tables" value={totalTables} icon={(props) => <Icon name="table" {...props} />} />
            {totalEstimatedRows > 0 && (
              <StatCard
                label="Est. Rows"
                value={formatRowCount(totalEstimatedRows)}
                icon={(props) => <Icon name="list-numbers" {...props} />}
              />
            )}
            {databaseInfo?.activeConnections != null && (
              <StatCard
                label="Connections"
                value={databaseInfo.activeConnections}
                icon={(props) => <Icon name="link" {...props} />}
                sublabel={databaseInfo.maxConnections ? `of ${databaseInfo.maxConnections}` : undefined}
              />
            )}
            {tablesWithRls > 0 && (
              <StatCard label="RLS enabled" value={tablesWithRls} icon={(props) => <Icon name="lock" {...props} />} />
            )}
            <StatCard
              label="Size"
              value={databaseInfo?.size ?? "—"}
              icon={(props) => <Icon name="hard-drive" {...props} />}
              isLoading={isLoadingDatabaseInfo}
            />
          </div>
        </motion.div>

        {/* ── Server info ─────────────────────────────────────── */}
        {(isLoadingDatabaseInfo || databaseInfo) && (
          <motion.div variants={itemVariants} className="space-y-3">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Server
            </p>
            {isLoadingDatabaseInfo ? (
              <div className="flex gap-3">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-3 w-28" />
              </div>
            ) : databaseInfo ? (
              <div className="space-y-3">
                {/* Primary info row */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground/60">Version</span>
                    <span className="font-mono font-medium text-foreground">
                      {shortVersion ?? databaseInfo.version}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground/60">Encoding</span>
                    <span className="font-mono font-medium text-foreground">
                      {databaseInfo.encoding}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground/60">Timezone</span>
                    <span className="font-mono font-medium text-foreground">
                      {databaseInfo.timezone}
                    </span>
                  </div>
                  {databaseInfo.databaseName && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-muted-foreground/60">Database</span>
                      <span className="font-mono font-medium text-foreground">
                        {databaseInfo.databaseName}
                      </span>
                    </div>
                  )}
                </div>

                {/* Performance & health stats */}
                {(databaseInfo.uptime || databaseInfo.cacheHitRatio != null || databaseInfo.deadTuples != null) && (
                  <div className="rounded-lg border border-border/50 bg-muted/10 p-3 space-y-2.5">
                    {/* Uptime */}
                    {databaseInfo.uptime && (
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5">
                          <Icon name="clock" className="size-3 text-muted-foreground/50" />
                          <span className="text-muted-foreground/60">Uptime</span>
                        </div>
                        <span className="font-mono font-medium text-foreground">
                          {databaseInfo.uptime}
                        </span>
                      </div>
                    )}

                    {/* Cache hit ratio */}
                    {databaseInfo.cacheHitRatio != null && (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-1.5">
                            <Icon name="zap" className="size-3 text-muted-foreground/50" />
                            <span className="text-muted-foreground/60">Cache hit ratio</span>
                          </div>
                          <span className={cn(
                            "font-mono font-medium",
                            databaseInfo.cacheHitRatio >= 99 ? "text-emerald-500" :
                            databaseInfo.cacheHitRatio >= 95 ? "text-amber-500" :
                            "text-destructive"
                          )}>
                            {databaseInfo.cacheHitRatio}%
                          </span>
                        </div>
                        <Progress
                          value={databaseInfo.cacheHitRatio}
                          max={100}
                          className="h-1"
                        />
                      </div>
                    )}

                    {/* Active connections bar */}
                    {connectionUsagePct != null && (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-1.5">
                            <Icon name="link" className="size-3 text-muted-foreground/50" />
                            <span className="text-muted-foreground/60">Connection usage</span>
                          </div>
                          <span className={cn(
                            "font-mono font-medium",
                            connectionUsagePct >= 90 ? "text-destructive" :
                            connectionUsagePct >= 70 ? "text-amber-500" :
                            "text-foreground"
                          )}>
                            {connectionUsagePct}%
                          </span>
                        </div>
                        <Progress
                          value={connectionUsagePct}
                          max={100}
                          className="h-1"
                        />
                      </div>
                    )}

                    {/* Dead tuples */}
                    {databaseInfo.deadTuples != null && databaseInfo.deadTuples > 0 && (
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5">
                          <Icon name="trash" className="size-3 text-muted-foreground/50" />
                          <span className="text-muted-foreground/60">Dead tuples</span>
                        </div>
                        <TooltipProvider delay={0}>
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <span className={cn(
                                  "font-mono font-medium cursor-default",
                                  databaseInfo.deadTuples > 100_000 ? "text-amber-500" : "text-foreground"
                                )}>
                                  {databaseInfo.deadTuples.toLocaleString()}
                                </span>
                              }
                            />
                            <TooltipContent side="top" sideOffset={4}>
                              {databaseInfo.deadTuples > 100_000
                                ? "Consider running VACUUM to reclaim space"
                                : "Dead tuples from UPDATE/DELETE operations"}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                    )}

                    {/* Transaction stats */}
                    {(databaseInfo.xactCommit != null || databaseInfo.xactRollback != null) && (
                      <TransactionStats
                        commit={databaseInfo.xactCommit}
                        rollback={databaseInfo.xactRollback}
                      />
                    )}
                  </div>
                )}
              </div>
            ) : null}
          </motion.div>
        )}

        {/* ── Local DB details ────────────────────────────────── */}
        {isLocal && localDbStatus && (
          <motion.div variants={itemVariants} className="space-y-3">
            <div className="flex items-center gap-2">
              <Icon name="server" className="size-3.5 text-muted-foreground" />
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Local Database
              </p>
            </div>
            <div className="rounded-lg border border-border/50 bg-muted/10 p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground/60">Engine</span>
                  <Badge variant="secondary" className="font-mono text-[10px] h-4 px-1">
                    {localDbStatus.engine === "sqlite" ? "SQLite" : "PostgreSQL"}
                  </Badge>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground/60">Status</span>
                  <span className={cn(
                    "inline-flex items-center gap-1 font-medium",
                    localDbStatus.running ? "text-emerald-500" : "text-amber-500"
                  )}>
                    <span className={cn(
                      "inline-block size-1.5 rounded-full",
                      localDbStatus.running ? "bg-emerald-500" : "bg-amber-500"
                    )} />
                    {localDbStatus.running ? "Running" : "Stopped"}
                  </span>
                </div>
                {localDbStatus.port != null && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground/60">Port</span>
                    <span className="font-mono font-medium text-foreground">
                      {localDbStatus.port}
                    </span>
                  </div>
                )}
                {localDbStatus.auto_start != null && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground/60">Auto-start</span>
                    <span className="font-medium text-foreground">
                      {localDbStatus.auto_start ? "On" : "Off"}
                    </span>
                  </div>
                )}
              </div>
              {localDbStatus.externally_connectable && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs pt-1 border-t border-border/30">
                  <div className="flex items-center gap-1.5">
                    <Icon name="globe" className="size-3 text-muted-foreground/50" />
                    <span className="text-muted-foreground/60">External</span>
                    <span className="font-mono font-medium text-emerald-500">Connectable</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground/60">Host</span>
                    <span className="font-mono font-medium text-foreground">
                      {localDbStatus.external_host}
                    </span>
                  </div>
                  {localDbStatus.external_port != null && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-muted-foreground/60">Port</span>
                      <span className="font-mono font-medium text-foreground">
                        {localDbStatus.external_port}
                      </span>
                    </div>
                  )}
                </div>
              )}
              {localDbStatus.file_path && (
                <div className="flex items-center gap-1.5 text-xs pt-1 border-t border-border/30">
                  <Icon name="file-code" className="size-3 text-muted-foreground/50" />
                  <span className="text-muted-foreground/60">Path</span>
                  <TooltipProvider delay={0}>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <span
                            className="font-mono text-foreground/70 truncate max-w-[280px] cursor-default"
                          >
                            {localDbStatus.file_path}
                          </span>
                        }
                      />
                      <TooltipContent side="top" sideOffset={4}>
                        {localDbStatus.file_path}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* ── Top tables ──────────────────────────────────────── */}
        {topTables.length > 0 && (
          <motion.div variants={itemVariants} className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Icon name="layout-grid" className="size-3.5 text-muted-foreground" />
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Largest Tables
                </p>
              </div>
              <Badge
                variant="secondary"
                className="font-mono text-[10px] h-5 px-1.5"
              >
                Top {topTables.length}
              </Badge>
            </div>
            <div className="rounded-lg border border-border/50 divide-y divide-border/50">
              {topTables.map((table, i) => (
                <motion.button
                  key={`${table.schema}.${table.name}`}
                  type="button"
                  onClick={() => onViewTables()}
                  className="group w-full flex items-center gap-3 py-2 px-3 text-left text-sm hover:bg-muted/30 transition-colors"
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{
                    duration: 0.18,
                    delay: i * 0.03,
                    ease: [0.23, 1, 0.32, 1] as [number, number, number, number],
                  }}
                  whileTap={{ scale: 0.995 }}
                >
                  <span className="text-[10px] tabular-nums text-muted-foreground/40 w-3 text-right">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <span className="font-medium truncate block">
                      {table.name}
                    </span>
                    <span className="text-[10px] text-muted-foreground/60 font-mono">
                      {table.schema}
                    </span>
                  </div>
                  <Badge
                    variant="secondary"
                    className="font-mono text-[10px] h-4 px-1.5 tabular-nums shrink-0"
                  >
                    ~{formatRowCount(table.estimatedRowCount)} rows
                  </Badge>
                  <Icon name="chevron-right" className="size-3 text-muted-foreground/30 group-hover:text-muted-foreground transition-colors" />
                </motion.button>
              ))}
            </div>
          </motion.div>
        )}

        {/* ── Schema list ─────────────────────────────────────── */}
        {schemasWithCounts.length > 0 && (
          <motion.div variants={itemVariants} className="space-y-3">
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
            <div className="divide-y divide-border/50 border-y border-border/50">
              {schemasWithCounts.map((schema, i) => (
                <motion.button
                  key={schema.name}
                  type="button"
                  onClick={() => onViewTables()}
                  className="group w-full flex items-center gap-2.5 py-2 px-3 text-left text-sm hover:bg-muted/30 transition-colors"
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{
                    duration: 0.18,
                    delay: i * 0.03,
                    ease: [0.23, 1, 0.32, 1] as [number, number, number, number],
                  }}
                  whileTap={{ scale: 0.995 }}
                >
                  <span className="flex-1 truncate font-medium">
                    {schema.name}
                  </span>
                  <span className="rounded-md bg-muted/60 px-1.5 py-0.5 text-[11px] tabular-nums text-muted-foreground">
                    {schema.count}
                  </span>
                  {schema.rlsCount > 0 && (
                    <Icon name="lock" className="size-2.5 text-cyan-500/60" />
                  )}
                  <Icon name="chevron-right" className="size-3 text-muted-foreground/30 group-hover:text-muted-foreground transition-colors" />
                </motion.button>
              ))}
            </div>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}
