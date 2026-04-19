import { createFileRoute, useParams } from "@tanstack/react-router";
import { useConnectionTabSync } from "@/components/ConnectionTabs";

export const Route = createFileRoute("/database/$connectionId")({
  component: DatabasePage,
});

function DatabasePage() {
  const { connectionId } = useParams({ from: "/database/$connectionId" });
  
  // Sync tab with connection
  useConnectionTabSync();

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold">Database Connection</h1>
      <p className="text-muted-foreground">Connection ID: {connectionId}</p>
      <p className="mt-4 text-sm text-muted-foreground">
        Database viewer not yet implemented. This is a placeholder route.
      </p>
    </div>
  );
}
