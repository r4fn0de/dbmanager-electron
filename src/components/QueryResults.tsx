import {
  Copy,
  Download,
  Expand,
  Table2,
  Terminal,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { QueryResult } from "@/ipc/db/types";
import { formatDuration } from "@/lib/utils";

interface QueryResultsProps {
  result: QueryResult | null;
  error: string | null;
  durationMs?: number;
}

/* ─── helpers ──────────────────────────────────────────────────────── */

function formatCellValue(cell: unknown): string {
  if (cell === null || cell === undefined) return "NULL";
  if (typeof cell === "boolean") return cell ? "true" : "false";
  if (typeof cell === "object") {
    try {
      return JSON.stringify(cell, null, 2);
    } catch {
      return String(cell);
    }
  }
  return String(cell);
}

function isNumericValue(cell: unknown): boolean {
  return typeof cell === "number";
}

function isBooleanValue(cell: unknown): boolean {
  return typeof cell === "boolean";
}

function isJsonValue(cell: unknown): boolean {
  return cell !== null && typeof cell === "object";
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {
    /* clipboard API unavailable */
  });
}

function exportAsCsv(result: QueryResult) {
  const header = result.columns.map((c) => c.name).join(",");
  const rows = result.rows.map((row) =>
    row
      .map((cell) => {
        const val = formatCellValue(cell);
        // Escape CSV: wrap in quotes if contains comma, quote, or newline
        if (val.includes(",") || val.includes('"') || val.includes("\n")) {
          return `"${val.replace(/"/g, '""')}"`;
        }
        return val;
      })
      .join(","),
  );
  const csv = [header, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "query-results.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function exportAsJson(result: QueryResult) {
  const data = result.rows.map((row) => {
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < result.columns.length; i++) {
      obj[result.columns[i].name] = row[i];
    }
    return obj;
  });
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "query-results.json";
  a.click();
  URL.revokeObjectURL(url);
}

/* ─── sub-components ───────────────────────────────────────────────── */

function CellExpandDialog({
  value,
  columnName,
  columnType,
}: {
  value: unknown;
  columnName: string;
  columnType: string;
}) {
  const [open, setOpen] = useState(false);
  const text = formatCellValue(value);
  const isNull = value === null || value === undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={(
          <button
            type="button"
            className="flex items-center gap-1 rounded px-1 py-0.5 text-xs text-muted-foreground opacity-0 transition-opacity group-hover/cell:opacity-100 hover:text-foreground relative z-[2]"
            title="Expand cell"
          >
            <Expand className="h-3 w-3" />
          </button>
        )}
      />
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={4}
        className="w-[min(480px,90vw)] gap-0 p-0 overflow-hidden"
      >
        <div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="truncate font-mono text-xs font-medium">
              {columnName}
            </span>
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {columnType}
            </span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => copyToClipboard(text)}
              title="Copy value"
            >
              <Copy className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setOpen(false)}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        </div>
        <ScrollArea className="max-h-[320px]">
          <pre
            className={`p-3 font-mono text-xs leading-5 whitespace-pre-wrap break-all ${
              isNull ? "italic text-muted-foreground" : ""
            }`}
          >
            {isNull ? "NULL" : text}
          </pre>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

/* ─── main component ───────────────────────────────────────────────── */

