import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Database, HardDrive, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ConnectionForm } from "@/components/ConnectionForm";
import { ConnectionList } from "@/components/ConnectionList";
import {
  CreateLocalDbDialog,
  type CreateLocalDbInput,
} from "@/components/CreateLocalDbDialog";
import { CloneToLocalDialog } from "@/components/CloneToLocalDialog";
import { useConnections } from "@/hooks/useConnections";
import { useLocalDatabases } from "@/hooks/useLocalDatabases";
import { useCloneToLocal } from "@/hooks/useCloneToLocal";
import type { TableRowCount } from "@/ipc/db/types";
import { LOCAL_DB_DEFAULT_PASSWORD } from "@/ipc/db/constants";
import type { Connection, ConnectionInput } from "@/ipc/db/types";
import {
  buildConnectionTab,
  useConnectionTabsStore,
} from "@/lib/stores/connection-tabs";

function Home() {
  const {
    connections,
    isLoading: isLoadingConnections,
    saveConnection,
    deleteConnection,
    testConnection,
  } = useConnections();
  const { create: createLocalDb, start: startLocalDb, pause: pauseLocalDb, databases: localDbs } = useLocalDatabases();
  const [searchQuery, setSearchQuery] = useState("");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isLocalDbDialogOpen, setIsLocalDbDialogOpen] = useState(false);
  const [isCloneDialogOpen, setIsCloneDialogOpen] = useState(false);
  const [cloningConnection, setCloningConnection] = useState<Connection | null>(null);
  const [cloneRowCounts, setCloneRowCounts] = useState<TableRowCount[]>([]);
  const [isLoadingCloneSchema, setIsLoadingCloneSchema] = useState(false);
  const [editingConnection, setEditingConnection] = useState<Connection | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isCreatingLocalDb, setIsCreatingLocalDb] = useState(false);
  const navigate = useNavigate();

  const {
    isLoading: isCloning,
    progress: cloneProgress,
    error: cloneError,
    exportSchema,
    cloneToLocal,
    cancelClone,
    reset: resetClone,
  } = useCloneToLocal();

  const localDbById = useMemo(() => {
    const map: Record<string, typeof localDbs[number]> = {};
    for (const db of localDbs) {
      map[db.id] = db;
    }
    return map;
  }, [localDbs]);

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
    setEditingConnection(null);
    setIsFormOpen(true);
  };

  const handleAddLocalDb = () => {
    setIsLocalDbDialogOpen(true);
  };

  const handleCreateLocalDb = async (input: CreateLocalDbInput) => {
    setIsCreatingLocalDb(true);
    try {
      const password = input.password.trim() || LOCAL_DB_DEFAULT_PASSWORD;
      const db = await createLocalDb({
        name: input.name,
        databaseName: input.databaseName,
        username: input.username,
        password,
        port: input.port,
        postgresVersion: input.postgresVersion,
        autoStart: input.autoStart,
      });

      // Create a connection entry that points to the local embedded postgres
      const localConnection: ConnectionInput = {
        id: db.id,
        name: db.name,
        host: "localhost",
        port: db.port ?? input.port,
        database: db.database_name || input.databaseName,
        username: db.username || input.username,
        password,
        ssl_mode: "disable",
        url: db.connection_string,
        is_local: true,
        connection_string: db.connection_string,
        postgres_version: db.postgres_version ?? input.postgresVersion,
        tag: input.tag,
        color: input.color,
        local_auto_start: db.auto_start,
      };

      try {
        await saveConnection(localConnection);
      } catch (error) {
        throw new Error(
          error instanceof Error
            ? `Failed to save local connection: ${error.message}`
            : "Failed to save local connection",
        );
      }
      navigate({
        to: "/database/$connectionId",
        params: { connectionId: db.id },
      });
      useConnectionTabsStore.getState().addTab({
        id: db.id,
        name: db.name,
        isLocal: true,
        color: input.color,
        provider: "direct",
      });
      setIsLocalDbDialogOpen(false);
      toast.success("Local database created successfully");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create local database");
    } finally {
      setIsCreatingLocalDb(false);
    }
  };

  const handleSave = async (connection: ConnectionInput) => {
    setIsSaving(true);
    try {
      await saveConnection(connection);
      setIsFormOpen(false);
      toast.success("Connection saved successfully");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save connection");
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async (connection: ConnectionInput): Promise<boolean> => {
    setIsTesting(true);
    try {
      return await testConnection(connection);
    } finally {
      setIsTesting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteConnection(id);
      toast.success("Connection deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete connection");
    }
  };

  const handleEdit = (connection: Connection) => {
    setEditingConnection(connection);
    setIsFormOpen(true);
  };

  const handleSelectConnection = (connection: Connection) => {
    // Add tab synchronously BEFORE navigating so it appears instantly
    useConnectionTabsStore.getState().addTab(buildConnectionTab(connection));
    navigate({
      to: "/database/$connectionId",
      params: { connectionId: connection.id },
    });
  };

  const handleCloneToLocal = async (connection: Connection) => {
    setCloningConnection(connection);
    setIsCloneDialogOpen(true);
    setIsLoadingCloneSchema(true);
    resetClone();

    try {
      const schemaResult = await exportSchema(connection.id);
      if (schemaResult) {
        setCloneRowCounts(schemaResult.tableRowCounts);
      } else {
        setCloneRowCounts([]);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load schema");
      setCloneRowCounts([]);
    } finally {
      setIsLoadingCloneSchema(false);
    }
  };

  const handleStartClone = async (
    targetName: string,
    selectedTables: { schema: string; table: string; importData: boolean }[],
    postgresVersion: string,
  ) => {
    if (!cloningConnection) return;

    try {
      const newConnection = await cloneToLocal(
        cloningConnection,
        targetName,
        selectedTables,
        postgresVersion,
      );

      if (newConnection) {
        // Add tab and navigate to the new connection
        useConnectionTabsStore.getState().addTab({
          id: newConnection.id,
          name: newConnection.name,
          isLocal: true,
          provider: "direct",
        });
        navigate({
          to: "/database/$connectionId",
          params: { connectionId: newConnection.id },
        });
        toast.success(`Database "${targetName}" cloned successfully`);
        setIsCloneDialogOpen(false);
        setCloningConnection(null);
        setCloneRowCounts([]);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Clone failed");
    }
  };

  const handleCloseCloneDialog = () => {
    if (!isCloning) {
      setIsCloneDialogOpen(false);
      setCloningConnection(null);
      setCloneRowCounts([]);
      resetClone();
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="border-x border-b rounded-lg flex-1 flex flex-col bg-background overflow-hidden">
        <div className="max-w-7xl mx-auto w-full px-12 sm:px-36 md:px-56 lg:px-72 py-4 sm:py-6 lg:py-8 flex-1 flex flex-col min-h-0">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] text-muted-foreground font-mono">
              {filteredConnections.length}{" "}
              {filteredConnections.length === 1 ? "database" : "databases"}
              {searchQuery &&
                connections.length !== filteredConnections.length && (
                  <> · {connections.length} total</>
                )}
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button size="sm" />}>
                <Plus className="h-3.5 w-3.5 mr-1.5" />
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
            <div className="relative mb-1.5">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search connections…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-7 pl-7 text-xs"
              />
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain">
            <ConnectionList
              connections={filteredConnections}
              localDbById={localDbById}
              isLoading={isLoadingConnections}
              onAdd={handleAdd}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onSelect={handleSelectConnection}
              onStartLocal={startLocalDb}
              onPauseLocal={pauseLocalDb}
              onCloneToLocal={handleCloneToLocal}
            />
          </div>
        </div>
      </div>

      <ConnectionForm
        connection={editingConnection}
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        onSave={handleSave}
        onTest={handleTest}
        isSaving={isSaving}
        isTesting={isTesting}
      />

      <CreateLocalDbDialog
        isOpen={isLocalDbDialogOpen}
        onClose={() => setIsLocalDbDialogOpen(false)}
        onCreate={handleCreateLocalDb}
        isCreating={isCreatingLocalDb}
      />

      <CloneToLocalDialog
        isOpen={isCloneDialogOpen}
        onClose={handleCloseCloneDialog}
        sourceConnection={cloningConnection}
        tableRowCounts={cloneRowCounts}
        isLoadingSchema={isLoadingCloneSchema}
        onStartClone={handleStartClone}
        onCancelClone={cancelClone}
        progress={cloneProgress}
        isCloning={isCloning}
        error={cloneError}
      />
    </div>
  );
}

export const Route = createFileRoute("/")({
  component: Home,
});
