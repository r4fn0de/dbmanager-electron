import { useState, useCallback, useMemo, useEffect } from "react";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Icon } from "@/components/ui/Icon";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ipc } from "@/ipc/manager";
import type { BranchInfo, SchemaTableSummary } from "@/ipc/db/types";

export interface CreateBranchInput {
  name: string;
  description?: string;
  parentBranchId?: string;
  dataTables?: Array<{ schema: string; table: string }>;
}

interface CreateBranchDialogProps {
  localDbName: string;
  /** Connection ID — used to fetch the schema summary for the data selector. */
  connectionId: string;
  branches: BranchInfo[];
  activeBranch: BranchInfo | null;
  onCreate: (input: CreateBranchInput) => Promise<BranchInfo>;
  /** Optional tooltip label shown on hover over the trigger button. */
  tooltipLabel?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────

function formatRowCount(n: number): string {
  if (n === 0) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toString();
}

// ── Data mode ──────────────────────────────────────────────────────────
type DataMode = "all" | "schema_only" | "selective";

interface TableCheckItem {
  schema: string;
  table: string;
  checked: boolean;
  estimatedRowCount: number;
}

export function CreateBranchDialog({
  localDbName,
  connectionId,
  branches,
  activeBranch,
  onCreate,
  tooltipLabel,
}: CreateBranchDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [parentBranchId, setParentBranchId] = useState<string>(
    activeBranch?.id ?? "",
  );
  const [dataMode, setDataMode] = useState<DataMode>("all");
  const [tableItems, setTableItems] = useState<TableCheckItem[]>([]);
  const [isLoadingSchema, setIsLoadingSchema] = useState(false);
  const [hasFetchedSchema, setHasFetchedSchema] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Lazy schema fetch: only when user switches to "selective" mode ─
  useEffect(() => {
    if (!open || dataMode !== "selective" || hasFetchedSchema) return;
    let cancelled = false;
    setIsLoadingSchema(true);
    ipc.client.db.getSchemaSummary({ id: connectionId })
      .then((summary) => {
        if (cancelled) return;
        // Only user tables (skip system schemas)
        const userTables = summary.tables.filter(
          (t: SchemaTableSummary) =>
            !["information_schema", "pg_catalog", "pg_toast"].includes(t.schema),
        );
        setTableItems(
          userTables.map((t: SchemaTableSummary) => ({
            schema: t.schema,
            table: t.name,
            checked: true,
            estimatedRowCount: t.estimated_row_count,
          })),
        );
      })
      .catch(() => {
        if (cancelled) return;
        setTableItems([]);
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingSchema(false);
          setHasFetchedSchema(true);
        }
      });
    return () => { cancelled = true; };
  }, [open, dataMode, connectionId, hasFetchedSchema]);

  // Reset schema cache and data mode when dialog closes so next open starts fresh
  useEffect(() => {
    if (!open) {
      setHasFetchedSchema(false);
      setTableItems([]);
      setDataMode("all");
    }
  }, [open]);

  // ── Table selection helpers ─────────────────────────────────────────
  const checkedCount = useMemo(
    () => tableItems.filter((t) => t.checked).length,
    [tableItems],
  );
  const allChecked = tableItems.length > 0 && checkedCount === tableItems.length;

  const toggleTable = useCallback((schema: string, table: string) => {
    setTableItems((prev) =>
      prev.map((t) =>
        t.schema === schema && t.table === table
          ? { ...t, checked: !t.checked }
          : t,
      ),
    );
  }, []);

  const toggleAll = useCallback(() => {
    setTableItems((prev) =>
      prev.map((t) => ({ ...t, checked: !allChecked })),
    );
  }, [allChecked]);

  const nameError = name.length > 63
    ? "Name must be 63 characters or less"
    : branches.some((b) => b.name === name)
      ? `Branch "${name}" already exists`
      : null;

  const canCreate = name.length > 0 && !nameError && !isCreating
    && !(dataMode === "selective" && isLoadingSchema);

