import { Icon as UiIcon } from "@/components/ui/Icon";
import type {
  EditingCell,
  TableEditorGridHeaderProps,
  TableEditorGridRowsProps,
} from "./TableEditorGrid.types";
import { TableEditorGridHeader } from "./TableEditorGridHeader";
import { TableEditorGridRows } from "./TableEditorGridRows";

interface TableEditorGridProps
  extends TableEditorGridHeaderProps,
    TableEditorGridRowsProps {
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
        className="w-max table-fixed caption-bottom border-separate border-spacing-0 text-xs focus-visible:outline-none"
        onKeyDown={handleTableKeyDown}
        tabIndex={0}
      >
        <TableEditorGridHeader {...rest} />
        <TableEditorGridRows {...rest} />
      </table>
    </div>
  );
}
