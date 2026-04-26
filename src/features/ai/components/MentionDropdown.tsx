import { forwardRef, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { PostgreSql } from '@/components/icons/PostgreSql';
import { Neon } from '@/components/icons/Neon';
import { Supabase } from '@/components/icons/Supabase';
import { MySql } from '@/components/icons/MySql';
import { MariaDb } from '@/components/icons/MariaDb';
import { Sqlite } from '@/components/icons/Sqlite';
import { ClickHouse } from '@/components/icons/ClickHouse';
import { Redis } from '@/components/icons/Redis';
import type { Connection } from '@/ipc/db/types';
import { cn } from '@/lib/utils';
import { detectConnectionProvider } from '@/lib/stores/connection-tabs';
import { Icon as UiIcon } from '@/components/ui/Icon';

interface MentionDropdownProps {
  connections: Connection[];
  activeIndex: number;
  onSelect: (connection: Connection) => void;
  onClose: () => void;
}

function getConnectionIcon(connection: Connection, className: string) {
  const provider = detectConnectionProvider(connection);

  if (provider === 'neon') return <Neon className={className} />;
  if (provider === 'supabase') return <Supabase className={className} />;
  if (provider === 'mysql') return <MySql className={className} />;
  if (provider === 'mariadb') return <MariaDb className={className} />;
  if (provider === 'clickhouse') return <ClickHouse className={className} />;
  if (provider === 'redis') return <Redis className={className} />;

  // Fallback to explicit db_type when provider is "direct" / "url".
  const dbType = connection.db_type;
  switch (dbType) {
    case 'postgresql':
      return <PostgreSql className={className} />;
    case 'mysql':
      return <MySql className={className} />;
    case 'mariadb':
      return <MariaDb className={className} />;
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

export const MentionDropdown = forwardRef<HTMLDivElement, MentionDropdownProps>(
  function MentionDropdown({ connections, activeIndex, onSelect, onClose }, forwardedRef) {
    const internalRef = useRef<HTMLDivElement>(null);

    const setRef = useCallback<(node: HTMLDivElement | null) => void>((node) => {
      internalRef.current = node;
      if (typeof forwardedRef === 'function') {
        forwardedRef(node);
      } else if (forwardedRef) {
        (forwardedRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
      }
    }, [forwardedRef]);

    useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
        if (internalRef.current && !internalRef.current.contains(event.target as Node)) {
          onClose();
        }
      };
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [onClose]);

    return (
      <AnimatePresence>
        {connections.length > 0 && (
          <motion.div
            ref={setRef}
            initial={{ opacity: 0, y: -2 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -2 }}
            transition={{ duration: 0.12, ease: [0.23, 1, 0.32, 1] }}
            className={cn(
              'absolute bottom-full left-0 mb-1.5 z-50 w-56',
              'rounded-lg border border-border/40 bg-background/95',
              'shadow-sm backdrop-blur-sm dark:bg-background/90'
            )}
          >
            <div className='py-1'>
              {connections.map((connection, index) => {
                const isActive = index === activeIndex;

                return (
                  <button
                    key={connection.id}
                    type='button'
                    onClick={() => onSelect(connection)}
                    className={cn(
                      'group flex w-full cursor-pointer items-center gap-2 px-2.5 py-1.5 text-left',
                      'transition-colors duration-100',
                      isActive
                        ? 'bg-muted/60 text-foreground'
                        : 'text-foreground/70 hover:bg-muted/40 hover:text-foreground/90'
                    )}
                  >
                    {getConnectionIcon(
                      connection,
                      cn(
                        'size-3.5 shrink-0',
                        isActive ? 'text-foreground/80' : 'text-muted-foreground/50 group-hover:text-foreground/60'
                      )
                    )}
                    <div className='flex min-w-0 flex-col'>
                      <span className='truncate text-xs font-medium leading-tight'>{connection.name}</span>
                      <span className='truncate text-[10px] text-muted-foreground/40'>
                        {connection.host}:{connection.port}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    );
  }
);
