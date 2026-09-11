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
import type { SchemaPolicy } from "@/ipc/db/types";

interface RlsPoliciesDialogProps {
  isOpen: boolean;
  onClose: () => void;
  policies: SchemaPolicy[];
  schema: string;
  tableName: string;
}

export function RlsPoliciesDialog({
  isOpen,
  onClose,
  schema,
  tableName,
  policies,
}: RlsPoliciesDialogProps) {
  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open={isOpen}>
      <DialogContent className="t-resize flex max-h-[80vh] max-w-2xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="h-5 w-5 text-cyan-500" name="lock" />
            RLS Policies
          </DialogTitle>
          <DialogDescription>
            Row Level Security policies for{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
              {schema}.{tableName}
            </code>
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-3 overflow-y-auto py-4">
          {policies.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              <Icon className="mx-auto mb-2 h-8 w-8 opacity-50" name="lock" />
              <p className="text-sm">No RLS policies found</p>
              <p className="mt-1 text-xs">
                This table has RLS enabled but no policies defined.
              </p>
            </div>
          ) : (
            policies.map((policy) => (
              <div
                className="space-y-2 rounded-lg border bg-muted/30 p-4"
                key={policy.name}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Icon
                    className="h-4 w-4 shrink-0 text-cyan-500"
                    name="lock"
                  />
                  <span className="font-medium text-sm">{policy.name}</span>
                  <Badge
                    className="bg-cyan-500/15 text-[10px] text-cyan-600 hover:bg-cyan-500/20 dark:text-cyan-400"
                    variant="secondary"
                  >
                    {policy.kind}
                  </Badge>
                  <Badge className="text-[10px]" variant="outline">
                    {policy.roles.join(", ")}
                  </Badge>
                </div>

                {policy.using_expr && (
                  <div className="space-y-1">
                    <span className="font-medium text-[10px] text-muted-foreground uppercase tracking-wider">
                      USING
                    </span>
                    <code className="block overflow-x-auto rounded bg-muted px-2.5 py-1.5 font-mono text-muted-foreground text-xs">
                      {policy.using_expr}
                    </code>
                  </div>
                )}

                {policy.with_check_expr && (
                  <div className="space-y-1">
                    <span className="font-medium text-[10px] text-muted-foreground uppercase tracking-wider">
                      WITH CHECK
                    </span>
                    <code className="block overflow-x-auto rounded bg-muted px-2.5 py-1.5 font-mono text-muted-foreground text-xs">
                      {policy.with_check_expr}
                    </code>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        <div className="flex justify-end border-t pt-2">
          <Button onClick={onClose} size="sm" variant="outline">
            <Icon className="mr-1.5 h-4 w-4" name="x" />
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
