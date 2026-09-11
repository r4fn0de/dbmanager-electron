import { Button } from "@/components/ui/button";
import type { SchemaColumn } from "@/ipc/db/types";
import { cn } from "@/lib/utils";
import type { RowRecord } from "../types";
import { EditableField } from "./EditableField";

interface TableEditorRowDetailsOverlayProps {
  columns: SchemaColumn[];
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
    hasPendingChange: boolean;
  }>;
  expandedRowOutline: {
    top: number;
    left: number;
    width: number;
    height: number;
  } | null;
  hasDraftChanges?: boolean;
  onClose: () => void;
  onDiscard: () => void;
  onFieldSave: (columnName: string, rawText: string) => void;
  onSaveAll: () => void;
  primaryKey: string[];
  readOnly?: boolean;
  tableName: string;
  tableSchema: string;
}

export function TableEditorRowDetailsOverlay({
  tableSchema,
  tableName,
  primaryKey,
  columns,
  readOnly = false,
  hasDraftChanges = false,
  expandedRow,
  expandedRowFields,
  expandedRowOutline,
  onFieldSave,
  onSaveAll,
  onDiscard,
  onClose,
}: TableEditorRowDetailsOverlayProps) {
  const columnMap = new Map(columns.map((column) => [column.name, column]));

  return (
    <>
      {expandedRowOutline && (
        <div
          className="pointer-events-none fixed z-10 rounded-sm border border-primary/70"
          style={{
            height: expandedRowOutline.height,
            left: expandedRowOutline.left,
            top: expandedRowOutline.top,
            width: expandedRowOutline.width,
          }}
        />
      )}

      {expandedRow && (
        <div className="absolute inset-0 z-40">
          <button
            aria-label="Close row details"
            className="absolute inset-0 bg-background/35"
            onClick={onClose}
            type="button"
          />
          <div className="absolute inset-y-0 right-0 w-[520px] max-w-[95%] border-l bg-background shadow-2xl">
            <div className="flex h-full min-h-0 flex-col">
              <div className="border-b px-4 py-3">
                <p className="text-left font-semibold text-sm">
                  {tableSchema}.{tableName}
                </p>
                <p className="text-muted-foreground text-xs">
                  {`Row #${expandedRow.index + 1}${
                    primaryKey.length > 0
                      ? ` · PK: ${primaryKey.map((column) => String(expandedRow.row[column] ?? "NULL")).join(", ")}`
                      : ""
                  }`}
                </p>
              </div>

              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
                {expandedRowFields.map((field) => {
                  const column = columnMap.get(field.name);
                  if (!column) {
                    return null;
                  }
                  return (
                    <EditableField
                      column={column}
                      hasPendingChange={field.hasPendingChange}
                      key={field.name}
                      onSave={(rawText) => onFieldSave(field.name, rawText)}
                      readOnly={readOnly}
                      value={field.value}
                    />
                  );
                })}
              </div>

              <div className="border-t px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="relative flex min-w-0 items-center">
                    <div
                      className={cn(
                        "flex items-center gap-2 overflow-hidden transition-[opacity,transform,max-width] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
                        hasDraftChanges && !readOnly
                          ? "max-w-[400px] scale-100 opacity-100"
                          : "pointer-events-none max-w-0 scale-[0.95] opacity-0"
                      )}
                    >
                      <Button onClick={onSaveAll} size="sm">
                        Save All Changes
                      </Button>
                      <Button onClick={onDiscard} size="sm" variant="outline">
                        Discard
                      </Button>
                    </div>
                    <span
                      className={cn(
                        "whitespace-nowrap text-muted-foreground text-xs transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
                        !hasDraftChanges || readOnly
                          ? "scale-100 opacity-100"
                          : "pointer-events-none absolute scale-[0.95] opacity-0"
                      )}
                    >
                      {readOnly
                        ? "Read-only (no primary key)."
                        : "No pending changes."}
                    </span>
                  </div>
                  <Button onClick={onClose} size="sm" variant="outline">
                    Close
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
