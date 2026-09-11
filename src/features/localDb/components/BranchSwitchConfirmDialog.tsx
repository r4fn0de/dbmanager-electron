import { useCallback, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/Icon";
import type { BranchInfo } from "@/ipc/db/types";

interface BranchSwitchConfirmDialogProps {
  currentBranch: BranchInfo | null;
  onConfirm: () => Promise<BranchInfo>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  targetBranch: BranchInfo | null;
}

export function BranchSwitchConfirmDialog({
  open,
  onOpenChange,
  targetBranch,
  currentBranch,
  onConfirm,
}: BranchSwitchConfirmDialogProps) {
  const [isSwitching, setIsSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = useCallback(async () => {
    setIsSwitching(true);
    setError(null);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to switch branch");
    } finally {
      setIsSwitching(false);
    }
  }, [onConfirm, onOpenChange]);

  if (!targetBranch) {
    return null;
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="t-resize sm:max-w-[400px]"
        overlayClassName="bg-black/10 supports-backdrop-filter:backdrop-blur-xs"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="size-4 text-muted-foreground" name="git-branch" />
            Switch Branch
          </DialogTitle>
          <DialogDescription className="select-text">
            You are about to switch the active database branch.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {/* Branch transition */}
          <div className="flex items-center justify-center gap-2">
            <Badge
              className="px-2 py-0.5 text-xs"
              variant={currentBranch?.isMain ? "default" : "outline"}
            >
              {currentBranch?.name ?? "main"}
            </Badge>
            <Icon
              className="size-3.5 text-muted-foreground"
              name="arrow-right"
            />
            <Badge
              className="px-2 py-0.5 text-xs"
              variant={targetBranch.isMain ? "default" : "outline"}
            >
              {targetBranch.name}
            </Badge>
          </div>

          {/* Description if present */}
          {targetBranch.description && (
            <p className="select-text text-center text-muted-foreground text-xs">
              {targetBranch.description}
            </p>
          )}

          {/* Warning */}
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
            <div className="flex items-start gap-2">
              <Icon
                className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400"
                name="triangle-alert"
              />
              <p className="select-text text-amber-800 text-xs leading-relaxed dark:text-amber-200">
                Switching branches will change the database that your connection
                points to. Any open editors or queries will use the new branch's
                data.
              </p>
            </div>
          </div>

          {/* Error */}
          {error && (
            <p className="select-text rounded-md bg-destructive/10 px-3 py-2 text-destructive text-xs">
              {error}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <Button
            disabled={isSwitching}
            onClick={() => onOpenChange(false)}
            size="sm"
            variant="outline"
          >
            Cancel
          </Button>
          <Button disabled={isSwitching} onClick={handleConfirm} size="sm">
            {isSwitching ? (
              <>
                <Icon className="mr-1.5 size-3.5 animate-spin" name="loader" />
                Switching...
              </>
            ) : (
              <>
                <Icon className="mr-1.5 size-3.5" name="git-branch" />
                Switch to {targetBranch.name}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
