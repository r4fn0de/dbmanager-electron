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
      chipClass: 'border-cyan-500/35 bg-cyan-500/10 text-cyan-700 dark:border-cyan-400/40 dark:bg-cyan-400/16 dark:text-cyan-300',
      iconClass: 'text-cyan-600 dark:text-cyan-300',
    };
  }

  if (provider === 'supabase') {
    return {
      chipClass: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:border-emerald-400/40 dark:bg-emerald-400/16 dark:text-emerald-300',
      iconClass: 'text-emerald-600 dark:text-emerald-300',
    };
  }

  if (provider === 'mysql') {
    return {
      chipClass: 'border-blue-500/35 bg-blue-500/10 text-blue-700 dark:border-blue-400/40 dark:bg-blue-400/16 dark:text-blue-300',
      iconClass: 'text-blue-600 dark:text-blue-300',
    };
  }

  if (provider === 'mariadb') {
    return {
      chipClass: 'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:border-amber-400/40 dark:bg-amber-400/16 dark:text-amber-300',
      iconClass: 'text-amber-600 dark:text-amber-300',
    };
  }

  if (provider === 'clickhouse') {
    return {
      chipClass: 'border-yellow-500/40 bg-yellow-500/12 text-yellow-800 dark:border-yellow-400/45 dark:bg-yellow-400/18 dark:text-yellow-300',
      iconClass: 'text-yellow-700 dark:text-yellow-300',
    };
  }

  if (provider === 'redis') {
    return {
      chipClass: 'border-red-500/35 bg-red-500/10 text-red-700 dark:border-red-400/40 dark:bg-red-400/16 dark:text-red-300',
      iconClass: 'text-red-600 dark:text-red-300',
    };
  }

  switch (connection.db_type) {
    case 'postgresql':
      return {
        chipClass: 'border-sky-500/35 bg-sky-500/10 text-sky-700 dark:border-sky-400/40 dark:bg-sky-400/16 dark:text-sky-300',
        iconClass: 'text-sky-600 dark:text-sky-300',
      };
    case 'sqlite':
      return {
        chipClass: 'border-slate-500/35 bg-slate-500/10 text-slate-700 dark:border-slate-400/40 dark:bg-slate-400/16 dark:text-slate-300',
        iconClass: 'text-slate-600 dark:text-slate-300',
      };
    default:
      return {
        chipClass: 'border-primary/30 bg-primary/12 text-primary/90 dark:border-primary/35 dark:bg-primary/18 dark:text-primary/80',
        iconClass: 'text-primary/80',
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
