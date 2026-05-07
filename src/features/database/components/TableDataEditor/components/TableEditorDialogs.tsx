import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Icon as UiIcon } from "@/components/ui/Icon";
import { Input } from "@/components/ui/input";

interface TableEditorDialogsProps {
  tableName: string;
  selectedRowCount: number;
  pendingBatchDelete: boolean;
  pendingTruncate: boolean;
  confirmText: string;
  truncateSqlPreview: string;
  isTruncating: boolean;
  onConfirmTextChange: (value: string) => void;
  onBatchDeleteOpenChange: (open: boolean) => void;
  onTruncateOpenChange: (open: boolean) => void;
  onConfirmBatchDelete: () => void;
  onConfirmTruncate: () => void;
}

export function TableEditorDialogs({
  tableName,
  selectedRowCount,
  pendingBatchDelete,
  pendingTruncate,
  confirmText,
  truncateSqlPreview,
  isTruncating,
  onConfirmTextChange,
  onBatchDeleteOpenChange,
  onTruncateOpenChange,
  onConfirmBatchDelete,
  onConfirmTruncate,
}: TableEditorDialogsProps) {
  return (
    <>
      <AlertDialog open={pendingBatchDelete} onOpenChange={onBatchDeleteOpenChange}>
        <AlertDialogContent className="t-resize">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm batch delete</AlertDialogTitle>
            <AlertDialogDescription>
              This will stage deletion of <strong>{selectedRowCount} rows</strong>.
              Changes are persisted only when you click <strong>Save Changes</strong>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Input
              value={confirmText}
              onChange={(event) => onConfirmTextChange(event.target.value)}
              placeholder={`Type ${tableName} to confirm`}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onConfirmBatchDelete}
              disabled={confirmText !== tableName}
            >
              Stage Delete ({selectedRowCount})
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={pendingTruncate} onOpenChange={onTruncateOpenChange}>
        <AlertDialogContent className="t-resize">
          <AlertDialogHeader>
            <AlertDialogTitle>Truncate table</AlertDialogTitle>
            <AlertDialogDescription>
              This operation is immediate and removes all rows from the table.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">SQL preview</p>
            <pre className="text-[11px] bg-muted rounded-md p-2 overflow-auto">
              {truncateSqlPreview}
            </pre>
            <Input
              value={confirmText}
              onChange={(event) => onConfirmTextChange(event.target.value)}
              placeholder={`Type ${tableName} to confirm`}
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onConfirmTruncate}
              disabled={confirmText !== tableName || isTruncating}
            >
              {isTruncating ? (
                <UiIcon name="loader" className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <UiIcon name="database" className="h-3.5 w-3.5" />
              )}
              Truncate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

