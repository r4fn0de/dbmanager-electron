import type { VirtualItem } from "@tanstack/react-virtual";
import { useMemo } from "react";
import { Icon as UiIcon } from "@/components/ui/Icon";
import type {
  EditingCell,
  TableEditorGridHeaderProps,
  TableEditorGridRowsProps,
} from "./TableEditorGrid.types";
import { TableEditorGridHeader } from "./TableEditorGridHeader";
import { TableEditorGridRows } from "./TableEditorGridRows";

interface TableEditorGridProps
  extends Omit<
      TableEditorGridHeaderProps,
      "totalColumnWidth" | "virtualColumns"
    >,
    Omit<TableEditorGridRowsProps, "totalColumnWidth" | "virtualColumns"> {
  editingCell: EditingCell | null;
  handleTableKeyDown: (event: React.KeyboardEvent) => void;
  isBlockingTableLoading: boolean;
  onGridScroll: () => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}

export function TableEditorGrid({
  isBlockingTableLoading,
  scrollRef,
  onGridScroll,
  handleTableKeyDown,
  ...rest
}: TableEditorGridProps) {
  const visibleColumns = useMemo(
    () => rest.visibleColumns.filter(Boolean),
    [rest.visibleColumns]
  );
  const { resolveColumnWidth } = rest;
  // Single source of truth for column geometry: cumulative offsets derived
  // from the same widths used for rendering. A column virtualizer was caching
  // `size`/`start` by index and going stale on resize/hide/reorder, which
  // desynced `left` from the rendered width and stacked cells on top of each
  // other. Column counts are small (<100), so render all columns and keep
  // virtualization for rows only (the actual perf bottleneck).
  const virtualColumns: VirtualItem[] = useMemo(() => {
    let start = 0;
    return visibleColumns.map((columnName, index) => {
      const size = resolveColumnWidth(columnName ?? "");
      const item: VirtualItem = {
        end: start + size,
        index,
        key: index,
        lane: 0,
        size,
        start,
      };
      start += size;
      return item;
    });
  }, [visibleColumns, resolveColumnWidth]);
  const totalColumnWidth = useMemo(
    () =>
      virtualColumns.reduce((total, column) => total + column.size, 0) ||
      (visibleColumns[0] ? resolveColumnWidth(visibleColumns[0]) : 0),
    [virtualColumns, visibleColumns, resolveColumnWidth]
  );
  const tableWidth = totalColumnWidth + 48;
  const tableHeight = rest.totalRowHeight + 32;

  if (isBlockingTableLoading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <UiIcon className="h-5 w-5 animate-spin" name="loader" />
        <span className="text-xs">Loading table data...</span>
      </div>
    );
  }

  return (
    <div
      className="h-full overflow-auto focus-within:ring-2 focus-within:ring-ring/40 focus-within:ring-inset"
      onScroll={onGridScroll}
      ref={scrollRef}
    >
      <table
        aria-label="Table data"
        className="relative block border-separate border-spacing-0 text-xs focus-visible:outline-none"
        onKeyDown={handleTableKeyDown}
        style={{
          height: tableHeight,
          minWidth: tableWidth,
          width: "100%",
        }}
        tabIndex={0}
      >
        <TableEditorGridHeader
          {...rest}
          totalColumnWidth={totalColumnWidth}
          virtualColumns={virtualColumns}
          visibleColumns={visibleColumns}
        />
        <TableEditorGridRows
          {...rest}
          totalColumnWidth={totalColumnWidth}
          virtualColumns={virtualColumns}
          visibleColumns={visibleColumns}
        />
      </table>
    </div>
  );
}
