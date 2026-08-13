import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/Icon";
import { ipc } from "@/ipc/manager";

export function UpdatesPanel() {
  const queryClient = useQueryClient();

  const manualInfoQuery = useQuery({
    queryFn: () => ipc.client.app.checkManualUpdateInfo(),
    queryKey: ["app", "manual-update-info"],
    retry: 1,
  });

  const checkManualMutation = useMutation({
    mutationFn: () => ipc.client.app.checkManualUpdateInfo(),
    onSuccess: (info) => {
      queryClient.setQueryData(["app", "manual-update-info"], info);
    },
  });

  const manualInfo = checkManualMutation.data ?? manualInfoQuery.data ?? null;
  const manualError =
    (checkManualMutation.error instanceof Error &&
      checkManualMutation.error.message) ||
    (manualInfoQuery.error instanceof Error && manualInfoQuery.error.message) ||
    null;

  return (
    <div className="space-y-4">
      <div className="space-y-4 rounded-xl border border-border/60 bg-muted/[0.02] p-4 transition-colors duration-150 ease-out hover:border-border/80">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            <p className="font-medium text-sm">Application update</p>
            <p className="text-muted-foreground text-xs">
              Check for new releases and download the latest build
            </p>
          </div>
          {manualInfo && (
            <Badge variant={manualInfo.hasUpdate ? "default" : "outline"}>
              {manualInfo.hasUpdate ? "Update available" : "Up to date"}
            </Badge>
          )}
        </div>

        {manualError && (
          <p className="text-destructive text-xs">{manualError}</p>
        )}

        <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg bg-muted/40 px-3 py-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Current</span>
            <span className="font-medium text-foreground">
              {manualInfo?.currentVersion ?? "-"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Latest</span>
            <span className="font-medium text-foreground">
              {manualInfo?.latestVersion ?? "-"}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <Button
            className="h-8 text-xs"
            disabled={checkManualMutation.isPending}
            onClick={() => checkManualMutation.mutate()}
            size="sm"
            variant="outline"
          >
            <Icon className="mr-1.5 size-3.5" name="refresh" />
            Check updates
          </Button>
          <Button
            className="h-8 gap-1.5 text-xs shadow-sm"
            disabled={!(manualInfo?.downloadUrl && manualInfo?.hasUpdate)}
            onClick={() => {
              if (!(manualInfo?.downloadUrl && manualInfo?.hasUpdate)) {
                return;
              }
              void ipc.client.shell.openExternalLink({
                url: manualInfo.downloadUrl,
              });
            }}
            size="sm"
          >
            <Icon className="size-3.5" name="download" />
            Download
          </Button>
        </div>
      </div>
    </div>
  );
}
