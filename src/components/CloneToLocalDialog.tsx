import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Icon } from "@/components/ui/Icon";
import type { Connection, TableRowCount } from "@/ipc/db/types";
import type { CloneToLocalProgress } from "@/hooks/useCloneToLocal";
import { cn } from "@/utils/tailwind";

// ── Constants ──────────────────────────────────────────────────────────

const POSTGRES_VERSIONS = [
  { value: "18.3.0", label: "PostgreSQL 18" },
  { value: "17.9.0", label: "PostgreSQL 17" },
  { value: "16.13.0", label: "PostgreSQL 16" },
  { value: "15.17.0", label: "PostgreSQL 15" },
  { value: "14.22.0", label: "PostgreSQL 14" },
];

interface TableSelection {
  schema: string;
  table: string;
  rowCount: number;
  importData: boolean;
}

// ── Main component ─────────────────────────────────────────────────────

interface CloneToLocalDialogProps {
  isOpen: boolean;
  onClose: () => void;
  sourceConnection: Connection | null;
  tableRowCounts: TableRowCount[];
  isLoadingSchema: boolean;
  onStartClone: (
    targetName: string,
    selectedTables: { schema: string; table: string; importData: boolean }[],
    postgresVersion: string,
  ) => void;
  onCancelClone: () => void;
  progress: CloneToLocalProgress | null;
  isCloning: boolean;
  error: string | null;
}

