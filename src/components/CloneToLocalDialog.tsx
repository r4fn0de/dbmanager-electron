import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { Database, Loader2, Check, AlertCircle, XCircle, Table2, FileCode } from "lucide-react";
import type { Connection, TableRowCount } from "@/ipc/db/types";
import type { CloneToLocalProgress } from "@/hooks/useCloneToLocal";

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

  // Derived: all selected state based on actual selections
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
    if (num >= 1_000_000) {
      return `${(num / 1_000_000).toFixed(1)}M`;
    }
    if (num >= 1_000) {
      return `${(num / 1_000).toFixed(1)}k`;
    }
    return num.toString();
  };

  const getProgressPercentage = () => {
    if (!progress || progress.totalTables === 0) return 0;
    if (progress.stage === "schema") {
      // Keep schema phase visibly moving even when source introspection is slow.
      return Math.min(35, 10 + elapsedSeconds * 0.8);
    }
    if (progress.stage === "data") {
      return 10 + (progress.tablesProcessed / progress.totalTables) * 70;
    }
    if (progress.stage === "indexes") return 80;
    if (progress.stage === "constraints") return 90;
    if (progress.stage === "complete") return 100;
    return 0;
  };

  const isComplete = progress?.stage === "complete";
  const hasError = progress?.stage === "error" || error !== null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !isCloning && onClose()}>
      <DialogContent className="sm:max-w-[650px] max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Clone to Local Database
          </DialogTitle>
          <DialogDescription>
            {sourceConnection
              ? `Clone "${sourceConnection.name}" to a new local database`
              : "Clone a remote database to your local machine"}
          </DialogDescription>
        </DialogHeader>

        {isLoadingSchema ? (
          <div className="flex flex-col items-center justify-center py-12 space-y-4">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Loading schema information...</p>
          </div>
        ) : isCloning || isComplete || hasError ? (
          <div className="py-6 space-y-6">
            {/* Progress Display */}
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  {progress?.stage === "complete"
                    ? "Clone completed!"
                    : progress?.stage === "error"
                      ? "Clone failed"
                      : progress?.message || "Processing..."}
                </span>
                <span className="font-medium">{Math.round(getProgressPercentage())}%</span>
              </div>
              <Progress value={getProgressPercentage()} className="h-2" />
              {isCloning && progress?.stage === "schema" && (
                <p className="text-xs text-muted-foreground mt-1">
                  This step can take a while for large databases ({elapsedSeconds}s elapsed).
                </p>
              )}
            </div>

            {/* Status Details */}
            <div className="bg-muted/50 rounded-lg p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Tables:</span>
                <span className="font-medium">
                  {progress?.tablesProcessed || 0} / {progress?.totalTables || 0}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Rows imported:</span>
                <span className="font-medium">{formatNumber(progress?.rowsProcessed || 0)}</span>
              </div>
              {progress?.currentTable && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Current table:</span>
                  <span className="font-medium font-mono">{progress.currentTable}</span>
                </div>
              )}
            </div>

            {/* Error Display */}
            {hasError && (
              <div className="bg-destructive/10 text-destructive rounded-lg p-4 flex items-start gap-3">
                <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">Clone failed</p>
                  <p className="text-sm opacity-90">{error || progress?.message}</p>
                </div>
              </div>
            )}

            {/* Success Display */}
            {isComplete && (
              <div className="bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 rounded-lg p-4 flex items-center gap-3">
                <Check className="h-5 w-5 shrink-0" />
                <div>
                  <p className="font-medium">Database cloned successfully!</p>
                  <p className="text-sm opacity-90">
                    {formatNumber(progress?.rowsProcessed || 0)} rows imported across{" "}
                    {progress?.totalTables} tables.
                  </p>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4 overflow-hidden flex-1 flex flex-col min-h-0">
            {/* Target Name */}
            <div className="space-y-2">
              <Label htmlFor="targetName">Local Database Name</Label>
              <Input
                id="targetName"
                value={targetName}
                onChange={(e) => setTargetName(e.target.value)}
                placeholder="My Cloned Database"
              />
            </div>

            {/* PostgreSQL Version */}
            <div className="space-y-2">
              <Label htmlFor="postgresVersion">PostgreSQL Version</Label>
              <Select value={postgresVersion} onValueChange={(v) => v && setPostgresVersion(v)}>
                <SelectTrigger id="postgresVersion">
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

            {/* Clone Mode */}
            <div className="space-y-2">
              <Label>Clone Mode</Label>
              <div className="inline-flex w-full rounded-lg border">
                <button
                  type="button"
                  className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-l-lg px-3 py-2 text-xs font-medium transition-colors ${
                    cloneMode === "schema_and_data"
                      ? "bg-primary text-primary-foreground"
                      : "bg-background text-muted-foreground hover:bg-muted/50"
                  }`}
                  onClick={() => setCloneMode("schema_and_data")}
                >
                  <Table2 className="h-3.5 w-3.5" />
                  Schema + Data
                </button>
                <button
                  type="button"
                  className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-r-lg px-3 py-2 text-xs font-medium transition-colors border-l ${
                    cloneMode === "schema_only"
                      ? "bg-primary text-primary-foreground"
                      : "bg-background text-muted-foreground hover:bg-muted/50"
                  }`}
                  onClick={() => setCloneMode("schema_only")}
                >
                  <FileCode className="h-3.5 w-3.5" />
                  Schema Only
                </button>
              </div>
            </div>

            {/* Tables Selection - only visible in schema_and_data mode */}
            {isSchemaOnly ? (
              <div className="bg-muted/50 rounded-lg p-3">
                <p className="text-sm text-muted-foreground">
                  Only the schema structure (tables, indexes, constraints) will be cloned.
                  No row data will be imported.
                </p>
                <p className="text-xs text-muted-foreground/70 mt-1">
                  {tableSelections.length} tables will be created.
                </p>
              </div>
            ) : (
            <div className="space-y-2 flex-1 min-h-0 flex flex-col">
              <div className="flex items-center justify-between">
                <Label>Tables to Import</Label>
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <span>
                    {selectedCount} of {tableSelections.length} selected
                  </span>
                  <span>~{formatNumber(totalRowsToImport)} rows</span>
                </div>
              </div>

              <div className="border rounded-md overflow-hidden flex-1 min-h-0">
                <div className="bg-muted/50 px-4 py-2 border-b flex items-center gap-3">
                  <Checkbox
                    id="selectAll"
                    checked={allSelected}
                    onCheckedChange={handleToggleAll}
                  />
                  <Label htmlFor="selectAll" className="font-medium cursor-pointer">
                    Select All
                  </Label>
                </div>

                <div className="overflow-auto max-h-[250px]">
                  <Table>
                    <TableHeader className="sticky top-0 bg-background">
                      <TableRow>
                        <TableHead className="w-[40px]"></TableHead>
                        <TableHead>Table</TableHead>
                        <TableHead className="text-right">Rows</TableHead>
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
                            <div className="font-mono text-sm">
                              <span className="text-muted-foreground">{table.schema}.</span>
                              {table.table}
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {formatNumber(table.rowCount)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          {isCloning && (
            <Button variant="destructive" size="sm" onClick={onCancelClone}>
              <XCircle className="h-4 w-4 mr-2" />
              Cancel Clone
            </Button>
          )}
          {!isCloning && !isComplete && !hasError && (
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
          )}
          {hasError && !isCloning && (
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          )}
          {isComplete ? (
            <Button onClick={onClose}>Done</Button>
          ) : !isCloning && !hasError ? (
            <Button
              onClick={handleStartClone}
              disabled={!targetName.trim() || (!isSchemaOnly && selectedCount === 0)}
            >
              <Database className="h-4 w-4 mr-2" />
              {isSchemaOnly ? "Clone Schema Only" : `Clone ${selectedCount} Tables`}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
