import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/Icon";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { QueryPlanResult } from "@/ipc/db/types";
import { cn, formatDuration } from "@/lib/utils";

interface QueryPlanPanelProps {
  error: string | null;
  isAnalyzing: boolean;
  onClose: () => void;
  plan: QueryPlanResult | null;
  sql: string;
}

interface QueryPlanBodyProps {
  error: string | null;
  isAnalyzing: boolean;
  plan: QueryPlanResult | null;
}

function QueryPlanBody({ error, isAnalyzing, plan }: QueryPlanBodyProps) {
  if (isAnalyzing) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-muted-foreground text-xs">
        <Icon className="size-3.5 animate-spin" name="loader" />
        Analyzing query plan...
      </div>
    );
  }

  if (error) {
    return (
      <div
        aria-live="polite"
        className="m-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive text-xs"
        role="alert"
      >
        {error}
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground text-xs">
        Run EXPLAIN to inspect the query plan.
      </div>
    );
  }

  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-border/60 border-b px-3 py-2">
        {plan.totalCost === undefined ? null : (
          <div className="rounded-md border border-border/60 bg-muted/20 px-2 py-1">
            <span className="block text-[10px] text-muted-foreground">
              Total cost
            </span>
            <span className="font-mono text-xs tabular-nums">
              {plan.totalCost.toLocaleString()}
            </span>
          </div>
        )}
        {plan.estimatedRows === undefined ? null : (
          <div className="rounded-md border border-border/60 bg-muted/20 px-2 py-1">
            <span className="block text-[10px] text-muted-foreground">
              Rows
            </span>
            <span className="font-mono text-xs tabular-nums">
              {plan.estimatedRows.toLocaleString()}
            </span>
          </div>
        )}
        {plan.executionTimeMs === undefined ? null : (
          <div className="rounded-md border border-border/60 bg-muted/20 px-2 py-1">
            <span className="block text-[10px] text-muted-foreground">
              Execution
            </span>
            <span className="font-mono text-xs tabular-nums">
              {formatDuration(plan.executionTimeMs)}
            </span>
          </div>
        )}
        <span
          className={cn(
            "ml-auto text-[10px]",
            plan.hasExecutionStats
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-muted-foreground"
          )}
        >
          {plan.hasExecutionStats
            ? "Actual execution statistics"
            : "Estimated plan"}
        </span>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <pre className="select-text whitespace-pre-wrap break-words p-3 font-mono text-[11px] text-foreground/90 leading-5">
          {plan.plan}
        </pre>
      </ScrollArea>
    </>
  );
}

export function QueryPlanPanel({
  error,
  isAnalyzing,
  onClose,
  plan,
  sql,
}: QueryPlanPanelProps) {
  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-border/70 bg-background">
      <header className="flex shrink-0 items-center justify-between gap-3 border-border/60 border-b bg-muted/20 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="size-3.5 text-primary" name="git-branch" />
          <span className="font-medium text-xs">Query plan</span>
          {plan?.hasExecutionStats ? (
            <Badge className="h-5 text-[10px]" variant="secondary">
              ANALYZE
            </Badge>
          ) : null}
          <span
            className="truncate font-mono text-[10px] text-muted-foreground/70"
            title={sql}
          >
            {sql}
          </span>
        </div>
        <Button
          aria-label="Close query plan"
          onClick={onClose}
          size="icon-xs"
          variant="ghost"
        >
          <Icon className="size-3.5" name="x" />
        </Button>
      </header>
      <QueryPlanBody error={error} isAnalyzing={isAnalyzing} plan={plan} />
    </section>
  );
}
