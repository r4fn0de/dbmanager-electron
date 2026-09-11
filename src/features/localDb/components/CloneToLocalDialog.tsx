import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/Icon";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Connection, TableRowCount } from "@/ipc/db/types";
import { cn } from "@/lib/utils";
import type { CloneToLocalProgress } from "../hooks/useCloneToLocal";

// ── Constants ──────────────────────────────────────────────────────────

const POSTGRES_VERSIONS = [
  { label: "PostgreSQL 18", value: "18.3.0" },
  { label: "PostgreSQL 17", value: "17.9.0" },
  { label: "PostgreSQL 16", value: "16.13.0" },
  { label: "PostgreSQL 15", value: "15.17.0" },
  { label: "PostgreSQL 14", value: "14.22.0" },
];

interface TableSelection {
  importData: boolean;
  rowCount: number;
  schema: string;
  table: string;
}

// ── Main component ─────────────────────────────────────────────────────

interface CloneToLocalDialogProps {
  clonedDatabaseName?: string;
  error: string | null;
  isCloning: boolean;
  isLoadingSchema: boolean;
  isOpen: boolean;
  onCancelClone: () => void;
  onClose: () => void;
  onOpenClonedDatabase?: () => void;
  onStartClone: (
    targetName: string,
    selectedTables: { schema: string; table: string; importData: boolean }[],
    postgresVersion: string
  ) => void;
  progress: CloneToLocalProgress | null;
  sourceConnection: Connection | null;
  tableRowCounts: TableRowCount[];
}

