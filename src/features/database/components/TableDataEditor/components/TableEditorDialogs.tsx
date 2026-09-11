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
  confirmText: string;
  isTruncating: boolean;
  onBatchDeleteOpenChange: (open: boolean) => void;
  onConfirmBatchDelete: () => void;
  onConfirmTextChange: (value: string) => void;
  onConfirmTruncate: () => void;
  onTruncateOpenChange: (open: boolean) => void;
  pendingBatchDelete: boolean;
  pendingTruncate: boolean;
  selectedRowCount: number;
  tableName: string;
  truncateSqlPreview: string;
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
      <AlertDialog
        onOpenChange={onBatchDeleteOpenChange}
        open={pendingBatchDelete}
      >
        <AlertDialogContent className="t-resize">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm batch delete</AlertDialogTitle>
            <AlertDialogDescription>
              This will stage deletion of{" "}
              <strong>{selectedRowCount} rows</strong>. Changes are persisted
              only when you click <strong>Save Changes</strong>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Input
              onChange={(event) => onConfirmTextChange(event.target.value)}
              placeholder={`Type ${tableName} to confirm`}
              value={confirmText}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={confirmText !== tableName}
              onClick={onConfirmBatchDelete}
            >
              Stage Delete ({selectedRowCount})
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog onOpenChange={onTruncateOpenChange} open={pendingTruncate}>
        <AlertDialogContent className="t-resize">
          <AlertDialogHeader>
            <AlertDialogTitle>Truncate table</AlertDialogTitle>
            <AlertDialogDescription>
              This operation is immediate and removes all rows from the table.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-2">
            <p className="text-muted-foreground text-xs">SQL preview</p>
            <pre className="overflow-auto rounded-md bg-muted p-2 text-[11px]">
              {truncateSqlPreview}
            </pre>
            <Input
              onChange={(event) => onConfirmTextChange(event.target.value)}
              placeholder={`Type ${tableName} to confirm`}
              value={confirmText}
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={confirmText !== tableName || isTruncating}
              onClick={onConfirmTruncate}
            >
              {isTruncating ? (
                <UiIcon className="h-3.5 w-3.5 animate-spin" name="loader" />
              ) : (
                <UiIcon className="h-3.5 w-3.5" name="database" />
              )}
              Truncate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
