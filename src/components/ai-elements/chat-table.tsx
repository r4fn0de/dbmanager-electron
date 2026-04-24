"use no memo"

import { cn } from "@/utils/tailwind";
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

  const rows = lines.slice(2).map(splitRow).filter((row) => row.length > 0);
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
      <div className={cn("overflow-x-auto rounded-md bg-muted/20 p-2 text-xs", className)}>
        <pre className="whitespace-pre font-mono text-muted-foreground">{markdown}</pre>
      </div>
    );
  }

  const { headers, rows } = parsed;
  const colCount = headers.length;

  return (
    <div
      className={cn(
        "overflow-x-auto rounded-md bg-muted/15",
        className,
      )}
    >
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            {headers.map((header, i) => (
              <th
                key={`h-${i}`}
                className={cn(
                  "border-b border-border/30 px-2.5 py-1.5 text-left font-medium text-foreground/80 whitespace-nowrap",
                  "bg-muted/25",
                  i === 0 && "sticky left-0 bg-muted/25",
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
                "transition-colors duration-75 ease-out",
                "hover:bg-muted/30",
                rowIndex === rows.length - 1 && "border-b-0",
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
                      "border-b border-border/20 px-2.5 py-1 whitespace-nowrap",
                      colIndex === 0 && "sticky left-0 bg-muted/10",
                      looksNumeric || looksLikeId ? "font-mono tabular-nums text-muted-foreground" : "text-foreground/85",
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
      {/* Row count indicator */}
      {rows.length > 5 && (
        <div className="flex items-center justify-between border-t border-border/20 px-2.5 py-1">
          <span className="text-[10px] text-muted-foreground/60">
            {rows.length} rows
          </span>
          {isStreaming && (
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/40 [animation-duration:1.5s]" />
              <span className="inline-flex size-1.5 rounded-full bg-primary" />
            </span>
          )}
        </div>
      )}
    </div>
  );
}
