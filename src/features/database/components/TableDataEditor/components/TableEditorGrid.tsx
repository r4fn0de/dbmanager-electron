import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";
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
  const visibleColumns = rest.visibleColumns.filter(Boolean);
  const columnVirtualizer = useVirtualizer({
    count: visibleColumns.length,
    estimateSize: (index) =>
      rest.resolveColumnWidth(visibleColumns[index] ?? ""),
    getScrollElement: () => scrollRef.current,
    horizontal: true,
    overscan: 3,
  });
  const measuredVirtualColumns = columnVirtualizer.getVirtualItems();
  const [firstColumn] = visibleColumns;
  const firstColumnSize = firstColumn
    ? rest.resolveColumnWidth(firstColumn)
    : 0;
  const virtualColumns: VirtualItem[] =
    measuredVirtualColumns.length > 0 || !firstColumn
      ? measuredVirtualColumns
      : [
          {
            end: firstColumnSize,
            index: 0,
            key: firstColumn,
            lane: 0,
            size: firstColumnSize,
            start: 0,
          },
        ];
  const totalColumnWidth = Math.max(
    columnVirtualizer.getTotalSize(),
    firstColumnSize
  );

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
        className="w-max table-fixed caption-bottom border-separate border-spacing-0 text-xs focus-visible:outline-none"
        onKeyDown={handleTableKeyDown}
        style={{ minWidth: totalColumnWidth + 48 }}
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