export function CloneToLocalDialog({
  isOpen,
  onClose,
  sourceConnection,
  tableRowCounts,
  isLoadingSchema,
  onStartClone,
  onCancelClone,
  progress,
  isCloning,
  error,
}: CloneToLocalDialogProps) {
  const [targetName, setTargetName] = useState("");
  const [postgresVersion, setPostgresVersion] = useState("16.13.0");
  const [tableSelections, setTableSelections] = useState<TableSelection[]>([]);
  const [cloneMode, setCloneMode] = useState<"schema_and_data" | "schema_only">("schema_and_data");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const selectedCount = useMemo(
    () => tableSelections.filter((t) => t.importData).length,
    [tableSelections],
  );
  const allSelected = tableSelections.length > 0 && selectedCount === tableSelections.length;
  const isSchemaOnly = cloneMode === "schema_only";

  useEffect(() => {
    if (!isCloning) {
      setElapsedSeconds(0);
      return;
    }
    const timer = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [isCloning]);

  // Initialize table selections when schema is loaded
  useEffect(() => {
    if (tableRowCounts.length > 0) {
      setTableSelections(
        tableRowCounts.map((t) => ({
          schema: t.schema,
          table: t.table,
          rowCount: t.rowCount,
          importData: true,
        })),
      );
    }
  }, [tableRowCounts]);

  // Generate default target name based on source connection
  useEffect(() => {
    if (sourceConnection && !targetName) {
      const baseName = sourceConnection.name || "Database";
      const timestamp = new Date().toISOString().slice(0, 10);
      setTargetName(`${baseName} (Clone ${timestamp})`);
    }
  }, [sourceConnection]);

  const handleToggleTable = (schema: string, table: string) => {
    setTableSelections((prev) =>
      prev.map((t: TableSelection) =>
        t.schema === schema && t.table === table
          ? { ...t, importData: !t.importData }
          : t,
      ),
    );
  };

  const handleToggleAll = () => {
    const newValue = !allSelected;
    setTableSelections((prev) => prev.map((t) => ({ ...t, importData: newValue })));
  };

  const handleStartClone = () => {
    const selectedTables = isSchemaOnly
      ? tableSelections.map((t) => ({
          schema: t.schema,
          table: t.table,
          importData: false,
        }))
      : tableSelections.map((t) => ({
          schema: t.schema,
          table: t.table,
          importData: t.importData,
        }));
    onStartClone(targetName, selectedTables, postgresVersion);
  };

  const totalRowsToImport = useMemo(
    () => tableSelections.filter((t) => t.importData).reduce((sum, t) => sum + t.rowCount, 0),
    [tableSelections],
  );

  const formatNumber = (num: number): string => {
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(1)}k`;
    return num.toString();
  };

  const getProgressPercentage = () => {
    if (!progress || progress.totalTables === 0) return 0;
    if (progress.stage === "schema") return Math.min(35, 10 + elapsedSeconds * 0.8);
    if (progress.stage === "data") return 10 + (progress.tablesProcessed / progress.totalTables) * 70;
    if (progress.stage === "indexes") return 80;
    if (progress.stage === "constraints") return 90;
    if (progress.stage === "complete") return 100;
    return 0;
  };

  const isComplete = progress?.stage === "complete";
  const hasError = progress?.stage === "error" || error !== null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !isCloning && onClose()}>
      <DialogContent className="sm:max-w-[520px] max-h-[90vh] p-0 gap-0 flex flex-col">
        {/* Header — fixed */}
        <div className="p-5 pb-0 shrink-0">
          <DialogHeader className="gap-1">
            <DialogTitle className="flex items-center gap-2">
              <Icon name="hard-drive" className="size-4 text-muted-foreground" />
              Clone to Local Database
            </DialogTitle>
            {sourceConnection && (
              <p className="text-xs text-muted-foreground">
                Source: <span className="font-medium text-foreground">{sourceConnection.name}</span>
              </p>
            )}
          </DialogHeader>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!isCloning && !isComplete && !hasError) handleStartClone();
          }}
          className="flex flex-col flex-1 min-h-0"
        >
          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto">
            <div className="flex flex-col gap-5 p-5">
              {isLoadingSchema ? (
                <div className="flex flex-col items-center justify-center py-8 gap-3">
                  <Icon name="loader" className="size-6 animate-spin text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">Loading schema information...</p>
                </div>
              ) : isCloning || isComplete || hasError ? (
                /* ── Progress phase ─────────────────────────────────── */
                <div className="flex flex-col gap-4">
                  {/* Progress bar */}
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">
                        {progress?.stage === "complete"
                          ? "Clone completed!"
                          : progress?.stage === "error"
                            ? "Clone failed"
                            : progress?.message || "Processing..."}
                      </span>
                      <span className="font-medium tabular-nums">{Math.round(getProgressPercentage())}%</span>
                    </div>
                    <Progress value={getProgressPercentage()} className="h-1.5" />
                    {isCloning && progress?.stage === "schema" && (
                      <p className="text-[11px] text-muted-foreground">
                        This step can take a while for large databases ({elapsedSeconds}s elapsed).
                      </p>
                    )}
                  </div>

                  {/* Status details */}
                  <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Tables</span>
                      <span className="font-medium tabular-nums">
                        {progress?.tablesProcessed || 0} / {progress?.totalTables || 0}
                      </span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Rows imported</span>
                      <span className="font-medium tabular-nums">{formatNumber(progress?.rowsProcessed || 0)}</span>
                    </div>
                    {progress?.currentTable && (
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Current</span>
                        <span className="font-mono font-medium">{progress.currentTable}</span>
                      </div>
                    )}
                  </div>

                  {/* Error */}
                  {hasError && (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 flex items-start gap-2.5">
                      <Icon name="alert-circle" className="size-4 shrink-0 mt-px text-destructive" />
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-destructive">Clone failed</p>
                        <p className="text-[11px] text-muted-foreground">{error || progress?.message}</p>
                      </div>
                    </div>
                  )}

                  {/* Success */}
                  {isComplete && (
                    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5 flex items-start gap-2.5">
                      <Icon name="check" className="size-4 shrink-0 mt-px text-emerald-600 dark:text-emerald-400" />
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                          Database cloned successfully!
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {formatNumber(progress?.rowsProcessed || 0)} rows imported across{" "}
                          {progress?.totalTables} tables.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                /* ── Form phase ─────────────────────────────────────── */
                <>
                  {/* ── Target section ──────────────────────────────── */}
                  <div className="flex flex-col gap-3.5">
                    <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                      Target
                    </span>

                    <div className="flex flex-col gap-1">
                      <Label htmlFor="clone-target-name" className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                        Local Database Name
                      </Label>
                      <Input
                        id="clone-target-name"
                        value={targetName}
                        onChange={(e) => setTargetName(e.target.value)}
                        placeholder="My Cloned Database"
                        className="h-7"
                      />
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="clone-pg-version" className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                        PostgreSQL Version
                      </Label>
                      <Select value={postgresVersion} onValueChange={(v) => v && setPostgresVersion(v)}>
                        <SelectTrigger id="clone-pg-version" className="h-7 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {POSTGRES_VERSIONS.map((v) => (
                            <SelectItem key={v.value} value={v.value}>
                              {v.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Divider */}
                  <div className="border-t" />

                  {/* ── Configuration section ──────────────────────── */}
                  <div className="flex flex-col gap-3.5">
                    <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                      Configuration
                    </span>

                    {/* Clone mode — pill-style toggle */}
                    <div className="flex flex-col gap-1.5">
                      <Label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                        Mode
                      </Label>
                      <div className="inline-flex w-full rounded-md border border-border bg-muted/30 p-0.5">
                        <button
                          type="button"
                          className={cn(
                            "flex-1 inline-flex items-center justify-center gap-1.5 rounded-sm px-2.5 py-1.5 text-[11px] font-medium transition-colors",
                            cloneMode === "schema_and_data"
                              ? "bg-background text-foreground shadow-sm"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                          onClick={() => setCloneMode("schema_and_data")}
                        >
                          <Icon name="database" className="size-3" />
                          Schema + Data
                        </button>
                        <button
                          type="button"
                          className={cn(
                            "flex-1 inline-flex items-center justify-center gap-1.5 rounded-sm px-2.5 py-1.5 text-[11px] font-medium transition-colors",
                            cloneMode === "schema_only"
                              ? "bg-background text-foreground shadow-sm"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                          onClick={() => setCloneMode("schema_only")}
                        >
                          <Icon name="file-code" className="size-3" />
                          Schema Only
                        </button>
                      </div>
                    </div>

                    {/* Schema-only notice */}
                    {isSchemaOnly && (
                      <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
                        Only the schema structure (tables, indexes, constraints) will be cloned. No row data will be
                        imported.
                        <span className="block mt-1">{tableSelections.length} tables will be created.</span>
                      </div>
                    )}
                  </div>

                  {/* ── Tables section (only in schema_and_data mode) ── */}
                  {!isSchemaOnly && (
                    <>
                      <div className="border-t" />
                      <div className="flex flex-col gap-3.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                            Tables
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {selectedCount}/{tableSelections.length} selected · ~{formatNumber(totalRowsToImport)} rows
                          </span>
                        </div>

                        <div className="border rounded-md overflow-hidden">
                          {/* Select all header */}
                          <div className="bg-muted/30 px-3 py-1.5 border-b flex items-center gap-2.5">
                            <Checkbox
                              id="clone-select-all"
                              checked={allSelected}
                              onCheckedChange={handleToggleAll}
                            />
                            <Label htmlFor="clone-select-all" className="text-[11px] font-medium cursor-pointer">
                              Select All
                            </Label>
                          </div>

                          {/* Table list */}
                          <div className="overflow-auto max-h-[200px]">
                            <Table>
                              <TableHeader className="sticky top-0 bg-background">
                                <TableRow>
                                  <TableHead className="w-[32px]" />
                                  <TableHead className="text-[11px]">Table</TableHead>
                                  <TableHead className="text-right text-[11px]">Rows</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {tableSelections.map((table) => (
                                  <TableRow key={`${table.schema}.${table.table}`}>
                                    <TableCell>
                                      <Checkbox
                                        checked={table.importData}
                                        onCheckedChange={() =>
                                          handleToggleTable(table.schema, table.table)
                                        }
                                      />
                                    </TableCell>
                                    <TableCell>
                                      <span className="font-mono text-[11px]">
                                        <span className="text-muted-foreground">{table.schema}.</span>
                                        {table.table}
                                      </span>
                                    </TableCell>
                                    <TableCell className="text-right font-mono text-[11px] tabular-nums">
                                      {formatNumber(table.rowCount)}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Footer — fixed */}
          <div className="flex items-center justify-end gap-2 border-t bg-muted/50 px-5 py-3 shrink-0">
            {isCloning ? (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={onCancelClone}
                className="h-7 text-xs gap-1"
              >
                <Icon name="x-circle" className="size-3" />
                Cancel Clone
              </Button>
            ) : isComplete || hasError ? (
              <Button type="button" size="sm" onClick={onClose} className="h-7 text-xs">
                {hasError ? "Close" : "Done"}
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onClose}
                  className="h-7 px-2 text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={!targetName.trim() || (!isSchemaOnly && selectedCount === 0)}
                  className="h-7 text-xs gap-1"
                >
                  <Icon name="database" className="size-3" />
                  {isSchemaOnly ? "Clone Schema Only" : `Clone ${selectedCount} Tables`}
                </Button>
              </>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
