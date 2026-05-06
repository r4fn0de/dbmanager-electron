import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ipc } from "@/ipc/manager";

export function UpdateToastListener() {
  const lastNotifiedVersionKeyRef = useRef<string | null>(null);
  const manualInfoQuery = useQuery({
    queryKey: ["app", "manual-update-info", "toast-listener"],
    queryFn: () => ipc.client.app.checkManualUpdateInfo(),
    refetchInterval: 1000 * 60 * 30,
    retry: 1,
  });
  const manualInfo = manualInfoQuery.data;

  useEffect(() => {
    if (!manualInfo) return;
    if (!manualInfo.hasUpdate) return;
    if (!manualInfo.downloadUrl) return;

    const versionKey = `${manualInfo.currentVersion}::${manualInfo.latestVersion}`;
    if (lastNotifiedVersionKeyRef.current === versionKey) return;
    lastNotifiedVersionKeyRef.current = versionKey;

    toast("Update available", {
      description: `Version ${manualInfo.latestVersion} is available.`,
      duration: 20000,
      action: {
        label: "Download",
        onClick: () => {
          void ipc.client.shell.openExternalLink({ url: manualInfo.downloadUrl });
        },
      },
    });
  }, [manualInfo]);

  return null;
}
