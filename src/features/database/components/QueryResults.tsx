import { useCallback, useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/Icon";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { QueryResult } from "@/ipc/db/types";
import { cn, formatDuration } from "@/lib/utils";

interface QueryResultsProps {
  durationMs?: number;
  error: string | null;
  isFixingWithAi?: boolean;
  onFixWithAi?: () => void;
  result: QueryResult | null;
}

/* ─── helpers ──────────────────────────────────────────────────────── */

function formatCellValue(cell: unknown): string {
  if (cell === null || cell === undefined) {
    return "NULL";
  }
  if (typeof cell === "boolean") {
    return cell ? "true" : "false";
  }
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
      .join(",")
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
    row.map((cell) => formatCellValue(cell))
  );
  const sheetData = [header, ...rows];
  const sheet = XLSX.utils.aoa_to_sheet(sheetData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Results");
  const rawBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
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
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        render={
          <button
            className="relative z-[2] flex select-none items-center gap-1 rounded px-1 py-0.5 text-muted-foreground text-xs opacity-0 transition-opacity hover:text-foreground group-hover/cell:opacity-100"
            title="Expand cell"
            type="button"
          >
            <Icon className="size-3" name="arrows-maximize" />
          </button>
        }
      />
      <PopoverContent
        align="start"
        className="w-[min(480px,90vw)] gap-0 overflow-hidden p-0"
        side="bottom"
        sideOffset={4}
      >
        <div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-medium font-mono text-xs">
              {columnName}
            </span>
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {columnType}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              onClick={() => copyToClipboard(text)}
              size="icon-xs"
              title="Copy value"
              variant="ghost"
            >
              <Icon className="size-3" name="copy" />
            </Button>
            <Button
              onClick={() => setOpen(false)}
              size="icon-xs"
              variant="ghost"
            >
              <Icon className="size-3" name="x" />
            </Button>
          </div>
        </div>
        <ScrollArea className="max-h-[320px]">
          <pre
            className={cn(
              "select-text whitespace-pre-wrap break-all p-3 font-mono text-xs leading-5",
              isNull && "text-muted-foreground italic"
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
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );

  const handleCopyCell = useCallback(
    (rowIdx: number, colIdx: number, value: unknown) => {
      const key = `${rowIdx}-${colIdx}`;
      copyToClipboard(formatCellValue(value));
      setCopiedCell(key);
      clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopiedCell(null), 1200);
    },
    []
  );

  useEffect(() => () => clearTimeout(copiedTimerRef.current), []);

  // ── Error state ──────────────────────────────────────────────────
  if (error) {
    const errorLines = error
      .split("|")
      .map((line) => line.trim())
      .filter(Boolean);

    return (
      <div className="h-full min-h-0 border-destructive/50 border-l-2 bg-destructive/5 px-3 py-2">
        <div className="flex items-start gap-2">
          <Icon
            className="mt-0.5 size-3.5 shrink-0 text-destructive"
            name="x"
          />
          <div className="min-w-0 flex-1">
            {errorLines.length > 0 ? (
              <div className="space-y-0.5">
                {errorLines.map((line, idx) => (
                  <code
                    className={cn(
                      "block select-text break-all font-mono text-xs leading-5",
                      idx === 0 ? "text-destructive" : "text-destructive/85"
                    )}
                    key={`${line}-${idx}`}
                  >
                    {line}
                  </code>
                ))}
              </div>
            ) : (
              <code className="block select-text break-all font-mono text-destructive/90 text-xs leading-5">
                {error}
              </code>
            )}
          </div>
          {durationMs !== undefined && (
            <span className="shrink-0 font-mono text-[10px] text-destructive/60">
              {formatDuration(durationMs)}
            </span>
          )}
        </div>
        {onFixWithAi && (
          <div className="mt-2">
            <Button
              disabled={isFixingWithAi}
              onClick={onFixWithAi}
              size="xs"
              variant="outline"
            >
              <Icon
                className={cn("size-3", isFixingWithAi && "animate-spin")}
                name={isFixingWithAi ? "loader" : "wand"}
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
      <div className="flex h-full min-h-0 flex-col items-center justify-center py-12 text-muted-foreground/60">
        <Icon
          className="mb-2 size-5 text-muted-foreground/40"
          name="terminal"
        />
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
            <Icon className="size-3.5 shrink-0" name="circle-check" />
            <span className="select-text font-medium text-xs">
              {result.row_count > 0
                ? `${result.row_count.toLocaleString()} ${result.row_count === 1 ? "row" : "rows"} affected`
                : "Statement executed successfully"}
            </span>
            {durationMs !== undefined && (
              <span className="ml-auto select-text font-mono text-[10px] text-emerald-700/70 dark:text-emerald-300/70">
                {formatDuration(durationMs)}
              </span>
            )}
          </div>
          <p className="mt-1 select-text text-[11px] text-muted-foreground">
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
            <Icon
              className="size-3.5 shrink-0 text-emerald-500"
              name="circle-check"
            />
            <span className="select-text font-medium text-xs">
              0 rows returned
            </span>
            <span className="text-[10px] text-muted-foreground/50">·</span>
            <span className="select-text text-muted-foreground/70 text-xs">
              {result.columns.length}{" "}
              {result.columns.length === 1 ? "column" : "columns"}
            </span>
            {durationMs !== undefined && (
              <span className="ml-auto select-text font-mono text-[10px] text-muted-foreground/60">
                {formatDuration(durationMs)}
              </span>
            )}
          </div>
          <p className="mt-1 select-text text-[11px] text-muted-foreground">
            Query executed successfully, but no records matched your filters.
          </p>
        </div>
      </div>
    );
  }

  // ── Results table ────────────────────────────────────────────────
  const colCount = result.columns.length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ── Truncation warning ──────────────────────────────────── */}
      {result.truncated && (
        <div className="flex items-center gap-2 border-amber-500/30 border-b bg-amber-500/5 px-3 py-1.5">
          <Icon
            className="size-3.5 shrink-0 text-amber-500"
            name="triangle-alert"
          />
          <span className="select-text text-amber-600 text-xs dark:text-amber-400">
            Results truncated to {result.row_count.toLocaleString()} rows
            (total: {result.totalRowCount?.toLocaleString()}). Add a LIMIT
            clause to reduce the result set.
          </span>
        </div>
      )}

      {/* ── Toolbar header ──────────────────────────────────────── */}
      <div className="flex items-center gap-2 border-border/50 border-b px-3 py-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-emerald-500">✓</span>
          <span className="select-text text-muted-foreground text-xs">
            {result.row_count.toLocaleString()}{" "}
            {result.row_count === 1 ? "row" : "rows"}
          </span>
        </div>

        <span className="text-[10px] text-muted-foreground/50">·</span>

        <span className="select-text text-muted-foreground/70 text-xs">
          {colCount} {colCount === 1 ? "column" : "columns"}
        </span>

        {durationMs !== undefined && (
          <>
            <span className="text-[10px] text-muted-foreground/50">·</span>
            <span className="select-text font-mono text-muted-foreground/70 text-xs">
              {formatDuration(durationMs)}
            </span>
          </>
        )}

        <div className="ml-auto flex items-center gap-1">
          <Button
            onClick={() => exportAsCsv(result)}
            size="xs"
            title="Export as CSV"
            variant="ghost"
          >
            <Icon className="size-3" name="download" />
            CSV
          </Button>
          <Button
            onClick={() => exportAsJson(result)}
            size="xs"
            title="Export as JSON"
            variant="ghost"
          >
            <Icon className="size-3" name="download" />
            JSON
          </Button>
          <Button
            onClick={() => exportAsXlsx(result)}
            size="xs"
            title="Export as Excel (XLSX)"
            variant="ghost"
          >
            <Icon className="size-3" name="download" />
            XLSX
          </Button>
        </div>
      </div>

      {/* ── Table container ─────────────────────────────────────── */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="min-w-full">
          <table className="w-full border-collapse text-xs">
            {/* ── Column headers ────────────────────────────────── */}
            <thead className="sticky top-0 z-10 bg-background">
              <tr className="border-border/50 border-b bg-background">
                {/* Row # column */}
                <th
                  className="h-7 w-10 min-w-[2.5rem] border-border/30 border-r bg-background px-2 text-center font-medium font-mono text-[10px] text-muted-foreground/50"
                  scope="col"
                >
                  #
                </th>
                {result.columns.map((col) => (
                  <th
                    className="h-7 whitespace-nowrap border-border/30 border-r px-3 text-left font-medium last:border-r-0"
                    key={col.name}
                    scope="col"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-muted-foreground text-xs">
                        {col.name}
                      </span>
                      <Badge
                        className="h-4 select-text rounded py-0 font-mono font-normal text-[9px] leading-none"
                        variant="secondary"
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
                  className="border-border/30 border-b last:border-b-0 hover:bg-muted/40"
                  key={rowIdx}
                >
                  {/* Row number */}
                  <td className="h-6 w-10 min-w-[2.5rem] border-border/30 border-r bg-muted/10 px-2 text-center font-mono text-[10px] text-muted-foreground/60">
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
                        className={cn(
                          "group/cell relative h-6 max-w-[240px] truncate whitespace-nowrap border-border/30 border-r px-3 font-mono text-xs last:border-r-0",
                          isNull && "text-muted-foreground/60 italic",
                          isNum && "text-right text-foreground/90 tabular-nums",
                          isBool && "text-center",
                          isJson && "text-muted-foreground",
                          !(isNull || isNum || isBool || isJson) &&
                            "text-foreground/90",
                          isCopied && "bg-primary/10"
                        )}
                        key={cellIdx}
                        title={text}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="select-text truncate">
                            {isNull ? (
                              "NULL"
                            ) : isBool ? (
                              <Badge
                                className={cn(
                                  "h-4 rounded px-1.5 font-mono text-[10px] leading-none",
                                  cell === true
                                    ? "border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                                    : "border-destructive/30 text-destructive/70"
                                )}
                                variant={
                                  cell === true ? "outline" : "secondary"
                                }
                              >
                                {String(cell)}
                              </Badge>
                            ) : (
                              text
                            )}
                          </span>
                          <span className="flex shrink-0 items-center">
                            {isCopied ? (
                              <span className="font-medium text-[10px] text-primary">
                                copied
                              </span>
                            ) : (
                              <CellExpandDialog
                                columnName={col.name}
                                columnType={col.type_name}
                                value={cell}
                              />
                            )}
                          </span>
                        </div>

                        {/* Click target for copying (below expand button via z-index) */}
                        <button
                          className="absolute inset-0 z-[1] cursor-default select-none"
                          onDoubleClick={() =>
                            handleCopyCell(rowIdx, cellIdx, cell)
                          }
                          title="Double-click to copy value"
                          type="button"
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
