import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertCircle } from "lucide-react";
import type { QueryResult } from "@/ipc/db/types";

interface QueryResultsProps {
  result: QueryResult | null;
  error: string | null;
}

export function QueryResults({ result, error }: QueryResultsProps) {
  if (error) {
    return (
      <div className="p-4 border rounded-md bg-destructive/10 text-destructive flex items-start gap-2">
        <AlertCircle className="h-5 w-5 mt-0.5 shrink-0" />
        <div>
          <p className="font-medium">Query failed</p>
          <p className="text-sm opacity-90">{error}</p>
        </div>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="p-8 border rounded-md bg-muted/50 text-center text-muted-foreground">
        <p>Run a query to see results</p>
      </div>
    );
  }

  if (result.row_count === 0) {
    return (
      <div className="p-4 border rounded-md bg-muted/50 text-center text-muted-foreground">
        <p>Query executed successfully. No rows returned.</p>
      </div>
    );
  }

  return (
    <div className="border rounded-md overflow-hidden">
      <div className="bg-muted px-4 py-2 text-sm text-muted-foreground border-b">
        {result.row_count} {result.row_count === 1 ? "row" : "rows"} returned
      </div>
      <div className="max-h-[300px] overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 bg-background">
            <TableRow>
              {result.columns.map((col) => (
                <TableHead key={col.name} className="whitespace-nowrap">
                  {col.name}
                  <span className="ml-1 text-xs text-muted-foreground font-normal">
                    ({col.type_name})
                  </span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.rows.map((row, rowIndex) => (
              <TableRow key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <TableCell
                    key={cellIndex}
                    className="font-mono text-xs max-w-[200px] truncate"
                    title={String(cell ?? "NULL")}
                  >
                    {cell === null ? (
                      <span className="text-muted-foreground italic">NULL</span>
                    ) : typeof cell === "object" ? (
                      JSON.stringify(cell)
                    ) : (
                      String(cell)
                    )}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
