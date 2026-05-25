import { Icon as UiIcon } from "@/components/ui/Icon";
import { TableEditorGridHeader } from "./TableEditorGridHeader";
import { TableEditorGridRows } from "./TableEditorGridRows";
import type {
  EditingCell,
  TableEditorGridHeaderProps,
  TableEditorGridRowsProps,
} from "./TableEditorGrid.types";

interface TableEditorGridProps extends TableEditorGridHeaderProps, TableEditorGridRowsProps {
  isBlockingTableLoading: boolean;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onGridScroll: () => void;
  handleTableKeyDown: (event: React.KeyboardEvent) => void;
  editingCell: EditingCell | null;
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
      <div className="h-full flex flex-col items-center justify-center gap-2 text-muted-foreground">
        <UiIcon name="loader" className="h-5 w-5 animate-spin" />
        <span className="text-xs">Loading table data...</span>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="h-full overflow-auto focus-within:ring-2 focus-within:ring-ring/40 focus-within:ring-inset"
      onScroll={onGridScroll}
    >
      <table
        className="w-max table-fixed caption-bottom text-xs border-separate border-spacing-0 focus-visible:outline-none"
        onKeyDown={handleTableKeyDown}
        tabIndex={0}
      >
        <TableEditorGridHeader {...rest} />
        <TableEditorGridRows {...rest} />
      </table>
    </div>
  );
}
