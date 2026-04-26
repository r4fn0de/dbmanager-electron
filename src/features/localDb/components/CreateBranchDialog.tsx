import { useState, useCallback } from "react";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Icon } from "@/components/ui/Icon";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { BranchInfo } from "@/ipc/db/types";

export interface CreateBranchInput {
  name: string;
  description?: string;
  parentBranchId?: string;
  dataTables?: Array<{ schema: string; table: string }>;
}

interface CreateBranchDialogProps {
  localDbName: string;
  branches: BranchInfo[];
  activeBranch: BranchInfo | null;
  onCreate: (input: CreateBranchInput) => Promise<BranchInfo>;
  /** Optional tooltip label shown on hover over the trigger button. */
  tooltipLabel?: string;
}

export function CreateBranchDialog({
  localDbName,
  branches,
  activeBranch,
  onCreate,
  tooltipLabel,
}: CreateBranchDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [parentBranchId, setParentBranchId] = useState<string>(
    activeBranch?.id ?? "",
  );
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameError = name.length > 63
    ? "Name must be 63 characters or less"
    : branches.some((b) => b.name === name)
      ? `Branch "${name}" already exists`
      : null;

  const canCreate = name.length > 0 && !nameError && !isCreating;

  const handleCreate = useCallback(async () => {
    if (!canCreate) return;
    setIsCreating(true);
    setError(null);
    try {
      await onCreate({
        name,
        description: description || undefined,
        parentBranchId: parentBranchId || undefined,
      });
      setOpen(false);
      setName("");
      setDescription("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create branch");
    } finally {
      setIsCreating(false);
    }
  }, [canCreate, name, description, parentBranchId, onCreate]);

  // Build the trigger element: Button ← DialogTrigger, optionally wrapped
  // in TooltipTrigger for hover labels.
  const triggerElement = (
    <DialogTrigger
      render={
        <Button variant="ghost" size="icon-xs" className="text-muted-foreground hover:text-foreground" />
      }
    >
      <Icon name="plus" className="size-3.5" />
    </DialogTrigger>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {tooltipLabel ? (
        <Tooltip>
          <TooltipTrigger
            render={triggerElement}
          />
          <TooltipContent side="bottom" sideOffset={4}>
            {tooltipLabel}
          </TooltipContent>
        </Tooltip>
      ) : (
        triggerElement
      )}
      <DialogContent
        className="sm:max-w-[480px]"
        overlayClassName="bg-black/10 supports-backdrop-filter:backdrop-blur-xs"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon name="plus" className="size-4 text-muted-foreground" />
            Create Branch
          </DialogTitle>
          <DialogDescription>
            Create a new branch from{" "}
            <span className="font-medium text-foreground">{localDbName}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Branch name */}
          <div className="space-y-1.5">
            <Label htmlFor="branch-name" className="text-xs font-medium">
              Branch name
            </Label>
            <Input
              id="branch-name"
              placeholder="e.g., feature/add-uuid-column"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={63}
              className={cn(nameError && "border-destructive")}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && canCreate) handleCreate();
              }}
            />
            {nameError && (
              <p className="text-xs text-destructive">{nameError}</p>
            )}
          </div>

          {/* Parent branch */}
          {branches.length > 1 && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Branch from</Label>
              <div className="flex flex-wrap gap-1.5">
                {branches.map((branch) => (
                  <button
                    key={branch.id}
                    type="button"
                    onClick={() => setParentBranchId(branch.id)}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors",
                      parentBranchId === branch.id
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border hover:border-primary/50 text-muted-foreground",
                    )}
                  >
                    {branch.isActive && (
                      <span className="size-1.5 rounded-full bg-emerald-500" />
                    )}
                    {branch.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="branch-description" className="text-xs font-medium">
              Description <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="branch-description"
              placeholder="What this branch is for..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="resize-none text-sm"
            />
          </div>

          {/* Info note */}
          <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
            <p className="text-xs text-muted-foreground leading-relaxed">
              The branch will be created as a copy of the{" "}
              <Badge variant="outline" className="text-[10px] h-4 px-1 font-mono ml-0.5">
                {branches.find((b) => b.id === parentBranchId)?.name ?? "main"}
              </Badge>{" "}
              branch using PostgreSQL template databases. Schema and data are included by default.
            </p>
          </div>

          {/* Error */}
          {error && (
            <p className="text-xs text-destructive rounded-md bg-destructive/10 px-3 py-2">
              {error}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOpen(false)}
            disabled={isCreating}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleCreate}
            disabled={!canCreate}
          >
            {isCreating ? (
              <>
                <Icon name="loader" className="size-3.5 animate-spin mr-1.5" />
                Creating...
              </>
            ) : (
              <>
                <Icon name="plus" className="size-3.5 mr-1.5" />
                Create Branch
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
