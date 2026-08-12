import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { SettingsPage } from "@/features/settings";
import { useConnectionTabsStore } from "@/lib/stores/connection-tabs";

export const Route = createFileRoute("/settings")({
  component: SettingsRoute,
});

function SettingsRoute() {
  useEffect(() => {
    useConnectionTabsStore.getState().openSettingsTab();
  }, []);

  return <SettingsPage />;
}