  const handleCreate = useCallback(async () => {
    if (!canCreate) return;
    setIsCreating(true);
    setError(null);
    try {
      const dataTables =
        dataMode === "schema_only"
          ? [] // empty array = schema-only branch (truncate all user tables)
          : dataMode === "selective"
            ? tableItems
                .filter((t) => t.checked)
                .map((t) => ({ schema: t.schema, table: t.table }))
            : undefined; // undefined = copy all data
      await onCreate({
        name,
        description: description || undefined,
        parentBranchId: parentBranchId || undefined,
        dataTables,
      });
      setOpen(false);
      setName("");
      setDescription("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create branch");
    } finally {
      setIsCreating(false);
    }
  }, [canCreate, name, description, parentBranchId, dataMode, tableItems, onCreate]);

  // Build the trigger element: Button ← DialogTrigger, optionally wrapped
  // in TooltipTrigger for hover labels.
  const triggerElement = (
    <DialogTrigger
      render={
        <Button variant="ghost" size="icon-xs" className="text-muted-foreground hover:text-foreground" />
      }
    >
      <Icon name="plus" className="size-3.5" />
    </DialogTrigger>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {tooltipLabel ? (
        <Tooltip>
          <TooltipTrigger
            render={triggerElement}
          />
          <TooltipContent side="bottom" sideOffset={4}>
            {tooltipLabel}
          </TooltipContent>
        </Tooltip>
      ) : (
        triggerElement
      )}
      <DialogContent
        className="t-resize sm:max-w-[540px]"
        overlayClassName="bg-black/10 supports-backdrop-filter:backdrop-blur-xs"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon name="plus" className="size-4 text-muted-foreground" />
            Create Branch
          </DialogTitle>
          <DialogDescription>
            Create a new branch from{" "}
            <span className="font-medium text-foreground">{localDbName}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Branch name */}
          <div className="space-y-1.5">
            <Label htmlFor="branch-name" className="text-xs font-medium">
              Branch name
            </Label>
            <Input
              id="branch-name"
              placeholder="e.g., feature/add-uuid-column"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={63}
              className={cn(nameError && "border-destructive")}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && canCreate) handleCreate();
              }}
            />
            {nameError && (
              <p className="text-xs text-destructive">{nameError}</p>
            )}
          </div>

          {/* Parent branch */}
          {branches.length > 1 && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Branch from</Label>
              <div className="flex flex-wrap gap-1.5">
                {branches.map((branch) => (
                  <button
                    key={branch.id}
                    type="button"
                    onClick={() => setParentBranchId(branch.id)}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors",
                      parentBranchId === branch.id
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border hover:border-primary/50 text-muted-foreground",
                    )}
                  >
                    {branch.isActive && (
                      <span className="size-1.5 rounded-full bg-emerald-500" />
                    )}
                    {branch.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="branch-description" className="text-xs font-medium">
              Description <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="branch-description"
              placeholder="What this branch is for..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="resize-none text-sm"
            />
          </div>

          {/* Divider */}
          <div className="border-t" />

          {/* Data mode toggle */}
          <div className="space-y-2.5">
            <Label className="text-xs font-medium">Data to include</Label>
            <div className="inline-flex w-full rounded-md border border-border bg-muted/30 p-0.5">
              <button
                type="button"
                className={cn(
                  "flex-1 inline-flex items-center justify-center gap-1.5 rounded-sm px-2 py-1.5 text-[11px] font-medium transition-colors",
                  dataMode === "all"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => setDataMode("all")}
              >
                <Icon name="database" className="size-3" />
                All data
              </button>
              <button
                type="button"
                className={cn(
                  "flex-1 inline-flex items-center justify-center gap-1.5 rounded-sm px-2 py-1.5 text-[11px] font-medium transition-colors",
                  dataMode === "schema_only"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => setDataMode("schema_only")}
              >
                <Icon name="file-code" className="size-3" />
                Schema only
              </button>
              <button
                type="button"
                className={cn(
                  "flex-1 inline-flex items-center justify-center gap-1.5 rounded-sm px-2 py-1.5 text-[11px] font-medium transition-colors",
                  dataMode === "selective"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => setDataMode("selective")}
              >
                <Icon name="filter" className="size-3" />
                Select tables
              </button>
            </div>

            {dataMode === "all" && (
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                All tables will include both schema and row data.
              </p>
            )}

            {dataMode === "schema_only" && (
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
                Only schema structure (tables, indexes, constraints) will be included. No row data will be copied.
              </div>
            )}

            {dataMode === "selective" && (
              <>
                {isLoadingSchema ? (
                  <div className="flex items-center justify-center py-6 gap-2">
                    <Icon name="loader" className="size-4 animate-spin text-muted-foreground" />
                    <span className="text-[11px] text-muted-foreground">Loading tables…</span>
                  </div>
                ) : tableItems.length === 0 ? (
                  <div className="py-4 text-center">
                    <p className="text-[11px] text-muted-foreground">
                      No user tables found.
                    </p>
                    <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                      This will create a schema-only branch.
                    </p>
                  </div>
                ) : (
                  <div className="border rounded-md overflow-hidden">
                    {/* Select-all header */}
                    <div className="bg-muted/30 px-3 py-1.5 border-b flex items-center gap-2.5">
                      <Checkbox
                        id="branch-select-all"
                        checked={allChecked}
                        onCheckedChange={toggleAll}
                      />
                      <Label htmlFor="branch-select-all" className="text-[11px] font-medium cursor-pointer flex-1">
                        Select all
                      </Label>
                      <span className="text-[10px] text-muted-foreground tabular-nums">
                        {checkedCount}/{tableItems.length}
                      </span>
                    </div>

                    {/* Table list */}
                    <ScrollArea className="max-h-48">
                      <div className="divide-y divide-border/40">
                        {tableItems.map((t) => (
                          <label
                            key={`${t.schema}.${t.table}`}
                            className={cn(
                              "flex items-center gap-2.5 px-3 py-1.5 cursor-pointer transition-colors hover:bg-muted/30",
                              !t.checked && "text-muted-foreground",
                            )}
                          >
                            <Checkbox
                              checked={t.checked}
                              onCheckedChange={() => toggleTable(t.schema, t.table)}
                            />
                            <span className="flex-1 min-w-0 font-mono text-[11px] truncate">
                              <span className="text-muted-foreground">{t.schema}.</span>
                              {t.table}
                            </span>
                            <span className="text-[10px] text-muted-foreground/60 tabular-nums shrink-0">
                              {formatRowCount(t.estimatedRowCount)}
                            </span>
                          </label>
                        ))}
                      </div>
                    </ScrollArea>

                    {/* Selection note */}
                    {checkedCount === 0 ? (
                      <div className="border-t px-3 py-1.5 bg-muted/20">
                        <p className="text-[10px] text-muted-foreground leading-relaxed">
                          No tables selected — only schema structure will be created, no row data will be copied.
                        </p>
                      </div>
                    ) : checkedCount < tableItems.length ? (
                      <div className="border-t px-3 py-1.5 bg-muted/20">
                        <p className="text-[10px] text-muted-foreground leading-relaxed">
                          Selected tables will include row data. Unselected tables will be schema-only (empty structure).
                        </p>
                      </div>
                    ) : null}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Info note */}
          <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
            <p className="text-xs text-muted-foreground leading-relaxed">
              The branch will be created as a copy of the{" "}
              <Badge variant="outline" className="text-[10px] h-4 px-1 font-mono ml-0.5">
                {branches.find((b) => b.id === parentBranchId)?.name ?? "main"}
              </Badge>{" "}
              branch using PostgreSQL template databases.
              {dataMode === "all"
                ? " Schema and data are included by default."
                : dataMode === "schema_only"
                  ? " Schema structure only — no row data will be copied."
                  : ` ${checkedCount} table${checkedCount !== 1 ? "s" : ""} will include data, the rest will be schema-only.`}
            </p>
          </div>

          {/* Error */}
          {error && (
            <p className="text-xs text-destructive rounded-md bg-destructive/10 px-3 py-2">
              {error}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOpen(false)}
            disabled={isCreating}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleCreate}
            disabled={!canCreate}
          >
            {isCreating ? (
              <>
                <Icon name="loader" className="size-3.5 animate-spin mr-1.5" />
                Creating...
              </>
            ) : (
              <>
                <Icon name="plus" className="size-3.5 mr-1.5" />
                Create Branch
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
