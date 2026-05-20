import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ipc } from "@/ipc/manager";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/Icon";

export function UpdatesPanel() {
  const queryClient = useQueryClient();

  const manualInfoQuery = useQuery({
    queryKey: ["app", "manual-update-info"],
    queryFn: () => ipc.client.app.checkManualUpdateInfo(),
    retry: 1,
  });

  const checkManualMutation = useMutation({
    mutationFn: () => ipc.client.app.checkManualUpdateInfo(),
    onSuccess: (info) => {
      queryClient.setQueryData(["app", "manual-update-info"], info);
    },
  });

  const manualInfo =
    checkManualMutation.data ?? manualInfoQuery.data ?? null;
  const manualError =
    (checkManualMutation.error instanceof Error &&
      checkManualMutation.error.message) ||
    (manualInfoQuery.error instanceof Error &&
      manualInfoQuery.error.message) ||
    null;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border/60 bg-muted/[0.02] p-4 space-y-3 transition-colors duration-150 ease-out hover:border-border/80">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium">Update</p>
          {manualInfo && (
            <Badge
              variant={manualInfo.hasUpdate ? "default" : "outline"}
            >
              {manualInfo.hasUpdate ? "Update available" : "Up to date"}
            </Badge>
          )}
        </div>

        {manualError && (
          <p className="text-xs text-destructive">{manualError}</p>
        )}

        <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
          <div>
            Current:{" "}
            <span className="text-foreground font-medium">
              {manualInfo?.currentVersion ?? "-"}
            </span>
          </div>
          <div>
            Latest:{" "}
            <span className="text-foreground font-medium">
              {manualInfo?.latestVersion ?? "-"}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            disabled={checkManualMutation.isPending}
            onClick={() => checkManualMutation.mutate()}
            className="h-8 text-xs"
          >
            <Icon name="refresh" className="size-3.5 mr-1.5" />
            Check updates
          </Button>
          <Button
            size="sm"
            disabled={
              !manualInfo?.downloadUrl || !manualInfo?.hasUpdate
            }
            onClick={() => {
              if (!manualInfo?.downloadUrl || !manualInfo?.hasUpdate)
                return;
              void ipc.client.shell.openExternalLink({
                url: manualInfo.downloadUrl,
              });
            }}
            className="h-8 text-xs gap-1.5 shadow-sm"
          >
            <Icon name="download" className="size-3.5" />
            Download
          </Button>
        </div>
      </div>
    </div>
  );
}