export function CloneToLocalDialog({
  isOpen,
  onClose,
  sourceConnection,
  tableRowCounts,
  isLoadingSchema,
  onStartClone,
  onCancelClone,
  onOpenClonedDatabase,
  clonedDatabaseName,
  progress,
  isCloning,
  error,
}: CloneToLocalDialogProps) {
  const [targetName, setTargetName] = useState("");
  const [postgresVersion, setPostgresVersion] = useState("16.13.0");
  const [tableSelections, setTableSelections] = useState<TableSelection[]>([]);
  const [cloneMode, setCloneMode] = useState<"schema_and_data" | "schema_only">(
    "schema_and_data"
  );
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const selectedCount = useMemo(
    () => tableSelections.filter((t) => t.importData).length,
    [tableSelections]
  );
  const allSelected =
    tableSelections.length > 0 && selectedCount === tableSelections.length;
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
          importData: true,
          rowCount: t.rowCount,
          schema: t.schema,
          table: t.table,
        }))
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
          : t
      )
    );
  };

  const handleToggleAll = () => {
    const newValue = !allSelected;
    setTableSelections((prev) =>
      prev.map((t) => ({ ...t, importData: newValue }))
    );
  };

  const handleStartClone = () => {
    const selectedTables = isSchemaOnly
      ? tableSelections.map((t) => ({
          importData: false,
          schema: t.schema,
          table: t.table,
        }))
      : tableSelections.map((t) => ({
          importData: t.importData,
          schema: t.schema,
          table: t.table,
        }));
    onStartClone(targetName, selectedTables, postgresVersion);
  };

  const totalRowsToImport = useMemo(
    () =>
      tableSelections
        .filter((t) => t.importData)
        .reduce((sum, t) => sum + t.rowCount, 0),
    [tableSelections]
  );

  const formatNumber = (num: number): string => {
    if (num >= 1_000_000) {
      return `${(num / 1_000_000).toFixed(1)}M`;
    }
    if (num >= 1000) {
      return `${(num / 1000).toFixed(1)}k`;
    }
    return num.toString();
  };

  const getProgressPercentage = () => {
    if (!progress || progress.totalTables === 0) {
      return 0;
    }
    if (progress.stage === "schema") {
      return Math.min(35, 10 + elapsedSeconds * 0.8);
    }
    if (progress.stage === "data") {
      return 10 + (progress.tablesProcessed / progress.totalTables) * 70;
    }
    if (progress.stage === "indexes") {
      return 80;
    }
    if (progress.stage === "constraints") {
      return 90;
    }
    if (progress.stage === "complete") {
      return 100;
    }
    return 0;
  };

  const isComplete = progress?.stage === "complete";
  const hasError = progress?.stage === "error" || error !== null;

  return (
    <Dialog
      onOpenChange={(open) => !(open || isCloning) && onClose()}
      open={isOpen}
    >
      <DialogContent className="t-resize flex max-h-[90vh] flex-col gap-0 p-0 sm:max-w-130">
        {/* Header — fixed */}
        <div className="shrink-0 p-5 pb-0">
          <DialogHeader className="gap-1">
            <DialogTitle className="flex items-center gap-2">
              <Icon
                className="size-4 text-muted-foreground"
                name="hard-drive"
              />
              Clone to Local Database
            </DialogTitle>
            {sourceConnection && (
              <p className="text-muted-foreground text-xs">
                Source:{" "}
                <span className="font-medium text-foreground">
                  {sourceConnection.name}
                </span>
              </p>
            )}
          </DialogHeader>
        </div>

        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            if (!(isCloning || isComplete || hasError)) {
              handleStartClone();
            }
          }}
        >
          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto">
            <div className="flex flex-col gap-5 p-5">
              {isLoadingSchema ? (
                <div className="flex flex-col items-center justify-center gap-3 py-8">
                  <Icon
                    className="size-6 animate-spin text-muted-foreground"
                    name="loader"
                  />
                  <p className="text-muted-foreground text-xs">
                    Loading schema information...
                  </p>
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
                      <span className="font-medium tabular-nums">
                        {Math.round(getProgressPercentage())}%
                      </span>
                    </div>
                    <Progress
                      className="h-1.5"
                      value={getProgressPercentage()}
                    />
                    {isCloning && progress?.stage === "schema" && (
                      <p className="text-[11px] text-muted-foreground">
                        This step can take a while for large databases (
                        {elapsedSeconds}s elapsed).
                      </p>
                    )}
                  </div>

                  {/* Status details */}
                  <div className="space-y-1.5 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Tables</span>
                      <span className="font-medium tabular-nums">
                        {progress?.tablesProcessed || 0} /{" "}
                        {progress?.totalTables || 0}
                      </span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">
                        Rows imported
                      </span>
                      <span className="font-medium tabular-nums">
                        {formatNumber(progress?.rowsProcessed || 0)}
                      </span>
                    </div>
                    {progress?.currentTable && (
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Current</span>
                        <span className="font-medium font-mono">
                          {progress.currentTable}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Error */}
                  {hasError && (
                    <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5">
                      <Icon
                        className="mt-px size-4 shrink-0 text-destructive"
                        name="alert-circle"
                      />
                      <div className="min-w-0">
                        <p className="font-medium text-destructive text-xs">
                          Clone failed
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {error || progress?.message}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Success */}
                  {isComplete && (
                    <div className="flex items-start gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5">
                      <Icon
                        className="mt-px size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                        name="check"
                      />
                      <div className="min-w-0">
                        <p className="font-medium text-emerald-700 text-xs dark:text-emerald-400">
                          Database cloned successfully!
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {clonedDatabaseName ? (
                            <>
                              <span className="font-medium text-foreground">
                                {clonedDatabaseName}
                              </span>{" "}
                              is ready.{" "}
                            </>
                          ) : null}
                          {formatNumber(progress?.rowsProcessed || 0)} rows
                          imported across {progress?.totalTables} tables.
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
                    <span className="font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
                      Target
                    </span>

                    <div className="flex flex-col gap-1">
                      <Label
                        className="font-medium text-[11px] text-muted-foreground uppercase tracking-wider"
                        htmlFor="clone-target-name"
                      >
                        Local Database Name
                      </Label>
                      <Input
                        className="h-7"
                        id="clone-target-name"
                        onChange={(e) => setTargetName(e.target.value)}
                        placeholder="My Cloned Database"
                        value={targetName}
                      />
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <Label
                        className="font-medium text-[11px] text-muted-foreground uppercase tracking-wider"
                        htmlFor="clone-pg-version"
                      >
                        PostgreSQL Version
                      </Label>
                      <Select
                        onValueChange={(v) => v && setPostgresVersion(v)}
                        value={postgresVersion}
                      >
                        <SelectTrigger
                          className="h-7 text-xs"
                          id="clone-pg-version"
                        >
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
                    <span className="font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
                      Configuration
                    </span>

                    {/* Clone mode — pill-style toggle */}
                    <div className="flex flex-col gap-1.5">
                      <Label className="font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
                        Mode
                      </Label>
                      <div className="inline-flex w-full rounded-md border border-border bg-muted/30 p-0.5">
                        <button
                          className={cn(
                            "inline-flex flex-1 items-center justify-center gap-1.5 rounded-sm px-2.5 py-1.5 font-medium text-[11px] transition-colors",
                            cloneMode === "schema_and_data"
                              ? "bg-background text-foreground shadow-sm"
                              : "text-muted-foreground hover:text-foreground"
                          )}
                          onClick={() => setCloneMode("schema_and_data")}
                          type="button"
                        >
                          <Icon className="size-3" name="database" />
                          Schema + Data
                        </button>
                        <button
                          className={cn(
                            "inline-flex flex-1 items-center justify-center gap-1.5 rounded-sm px-2.5 py-1.5 font-medium text-[11px] transition-colors",
                            cloneMode === "schema_only"
                              ? "bg-background text-foreground shadow-sm"
                              : "text-muted-foreground hover:text-foreground"
                          )}
                          onClick={() => setCloneMode("schema_only")}
                          type="button"
                        >
                          <Icon className="size-3" name="file-code" />
                          Schema Only
                        </button>
                      </div>
                    </div>

                    {/* Schema-only notice */}
                    {isSchemaOnly && (
                      <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
                        Only the schema structure (tables, indexes, constraints)
                        will be cloned. No row data will be imported.
                        <span className="mt-1 block">
                          {tableSelections.length} tables will be created.
                        </span>
                      </div>
                    )}
                  </div>

                  {/* ── Tables section (only in schema_and_data mode) ── */}
                  {!isSchemaOnly && (
                    <>
                      <div className="border-t" />
                      <div className="flex flex-col gap-3.5">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
                            Tables
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {selectedCount}/{tableSelections.length} selected ·
                            ~{formatNumber(totalRowsToImport)} rows
                          </span>
                        </div>

                        <div className="overflow-hidden rounded-md border">
                          {/* Select all header */}
                          <div className="flex items-center gap-2.5 border-b bg-muted/30 px-3 py-1.5">
                            <Checkbox
                              checked={allSelected}
                              id="clone-select-all"
                              onCheckedChange={handleToggleAll}
                            />
                            <Label
                              className="cursor-pointer font-medium text-[11px]"
                              htmlFor="clone-select-all"
                            >
                              Select All
                            </Label>
                          </div>

                          {/* Table list */}
                          <div className="max-h-50 overflow-auto">
                            <Table>
                              <TableHeader className="sticky top-0 bg-background">
                                <TableRow>
                                  <TableHead className="w-8" />
                                  <TableHead className="text-[11px]">
                                    Table
                                  </TableHead>
                                  <TableHead className="text-right text-[11px]">
                                    Rows
                                  </TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {tableSelections.map((table) => (
                                  <TableRow
                                    key={`${table.schema}.${table.table}`}
                                  >
                                    <TableCell>
                                      <Checkbox
                                        checked={table.importData}
                                        onCheckedChange={() =>
                                          handleToggleTable(
                                            table.schema,
                                            table.table
                                          )
                                        }
                                      />
                                    </TableCell>
                                    <TableCell>
                                      <span className="font-mono text-[11px]">
                                        <span className="text-muted-foreground">
                                          {table.schema}.
                                        </span>
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
          <div className="flex shrink-0 items-center justify-end gap-2 border-t bg-muted/50 px-5 py-3">
            {isCloning ? (
              <Button
                className="h-7 gap-1 text-xs"
                onClick={onCancelClone}
                size="sm"
                type="button"
                variant="destructive"
              >
                <Icon className="size-3" name="x-circle" />
                Cancel Clone
              </Button>
            ) : isComplete || hasError ? (
              hasError ? (
                <Button
                  className="h-7 text-xs"
                  onClick={onClose}
                  size="sm"
                  type="button"
                >
                  Close
                </Button>
              ) : (
                <>
                  <Button
                    className="h-7 px-2 text-xs"
                    onClick={onClose}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    Later
                  </Button>
                  <Button
                    className="h-7 gap-1 text-xs"
                    onClick={onOpenClonedDatabase}
                    size="sm"
                    type="button"
                  >
                    <Icon className="size-3" name="arrow-right" />
                    Open Database
                  </Button>
                </>
              )
            ) : (
              <>
                <Button
                  className="h-7 px-2 text-xs"
                  onClick={onClose}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  Cancel
                </Button>
                <Button
                  className="h-7 gap-1 text-xs"
                  disabled={
                    !targetName.trim() || (!isSchemaOnly && selectedCount === 0)
                  }
                  size="sm"
                  type="submit"
                >
                  <Icon className="size-3" name="database" />
                  {isSchemaOnly
                    ? "Clone Schema Only"
                    : `Clone ${selectedCount} Tables`}
                </Button>
              </>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
