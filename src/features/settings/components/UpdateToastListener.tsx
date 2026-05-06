import { useEffect, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ipc } from "@/ipc/manager";

export function UpdateToastListener() {
  const lastNotifiedDownloadKeyRef = useRef<string | null>(null);

  const statusQuery = useQuery({
    queryKey: ["app", "update-status"],
    queryFn: () => ipc.client.app.updateStatus(),
    refetchInterval: 5000,
  });

  const installMutation = useMutation({
    mutationFn: () => ipc.client.app.restartAndInstallUpdate({ confirm: true }),
  });

  const status = statusQuery.data;

  useEffect(() => {
    if (!status) return;
    if (status.stage !== "downloaded") return;

    const downloadKey = `${status.currentVersion}::${status.availableVersion ?? "unknown"}`;
    if (lastNotifiedDownloadKeyRef.current === downloadKey) return;
    lastNotifiedDownloadKeyRef.current = downloadKey;

    toast("Update ready to install", {
      description: status.availableVersion
        ? `Version ${status.availableVersion} has been downloaded.`
        : "A new version has been downloaded.",
      duration: 20000,
      action: {
        label: "Restart now",
        onClick: () => {
          installMutation.mutate();
        },
      },
    });
  }, [installMutation, status]);

  return null;
}
