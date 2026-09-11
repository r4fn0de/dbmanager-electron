import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/Icon";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatRowCount } from "@/constants";
import type { BranchInfo, SchemaTableSummary } from "@/ipc/db/types";
import { ipc } from "@/ipc/manager";
import { cn } from "@/lib/utils";

export interface CreateBranchInput {
  dataTables?: Array<{ schema: string; table: string }>;
  description?: string;
  name: string;
  parentBranchId?: string;
}

interface CreateBranchDialogProps {
  activeBranch: BranchInfo | null;
  branches: BranchInfo[];
  /** Connection ID — used to fetch the schema summary for the data selector. */
  connectionId: string;
  localDbName: string;
  onCreate: (input: CreateBranchInput) => Promise<BranchInfo>;
  /** Optional tooltip label shown on hover over the trigger button. */
  tooltipLabel?: string;
}

// ── Data mode ──────────────────────────────────────────────────────────
type DataMode = "all" | "schema_only" | "selective";

interface TableCheckItem {
  checked: boolean;
  estimatedRowCount: number;
  schema: string;
  table: string;
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
    activeBranch?.id ?? ""
  );
  const [dataMode, setDataMode] = useState<DataMode>("all");
  const [tableItems, setTableItems] = useState<TableCheckItem[]>([]);
  const [isLoadingSchema, setIsLoadingSchema] = useState(false);
  const [hasFetchedSchema, setHasFetchedSchema] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Lazy schema fetch: only when user switches to "selective" mode ─
  useEffect(() => {
    if (!open || dataMode !== "selective" || hasFetchedSchema) {
      return;
    }
    let cancelled = false;
    setIsLoadingSchema(true);
    ipc.client.db
      .getSchemaSummary({ id: connectionId })
      .then((summary) => {
        if (cancelled) {
          return;
        }
        // Only user tables (skip system schemas)
        const userTables = summary.tables.filter(
          (t: SchemaTableSummary) =>
            !["information_schema", "pg_catalog", "pg_toast"].includes(t.schema)
        );
        setTableItems(
          userTables.map((t: SchemaTableSummary) => ({
            checked: true,
            estimatedRowCount: t.estimated_row_count,
            schema: t.schema,
            table: t.name,
          }))
        );
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setTableItems([]);
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingSchema(false);
          setHasFetchedSchema(true);
        }
      });
    return () => {
      cancelled = true;
    };
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
    [tableItems]
  );
  const allChecked =
    tableItems.length > 0 && checkedCount === tableItems.length;

  const toggleTable = useCallback((schema: string, table: string) => {
    setTableItems((prev) =>
      prev.map((t) =>
        t.schema === schema && t.table === table
          ? { ...t, checked: !t.checked }
          : t
      )
    );
  }, []);

  const toggleAll = useCallback(() => {
    setTableItems((prev) => prev.map((t) => ({ ...t, checked: !allChecked })));
  }, [allChecked]);

  const nameError =
    name.length > 63
      ? "Name must be 63 characters or less"
      : branches.some((b) => b.name === name)
        ? `Branch "${name}" already exists`
        : null;

  const canCreate =
    name.length > 0 &&
    !nameError &&
    !isCreating &&
    !(dataMode === "selective" && isLoadingSchema);

  const handleCreate = useCallback(async () => {
    if (!canCreate) {
      return;
    }
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
        dataTables,
        description: description || undefined,
        name,
        parentBranchId: parentBranchId || undefined,
      });
      setOpen(false);
      setName("");
      setDescription("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create branch");
    } finally {
      setIsCreating(false);
    }
  }, [
    canCreate,
    name,
    description,
    parentBranchId,
    dataMode,
    tableItems,
    onCreate,
  ]);

  // Build the trigger element: Button ← DialogTrigger, optionally wrapped
  // in TooltipTrigger for hover labels.
  const triggerElement = (
    <DialogTrigger
      render={
        <Button
          className="text-muted-foreground hover:text-foreground"
          size="icon-xs"
          variant="ghost"
        />
      }
    >
      <Icon className="size-3.5" name="plus" />
    </DialogTrigger>
  );

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      {tooltipLabel ? (
        <Tooltip>
          <TooltipTrigger render={triggerElement} />
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
            <Icon className="size-4 text-muted-foreground" name="plus" />
            Create Branch
          </DialogTitle>
          <DialogDescription className="select-text">
            Create a new branch from{" "}
            <span className="font-medium text-foreground">{localDbName}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Branch name */}
          <div className="space-y-1.5">
            <Label className="font-medium text-xs" htmlFor="branch-name">
              Branch name
            </Label>
            <Input
              className={cn(nameError && "border-destructive")}
              id="branch-name"
              maxLength={63}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canCreate) {
                  handleCreate();
                }
              }}
              placeholder="e.g., feature/add-uuid-column"
              value={name}
            />
            {nameError && (
              <p className="select-text text-destructive text-xs">
                {nameError}
              </p>
            )}
          </div>

          {/* Parent branch */}
          {branches.length > 1 && (
            <div className="space-y-1.5">
              <Label className="font-medium text-xs">Branch from</Label>
              <div className="flex flex-wrap gap-1.5">
                {branches.map((branch) => (
                  <button
                    className={cn(
                      "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors",
                      parentBranchId === branch.id
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:border-primary/50"
                    )}
                    key={branch.id}
                    onClick={() => setParentBranchId(branch.id)}
                    type="button"
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
            <Label className="font-medium text-xs" htmlFor="branch-description">
              Description{" "}
              <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              className="resize-none text-sm"
              id="branch-description"
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this branch is for..."
              rows={2}
              value={description}
            />
          </div>

          {/* Divider */}
          <div className="border-t" />

          {/* Data mode toggle */}
          <div className="space-y-2.5">
            <Label className="font-medium text-xs">Data to include</Label>
            <div className="inline-flex w-full rounded-md border border-border bg-muted/30 p-0.5">
              <button
                className={cn(
                  "inline-flex flex-1 items-center justify-center gap-1.5 rounded-sm px-2 py-1.5 font-medium text-[11px] transition-colors",
                  dataMode === "all"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
                onClick={() => setDataMode("all")}
                type="button"
              >
                <Icon className="size-3" name="database" />
                All data
              </button>
              <button
                className={cn(
                  "inline-flex flex-1 items-center justify-center gap-1.5 rounded-sm px-2 py-1.5 font-medium text-[11px] transition-colors",
                  dataMode === "schema_only"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
                onClick={() => setDataMode("schema_only")}
                type="button"
              >
                <Icon className="size-3" name="file-code" />
                Schema only
              </button>
              <button
                className={cn(
                  "inline-flex flex-1 items-center justify-center gap-1.5 rounded-sm px-2 py-1.5 font-medium text-[11px] transition-colors",
                  dataMode === "selective"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
                onClick={() => setDataMode("selective")}
                type="button"
              >
                <Icon className="size-3" name="filter" />
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
                Only schema structure (tables, indexes, constraints) will be
                included. No row data will be copied.
              </div>
            )}

            {dataMode === "selective" && (
              isLoadingSchema ? (
                  <div className="flex items-center justify-center gap-2 py-6">
                    <Icon
                      className="size-4 animate-spin text-muted-foreground"
                      name="loader"
                    />
                    <span className="text-[11px] text-muted-foreground">
                      Loading tables…
                    </span>
                  </div>
                ) : tableItems.length === 0 ? (
                  <div className="py-4 text-center">
                    <p className="text-[11px] text-muted-foreground">
                      No user tables found.
                    </p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground/70">
                      This will create a schema-only branch.
                    </p>
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-md border">
                    {/* Select-all header */}
                    <div className="flex items-center gap-2.5 border-b bg-muted/30 px-3 py-1.5">
                      <Checkbox
                        checked={allChecked}
                        id="branch-select-all"
                        onCheckedChange={toggleAll}
                      />
                      <Label
                        className="flex-1 cursor-pointer font-medium text-[11px]"
                        htmlFor="branch-select-all"
                      >
                        Select all
                      </Label>
                      <span className="text-[10px] text-muted-foreground tabular-nums">
                        {checkedCount}/{tableItems.length}
                      </span>
                    </div>

                    {/* Table list */}
                    <ScrollArea className="h-48">
                      <div className="divide-y divide-border/40">
                        {tableItems.map((t) => (
                          <label
                            className={cn(
                              "flex cursor-pointer items-center gap-2.5 px-3 py-1.5 transition-colors hover:bg-muted/30",
                              !t.checked && "text-muted-foreground"
                            )}
                            key={`${t.schema}.${t.table}`}
                          >
                            <Checkbox
                              checked={t.checked}
                              onCheckedChange={() =>
                                toggleTable(t.schema, t.table)
                              }
                            />
                            <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
                              <span className="text-muted-foreground">
                                {t.schema}.
                              </span>
                              {t.table}
                            </span>
                            <span className="shrink-0 text-[10px] text-muted-foreground/60 tabular-nums">
                              {t.estimatedRowCount === 0
                                ? "—"
                                : formatRowCount(t.estimatedRowCount)}
                            </span>
                          </label>
                        ))}
                      </div>
                    </ScrollArea>

                    {/* Selection note */}
                    {checkedCount === 0 ? (
                      <div className="border-t bg-muted/20 px-3 py-1.5">
                        <p className="text-[10px] text-muted-foreground leading-relaxed">
                          No tables selected — only schema structure will be
                          created, no row data will be copied.
                        </p>
                      </div>
                    ) : checkedCount < tableItems.length ? (
                      <div className="border-t bg-muted/20 px-3 py-1.5">
                        <p className="text-[10px] text-muted-foreground leading-relaxed">
                          Selected tables will include row data. Unselected
                          tables will be schema-only (empty structure).
                        </p>
                      </div>
                    ) : null}
                  </div>
                )
            )}
          </div>

          {/* Info note */}
          <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
            <p className="text-muted-foreground text-xs leading-relaxed">
              The branch will be created as a copy of the{" "}
              <Badge
                className="ml-0.5 h-4 px-1 font-mono text-[10px]"
                variant="outline"
              >
                {branches.find((b) => b.id === parentBranchId)?.name ?? "main"}
              </Badge>{" "}
              branch using PostgreSQL template databases.
              {dataMode === "all"
                ? " Schema and data are included by default."
                : dataMode === "schema_only"
                  ? " Schema structure only — no row data will be copied."
                  : ` ${checkedCount} table${checkedCount === 1 ? "" : "s"} will include data, the rest will be schema-only.`}
            </p>
          </div>

          {/* Error */}
          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-xs">
              {error}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <Button
            disabled={isCreating}
            onClick={() => setOpen(false)}
            size="sm"
            variant="outline"
          >
            Cancel
          </Button>
          <Button disabled={!canCreate} onClick={handleCreate} size="sm">
            {isCreating ? (
              <>
                <Icon className="mr-1.5 size-3.5 animate-spin" name="loader" />
                Creating...
              </>
            ) : (
              <>
                <Icon className="mr-1.5 size-3.5" name="plus" />
                Create Branch
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
