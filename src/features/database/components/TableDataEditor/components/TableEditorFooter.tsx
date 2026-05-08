import { Icon as UiIcon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface TableEditorFooterProps {
  page: number;
  totalPages: number;
  pageSize: number;
  isLoading: boolean;
  hasDraftChanges: boolean;
  isSaving: boolean;
  pressableClass: string;
  onPrevPage: () => void;
  onNextPage: () => void;
  onPageSizeChange: (size: number) => void;
  onDiscardDrafts: () => void;
  onSaveChanges: () => void;
}

export function TableEditorFooter({
  page,
  totalPages,
  pageSize,
  isLoading,
  hasDraftChanges,
  isSaving,
  pressableClass,
  onPrevPage,
  onNextPage,
  onPageSizeChange,
  onDiscardDrafts,
  onSaveChanges,
}: TableEditorFooterProps) {
  return (
    <div className="border-t px-3 py-2 flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon-sm"
          className={pressableClass}
          onClick={onPrevPage}
          disabled={page === 0 || isLoading}
        >
          <UiIcon name="chevron-left" className="h-3.5 w-3.5" />
        </Button>
        <span className="text-xs text-muted-foreground">
          Page {page + 1} / {totalPages}
        </span>
        <Button
          variant="outline"
          size="icon-sm"
          className={pressableClass}
          onClick={onNextPage}
          disabled={isLoading || page + 1 >= totalPages}
        >
          <UiIcon name="chevron-right" className="h-3.5 w-3.5" />
        </Button>
        <span className="text-xs text-muted-foreground ml-2">Rows per page</span>
        {[25, 50, 100].map((size) => (
          <Button
            key={size}
            variant={pageSize === size ? "secondary" : "outline"}
            size="sm"
            className={pressableClass}
            onClick={() => onPageSizeChange(size)}
          >
            {size}
          </Button>
        ))}
      </div>

      <div
        className={cn(
          "flex items-center gap-2 overflow-hidden transition-[opacity,transform,max-width] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
          hasDraftChanges
            ? "opacity-100 scale-100 max-w-[400px]"
            : "opacity-0 scale-[0.95] max-w-0 pointer-events-none",
        )}
      >
        <Button
          variant="outline"
          size="sm"
          className={pressableClass}
          onClick={onDiscardDrafts}
          disabled={isSaving}
        >
          <UiIcon name="undo" className="h-3.5 w-3.5" />
          Discard
        </Button>
        <Button
          variant="default"
          size="sm"
          className={pressableClass}
          onClick={onSaveChanges}
          disabled={isSaving}
        >
          {isSaving ? (
            <UiIcon name="loader" className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <UiIcon name="device-floppy" className="h-3.5 w-3.5" />
          )}
          Save Changes
        </Button>
      </div>
    </div>
  );
}

