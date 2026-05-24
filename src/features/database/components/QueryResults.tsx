import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { QueryResult } from "@/ipc/db/types";
import { formatDuration } from "@/lib/utils";
import { cn } from "@/lib/utils";
import * as XLSX from "xlsx";

interface QueryResultsProps {
  result: QueryResult | null;
  error: string | null;
  durationMs?: number;
  onFixWithAi?: () => void;
  isFixingWithAi?: boolean;
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

function exportAsXlsx(result: QueryResult) {
  const header = result.columns.map((c) => c.name);
  const rows = result.rows.map((row) =>
    row.map((cell) => formatCellValue(cell)),
  );
  const sheetData = [header, ...rows];
  const sheet = XLSX.utils.aoa_to_sheet(sheetData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Results");
  const rawBuffer = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  const buffer = new Uint8Array(rawBuffer as number[]).buffer;
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "query-results.xlsx";
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
                className="flex items-center gap-1 rounded px-1 py-0.5 text-xs text-muted-foreground opacity-0 transition-opacity group-hover/cell:opacity-100 hover:text-foreground relative z-[2] select-none"
                title="Expand cell"
              >
            <Icon name="arrows-maximize" className="size-3" />
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
              <Icon name="copy" className="size-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setOpen(false)}
            >
              <Icon name="x" className="size-3" />
            </Button>
          </div>
        </div>
        <ScrollArea className="max-h-[320px]">
          <pre
            className={cn(
              "p-3 font-mono text-xs leading-5 whitespace-pre-wrap break-all select-text",
              isNull && "italic text-muted-foreground"
            )}
          >
            {isNull ? "NULL" : text}
          </pre>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

/* ─── main component ───────────────────────────────────────────────── */

export function QueryResults({
  result,
  error,
  durationMs,
  onFixWithAi,
  isFixingWithAi = false,
}: QueryResultsProps) {
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
    const errorLines = error
      .split("|")
      .map((line) => line.trim())
      .filter(Boolean);

    return (
      <div className="h-full min-h-0 border-l-2 border-destructive/50 bg-destructive/5 px-3 py-2">
        <div className="flex items-start gap-2">
          <Icon name="x" className="mt-0.5 size-3.5 text-destructive shrink-0" />
          <div className="min-w-0 flex-1">
            {errorLines.length > 0 ? (
              <div className="space-y-0.5">
                {errorLines.map((line, idx) => (
                  <code
                    key={`${line}-${idx}`}
                    className={cn(
                      "block font-mono text-xs leading-5 break-all select-text",
                      idx === 0 ? "text-destructive" : "text-destructive/85",
                    )}
                  >
                    {line}
                  </code>
                ))}
              </div>
            ) : (
              <code className="block font-mono text-xs text-destructive/90 leading-5 break-all select-text">
                {error}
              </code>
            )}
          </div>
          {durationMs !== undefined && (
            <span className="text-[10px] text-destructive/60 font-mono shrink-0">
              {formatDuration(durationMs)}
            </span>
          )}
        </div>
        {onFixWithAi && (
          <div className="mt-2">
            <Button
              variant="outline"
              size="xs"
              onClick={onFixWithAi}
              disabled={isFixingWithAi}
            >
              <Icon
                name={isFixingWithAi ? "loader" : "wand-sparkles"}
                className={cn("size-3", isFixingWithAi && "animate-spin")}
              />
              {isFixingWithAi ? "Fixing..." : "Fix with AI"}
            </Button>
          </div>
        )}
      </div>
    );
  }

  // ── Empty / placeholder state ────────────────────────────────────
  if (!result) {
    return (
      <div className="h-full min-h-0 flex flex-col items-center justify-center py-12 text-muted-foreground/60">
        <Icon name="terminal" className="size-5 mb-2 text-muted-foreground/40" />
        <p className="text-xs">No results yet</p>
      </div>
    );
  }

  // ── Success with no result set (DDL/DML without RETURNING) ──────
  if (result.columns.length === 0) {
    return (
      <div className="h-full min-h-0 px-3 py-2">
        <div className="rounded-md border border-emerald-500/25 bg-emerald-500/5 px-3 py-2">
          <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
            <Icon name="circle-check" className="size-3.5 shrink-0" />
            <span className="text-xs font-medium select-text">
              {result.row_count > 0
                ? `${result.row_count.toLocaleString()} ${result.row_count === 1 ? "row" : "rows"} affected`
                : "Statement executed successfully"}
            </span>
            {durationMs !== undefined && (
              <span className="ml-auto text-[10px] font-mono text-emerald-700/70 dark:text-emerald-300/70 select-text">
                {formatDuration(durationMs)}
              </span>
            )}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground select-text">
            This query did not return a result set.
          </p>
        </div>
      </div>
    );
  }

  // ── Success but empty result set (SELECT with 0 rows) ────────────
  if (result.row_count === 0) {
    return (
      <div className="h-full min-h-0 px-3 py-2">
        <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2">
          <div className="flex items-center gap-2 text-muted-foreground/80">
            <Icon name="circle-check" className="size-3.5 text-emerald-500 shrink-0" />
            <span className="text-xs font-medium select-text">0 rows returned</span>
            <span className="text-[10px] text-muted-foreground/50">·</span>
            <span className="text-xs text-muted-foreground/70 select-text">
              {result.columns.length} {result.columns.length === 1 ? "column" : "columns"}
            </span>
            {durationMs !== undefined && (
              <span className="ml-auto text-[10px] font-mono text-muted-foreground/60 select-text">
                {formatDuration(durationMs)}
              </span>
            )}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground select-text">
            Query executed successfully, but no records matched your filters.
          </p>
        </div>
      </div>
    );
  }

  // ── Results table ────────────────────────────────────────────────
  const colCount = result.columns.length;

  return (
    <div className="h-full min-h-0 flex flex-col">
      {/* ── Truncation warning ──────────────────────────────────── */}
      {result.truncated && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-amber-500/30 bg-amber-500/5">
          <Icon name="triangle-alert" className="size-3.5 text-amber-500 shrink-0" />
          <span className="text-xs text-amber-600 dark:text-amber-400 select-text">
            Results truncated to {result.row_count.toLocaleString()} rows (total: {result.totalRowCount?.toLocaleString()}). Add a LIMIT clause to reduce the result set.
          </span>
        </div>
      )}

      {/* ── Toolbar header ──────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/50">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-emerald-500">✓</span>
          <span className="text-xs text-muted-foreground select-text">
            {result.row_count.toLocaleString()}{" "}
            {result.row_count === 1 ? "row" : "rows"}
          </span>
        </div>

        <span className="text-[10px] text-muted-foreground/50">
          ·
        </span>

        <span className="text-xs text-muted-foreground/70 select-text">
          {colCount} {colCount === 1 ? "column" : "columns"}
        </span>

        {durationMs !== undefined && (
          <>
            <span className="text-[10px] text-muted-foreground/50">
              ·
            </span>
            <span className="text-xs font-mono text-muted-foreground/70 select-text">
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
            <Icon name="download" className="size-3" />
            CSV
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => exportAsJson(result)}
            title="Export as JSON"
          >
            <Icon name="download" className="size-3" />
            JSON
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => exportAsXlsx(result)}
            title="Export as Excel (XLSX)"
          >
            <Icon name="download" className="size-3" />
            XLSX
          </Button>
        </div>
      </div>

      {/* ── Table container ─────────────────────────────────────── */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="min-w-full">
          <table className="w-full border-collapse text-xs">
            {/* ── Column headers ────────────────────────────────── */}
            <thead className="sticky top-0 z-10 bg-background">
              <tr className="border-b border-border/50 bg-background">
                {/* Row # column */}
                <th
                  className="h-7 w-10 min-w-[2.5rem] px-2 text-center font-mono text-[10px] font-medium text-muted-foreground/50 border-r border-border/30 bg-background"
                  scope="col"
                >
                  #
                </th>
                {result.columns.map((col) => (
                  <th
                    key={col.name}
                    className="h-7 px-3 text-left font-medium whitespace-nowrap border-r border-border/30 last:border-r-0"
                    scope="col"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-muted-foreground">
                        {col.name}
                      </span>
                      <Badge
                        variant="secondary"
                        className="h-4 rounded font-mono text-[9px] py-0 leading-none font-normal select-text"
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
                  className="border-b border-border/30 last:border-b-0 hover:bg-muted/40"
                >
                  {/* Row number */}
                  <td className="h-6 w-10 min-w-[2.5rem] px-2 text-center font-mono text-[10px] text-muted-foreground/60 border-r border-border/30 bg-muted/10">
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
                        className={cn(
                          "group/cell h-6 px-3 font-mono text-xs whitespace-nowrap max-w-[240px] truncate border-r border-border/30 last:border-r-0 relative",
                          isNull && "italic text-muted-foreground/60",
                          isNum && "text-right tabular-nums text-foreground/90",
                          isBool && "text-center",
                          isJson && "text-muted-foreground",
                          !isNull && !isNum && !isBool && !isJson && "text-foreground/90",
                          isCopied && "bg-primary/10"
                        )}
                        title={text}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="truncate select-text">
                            {isNull ? (
                              "NULL"
                            ) : isBool ? (
                              <Badge
                                variant={cell === true ? "outline" : "secondary"}
                                className={cn(
                                  "h-4 rounded font-mono text-[10px] px-1.5 leading-none",
                                  cell === true
                                    ? "border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                                    : "border-destructive/30 text-destructive/70"
                                )}
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
                          className="absolute inset-0 z-[1] cursor-default select-none"
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
