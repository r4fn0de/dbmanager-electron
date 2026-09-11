import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { ipc } from "@/ipc/manager";

export function UpdateToastListener() {
  const lastNotifiedVersionKeyRef = useRef<string | null>(null);
  const manualInfoQuery = useQuery({
    queryFn: () => ipc.client.app.checkManualUpdateInfo(),
    queryKey: ["app", "manual-update-info", "toast-listener"],
    refetchInterval: 1000 * 60 * 30,
    retry: 1,
  });
  const manualInfo = manualInfoQuery.data;

  useEffect(() => {
    if (!manualInfo) {
      return;
    }
    if (!manualInfo.hasUpdate) {
      return;
    }
    if (!manualInfo.downloadUrl) {
      return;
    }

    const versionKey = `${manualInfo.currentVersion}::${manualInfo.latestVersion}`;
    if (lastNotifiedVersionKeyRef.current === versionKey) {
      return;
    }
    lastNotifiedVersionKeyRef.current = versionKey;

    toast("Update available", {
      action: {
        label: "Download",
        onClick: () => {
          void ipc.client.shell.openExternalLink({
            url: manualInfo.downloadUrl,
          });
        },
      },
      description: `Version ${manualInfo.latestVersion} is available.`,
      duration: 20_000,
    });
  }, [manualInfo]);

  return null;
}
