import { Button } from "@/components/ui/button";
import { getCellTitle, normalizeDisplay } from "../utils/valueParsers";
import type { RowRecord } from "../types";

interface TableEditorRowDetailsOverlayProps {
  tableSchema: string;
  tableName: string;
  primaryKey: string[];
  expandedRow: {
    rowKey: string;
    row: RowRecord;
    index: number;
  } | null;
  expandedRowFields: Array<{
    name: string;
    type: string;
    value: unknown;
    textValue: string;
  }>;
  expandedRowOutline: {
    top: number;
    left: number;
    width: number;
    height: number;
  } | null;
  isPanelPending: boolean;
  onClose: () => void;
}

export function TableEditorRowDetailsOverlay({
  tableSchema,
  tableName,
  primaryKey,
  expandedRow,
  expandedRowFields,
  expandedRowOutline,
  isPanelPending,
  onClose,
}: TableEditorRowDetailsOverlayProps) {
  return (
    <>
      {expandedRowOutline && (
        <div
          className="pointer-events-none fixed z-10 rounded-sm border border-primary/70"
          style={{
            top: expandedRowOutline.top,
            left: expandedRowOutline.left,
            width: expandedRowOutline.width,
            height: expandedRowOutline.height,
          }}
        />
      )}

      {expandedRow && (
        <div className="absolute inset-0 z-40">
          <button
            type="button"
            aria-label="Close row details"
            className="absolute inset-0 bg-background/35"
            onClick={onClose}
          />
          <div className="absolute inset-y-0 right-0 w-[520px] max-w-[95%] border-l bg-background shadow-2xl">
            <div className="flex h-full min-h-0 flex-col">
              <div className="border-b px-4 py-3">
                <p className="text-left text-sm font-semibold">
                  {tableSchema}.{tableName}
                </p>
                <p className="text-xs text-muted-foreground">
                  {`Row #${expandedRow.index + 1}${
                    primaryKey.length > 0
                      ? ` · PK: ${primaryKey.map((column) => normalizeDisplay(expandedRow.row[column])).join(", ")}`
                      : ""
                  }`}
                </p>
              </div>

              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
                {expandedRowFields.map((field) => {
                  const value = field.value;
                  return (
                    <div key={field.name} className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-medium">{field.name}</span>
                        <span className="truncate text-[10px] text-muted-foreground">
                          {field.type}
                        </span>
                      </div>
                      <div
                        className={`max-h-40 overflow-auto rounded border bg-background px-2 py-1.5 font-mono text-xs ${
                          value === null || value === undefined ? "italic text-muted-foreground/70" : ""
                        }`}
                        title={getCellTitle(value)}
                      >
                        {field.textValue}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="border-t px-4 py-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onClose}
                  disabled={isPanelPending}
                >
                  Close
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
