import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SchemaColumn } from "@/ipc/db/types";
import type { RowRecord } from "../types";
import { EditableField } from "./EditableField";

interface TableEditorRowDetailsOverlayProps {
  tableSchema: string;
  tableName: string;
  primaryKey: string[];
  columns: SchemaColumn[];
  readOnly?: boolean;
  hasDraftChanges?: boolean;
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
  onFieldSave: (columnName: string, rawText: string) => void;
  onSaveAll: () => void;
  onDiscard: () => void;
  onClose: () => void;
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
                      ? ` · PK: ${primaryKey.map((column) => String(expandedRow.row[column] ?? "NULL")).join(", ")}`
                      : ""
                  }`}
                </p>
              </div>

              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
                {expandedRowFields.map((field) => {
                  const column = columnMap.get(field.name);
                  if (!column) return null;
                  return (
                    <EditableField
                      key={field.name}
                      column={column}
                      value={field.value}
                      readOnly={readOnly}
                      hasPendingChange={field.hasPendingChange}
                      onSave={(rawText) => onFieldSave(field.name, rawText)}
                    />
                  );
                })}
              </div>

              <div className="border-t px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="relative flex items-center min-w-0">
                    <div
                      className={cn(
                        "flex items-center gap-2 overflow-hidden transition-[opacity,transform,max-width] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
                        hasDraftChanges && !readOnly
                          ? "opacity-100 scale-100 max-w-[400px]"
                          : "opacity-0 scale-[0.95] max-w-0 pointer-events-none",
                      )}
                    >
                      <Button size="sm" onClick={onSaveAll}>
                        Save All Changes
                      </Button>
                      <Button variant="outline" size="sm" onClick={onDiscard}>
                        Discard
                      </Button>
                    </div>
                    <span
                      className={cn(
                        "text-xs text-muted-foreground whitespace-nowrap transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
                        !hasDraftChanges || readOnly
                          ? "opacity-100 scale-100"
                          : "opacity-0 scale-[0.95] absolute pointer-events-none",
                      )}
                    >
                      {readOnly ? "Read-only (no primary key)." : "No pending changes."}
                    </span>
                  </div>
                  <Button variant="outline" size="sm" onClick={onClose}>
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
