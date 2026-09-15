import { motion } from "motion/react";
import { type ReactNode, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/Icon";
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
  /** Passing a schema name pre-selects it before switching to the Tables section. */
  onViewTables: (schema?: string) => void;
  schemaSummary: SchemaSummary | null;
}

/* ── Animation variants (GPU-only, never scale(0), ≤300ms) ── */
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

// ── Small building blocks ─────────────────────────────────────────────

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
// "PostgreSQL 17.11 (c4b0a8b) on x86_64…" → captures "PostgreSQL 17.11"
const SERVER_VERSION_RE = /^(\S+\s+[\d.]+)/;
const URL_PASSWORD_RE = /:[^:]*@/;

const COPY_FEEDBACK_LABELS: Record<"copied" | "failed" | "idle", string> = {
  copied: "Copied!",
  failed: "Failed to copy",
  idle: "Copy connection string",
};

function getLocalDbAction(
  isRunning: boolean,
  isToggling: boolean
): { icon: IconName; isSpinning?: boolean; label: string } {
  if (isToggling) {
    return {
      icon: "loader",
      isSpinning: true,
      label: isRunning ? "Stopping…" : "Starting…",
    };
  }
  if (isRunning) {
    return { icon: "pause", label: "Pause" };
  }
  return { icon: "play", label: "Start" };
}

function MetaSep() {
  return (
    <span aria-hidden className="text-muted-foreground/30">
      ·
    </span>
  );
}

function Rule() {
  return <div className="h-px bg-border/60" />;
}

function Stat({
  label,
  value,
  isLoading,
}: {
  label: string;
  value: number | string;
  isLoading?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      {isLoading ? (
        <Skeleton className="h-3.5 w-10" />
      ) : (
        <span className="select-text font-medium text-[13px] text-foreground tabular-nums leading-none">
          {value}
        </span>
      )}
      <span className="text-[11px] text-muted-foreground/60 leading-none">
        {label}
      </span>
    </div>
  );
}

