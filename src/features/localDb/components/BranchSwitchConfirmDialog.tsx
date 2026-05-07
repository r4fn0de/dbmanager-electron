import { useState, useCallback } from "react";
import {
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/Icon";
import { Badge } from "@/components/ui/badge";
import type { BranchInfo } from "@/ipc/db/types";

interface BranchSwitchConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetBranch: BranchInfo | null;
  currentBranch: BranchInfo | null;
  onConfirm: () => Promise<BranchInfo>;
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

  if (!targetBranch) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="t-resize sm:max-w-[400px]"
        overlayClassName="bg-black/10 supports-backdrop-filter:backdrop-blur-xs"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon name="git-branch" className="size-4 text-muted-foreground" />
            Switch Branch
          </DialogTitle>
          <DialogDescription className="select-text">
            You are about to switch the active database branch.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {/* Branch transition */}
          <div className="flex items-center gap-2 justify-center">
            <Badge
              variant={currentBranch?.isMain ? "default" : "outline"}
              className="text-xs px-2 py-0.5"
            >
              {currentBranch?.name ?? "main"}
            </Badge>
            <Icon name="arrow-right" className="size-3.5 text-muted-foreground" />
            <Badge
              variant={targetBranch.isMain ? "default" : "outline"}
              className="text-xs px-2 py-0.5"
            >
              {targetBranch.name}
            </Badge>
          </div>

          {/* Description if present */}
          {targetBranch.description && (
            <p className="text-xs text-muted-foreground text-center select-text">
              {targetBranch.description}
            </p>
          )}

          {/* Warning */}
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
            <div className="flex items-start gap-2">
              <Icon name="triangle-alert" className="size-3.5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-800 dark:text-amber-200 leading-relaxed select-text">
                Switching branches will change the database that your connection points to.
                Any open editors or queries will use the new branch's data.
              </p>
            </div>
          </div>

          {/* Error */}
          {error && (
            <p className="text-xs text-destructive rounded-md bg-destructive/10 px-3 py-2 select-text">
              {error}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={isSwitching}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleConfirm}
            disabled={isSwitching}
          >
            {isSwitching ? (
              <>
                <Icon name="loader" className="size-3.5 animate-spin mr-1.5" />
                Switching...
              </>
            ) : (
              <>
                <Icon name="git-branch" className="size-3.5 mr-1.5" />
                Switch to {targetBranch.name}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
