import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Database, HardDrive, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { ConnectionForm } from "@/components/ConnectionForm";
import { ConnectionList } from "@/components/ConnectionList";
import {
  CreateLocalDbDialog,
  type CreateLocalDbInput,
} from "@/components/CreateLocalDbDialog";
import { CloneToLocalDialog } from "@/components/CloneToLocalDialog";
import { useConnectionsList } from "@/hooks/useConnectionsList";
import { testConnection } from "@/hooks/db-actions";
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
  } = useConnectionsList();
  const { create: createLocalDb, start: startLocalDb, pause: pauseLocalDb, remove: removeLocalDb, databases: localDbs } = useLocalDatabases();
  const [searchQuery, setSearchQuery] = useState("");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isLocalDbDialogOpen, setIsLocalDbDialogOpen] = useState(false);
  const [isCloneDialogOpen, setIsCloneDialogOpen] = useState(false);
  const [cloningConnection, setCloningConnection] = useState<Connection | null>(null);
  const [cloneRowCounts, setCloneRowCounts] = useState<TableRowCount[]>([]);
  const [isLoadingCloneSchema, setIsLoadingCloneSchema] = useState(false);
  const [editingConnection, setEditingConnection] = useState<Connection | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Connection | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
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

  const localCount = useMemo(
    () => connections.filter((c) => c.is_local).length,
    [connections],
  );
  const remoteCount = useMemo(
    () => connections.filter((c) => !c.is_local).length,
    [connections],
  );

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

  const handleDeleteRequest = (connection: Connection) => {
    setPendingDelete(connection);
  };

  const handleDeleteConfirm = async () => {
    if (!pendingDelete) return;
    setIsDeleting(true);
    const isLocal = pendingDelete.is_local;
    let localDbRemoved = false;
    try {
      if (isLocal) {
        await removeLocalDb(pendingDelete.id);
        localDbRemoved = true;
      }
      await deleteConnection(pendingDelete.id);
      useConnectionTabsStore.getState().removeTab(pendingDelete.id);
      toast.success("Connection deleted");
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to delete connection";
      if (isLocal && localDbRemoved) {
        toast.error(`Database removed but failed to delete connection entry: ${msg}`);
      } else {
        toast.error(msg);
      }
    } finally {
      setPendingDelete(null);
      setIsDeleting(false);
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
        <div className="max-w-2xl mx-auto w-full px-6 py-6 flex-1 flex flex-col min-h-0">
          {/* Page header */}
          <div className="flex items-start justify-between mb-4">
            <div>
              <h1 className="text-lg font-semibold tracking-tight">
                Databases
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                {connections.length === 0
                  ? "Connect to a database to get started"
                  : [
                      remoteCount > 0 && `${remoteCount} remote`,
                      localCount > 0 && `${localCount} local`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
              </p>
            </div>
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

          {/* Search */}
          {connections.length > 0 && (
            <div className="relative mb-3">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search by name, host, or database…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 pl-8 text-xs"
              />
            </div>
          )}

          {/* Filtered count indicator */}
          {searchQuery && connections.length !== filteredConnections.length && (
            <p className="text-[11px] text-muted-foreground mb-2">
              Showing {filteredConnections.length} of {connections.length}
            </p>
          )}

          <Separator className="mb-3" />

          {/* Connection list */}
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain">
            <ConnectionList
              connections={filteredConnections}
              localDbById={localDbById}
              isLoading={isLoadingConnections}
              onAdd={handleAdd}
              onEdit={handleEdit}
              onDelete={handleDeleteRequest}
              onSelect={handleSelectConnection}
              onStartLocal={startLocalDb}
              onPauseLocal={pauseLocalDb}
              onCloneToLocal={handleCloneToLocal}
            />
          </div>
        </div>
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => { if (!open) setPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete connection?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove <strong>{pendingDelete?.name}</strong> from your saved connections.
              {pendingDelete?.is_local && " The local PostgreSQL database will also be deleted."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleDeleteConfirm}
              disabled={isDeleting}
            >
              {isDeleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
