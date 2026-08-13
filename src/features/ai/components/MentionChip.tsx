import { motion } from "motion/react";
import { type MouseEvent, useCallback } from "react";
import { ClickHouse } from "@/components/icons/ClickHouse";
import { MySql } from "@/components/icons/MySql";
import { Neon } from "@/components/icons/Neon";
import { PostgreSql } from "@/components/icons/PostgreSql";
import { Redis } from "@/components/icons/Redis";
import { Sqlite } from "@/components/icons/Sqlite";
import { Supabase } from "@/components/icons/Supabase";
import { Icon as UiIcon } from "@/components/ui/Icon";
import type { Connection } from "@/ipc/db/types";
import { detectConnectionProvider } from "@/lib/stores/connection-tabs";
import { cn } from "@/lib/utils";

interface MentionChipProps {
  className?: string;
  connection: Connection;
  /** Called with the connection id when the hover-revealed remove button is clicked. */
  onRemove?: (connectionId: string) => void;
}

/**
 * Colored tint per provider / engine, keeping the database color identity
 * while matching kern's compact chip shell (borderless, foreground tint).
 */
function getMentionTone(connection: Connection): {
  chipClass: string;
  iconClass: string;
} {
  const provider = detectConnectionProvider(connection);

  if (provider === "neon") {
    return {
      chipClass:
        "bg-cyan-500/15 text-cyan-800 hover:bg-cyan-500/25 dark:bg-cyan-400/22 dark:text-cyan-200 dark:hover:bg-cyan-400/35",
      iconClass: "text-cyan-700 dark:text-cyan-200",
    };
  }

  if (provider === "supabase") {
    return {
      chipClass:
        "bg-emerald-500/15 text-emerald-800 hover:bg-emerald-500/25 dark:bg-emerald-400/22 dark:text-emerald-200 dark:hover:bg-emerald-400/35",
      iconClass: "text-emerald-700 dark:text-emerald-200",
    };
  }

  if (provider === "mysql") {
    return {
      chipClass:
        "bg-blue-500/15 text-blue-800 hover:bg-blue-500/25 dark:bg-blue-400/22 dark:text-blue-200 dark:hover:bg-blue-400/35",
      iconClass: "text-blue-700 dark:text-blue-200",
    };
  }

  if (provider === "mariadb") {
    return {
      chipClass:
        "bg-amber-500/15 text-amber-800 hover:bg-amber-500/25 dark:bg-amber-400/22 dark:text-amber-200 dark:hover:bg-amber-400/35",
      iconClass: "text-amber-700 dark:text-amber-200",
    };
  }

  if (provider === "clickhouse") {
    return {
      chipClass:
        "bg-yellow-500/18 text-yellow-900 hover:bg-yellow-500/30 dark:bg-yellow-400/25 dark:text-yellow-200 dark:hover:bg-yellow-400/40",
      iconClass: "text-yellow-800 dark:text-yellow-200",
    };
  }

  if (provider === "redis") {
    return {
      chipClass:
        "bg-red-500/15 text-red-800 hover:bg-red-500/25 dark:bg-red-400/22 dark:text-red-200 dark:hover:bg-red-400/35",
      iconClass: "text-red-700 dark:text-red-200",
    };
  }

  switch (connection.db_type) {
    case "postgresql":
      return {
        chipClass:
          "bg-sky-500/15 text-sky-800 hover:bg-sky-500/25 dark:bg-sky-400/22 dark:text-sky-200 dark:hover:bg-sky-400/35",
        iconClass: "text-sky-700 dark:text-sky-200",
      };
    case "sqlite":
      return {
        chipClass:
          "bg-slate-500/15 text-slate-800 hover:bg-slate-500/25 dark:bg-slate-400/22 dark:text-slate-200 dark:hover:bg-slate-400/35",
        iconClass: "text-slate-700 dark:text-slate-200",
      };
    default:
      return {
        chipClass:
          "bg-primary/18 text-primary hover:bg-primary/28 dark:bg-primary/25 dark:text-primary/90 dark:hover:bg-primary/40",
        iconClass: "text-primary",
      };
  }
}

function getConnectionIcon(connection: Connection, className: string) {
  const provider = detectConnectionProvider(connection);

  if (provider === "neon") {
    return <Neon className={className} />;
  }
  if (provider === "supabase") {
    return <Supabase className={className} />;
  }
  if (provider === "mysql" || provider === "mariadb") {
    return <MySql className={className} />;
  }
  if (provider === "clickhouse") {
    return <ClickHouse className={className} />;
  }
  if (provider === "redis") {
    return <Redis className={className} />;
  }

  // Fallback to explicit db_type when provider is "direct" / "url".
  const dbType = connection.db_type;
  switch (dbType) {
    case "postgresql":
      return <PostgreSql className={className} />;
    case "mysql":
    case "mariadb":
      return <MySql className={className} />;
    case "clickhouse":
      return <ClickHouse className={className} />;
    case "sqlite":
      return <Sqlite className={className} />;
    case "redis":
      return <Redis className={className} />;
    default:
      return <UiIcon className={className} name="database" />;
  }
}

export function MentionChip({
  connection,
  className,
  onRemove,
}: MentionChipProps) {
  const tone = getMentionTone(connection);

  const handleRemove = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      onRemove?.(connection.id);
    },
    [onRemove, connection.id]
  );

  return (
    <motion.span
      animate={{ opacity: 1, scale: 1 }}
      className={cn(
        "group inline-flex h-[18px] min-w-0 max-w-[12rem] items-center gap-1 rounded px-1",
        "text-sm leading-none transition-colors",
        tone.chipClass,
        className
      )}
      exit={{ opacity: 0, scale: 0.9 }}
      initial={{ opacity: 0, scale: 0.9 }}
      title={connection.name}
      transition={{ duration: 0.15, ease: [0.23, 1, 0.32, 1] }}
    >
      {/* Icon — swapped for the remove button on hover, same size, no width shift. */}
      <span className="pointer-events-none inline-flex shrink-0 items-center group-hover:hidden">
        {getConnectionIcon(connection, cn("size-3.5 shrink-0", tone.iconClass))}
      </span>
      {onRemove ? (
        <button
          aria-label={`Remove ${connection.name}`}
          className="hidden shrink-0 items-center transition-colors hover:opacity-80 group-hover:inline-flex"
          onClick={handleRemove}
          tabIndex={-1}
          type="button"
        >
          <UiIcon className={cn("size-3.5", tone.iconClass)} name="x" />
        </button>
      ) : null}
      <span className="truncate">{connection.name}</span>
    </motion.span>
  );
}

interface MentionChipsProps {
  className?: string;
  connections: Map<string, Connection>;
}

export function MentionChips({ connections, className }: MentionChipsProps) {
  if (connections.size === 0) {
    return null;
  }

  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {Array.from(connections.entries()).map(([id, connection]) => (
        <MentionChip connection={connection} key={id} />
      ))}
    </div>
  );
}
