import {
  ChevronRight,
  Database,
  HardDrive,
  Loader2,
  Lock,
  Pause,
  Play,
  RefreshCw,
  Table2,
  Terminal,
} from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  Connection,
  DatabaseInfo,
  LocalDbInfo,
  SchemaSummary,
} from "@/ipc/db/types";
import { cn } from "@/utils/tailwind";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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
  const { totalSchemas, totalTables, tablesWithRls, schemasWithCounts } = useMemo(() => {
    if (!schemaSummary) return { totalSchemas: 0, totalTables: 0, tablesWithRls: 0, schemasWithCounts: [] as { name: string; count: number; rlsCount: number }[] };
    let rlsCount = 0;
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
    }
    const counts = schemaSummary.schemas.map((name) => ({
      name,
      ...(schemaMap.get(name) ?? { count: 0, rlsCount: 0 }),
    }));
    return {
      totalSchemas: schemaSummary.schemas.length,
      totalTables: schemaSummary.tables.length,
      tablesWithRls: rlsCount,
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
                <Terminal className="size-3.5" />
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
                <Table2 className="size-3.5" />
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
                <RefreshCw className="size-3.5" />
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
                      <Loader2 className="size-3 animate-spin" />
                      {isRunning ? "Stopping..." : "Starting..."}
                    </>
                  ) : isRunning ? (
                    <>
                      <Pause className="size-3" />
                      Pause
                    </>
                  ) : (
                    <>
                      <Play className="size-3" />
                      Start
                    </>
                  )}
                </Button>
              </motion.div>
            )}
          </div>
        </motion.div>

        <motion.div variants={itemVariants} className="space-y-3">
          <div className="flex items-center gap-2">
            <Database className="size-3.5 text-muted-foreground" />
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Overview
            </p>
          </div>
          <div
            className={cn(
              "grid grid-cols-2 gap-2",
              tablesWithRls > 0 ? "sm:grid-cols-4" : "sm:grid-cols-3"
            )}
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
        </motion.div>

        {/* Server info */}
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
              </div>
            ) : null}
          </motion.div>
        )}

        {/* Schema list */}
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
                    <Lock className="size-2.5 text-cyan-500/60" />
                  )}
                  <ChevronRight className="size-3 text-muted-foreground/30 group-hover:text-muted-foreground transition-colors" />
                </motion.button>
              ))}
            </div>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}
