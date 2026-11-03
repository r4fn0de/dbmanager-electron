import { ClickHouse } from "@/components/icons/ClickHouse";
import { MariaDb } from "@/components/icons/MariaDb";
import { MySql } from "@/components/icons/MySql";
import { Neon } from "@/components/icons/Neon";
import { PostgreSql } from "@/components/icons/PostgreSql";
import { Redis } from "@/components/icons/Redis";
import { Sqlite } from "@/components/icons/Sqlite";
import { Supabase } from "@/components/icons/Supabase";
import { Icon as UiIcon } from "@/components/ui/Icon";
import type { ConnectionMentionProvider } from "@/components/ui/lexical/connection-mention-node";
import { cn } from "@/lib/utils";

function MentionProviderIcon({
  provider,
  className,
}: {
  provider: ConnectionMentionProvider;
  className?: string;
}) {
  const iconClassName = cn("size-3.5 shrink-0", className);
  switch (provider) {
    case "neon":
      return <Neon className={iconClassName} />;
    case "supabase":
      return <Supabase className={iconClassName} />;
    case "mysql":
      return <MySql className={iconClassName} />;
    case "mariadb":
      return <MariaDb className={iconClassName} />;
    case "clickhouse":
      return <ClickHouse className={iconClassName} />;
    case "redis":
      return <Redis className={iconClassName} />;
    case "postgresql":
      return <PostgreSql className={iconClassName} />;
    case "sqlite":
      return <Sqlite className={iconClassName} />;
    default:
      return (
        <UiIcon className={iconClassName} name="database" />
      );
  }
}

export function ConnectionMentionPill({
  label,
  provider,
}: {
  label: string;
  provider: ConnectionMentionProvider;
}) {
  return (
    <span
      className="mx-px inline-flex max-w-full min-w-0 items-center gap-1 rounded-md border border-primary/25 bg-primary/10 py-px pr-1.5 pl-1 align-baseline text-sm font-medium text-primary"
      contentEditable={false}
      data-connection-mention-label={label}
      data-connection-mention-provider={provider}
      title={label}
    >
      <MentionProviderIcon
        className="rounded-sm bg-primary/15 p-px"
        provider={provider}
      />
      <span className="min-w-0 flex-1 truncate leading-none">{label}</span>
    </span>
  );
}
