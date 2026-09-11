import { Checkbox } from "@/components/ui/checkbox";
import { TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { TableEditorGridHeaderProps } from "./TableEditorGrid.types";

export function TableEditorGridHeader({
  isAllSelected,
  isSomeSelected,
  toggleSelectAll,
  visibleColumns,
  virtualColumns,
  totalColumnWidth,
  sort,
  columnMap,
  resolveColumnWidth,
  onSortColumn,
  handleResizeMouseDown,
}: TableEditorGridHeaderProps) {
  const leftColumnSpacer = virtualColumns[0]?.start ?? 0;
  const lastVirtualColumn = virtualColumns.at(-1);
  const rightColumnSpacer = lastVirtualColumn
    ? totalColumnWidth - lastVirtualColumn.end
    : totalColumnWidth;

  return (
    <TableHeader className="sticky top-0 z-10 border-border border-b-2 bg-muted/40">
      <TableRow className="hover:bg-transparent">
        <TableHead
          className="sticky left-0 z-[5] h-8 w-12 min-w-12 border-border border-r bg-background px-2 py-1 text-center"
          style={{ maxWidth: 48, minWidth: 48, width: 48 }}
        >
          <div className="flex items-center justify-center">
            {isSomeSelected && !isAllSelected ? (
              <button
                className="flex size-4 items-center justify-center rounded-[4px] border border-input bg-primary"
                onClick={toggleSelectAll}
                type="button"
              >
                <svg aria-hidden="true" height="2" width="8">
                  <rect fill="white" height="2" rx="1" width="8" />
                </svg>
              </button>
            ) : (
              <Checkbox
                checked={isAllSelected}
                onCheckedChange={toggleSelectAll}
              />
            )}
          </div>
        </TableHead>
        {leftColumnSpacer > 0 ? (
          <TableHead
            aria-hidden="true"
            className="border-0 bg-background p-0"
            style={{ width: leftColumnSpacer }}
          />
        ) : null}
        {virtualColumns.map((virtualColumn) => {
          const columnName = visibleColumns[virtualColumn.index];
          if (!columnName) {
            return null;
          }
          const sorted =
            sort[0]?.column === columnName ? sort[0].direction : null;
          const column = columnMap[columnName];
          const width = resolveColumnWidth(columnName);
          return (
            <TableHead
              className="group relative h-8 border-border border-r bg-background px-2 py-1 transition-colors last:border-r-0 hover:bg-muted/60"
              key={columnName}
              style={{ maxWidth: width, minWidth: width, width }}
            >
              <button
                className="h-full w-full select-none overflow-hidden pr-2 text-left"
                onClick={() => onSortColumn(columnName)}
                type="button"
              >
                <div className="flex min-w-0 items-center gap-1">
                  <span
                    className="min-w-0 flex-1 basis-0 overflow-hidden text-ellipsis whitespace-nowrap font-semibold text-foreground/90"
                    title={
                      column?.data_type
                        ? `${columnName} (${column.data_type})`
                        : columnName
                    }
                  >
                    {columnName}
                  </span>
                  {column?.data_type ? (
                    <span
                      className="min-w-0 max-w-[42%] truncate whitespace-nowrap font-normal text-[10px] text-muted-foreground/70"
                      title={column.data_type}
                    >
                      {column.data_type}
                    </span>
                  ) : null}
                  {sorted === null ? null : (
                    <span className="shrink-0 font-medium text-[10px] text-slate-600 dark:text-slate-300">
                      {sorted === "asc" ? "↑" : "↓"}
                    </span>
                  )}
                </div>
              </button>
              <button
                aria-label={`Resize column ${columnName}`}
                className="absolute top-0 right-0 bottom-0 z-20 w-1.5 cursor-col-resize select-none transition-colors hover:bg-primary/30 active:bg-primary/50"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                  }
                }}
                onMouseDown={(e) => handleResizeMouseDown(columnName, e)}
                type="button"
              />
            </TableHead>
          );
        })}
        {rightColumnSpacer > 0 ? (
          <TableHead
            aria-hidden="true"
            className="border-0 bg-background p-0"
            style={{ width: rightColumnSpacer }}
          />
        ) : null}
      </TableRow>
    </TableHeader>
  );
}
