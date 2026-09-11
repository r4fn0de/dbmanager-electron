import { motion } from "motion/react";
import {
  type ComponentType,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/Icon";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { DB_TYPE_LABELS, formatRowCount } from "@/constants";
import type {
  Connection,
  DatabaseInfo,
  LocalDbInfo,
  SchemaSummary,
} from "@/ipc/db/types";
import { cn } from "@/lib/utils";

// ── Props ─────────────────────────────────────────────────────────────

interface DatabaseOverviewProps {
  connection: Connection;
  connectionString?: string;
  copyConnectionStringFeedback: null | "copied" | "failed";
  databaseInfo: DatabaseInfo | null;
  isLoadingDatabaseInfo: boolean;
  isLoadingLocalDbStatus: boolean;
  isTogglingLocalDbStatus: boolean;
  localDbStatus: LocalDbInfo | null;
  onCopyConnectionString: () => Promise<void> | void;
  onNewQuery: () => void;
  onPauseLocalDb: () => Promise<void>;
  onStartLocalDb: () => Promise<void>;
  onTestConnection: () => void;
  onViewTables: () => void;
  schemaSummary: SchemaSummary | null;
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
    <div className="flex flex-col gap-1.5 rounded-lg border bg-muted/10 px-3 py-2.5 transition-colors hover:bg-muted/20">
      <div className="flex items-center justify-between">
        {Icon && <Icon className="size-3.5 text-muted-foreground/40" />}
        {isLoading ? (
          <Skeleton className="h-4 w-10" />
        ) : (
          <p className="font-heading font-semibold text-sm tabular-nums leading-none">
            {value}
          </p>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground leading-none">{label}</p>
      {sublabel && (
        <p className="text-[10px] text-muted-foreground/60 leading-none">
          {sublabel}
        </p>
      )}
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
    transition: {
      duration: 0.22,
      ease: [0.23, 1, 0.32, 1] as [number, number, number, number],
    },
    y: 0,
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
  const { totalSchemas, totalTables, totalEstimatedRows, schemasWithCounts } =
    useMemo(() => {
      if (!schemaSummary) {
        return {
          schemasWithCounts: [] as { name: string; count: number }[],
          totalEstimatedRows: 0,
          totalSchemas: 0,
          totalTables: 0,
        };
      }
      let rowsSum = 0;
      const schemaMap = new Map<string, { count: number }>();
      for (const schema of schemaSummary.schemas) {
        schemaMap.set(schema, { count: 0 });
      }
      for (const table of schemaSummary.tables) {
        const entry = schemaMap.get(table.schema);
        if (entry) {
          entry.count++;
        }
        rowsSum += table.estimated_row_count;
      }
      const counts = schemaSummary.schemas.map((name) => ({
        name,
        ...(schemaMap.get(name) ?? { count: 0, rlsCount: 0 }),
      }));
      return {
        schemasWithCounts: counts,
        totalEstimatedRows: rowsSum,
        totalSchemas: schemaSummary.schemas.length,
        totalTables: schemaSummary.tables.length,
      };
    }, [schemaSummary]);

  const shortVersion = databaseInfo?.version?.split(" on ")?.[0] ?? null;
  const colorBadge =
    connection.color && /^#[0-9a-fA-F]{6}$/.test(connection.color)
      ? connection.color
      : null;
  const isLocal = connection.is_local === true;
  const isRunning = localDbStatus?.running ?? false;
  const engineVersion =
    connection.engine_version ?? connection.postgres_version;
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
    databaseInfo?.activeConnections != null &&
    databaseInfo?.maxConnections != null
      ? Math.round(
          (databaseInfo.activeConnections / databaseInfo.maxConnections) * 100
        )
      : null;

  const handleCopyDisplayInfo = async () => {
    if (displayInfoTooltipTimeoutRef.current) {
      clearTimeout(displayInfoTooltipTimeoutRef.current);
      displayInfoTooltipTimeoutRef.current = null;
    }
    setIsDisplayInfoTooltipPinned(true);
    try {
      await onCopyConnectionString();
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

  useEffect(
    () => () => {
      if (displayInfoTooltipTimeoutRef.current) {
        clearTimeout(displayInfoTooltipTimeoutRef.current);
      }
    },
    []
  );

  const isDisplayInfoTooltipOpen =
    isDisplayInfoHovered || isDisplayInfoTooltipPinned;

  return (
    <motion.div
      animate="visible"
      className="h-full overflow-auto"
      initial="hidden"
      variants={containerVariants}
    >
      <div className="mx-auto max-w-2xl space-y-5 px-6 py-8">
        {/* ── Header ──────────────────────────────────────────── */}
        <motion.div className="space-y-2.5" variants={itemVariants}>
          {/* Name row with status */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
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
                <h1 className="select-text truncate font-heading font-semibold text-lg tracking-tight">
                  {connection.name}
                </h1>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                    <span
                      className={cn(
                        "inline-block size-1.5 rounded-full",
                        isLoadingDatabaseInfo
                          ? "bg-amber-500"
                          : "bg-emerald-500"
                      )}
                    />
                    {isLoadingDatabaseInfo ? "Loading" : "Connected"}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
              {/* DB type badge */}
              <Badge
                className="h-5 select-text px-1.5 font-mono text-[10px]"
                variant="secondary"
              >
                {dbTypeLabel}
              </Badge>
              {isLocal && (
                <Badge
                  className="h-5 select-text px-1.5 font-mono text-[10px]"
                  variant="outline"
                >
                  LOCAL
                </Badge>
              )}
              {connection.tag && (
                <Badge
                  className="h-5 select-text px-1.5 text-[10px]"
                  variant="secondary"
                >
                  {connection.tag}
                </Badge>
              )}
              {engineVersion && (
                <Badge
                  className="h-5 select-text px-1.5 font-mono text-[10px]"
                  variant="secondary"
                >
                  v{engineVersion}
                </Badge>
              )}
              <Badge
                className="h-5 select-text px-1.5 font-mono text-[10px]"
                variant="outline"
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
                    className="max-w-full select-none truncate rounded-sm px-1 py-0.5 text-left font-mono text-muted-foreground text-xs transition-colors duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    onClick={() => void handleCopyDisplayInfo()}
                    onMouseEnter={() => setIsDisplayInfoHovered(true)}
                    onMouseLeave={() => setIsDisplayInfoHovered(false)}
                    type="button"
                  />
                }
              >
                {displayInfo}
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={6}>
                <span
                  className="fade-in-0 zoom-in-95 inline-block animate-in duration-150"
                  key={displayInfoCopyFeedback ?? "idle"}
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
          <div className="flex items-center gap-1.5 pt-0.5">
            <motion.div whileTap={{ scale: 0.97 }}>
              <Button
                className="h-7 gap-1.5 text-xs transition-transform duration-150 active:scale-[0.98]"
                onClick={onNewQuery}
                size="sm"
              >
                <Icon className="size-3.5" name="terminal" />
                New query
              </Button>
            </motion.div>
            <motion.div whileTap={{ scale: 0.97 }}>
              <Button
                className="h-7 gap-1.5 text-xs transition-transform duration-150 active:scale-[0.98]"
                onClick={onViewTables}
                size="sm"
                variant="secondary"
              >
                <Icon className="size-3.5" name="table" />
                Tables
              </Button>
            </motion.div>
            <motion.div whileTap={{ scale: 0.97 }}>
              <Button
                className="h-7 w-7 p-0 text-muted-foreground transition-colors duration-200 hover:text-foreground"
                onClick={onTestConnection}
                size="sm"
                title="Test connection"
                variant="ghost"
              >
                <Icon className="size-3.5" name="refresh" />
              </Button>
            </motion.div>
            {isLocal && (
              <motion.div whileTap={{ scale: 0.97 }}>
                <Button
                  className="h-7 gap-1.5 text-xs transition-transform duration-150 active:scale-[0.98]"
                  disabled={isLoadingLocalDbStatus || isTogglingLocalDbStatus}
                  onClick={isRunning ? onPauseLocalDb : onStartLocalDb}
                  size="sm"
                  variant="ghost"
                >
                  {isTogglingLocalDbStatus ? (
                    <>
                      <Icon className="size-3 animate-spin" name="loader" />
                      {isRunning ? "Stopping..." : "Starting..."}
                    </>
                  ) : isRunning ? (
                    <>
                      <Icon className="size-3" name="pause" />
                      Pause
                    </>
                  ) : (
                    <>
                      <Icon className="size-3" name="play" />
                      Start
                    </>
                  )}
                </Button>
              </motion.div>
            )}
          </div>
        </motion.div>

        {/* ── Overview stats ─────────────────────────────────── */}
        <motion.div className="space-y-2.5" variants={itemVariants}>
          <div className="flex items-center gap-2">
            <Icon className="size-3.5 text-muted-foreground" name="database" />
            <p className="font-medium text-[11px] text-muted-foreground/90 uppercase tracking-[0.12em]">
              Overview
            </p>
          </div>
          <div
            className={cn(
              "grid grid-cols-2 gap-2",
              totalEstimatedRows > 0 && databaseInfo?.activeConnections != null
                ? "sm:grid-cols-4"
                : totalEstimatedRows > 0 ||
                    databaseInfo?.activeConnections != null
                  ? "sm:grid-cols-3"
                  : "sm:grid-cols-3"
            )}
          >
            <StatCard
              icon={(props) => <Icon name="database" {...props} />}
              label="Schemas"
              value={totalSchemas}
            />
            <StatCard
              icon={(props) => <Icon name="table" {...props} />}
              label="Tables"
              value={totalTables}
            />
            {totalEstimatedRows > 0 && (
              <StatCard
                icon={(props) => <Icon name="list-numbers" {...props} />}
                label="Est. Rows"
                value={formatRowCount(totalEstimatedRows)}
              />
            )}
            {databaseInfo?.activeConnections != null && (
              <StatCard
                icon={(props) => <Icon name="link" {...props} />}
                label="Connections"
                sublabel={
                  databaseInfo.maxConnections
                    ? `of ${databaseInfo.maxConnections}`
                    : undefined
                }
                value={databaseInfo.activeConnections}
              />
            )}
            <StatCard
              icon={(props) => <Icon name="hard-drive" {...props} />}
              isLoading={isLoadingDatabaseInfo}
              label="Size"
              value={databaseInfo?.size ?? "—"}
            />
          </div>
        </motion.div>

        {/* ── Server info ─────────────────────────────────────── */}
        {(isLoadingDatabaseInfo || databaseInfo) && (
          <motion.div className="space-y-2.5" variants={itemVariants}>
            <p className="font-medium text-[11px] text-muted-foreground/90 uppercase tracking-[0.12em]">
              Server
            </p>
            {isLoadingDatabaseInfo ? (
              <div className="flex gap-3">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-3 w-28" />
              </div>
            ) : databaseInfo ? (
              <div className="space-y-2.5">
                {/* Primary info row */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground/60">Version</span>
                    <span className="select-text font-medium font-mono text-foreground">
                      {shortVersion ?? databaseInfo.version}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground/60">Encoding</span>
                    <span className="select-text font-medium font-mono text-foreground">
                      {databaseInfo.encoding}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground/60">Timezone</span>
                    <span className="select-text font-medium font-mono text-foreground">
                      {databaseInfo.timezone}
                    </span>
                  </div>
                  {databaseInfo.databaseName && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-muted-foreground/60">Database</span>
                      <span className="select-text font-medium font-mono text-foreground">
                        {databaseInfo.databaseName}
                      </span>
                    </div>
                  )}
                </div>

                {/* Performance & health stats */}
                {(databaseInfo.cacheHitRatio != null ||
                  connectionUsagePct != null) && (
                  <div className="space-y-2.5 rounded-lg border border-border/50 bg-muted/10 p-2.5">
                    {/* Cache hit ratio */}
                    {databaseInfo.cacheHitRatio != null && (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-1.5">
                            <Icon
                              className="size-3 text-muted-foreground/50"
                              name="zap"
                            />
                            <span className="text-muted-foreground/60">
                              Cache hit ratio
                            </span>
                          </div>
                          <span
                            className={cn(
                              "font-medium font-mono",
                              databaseInfo.cacheHitRatio >= 99
                                ? "text-emerald-500"
                                : databaseInfo.cacheHitRatio >= 95
                                  ? "text-amber-500"
                                  : "text-destructive"
                            )}
                          >
                            {databaseInfo.cacheHitRatio}%
                          </span>
                        </div>
                        <Progress
                          className="h-1"
                          max={100}
                          value={databaseInfo.cacheHitRatio}
                        />
                      </div>
                    )}

                    {/* Active connections bar */}
                    {connectionUsagePct != null && (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-1.5">
                            <Icon
                              className="size-3 text-muted-foreground/50"
                              name="link"
                            />
                            <span className="text-muted-foreground/60">
                              Connection usage
                            </span>
                          </div>
                          <span
                            className={cn(
                              "font-medium font-mono",
                              connectionUsagePct >= 90
                                ? "text-destructive"
                                : connectionUsagePct >= 70
                                  ? "text-amber-500"
                                  : "text-foreground"
                            )}
                          >
                            {connectionUsagePct}%
                          </span>
                        </div>
                        <Progress
                          className="h-1"
                          max={100}
                          value={connectionUsagePct}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : null}
          </motion.div>
        )}

        {/* ── Local DB details ────────────────────────────────── */}
        {isLocal && localDbStatus && (
          <motion.div className="space-y-2.5" variants={itemVariants}>
            <div className="flex items-center gap-2">
              <Icon className="size-3.5 text-muted-foreground" name="server" />
              <p className="font-medium text-[11px] text-muted-foreground/90 uppercase tracking-[0.12em]">
                Local Database
              </p>
            </div>
            <div className="space-y-2 rounded-lg border border-border/50 bg-muted/10 p-2.5">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground/60">Engine</span>
                  <Badge
                    className="h-4 select-text px-1 font-mono text-[10px]"
                    variant="secondary"
                  >
                    {localDbStatus.engine === "sqlite"
                      ? "SQLite"
                      : "PostgreSQL"}
                  </Badge>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground/60">Status</span>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 font-medium",
                      localDbStatus.running
                        ? "text-emerald-500"
                        : "text-amber-500"
                    )}
                  >
                    <span
                      className={cn(
                        "inline-block size-1.5 rounded-full",
                        localDbStatus.running
                          ? "bg-emerald-500"
                          : "bg-amber-500"
                      )}
                    />
                    {localDbStatus.running ? "Running" : "Stopped"}
                  </span>
                </div>
                {localDbStatus.port != null && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground/60">Port</span>
                    <span className="select-text font-medium font-mono text-foreground">
                      {localDbStatus.port}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}

        {/* ── Schema list ─────────────────────────────────────── */}
        {schemasWithCounts.length > 0 && (
          <motion.div className="space-y-2.5" variants={itemVariants}>
            <div className="flex items-center justify-between">
              <p className="font-medium text-[11px] text-muted-foreground/90 uppercase tracking-[0.12em]">
                Schemas
              </p>
              <Badge
                className="h-5 px-1.5 font-mono text-[10px]"
                variant="secondary"
              >
                {schemasWithCounts.length}
              </Badge>
            </div>
            <div className="divide-y divide-border/50 border-border/50 border-y">
              {schemasWithCounts.map((schema, i) => (
                <motion.button
                  animate={{ opacity: 1, x: 0 }}
                  className="group flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors duration-200 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset"
                  initial={{ opacity: 0, x: -4 }}
                  key={schema.name}
                  onClick={() => onViewTables()}
                  transition={{
                    delay: i * 0.03,
                    duration: 0.18,
                    ease: [0.23, 1, 0.32, 1] as [
                      number,
                      number,
                      number,
                      number,
                    ],
                  }}
                  type="button"
                  whileTap={{ scale: 0.995 }}
                >
                  <span className="flex-1 select-text truncate font-medium">
                    {schema.name}
                  </span>
                  <span className="rounded-md bg-muted/60 px-1.5 py-0.5 text-[11px] text-muted-foreground tabular-nums">
                    {schema.count}
                  </span>
                  <Icon
                    className="size-3 text-muted-foreground/30 transition-colors group-hover:text-muted-foreground"
                    name="chevron-right"
                  />
                </motion.button>
              ))}
            </div>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}
