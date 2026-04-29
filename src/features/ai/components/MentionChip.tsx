import { motion } from 'motion/react';
import { Neon } from '@/components/icons/Neon';
import { Supabase } from '@/components/icons/Supabase';
import { MySql } from '@/components/icons/MySql';
import { ClickHouse } from '@/components/icons/ClickHouse';
import { Redis } from '@/components/icons/Redis';
import { PostgreSql } from '@/components/icons/PostgreSql';
import { Sqlite } from '@/components/icons/Sqlite';
import type { Connection } from '@/ipc/db/types';
import { cn } from '@/lib/utils';
import { detectConnectionProvider } from '@/lib/stores/connection-tabs';
import { Icon as UiIcon } from '@/components/ui/Icon';

interface MentionChipProps {
  connection: Connection;
  className?: string;
}

function getMentionTone(connection: Connection): {
  chipClass: string;
  iconClass: string;
} {
  const provider = detectConnectionProvider(connection);

  if (provider === 'neon') {
    return {
      chipClass: 'border-cyan-500/45 bg-cyan-500/15 text-cyan-800 dark:border-cyan-400/50 dark:bg-cyan-400/22 dark:text-cyan-200',
      iconClass: 'text-cyan-700 dark:text-cyan-200',
    };
  }

  if (provider === 'supabase') {
    return {
      chipClass: 'border-emerald-500/45 bg-emerald-500/15 text-emerald-800 dark:border-emerald-400/50 dark:bg-emerald-400/22 dark:text-emerald-200',
      iconClass: 'text-emerald-700 dark:text-emerald-200',
    };
  }

  if (provider === 'mysql') {
    return {
      chipClass: 'border-blue-500/45 bg-blue-500/15 text-blue-800 dark:border-blue-400/50 dark:bg-blue-400/22 dark:text-blue-200',
      iconClass: 'text-blue-700 dark:text-blue-200',
    };
  }

  if (provider === 'mariadb') {
    return {
      chipClass: 'border-amber-500/45 bg-amber-500/15 text-amber-800 dark:border-amber-400/50 dark:bg-amber-400/22 dark:text-amber-200',
      iconClass: 'text-amber-700 dark:text-amber-200',
    };
  }

  if (provider === 'clickhouse') {
    return {
      chipClass: 'border-yellow-500/50 bg-yellow-500/18 text-yellow-900 dark:border-yellow-400/55 dark:bg-yellow-400/25 dark:text-yellow-200',
      iconClass: 'text-yellow-800 dark:text-yellow-200',
    };
  }

  if (provider === 'redis') {
    return {
      chipClass: 'border-red-500/45 bg-red-500/15 text-red-800 dark:border-red-400/50 dark:bg-red-400/22 dark:text-red-200',
      iconClass: 'text-red-700 dark:text-red-200',
    };
  }

  switch (connection.db_type) {
    case 'postgresql':
      return {
        chipClass: 'border-sky-500/45 bg-sky-500/15 text-sky-800 dark:border-sky-400/50 dark:bg-sky-400/22 dark:text-sky-200',
        iconClass: 'text-sky-700 dark:text-sky-200',
      };
    case 'sqlite':
      return {
        chipClass: 'border-slate-500/45 bg-slate-500/15 text-slate-800 dark:border-slate-400/50 dark:bg-slate-400/22 dark:text-slate-200',
        iconClass: 'text-slate-700 dark:text-slate-200',
      };
    default:
      return {
        chipClass: 'border-primary/40 bg-primary/18 text-primary dark:border-primary/45 dark:bg-primary/25 dark:text-primary/90',
        iconClass: 'text-primary',
      };
  }
}

function getConnectionIcon(connection: Connection, className: string) {
  const provider = detectConnectionProvider(connection);

  if (provider === 'neon') return <Neon className={className} />;
  if (provider === 'supabase') return <Supabase className={className} />;
  if (provider === 'mysql' || provider === 'mariadb') return <MySql className={className} />;
  if (provider === 'clickhouse') return <ClickHouse className={className} />;
  if (provider === 'redis') return <Redis className={className} />;

  // Fallback to explicit db_type when provider is "direct" / "url".
  const dbType = connection.db_type;
  switch (dbType) {
    case 'postgresql':
      return <PostgreSql className={className} />;
    case 'mysql':
    case 'mariadb':
      return <MySql className={className} />;
    case 'clickhouse':
      return <ClickHouse className={className} />;
    case 'sqlite':
      return <Sqlite className={className} />;
    case 'redis':
      return <Redis className={className} />;
    default:
      return <UiIcon name='database' className={className} />;
  }
}

export function MentionChip({ connection, className }: MentionChipProps) {
  const tone = getMentionTone(connection);

  return (
    <motion.span
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.15, ease: [0.23, 1, 0.32, 1] }}
      className={cn(
        'inline-flex max-w-[9.5rem] items-center gap-1 rounded-full border',
        'px-1.5 py-0.5 text-[10.5px] font-medium leading-3.5',
        tone.chipClass,
        className
      )}
      title={connection.name}
    >
      {getConnectionIcon(connection, cn('size-2.5 shrink-0', tone.iconClass))}
      <span className='truncate'>{connection.name}</span>
    </motion.span>
  );
}

interface MentionChipsProps {
  connections: Map<string, Connection>;
  className?: string;
}

export function MentionChips({ connections, className }: MentionChipsProps) {
  if (connections.size === 0) return null;

  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {Array.from(connections.entries()).map(([id, connection]) => (
        <MentionChip key={id} connection={connection} />
      ))}
    </div>
  );
}