export function QueryResults({ result, error, durationMs }: QueryResultsProps) {
  const [copiedCell, setCopiedCell] = useState<string | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const handleCopyCell = useCallback(
    (rowIdx: number, colIdx: number, value: unknown) => {
      const key = `${rowIdx}-${colIdx}`;
      copyToClipboard(formatCellValue(value));
      setCopiedCell(key);
      clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopiedCell(null), 1200);
    },
    [],
  );

  useEffect(() => {
    return () => clearTimeout(copiedTimerRef.current);
  }, []);

  // ── Error state ──────────────────────────────────────────────────
  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-destructive/20 bg-destructive/10">
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-destructive/20">
            <X className="h-3 w-3 text-destructive" />
          </div>
          <span className="text-sm font-medium text-destructive">
            Query failed
          </span>
          {durationMs !== undefined && (
            <span className="ml-auto text-xs text-destructive/60 font-mono">
              {formatDuration(durationMs)}
            </span>
          )}
        </div>
        <div className="px-4 py-3">
          <code className="font-mono text-sm text-destructive/90 leading-6 break-all">
            {error}
          </code>
        </div>
      </div>
    );
  }

  // ── Empty / placeholder state ────────────────────────────────────
  if (!result) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted/60 mb-3">
          <Terminal className="h-5 w-5" />
        </div>
        <p className="text-sm font-medium">No results yet</p>
        <p className="text-xs mt-1 text-muted-foreground/70">
          Run a query to see results here
        </p>
      </div>
    );
  }

  // ── Success but no rows ──────────────────────────────────────────
  if (result.row_count === 0) {
    return (
      <div className="rounded-lg border border-dashed bg-muted/20 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-dashed">
          <div className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500/15">
            <span className="text-[10px] text-emerald-600 dark:text-emerald-400">
              ✓
            </span>
          </div>
          <span className="text-xs font-medium text-foreground">
            Query executed successfully
          </span>
          {durationMs !== undefined && (
            <span className="ml-auto text-xs font-mono text-muted-foreground">
              {formatDuration(durationMs)}
            </span>
          )}
        </div>
        <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
          <Table2 className="h-6 w-6 mb-2 opacity-40" />
          <p className="text-sm">No rows returned</p>
          <p className="text-xs mt-1 opacity-60">
            The query completed but returned 0 results
          </p>
        </div>
      </div>
    );
  }

  // ── Results table ────────────────────────────────────────────────
  const colCount = result.columns.length;

  return (
    <div className="rounded-lg border overflow-hidden bg-background">
      {/* ── Toolbar header ──────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30">
        <div className="flex items-center gap-1.5">
          <div className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500/15">
            <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
              ✓
            </span>
          </div>
          <span className="text-xs font-medium">
            {result.row_count.toLocaleString()}{" "}
            {result.row_count === 1 ? "row" : "rows"}
          </span>
        </div>

        <span className="text-[10px] text-muted-foreground">
          ·
        </span>

        <span className="text-xs text-muted-foreground">
          {colCount} {colCount === 1 ? "column" : "columns"}
        </span>

        {durationMs !== undefined && (
          <>
            <span className="text-[10px] text-muted-foreground">
              ·
            </span>
            <span className="text-xs font-mono text-muted-foreground">
              {formatDuration(durationMs)}
            </span>
          </>
        )}

        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="xs"
            onClick={() => exportAsCsv(result)}
            title="Export as CSV"
          >
            <Download className="h-3 w-3" />
            CSV
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => exportAsJson(result)}
            title="Export as JSON"
          >
            <Download className="h-3 w-3" />
            JSON
          </Button>
        </div>
      </div>

      {/* ── Table container ─────────────────────────────────────── */}
      <ScrollArea className="max-h-[200px]">
        <div className="min-w-full">
          <table className="w-full border-collapse text-sm">
            {/* ── Column headers ────────────────────────────────── */}
            <thead className="sticky top-0 z-10">
              <tr className="border-b bg-muted/50">
                {/* Row # column */}
                <th
                  className="h-8 w-10 min-w-[2.5rem] px-2 text-center font-mono text-[10px] font-medium text-muted-foreground/60 border-r bg-muted/30"
                  scope="col"
                >
                  #
                </th>
                {result.columns.map((col) => (
                  <th
                    key={col.name}
                    className="h-8 px-3 text-left font-medium whitespace-nowrap border-r last:border-r-0"
                    scope="col"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-foreground">
                        {col.name}
                      </span>
                      <Badge
                        variant="secondary"
                        className="h-4 rounded font-mono text-[9px] py-0 leading-none font-normal"
                      >
                        {col.type_name}
                      </Badge>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>

            {/* ── Data rows ──────────────────────────────────────── */}
            <tbody>
              {result.rows.map((row, rowIdx) => (
                <tr
                  key={rowIdx}
                  className={`border-b last:border-b-0 transition-colors hover:bg-muted/40 ${
                    rowIdx % 2 === 1 ? "bg-muted/15" : ""
                  }`}
                >
                  {/* Row number */}
                  <td className="h-7 w-10 min-w-[2.5rem] px-2 text-center font-mono text-[10px] text-muted-foreground/50 border-r bg-muted/10">
                    {rowIdx + 1}
                  </td>
                  {row.map((cell, cellIdx) => {
                    const cellKey = `${rowIdx}-${cellIdx}`;
                    const isCopied = copiedCell === cellKey;
                    const col = result.columns[cellIdx];
                    const isNull = cell === null || cell === undefined;
                    const isNum = isNumericValue(cell);
                    const isBool = isBooleanValue(cell);
                    const isJson = isJsonValue(cell);
                    const text = formatCellValue(cell);

                    return (
                      <td
                        key={cellIdx}
                        className={`group/cell h-7 px-3 font-mono text-xs whitespace-nowrap max-w-[240px] truncate border-r last:border-r-0 relative ${
                          isNull
                            ? "italic text-muted-foreground/50"
                            : isNum
                              ? "text-right tabular-nums text-foreground"
                              : isBool
                                ? "text-center"
                                : isJson
                                  ? "text-muted-foreground"
                                  : "text-foreground"
                        } ${isCopied ? "bg-primary/10" : ""}`}
                        title={text}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="truncate">
                            {isNull ? (
                              "NULL"
                            ) : isBool ? (
                              <Badge
                                variant={cell === true ? "outline" : "secondary"}
                                className={`h-4 rounded font-mono text-[10px] px-1.5 leading-none ${
                                  cell === true
                                    ? "border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                                    : "border-destructive/30 text-destructive/70"
                                }`}
                              >
                                {String(cell)}
                              </Badge>
                            ) : (
                              text
                            )}
                          </span>
                          <span className="shrink-0 flex items-center">
                            {isCopied ? (
                              <span className="text-[10px] text-primary font-medium">
                                copied
                              </span>
                            ) : (
                              <CellExpandDialog
                                value={cell}
                                columnName={col.name}
                                columnType={col.type_name}
                              />
                            )}
                          </span>
                        </div>

                        {/* Click target for copying (below expand button via z-index) */}
                        <button
                          type="button"
                          className="absolute inset-0 z-[1] cursor-default"
                          onDoubleClick={() =>
                            handleCopyCell(rowIdx, cellIdx, cell)
                          }
                          title="Double-click to copy value"
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ScrollArea>
    </div>
  );
}
