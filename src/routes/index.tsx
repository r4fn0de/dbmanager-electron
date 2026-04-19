import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Database, HardDrive, Plus, Search, Server } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useConnections } from "@/hooks/useConnections";
import { useLocalDatabases } from "@/hooks/useLocalDatabases";

function Home() {
  const { connections, isLoading: isLoadingConnections } = useConnections();
  const { databases: localDatabases } = useLocalDatabases();
  const [searchQuery, setSearchQuery] = useState("");
  const navigate = useNavigate();

  const filteredConnections = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return connections;
    return connections.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.host.toLowerCase().includes(q) ||
        c.database.toLowerCase().includes(q) ||
        (c.url ?? "").toLowerCase().includes(q),
    );
  }, [connections, searchQuery]);

  const handleAdd = () => {
    // TODO: Abrir dialog de conexão
    console.log("Add connection");
  };

  const handleAddLocalDb = () => {
    // TODO: Abrir dialog de local DB
    console.log("Add local DB");
  };

  const handleSelectConnection = (connection: { id: string }) => {
    navigate({
      to: "/database/$connectionId",
      params: { connectionId: connection.id },
    });
  };

  return (
    <div className="h-full flex flex-col">
      <div className="border-x border-b rounded-lg p-4 flex-1 flex flex-col bg-background">
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm font-medium text-muted-foreground">
            {filteredConnections.length}{" "}
            {filteredConnections.length === 1 ? "database" : "databases"}
            {searchQuery &&
              connections.length !== filteredConnections.length && (
                <> · {connections.length} total</>
              )}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button />}>
              <Plus className="h-4 w-4 mr-2" />
              Add
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleAdd}>
                <Database className="mr-2 h-4 w-4" />
                Remote Connection
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleAddLocalDb}>
                <HardDrive className="mr-2 h-4 w-4" />
                New Local Database
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {connections.length > 0 && (
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search connections…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain">
          {isLoadingConnections ? (
            <div className="text-center py-12 text-muted-foreground">
              Loading connections...
            </div>
          ) : filteredConnections.length === 0 ? (
            <div className="text-center py-12">
              <Database className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">
                {searchQuery ? "No matches found" : "No connections yet"}
              </h3>
              <p className="text-muted-foreground mb-4">
                {searchQuery
                  ? "Try a different search term."
                  : "Add your first database connection to get started."}
              </p>
              <Button onClick={handleAdd}>
                <Plus className="mr-2 h-4 w-4" />
                Add Connection
              </Button>
            </div>
          ) : (
            <div className="grid gap-3">
              {filteredConnections.map((conn) => (
                <Card
                  key={conn.id}
                  className="hover:border-primary/50 transition-colors cursor-pointer"
                  onClick={() => handleSelectConnection(conn)}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-center gap-2">
                      <Server className="h-4 w-4 text-muted-foreground" />
                      <CardTitle className="text-base">{conn.name}</CardTitle>
                      {conn.is_local && (
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">
                          Local
                        </span>
                      )}
                    </div>
                    <CardDescription>
                      {conn.host}:{conn.port}/{conn.database}
                    </CardDescription>
                  </CardHeader>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/")({
  component: Home,
});
