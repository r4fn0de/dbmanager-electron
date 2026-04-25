import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/Icon";
import type { SchemaPolicy } from "@/ipc/db/types";

interface RlsPoliciesDialogProps {
  isOpen: boolean;
  onClose: () => void;
  schema: string;
  tableName: string;
  policies: SchemaPolicy[];
}

export function RlsPoliciesDialog({
  isOpen,
  onClose,
  schema,
  tableName,
  policies,
}: RlsPoliciesDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon name="lock" className="h-5 w-5 text-cyan-500" />
            RLS Policies
          </DialogTitle>
          <DialogDescription>
            Row Level Security policies for{" "}
            <code className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">
              {schema}.{tableName}
            </code>
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto py-4 space-y-3">
          {policies.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Icon name="lock" className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No RLS policies found</p>
              <p className="text-xs mt-1">
                This table has RLS enabled but no policies defined.
              </p>
            </div>
          ) : (
            policies.map((policy) => (
              <div
                key={policy.name}
                className="border rounded-lg p-4 space-y-2 bg-muted/30"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <Icon name="lock" className="h-4 w-4 text-cyan-500 shrink-0" />
                  <span className="font-medium text-sm">{policy.name}</span>
                  <Badge
                    variant="secondary"
                    className="text-[10px] bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-500/20"
                  >
                    {policy.kind}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    {policy.roles.join(", ")}
                  </Badge>
                </div>

                {policy.using_expr && (
                  <div className="space-y-1">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                      USING
                    </span>
                    <code className="block px-2.5 py-1.5 bg-muted rounded text-xs font-mono text-muted-foreground overflow-x-auto">
                      {policy.using_expr}
                    </code>
                  </div>
                )}

                {policy.with_check_expr && (
                  <div className="space-y-1">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                      WITH CHECK
                    </span>
                    <code className="block px-2.5 py-1.5 bg-muted rounded text-xs font-mono text-muted-foreground overflow-x-auto">
                      {policy.with_check_expr}
                    </code>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        <div className="flex justify-end pt-2 border-t">
          <Button variant="outline" size="sm" onClick={onClose}>
            <Icon name="x" className="h-4 w-4 mr-1.5" />
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
