import { Checkbox } from "@/components/ui/checkbox";
import { TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { TableEditorGridHeaderProps } from "./TableEditorGrid.types";

export function TableEditorGridHeader({
  isAllSelected,
  isSomeSelected,
  toggleSelectAll,
  visibleColumns,
  sort,
  columnMap,
  resolveColumnWidth,
  onSortColumn,
  handleResizeMouseDown,
}: TableEditorGridHeaderProps) {
  return (
    <TableHeader className="sticky top-0 z-10 bg-muted/40 border-b-2 border-border">
      <TableRow className="hover:bg-transparent">
        <TableHead className="sticky left-0 z-[5] w-12 min-w-12 border-r border-border bg-background px-2 py-1 text-center h-8">
          <div className="flex items-center justify-center">
            {isAllSelected ? (
              <Checkbox checked onCheckedChange={toggleSelectAll} />
            ) : isSomeSelected ? (
              <button
                type="button"
                onClick={toggleSelectAll}
                className="flex size-4 items-center justify-center rounded-[4px] border border-input bg-primary"
              >
                <svg width="8" height="2">
                  <rect width="8" height="2" fill="white" rx="1" />
                </svg>
              </button>
            ) : (
              <Checkbox checked={false} onCheckedChange={toggleSelectAll} />
            )}
          </div>
        </TableHead>
        {visibleColumns.map((columnName) => {
          const sorted = sort[0]?.column === columnName ? sort[0].direction : null;
          const column = columnMap[columnName];
          const width = resolveColumnWidth(columnName);
          return (
            <TableHead
              key={columnName}
              className="border-r border-border last:border-r-0 hover:bg-muted/60 transition-colors relative group h-8 py-1 px-2 bg-background"
              style={{ width, minWidth: width, maxWidth: width }}
            >
              <button
                type="button"
                className="w-full h-full text-left cursor-pointer pr-2 overflow-hidden select-none"
                onClick={() => onSortColumn(columnName)}
              >
                <div className="flex items-center min-w-0 gap-1">
                  <span
                    className="min-w-0 flex-1 basis-0 overflow-hidden text-ellipsis whitespace-nowrap font-semibold text-foreground/90 select-text"
                    title={column?.data_type ? `${columnName} (${column.data_type})` : columnName}
                  >
                    {columnName}
                  </span>
                  {column?.data_type ? (
                    <span
                      className="min-w-0 max-w-[42%] truncate whitespace-nowrap text-[10px] font-normal text-muted-foreground/70 select-text"
                      title={column.data_type}
                    >
                      {column.data_type}
                    </span>
                  ) : null}
                  {sorted && (
                    <span className="shrink-0 text-[10px] font-medium text-slate-600 dark:text-slate-300">
                      {sorted === "asc" ? "↑" : "↓"}
                    </span>
                  )}
                </div>
              </button>
              <button
                type="button"
                aria-label={`Resize column ${columnName}`}
                className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors z-20 select-none"
                onMouseDown={(e) => handleResizeMouseDown(columnName, e)}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                  }
                }}
              />
            </TableHead>
          );
        })}
      </TableRow>
    </TableHeader>
  );
}
