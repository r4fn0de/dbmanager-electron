"use no memo"

import { cn } from "@/lib/utils";
import { useMemo } from "react";

export interface ChatTableProps {
  /** Raw markdown table text (pipe-delimited rows) */
  markdown: string;
  /** Whether the table is still streaming in */
  isStreaming?: boolean;
  className?: string;
}

/** Parsed table structure */
interface ParsedTable {
  headers: string[];
  rows: string[][];
}

/**
 * Parses a markdown table string into headers and rows.
 * Handles alignment separators (|---|), escaped pipes, and irregular spacing.
 */
function parseMarkdownTable(raw: string): ParsedTable | null {
  const lines = raw.trim().split("\n").filter((line) => line.trim().length > 0);
  if (lines.length < 2) return null;

  const splitRow = (line: string): string[] =>
    line
      .split("|")
      .slice(1, -1) // Remove empty strings from leading/trailing |
      .map((cell) => cell.trim());

  const headers = splitRow(lines[0]);
  if (headers.length === 0) return null;

  // Verify second line is a separator (---|:---:|---:)
  const separatorPattern = /^[\s|:\-]+$/;
  if (!separatorPattern.test(lines[1])) return null;

  const rows = lines.slice(2).reduce<string[][]>((acc, line) => {
    const row = splitRow(line);
    if (row.length > 0) {
      acc.push(row);
    }
    return acc;
  }, []);
  if (rows.length === 0) return null;

  return { headers, rows };
}

/**
 * ChatTable — renders markdown tables as compact, polished inline tables
 * that blend into the AI chat conversation flow.
 *
 * Design philosophy:
 * - Compact rows (py-1) to stay proportional with chat text
 * - Muted header bg + font-medium for clear column labels
 * - No heavy borders — subtle border-border/30 for cells
 * - Monospace for values that look like IDs/numbers
 * - Horizontal scroll for wide tables in the narrow panel
 */
export function ChatTable({ markdown, isStreaming, className }: ChatTableProps) {
  const parsed = useMemo(() => parseMarkdownTable(markdown), [markdown]);

  if (!parsed) {
    // Fallback: render as preformatted text if parsing fails
    return (
      <div className={cn("overflow-x-auto rounded-lg bg-muted/20 p-3 text-xs", className)}>
        <pre className="whitespace-pre font-mono text-muted-foreground/80">{markdown}</pre>
      </div>
    );
  }

  const { headers, rows } = parsed;
  const colCount = headers.length;

  return (
    <div
      className={cn(
        "overflow-x-auto rounded-lg border border-border/10",
        className,
      )}
    >
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-border/10">
            {headers.map((header, i) => (
              <th
                key={`h-${i}`}
                className={cn(
                  "px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap",
                  i === 0 && "sticky left-0 bg-muted/30",
                )}
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr
              key={`r-${rowIndex}`}
              className={cn(
                "transition-colors duration-150 ease-out",
                "hover:bg-muted/20",
                rowIndex !== rows.length - 1 && "border-b border-border/5",
              )}
            >
              {Array.from({ length: colCount }).map((_, colIndex) => {
                const cellValue = row[colIndex] ?? "";
                const looksNumeric = /^[\d.,$€£¥%+\-eE\s]+$/.test(cellValue);
                const looksLikeId = /^[a-f0-9-]{8,}$/i.test(cellValue) || /^\d{4,}$/.test(cellValue);

                return (
                  <td
                    key={`c-${rowIndex}-${colIndex}`}
                    className={cn(
                      "px-3 py-1.5 whitespace-nowrap",
                      colIndex === 0 && "sticky left-0 bg-background",
                      looksNumeric || looksLikeId ? "font-mono tabular-nums text-muted-foreground" : "text-foreground/90",
                    )}
                  >
                    {cellValue}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 5 && (
        <div className="flex items-center justify-between border-t border-border/10 px-3 py-1.5">
          <span className="text-[10px] font-medium text-muted-foreground/50">
            {rows.length} rows
          </span>
          {isStreaming && (
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/40 animation-duration-[1.5s]" />
              <span className="inline-flex size-1.5 rounded-full bg-primary" />
            </span>
          )}
        </div>
      )}
    </div>
  );
}
