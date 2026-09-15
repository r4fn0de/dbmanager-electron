import { Icon as UiIcon } from "@/components/ui/Icon";
import type {
  TableEditorGridHeaderProps,
  TableEditorGridRowsProps,
} from "./TableEditorGrid.types";
import { TableEditorGridHeader } from "./TableEditorGridHeader";
import { TableEditorGridRows } from "./TableEditorGridRows";

interface TableEditorGridProps
  extends TableEditorGridRowsProps,
    Pick<
      TableEditorGridHeaderProps,
      | "handleResizeMouseDown"
      | "isAllSelected"
      | "isSomeSelected"
      | "onSortColumn"
      | "sort"
      | "toggleSelectAll"
    > {
  handleTableKeyDown: (event: React.KeyboardEvent) => void;
  isBlockingTableLoading: boolean;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}

export function TableEditorGrid({
  isBlockingTableLoading,
  scrollRef,
  handleTableKeyDown,
  totalColumnWidth,
  // Header-only props (destructured so they are not spread into Rows).
  handleResizeMouseDown,
  isAllSelected,
  isSomeSelected,
  onSortColumn,
  sort,
  toggleSelectAll,
  ...rowsProps
}: TableEditorGridProps) {
  // Column virtualization (which columns are rendered, their exact offsets)
  // is owned by `useColumnVirtualization` in TableDataEditor and arrives via
  // props — the same pattern as the row virtualizer. `virtualColumn.start`
  // already includes the 48px sticky gutter (baked in via `paddingStart`),
  // so it is the cell's exact CSS `left` inside the table body.
  const tableWidth = totalColumnWidth + 48;
  const tableHeight = rowsProps.totalRowHeight + 32;

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
      // `focus-within` lit the ring on every click: the `<table>` is focusable
      // (`tabIndex={0}`) so selecting a row focused it and outlined the whole
      // grid. Scoping to `>table:focus-visible` keeps the ring as a keyboard-only
      // affordance — the `<table>` suppresses its own outline, so without this a
      // Tab into the grid would have no visible focus indicator at all.
      className="h-full overflow-auto has-[>table:focus-visible]:ring-2 has-[>table:focus-visible]:ring-ring/40 has-[>table:focus-visible]:ring-inset"
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
          columnMap={rowsProps.columnMap}
          handleResizeMouseDown={handleResizeMouseDown}
          isAllSelected={isAllSelected}
          isSomeSelected={isSomeSelected}
          onSortColumn={onSortColumn}
          resolveColumnWidth={rowsProps.resolveColumnWidth}
          sort={sort}
          toggleSelectAll={toggleSelectAll}
          totalColumnWidth={totalColumnWidth}
          virtualColumns={rowsProps.virtualColumns}
          visibleColumns={rowsProps.visibleColumns}
        />
        <TableEditorGridRows
          {...rowsProps}
          totalColumnWidth={totalColumnWidth}
          virtualColumns={rowsProps.virtualColumns}
          visibleColumns={rowsProps.visibleColumns}
        />
      </table>
    </div>
  );
}
