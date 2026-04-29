import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { motion } from "motion/react";
import { useCallback, useMemo, useState } from "react";
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
import { Icon } from "@/components/ui/Icon";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConnectionForm, ConnectionList, useConnectionsList } from "@/features/connection";
import {
  CreateLocalDbDialog,
  type CreateLocalDbInput,
  CloneToLocalDialog,
  useLocalDatabases,
  useCloneToLocal,
} from "@/features/localDb";
import { testConnection } from "@/features/database/hooks/db-actions";
import type { BranchInfo, TableRowCount } from "@/ipc/db/types";
import { LOCAL_DB_DEFAULT_PASSWORD } from "@/ipc/db/constants";
import type { Connection, ConnectionInput } from "@/ipc/db/types";
import { ipc } from "@/ipc/manager";
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
  const { create: createLocalDb, start: startLocalDb, pause: pauseLocalDb, remove: removeLocalDb, databases: localDbs, invalidateCache: invalidateLocalDbCache } = useLocalDatabases();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState("all");
  const [activeTagFilter, setActiveTagFilter] = useState("all-tags");
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

  // ── Branch management ──────────────────────────────────────────
  // Branch data is fetched on demand via IPC when users interact with local PG DBs.
  // We store results in a simple state map rather than using a hook per-DB
  // to avoid race conditions with hook query-key changes.
  const [branchesByDbId, setBranchesByDbId] = useState<Record<string, BranchInfo[]>>({});

  // Load branches for a specific local DB on demand
  const loadBranchesForDb = useCallback(async (localDbId: string) => {
    try {
      const branches = await ipc.client.db.listBranches({ localDbId });
      setBranchesByDbId((prev) => ({ ...prev, [localDbId]: branches }));
    } catch {
      // ignore — branches will simply not appear
    }
  }, []);

  const availableTags = useMemo(() => {
    const tags = new Set<string>();
    for (const connection of connections) {
      const tag = connection.tag?.trim();
      if (tag) tags.add(tag);
    }
    return Array.from(tags).sort((a, b) => a.localeCompare(b));
  }, [connections]);

  const filteredConnections = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return connections.filter((c) => {
      const matchesSearch =
        !q ||
        c.name.toLowerCase().includes(q) ||
        c.host.toLowerCase().includes(q) ||
        c.database.toLowerCase().includes(q) ||
        (c.url ?? "").toLowerCase().includes(q);

      if (!matchesSearch) return false;

      if (activeFilter === "all") return true;
      if (activeFilter === "local") return c.is_local;
      if (activeFilter === "remote") return !c.is_local;

      return false;
    });
  }, [connections, searchQuery, activeFilter]);

  const fullyFilteredConnections = useMemo(() => {
    if (activeTagFilter === "all-tags") return filteredConnections;
    if (activeTagFilter === "tagged") {
      return filteredConnections.filter((c) => Boolean(c.tag?.trim()));
    }
    if (activeTagFilter === "untagged") {
      return filteredConnections.filter((c) => !c.tag?.trim());
    }
    if (activeTagFilter.startsWith("tag:")) {
      const tagValue = activeTagFilter.slice(4);
      return filteredConnections.filter((c) => c.tag?.trim() === tagValue);
    }
    return filteredConnections;
  }, [filteredConnections, activeTagFilter]);

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
        db_type: "postgresql",
        host: "localhost",
        port: db.port ?? input.port,
        database: db.database_name || input.databaseName,
        username: db.username || input.username,
        password,
        ssl_mode: "disable",
        url: db.connection_string,
        is_local: true,
        connection_string: db.connection_string,
        engine_version: db.postgres_version ?? input.postgresVersion,
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
    if (connection.is_local) {
      const localDb = localDbById[connection.id];
      if (!localDb?.running) {
        toast.error(`Local database "${connection.name}" is not running. Start it before opening.`);
        return;
      }
      // Load branches for this DB when the user clicks it
      if (localDb.engine === "postgresql") {
        loadBranchesForDb(connection.id);
      }
    }

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
    <motion.div
      className="h-full flex flex-col"
      initial={{ paddingLeft: 24 }}
      animate={{ paddingLeft: 0 }}
      exit={{ paddingLeft: 24 }}
      transition={{ duration: 0.36, ease: [0.23, 1, 0.32, 1] }}
    >
      <div className="flex-1 flex flex-col bg-background rounded-md ring-1 ring-border/40 overflow-hidden">
        <div className="max-w-3xl mx-auto w-full px-5 py-5 flex-1 flex flex-col min-h-0 gap-5">
          {/* Page header */}
          <div className="flex items-center justify-between">
            <div className="flex items-baseline gap-2.5">
              <h1 className="text-base font-semibold">Databases</h1>
              {connections.length > 0 && (
                <span className="text-[11px] text-muted-foreground/70">
                  {[
                    remoteCount > 0 && `${remoteCount} remote`,
                    localCount > 0 && `${localCount} local`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              )}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button size="sm" className="h-7 text-xs gap-1">
                    <Icon name="plus" className="size-3.5" />
                    Add
                  </Button>
                }
              />
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleAdd}>
                  <Icon name="database" className="mr-2 size-4" />
                  Remote Connection
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleAddLocalDb}>
                  <Icon name="hard-drive" className="mr-2 size-4" />
                  New Local Database
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Search + filter status */}
          {connections.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-1">
                {[
                  { label: "All", value: "all" },
                  { label: "Local", value: "local" },
                  { label: "Remote", value: "remote" },
                ].map((chip) => (
                  <Button
                    key={chip.value}
                    type="button"
                    size="sm"
                    variant={activeFilter === chip.value ? "secondary" : "ghost"}
                    onClick={() => setActiveFilter(chip.value)}
                    className="h-6 px-2 text-[11px]"
                  >
                    {chip.label}
                  </Button>
                ))}
              </div>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Icon name="search" className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
                  <Input
                    placeholder="Search by name, host, or database…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-8 pl-8 text-xs"
                  />
                </div>
                <Select value={activeTagFilter} onValueChange={setActiveTagFilter}>
                  <SelectTrigger size="default" className="h-8 w-[180px] text-xs">
                    <SelectValue placeholder="Tag" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all-tags">All tags</SelectItem>
                    <SelectItem value="tagged">With tag</SelectItem>
                    <SelectItem value="untagged">Without tag</SelectItem>
                    {availableTags.map((tag) => (
                      <SelectItem key={tag} value={`tag:${tag}`}>
                        {tag}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {(searchQuery || activeFilter !== "all" || activeTagFilter !== "all-tags") &&
                connections.length !== fullyFilteredConnections.length && (
                <p className="text-[11px] text-muted-foreground/70">
                  Showing {fullyFilteredConnections.length} of {connections.length}
                </p>
                )}
            </div>
          )}

          {/* Divider */}
          <div className="border-t" />

          {/* Connection list */}
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain">
            <ConnectionList
              connections={fullyFilteredConnections}
              localDbById={localDbById}
              branchesByDbId={branchesByDbId}
              isLoading={isLoadingConnections}
              onAdd={handleAdd}
              onEdit={handleEdit}
              onDelete={handleDeleteRequest}
              onSelect={handleSelectConnection}
              onStartLocal={async (id) => {
                await startLocalDb(id);
                // Load branches after starting
                loadBranchesForDb(id);
              }}
              onPauseLocal={pauseLocalDb}
              onCloneToLocal={handleCloneToLocal}
              onCreateBranch={async (localDbId, input) => {
                const result = await ipc.client.db.createBranch({ localDbId, ...input });
                await loadBranchesForDb(localDbId);
                return result;
              }}
              onSwitchBranch={async (localDbId, branchId) => {
                const result = await ipc.client.db.switchBranch({ localDbId, branchId });
                await loadBranchesForDb(localDbId);
                invalidateLocalDbCache();
                return result;
              }}
              onDeleteBranch={async (localDbId, branchId) => {
                await ipc.client.db.deleteBranch({ localDbId, branchId });
                await loadBranchesForDb(localDbId);
              }}
            />
          </div>
        </div>
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => { if (!open) setPendingDelete(null); }}>
        <AlertDialogContent className="t-resize">
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
    </motion.div>
  );
}

export const Route = createFileRoute("/")({
  component: Home,
});
