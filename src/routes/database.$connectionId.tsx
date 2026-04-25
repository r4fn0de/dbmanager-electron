import { createFileRoute } from "@tanstack/react-router";
import { useConnectionTabsStore } from "@/lib/stores/connection-tabs";

export { DatabasePageContent } from "./database/DatabasePageContent";

export const Route = createFileRoute("/database/$connectionId")({
  component: DatabasePage,
});

function DatabasePage() {
  const { connectionId } = Route.useParams();
  const store = useConnectionTabsStore.getState();
  if (!store.tabs.some((t) => t.id === connectionId)) {
    // Tab not yet in the store — the page will register it via the
    // useEffect inside DatabasePageContent when it mounts.
  }
  return null;
}
