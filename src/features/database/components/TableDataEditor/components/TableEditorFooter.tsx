import { Button } from "@/components/ui/button";
import { Icon as UiIcon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils";

interface TableEditorFooterProps {
  hasDraftChanges: boolean;
  hasNextPage?: boolean;
  isLoading: boolean;
  isSaving: boolean;
  onDiscardDrafts: () => void;
  onNextPage: () => void;
  onPageSizeChange: (size: number) => void;
  onPrevPage: () => void;
  onRequestExactCount?: () => void;
  onSaveChanges: () => void;
  page: number;
  pageSize: number;
  pressableClass: string;
  totalEstimate?: number;
  totalIsEstimated?: boolean;
  totalPages: number;
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
  hasNextPage,
  onRequestExactCount,
  totalEstimate = 0,
  totalIsEstimated = false,
}: TableEditorFooterProps) {
  const canGoNext = hasNextPage ?? page + 1 < totalPages;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-background/95 px-3 py-2 backdrop-blur-sm supports-[backdrop-filter]:bg-background/80">
      <div className="flex items-center gap-1">
        <Button
          className={pressableClass}
          disabled={page === 0 || isLoading}
          onClick={onPrevPage}
          size="icon-sm"
          variant="outline"
        >
          <UiIcon className="h-3.5 w-3.5" name="chevron-left" />
        </Button>
        <span className="px-1 text-muted-foreground text-xs">
          Page {page + 1} / {totalPages}
        </span>
        {totalIsEstimated &&
          totalEstimate >= 0 &&
          onRequestExactCount && (
            <Button
              className="h-6 px-1.5 text-[11px]"
              disabled={isLoading}
              onClick={onRequestExactCount}
              size="sm"
              variant="ghost"
            >
              Exact count
            </Button>
          )}
        <Button
          className={pressableClass}
          disabled={isLoading || !canGoNext}
          onClick={onNextPage}
          size="icon-sm"
          variant="outline"
        >
          <UiIcon className="h-3.5 w-3.5" name="chevron-right" />
        </Button>
        <span className="ml-2 text-muted-foreground text-xs">
          Rows per page
        </span>
        {[25, 50, 100].map((size) => (
          <Button
            className={pressableClass}
            key={size}
            onClick={() => onPageSizeChange(size)}
            size="sm"
            variant={pageSize === size ? "secondary" : "outline"}
          >
            {size}
          </Button>
        ))}
      </div>

      <div
        className={cn(
          "flex items-center gap-2 overflow-hidden transition-[opacity,transform,max-width] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
          hasDraftChanges
            ? "max-w-[400px] scale-100 opacity-100"
            : "pointer-events-none max-w-0 scale-[0.95] opacity-0"
        )}
      >
        <Button
          className={pressableClass}
          disabled={isSaving}
          onClick={onDiscardDrafts}
          size="sm"
          variant="outline"
        >
          <UiIcon className="h-3.5 w-3.5" name="undo" />
          Discard
        </Button>
        <Button
          className={pressableClass}
          disabled={isSaving}
          onClick={onSaveChanges}
          size="sm"
          variant="default"
        >
          {isSaving ? (
            <UiIcon className="h-3.5 w-3.5 animate-spin" name="loader" />
          ) : (
            <UiIcon className="h-3.5 w-3.5" name="device-floppy" />
          )}
          Save Changes
        </Button>
      </div>
    </div>
  );
}