function SchemaList({
  schemas,
  onSelect,
}: {
  schemas: { count: number; name: string }[];
  onSelect: (schema: string) => void;
}) {
  return (
    <>
      <Rule />
      <motion.div className="space-y-1" variants={itemVariants}>
        <p className="px-2 text-[11px] text-muted-foreground/60">Schemas</p>
        {schemas.map((schema) => (
          <button
            className="group flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors duration-150 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset"
            key={schema.name}
            onClick={() => onSelect(schema.name)}
            type="button"
          >
            <span className="flex-1 select-text truncate text-[13px]">
              {schema.name}
            </span>
            <span className="text-[11px] text-muted-foreground/60 tabular-nums">
              {schema.count}
            </span>
            <Icon
              className="size-3 shrink-0 text-muted-foreground/40 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
              name="chevron-right"
            />
          </button>
        ))}
      </motion.div>
    </>
  );
}

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

  const colorBadge =
    connection.color && HEX_COLOR_RE.test(connection.color)
      ? connection.color
      : null;
  const isLocal = connection.is_local === true;
  const isRunning = Boolean(localDbStatus?.running);
  const dbTypeLabel = DB_TYPE_LABELS[connection.db_type] ?? connection.db_type;
  const showLocalDb = isLocal && localDbStatus !== null;
  const localDbAction = getLocalDbAction(isRunning, isTogglingLocalDbStatus);
  const copyFeedback = copyConnectionStringFeedback ?? "idle";

  const versionLabel = useMemo(() => {
    const engineVersion =
      connection.engine_version ?? connection.postgres_version;
    if (engineVersion) {
      return `${dbTypeLabel} ${engineVersion}`;
    }
    const raw = databaseInfo?.version;
    if (!raw) {
      return dbTypeLabel;
    }
    return raw.match(SERVER_VERSION_RE)?.[1] ?? raw;
  }, [
    connection.engine_version,
    connection.postgres_version,
    databaseInfo?.version,
    dbTypeLabel,
  ]);

  const displayInfo = useMemo(() => {
    if (connectionString) {
      return connectionString;
    }
    if (connection.url) {
      return connection.url.replace(URL_PASSWORD_RE, ":****@");
    }
    return `${connection.username}@${connection.host}:${connection.port}/${connection.database}`;
  }, [
    connectionString,
    connection.url,
    connection.username,
    connection.host,
    connection.port,
    connection.database,
  ]);

  // One quiet line of identity facts instead of a dedicated "Server" block.
  const metaParts: { key: string; node: ReactNode }[] = [
    {
      key: "status",
      node: (
        <span className="inline-flex items-center gap-1.5">
          <span
            className={cn(
              "inline-block size-1.5 rounded-full",
              isLoadingDatabaseInfo ? "bg-amber-500" : "bg-emerald-500"
            )}
          />
          {isLoadingDatabaseInfo ? "Connecting" : "Connected"}
        </span>
      ),
    },
    { key: "version", node: versionLabel },
    ...(databaseInfo?.databaseName
      ? [{ key: "database", node: databaseInfo.databaseName }]
      : []),
    ...(databaseInfo?.encoding
      ? [{ key: "encoding", node: databaseInfo.encoding }]
      : []),
    ...(databaseInfo?.timezone
      ? [{ key: "timezone", node: databaseInfo.timezone }]
      : []),
  ];

  const isSchemaLoading = schemaSummary === null;
  const connectionUsagePct =
    databaseInfo?.activeConnections != null &&
    databaseInfo?.maxConnections != null
      ? Math.round(
          (databaseInfo.activeConnections / databaseInfo.maxConnections) * 100
        )
      : null;

  const stats: {
    label: string;
    value: number | string;
    isLoading?: boolean;
  }[] = [
    { isLoading: isSchemaLoading, label: "schemas", value: totalSchemas },
    { isLoading: isSchemaLoading, label: "tables", value: totalTables },
    ...(totalEstimatedRows > 0
      ? [
          {
            isLoading: isSchemaLoading,
            label: "est. rows",
            value: formatRowCount(totalEstimatedRows),
          },
        ]
      : []),
    ...(databaseInfo?.activeConnections == null
      ? []
      : [
          {
            label: "connections",
            value: databaseInfo.maxConnections
              ? `${databaseInfo.activeConnections}/${databaseInfo.maxConnections}`
              : databaseInfo.activeConnections,
          },
        ]),
    {
      isLoading: isLoadingDatabaseInfo,
      label: "size",
      value: databaseInfo?.size ?? "—",
    },
  ];

  // Health is only surfaced when it is actually worth a look — a healthy
  // database says nothing at all instead of showing two full progress bars.
  const healthNotes: string[] = [];
  if (databaseInfo?.cacheHitRatio != null && databaseInfo.cacheHitRatio < 95) {
    healthNotes.push(
      `Cache hit ratio at ${databaseInfo.cacheHitRatio}% — below the 95% baseline`
    );
  }
  if (connectionUsagePct != null && connectionUsagePct >= 70) {
    healthNotes.push(`Connections at ${connectionUsagePct}% of capacity`);
  }

  return (
    <TooltipProvider delay={0}>
      <motion.div
        animate="visible"
        className="h-full overflow-auto"
        initial="hidden"
        variants={containerVariants}
      >
        <div className="mx-auto max-w-2xl space-y-6 px-6 py-10">
          {/* ── Identity ────────────────────────────────────────── */}
          <motion.div className="space-y-3" variants={itemVariants}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                {colorBadge ? (
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: colorBadge }}
                  />
                ) : null}
                <h1 className="select-text truncate font-heading font-medium text-base tracking-tight">
                  {connection.name}
                </h1>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {!!connection.tag && (
                  <Badge
                    className="h-5 select-text px-1.5 text-[10px]"
                    variant="secondary"
                  >
                    {connection.tag}
                  </Badge>
                )}
                {isLocal && (
                  <Badge
                    className="h-5 select-text px-1.5 font-mono text-[10px]"
                    variant="outline"
                  >
                    LOCAL
                  </Badge>
                )}
              </div>
            </div>

            <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted-foreground">
              {metaParts.map((part, i) => (
                <span
                  className="inline-flex items-center gap-x-1.5"
                  key={part.key}
                >
                  {i > 0 && <MetaSep />}
                  {part.node}
                </span>
              ))}
            </p>

            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    className="group max-w-full cursor-pointer select-none rounded-sm py-0.5 text-left font-mono text-[11px] text-muted-foreground transition-colors duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    onClick={onCopyConnectionString}
                    type="button"
                  >
                    <span className="flex items-center gap-2">
                      <span className="truncate">{displayInfo}</span>
                      <Icon
                        className={cn(
                          "size-3 shrink-0 opacity-0 transition-opacity duration-200 group-hover:opacity-60",
                          copyFeedback === "copied" &&
                            "text-emerald-500 opacity-100",
                          copyFeedback === "failed" &&
                            "text-destructive opacity-100"
                        )}
                        name="copy"
                      />
                    </span>
                  </button>
                }
              />
              <TooltipContent side="top" sideOffset={6}>
                {COPY_FEEDBACK_LABELS[copyFeedback]}
              </TooltipContent>
            </Tooltip>

            <div className="flex items-center gap-1.5 pt-0.5">
              <Button
                className="h-7 gap-1.5 text-xs transition-transform duration-150 active:scale-[0.98]"
                onClick={onNewQuery}
                size="sm"
              >
                <Icon className="size-3.5" name="terminal" />
                New query
              </Button>
              <Button
                className="h-7 gap-1.5 text-xs transition-transform duration-150 active:scale-[0.98]"
                onClick={() => onViewTables()}
                size="sm"
                variant="secondary"
              >
                <Icon className="size-3.5" name="table" />
                Tables
              </Button>
              <div className="ml-auto flex items-center gap-1">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        className="text-muted-foreground transition-colors duration-200 hover:text-foreground"
                        onClick={onTestConnection}
                        size="icon-sm"
                        variant="ghost"
                      >
                        <Icon className="size-3.5" name="plug-connected" />
                      </Button>
                    }
                  />
                  <TooltipContent side="top" sideOffset={6}>
                    Test connection
                  </TooltipContent>
                </Tooltip>
                {isLocal && (
                  <Button
                    className="h-7 gap-1.5 text-muted-foreground text-xs hover:text-foreground"
                    disabled={isLoadingLocalDbStatus || isTogglingLocalDbStatus}
                    onClick={isRunning ? onPauseLocalDb : onStartLocalDb}
                    size="sm"
                    variant="ghost"
                  >
                    <Icon
                      className={cn(
                        "size-3",
                        localDbAction.isSpinning && "animate-spin"
                      )}
                      name={localDbAction.icon}
                    />
                    {localDbAction.label}
                  </Button>
                )}
              </div>
            </div>
          </motion.div>

          <Rule />

          {/* ── Stats — one flexible row, no card chrome ────────── */}
          <motion.div
            className="flex flex-wrap items-center gap-x-8 gap-y-4"
            variants={itemVariants}
          >
            {stats.map((stat) => (
              <Stat
                isLoading={stat.isLoading}
                key={stat.label}
                label={stat.label}
                value={stat.value}
              />
            ))}
          </motion.div>

          {showLocalDb ? (
            <motion.div
              className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted-foreground/70"
              variants={itemVariants}
            >
              <Icon className="mr-1 size-3" name="server" />
              <span>
                Local{" "}
                {localDbStatus.engine === "sqlite" ? "SQLite" : "PostgreSQL"}
              </span>
              <MetaSep />
              <span
                className={cn(
                  isRunning
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-amber-600 dark:text-amber-400"
                )}
              >
                {isRunning ? "Running" : "Stopped"}
              </span>
              {localDbStatus.port != null && (
                <>
                  <MetaSep />
                  <span className="font-mono">{localDbStatus.port}</span>
                </>
              )}
            </motion.div>
          ) : null}

          {healthNotes.length > 0 && (
            <motion.div
              className="flex items-start gap-2 rounded-md bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-700 dark:text-amber-400"
              variants={itemVariants}
            >
              <Icon className="mt-px size-3.5 shrink-0" name="triangle-alert" />
              <span>{healthNotes.join(" · ")}</span>
            </motion.div>
          )}

          {schemasWithCounts.length > 0 && (
            <SchemaList onSelect={onViewTables} schemas={schemasWithCounts} />
          )}
        </div>
      </motion.div>
    </TooltipProvider>
  );
}
