import { useQueryClient } from "@tanstack/react-query";
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
import {
  ConnectionForm,
  ConnectionList,
  useConnectionsList,
} from "@/features/connection";
import {
  getConnection,
  testConnection,
} from "@/features/database/hooks/db-actions";
import {
  CloneToLocalDialog,
  CreateLocalDbDialog,
  type CreateLocalDbInput,
  useCloneToLocal,
  useLocalDatabases,
} from "@/features/localDb";
import { LOCAL_DB_DEFAULT_PASSWORD } from "@/ipc/db/constants";
import type {
  BranchInfo,
  Connection,
  ConnectionInput,
  TableRowCount,
} from "@/ipc/db/types";
import { ipc } from "@/ipc/manager";
import {
  buildConnectionTab,
  useConnectionTabsStore,
} from "@/lib/stores/connection-tabs";
import { cn } from "@/lib/utils";

function Home() {
  const {
    connections,
    isLoading: isLoadingConnections,
    saveConnection,
    deleteConnection,
  } = useConnectionsList();
  const {
    create: createLocalDb,
    start: startLocalDb,
    pause: pauseLocalDb,
    remove: removeLocalDb,
    databases: localDbs,
    invalidateCache: invalidateLocalDbCache,
  } = useLocalDatabases();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState("all");
  const [activeTagFilter, setActiveTagFilter] = useState("all-tags");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isLocalDbDialogOpen, setIsLocalDbDialogOpen] = useState(false);
  const [isCloneDialogOpen, setIsCloneDialogOpen] = useState(false);
  const [cloningConnection, setCloningConnection] = useState<Connection | null>(
    null
  );
  const [cloneRowCounts, setCloneRowCounts] = useState<TableRowCount[]>([]);
  const [clonedConnection, setClonedConnection] = useState<Connection | null>(
    null
  );
  const [isLoadingCloneSchema, setIsLoadingCloneSchema] = useState(false);
  const [editingConnection, setEditingConnection] = useState<Connection | null>(
    null
  );
  const [pendingDelete, setPendingDelete] = useState<Connection | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isCreatingLocalDb, setIsCreatingLocalDb] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

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
    const map: Record<string, (typeof localDbs)[number]> = {};
    for (const db of localDbs) {
      map[db.id] = db;
    }
    return map;
  }, [localDbs]);

  // ── Branch management ──────────────────────────────────────────
  // Branch data is fetched on demand via IPC when users interact with local PG DBs.
  // We store results in a simple state map rather than using a hook per-DB
  // to avoid race conditions with hook query-key changes.
  const [branchesByDbId, setBranchesByDbId] = useState<
    Record<string, BranchInfo[]>
  >({});

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
      if (tag) {
        tags.add(tag);
      }
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

      if (!matchesSearch) {
        return false;
      }

      if (activeFilter === "all") {
        return true;
      }
      if (activeFilter === "local") {
        return c.is_local;
      }
      if (activeFilter === "remote") {
        return !c.is_local;
      }

      return false;
    });
  }, [connections, searchQuery, activeFilter]);

  const fullyFilteredConnections = useMemo(() => {
    if (activeTagFilter === "all-tags") {
      return filteredConnections;
    }
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
    [connections]
  );
  const remoteCount = useMemo(
    () => connections.filter((c) => !c.is_local).length,
    [connections]
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
      const normalizedName = input.name.trim();
      if (!normalizedName) {
        throw new Error("Local database name is required");
      }
      const password = input.password.trim() || LOCAL_DB_DEFAULT_PASSWORD;
      const db = await createLocalDb({
        name: normalizedName,
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
            : "Failed to save local connection"
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
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to create local database"
      );
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
      toast.error(
        error instanceof Error ? error.message : "Failed to save connection"
      );
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
    if (!pendingDelete) {
      return;
    }
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
      const msg =
        error instanceof Error ? error.message : "Failed to delete connection";
      if (isLocal && localDbRemoved) {
        toast.error(
          `Database removed but failed to delete connection entry: ${msg}`
        );
      } else {
        toast.error(msg);
      }
    } finally {
      setPendingDelete(null);
      setIsDeleting(false);
    }
  };

  const handleEdit = async (connection: Connection) => {
    const completeConnection = await getConnection(connection.id);
    setEditingConnection(completeConnection ?? connection);
    setIsFormOpen(true);
  };

  const handleSelectConnection = (connection: Connection) => {
    if (connection.is_local) {
      const localDb = localDbById[connection.id];
      if (!localDb?.running) {
        toast.error(
          `Local database "${connection.name}" is not running. Start it before opening.`
        );
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
    setClonedConnection(null);
    resetClone();

    try {
      const schemaResult = await exportSchema(connection.id);
      if (schemaResult) {
        setCloneRowCounts(schemaResult.tableRowCounts);
      } else {
        setCloneRowCounts([]);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to load schema"
      );
      setCloneRowCounts([]);
    } finally {
      setIsLoadingCloneSchema(false);
    }
  };

  const handleStartClone = async (
    targetName: string,
    selectedTables: { schema: string; table: string; importData: boolean }[],
    postgresVersion: string
  ) => {
    if (!cloningConnection) {
      return;
    }

    try {
      const newConnection = await cloneToLocal(
        cloningConnection,
        targetName,
        selectedTables,
        postgresVersion
      );

      if (newConnection) {
        setClonedConnection(newConnection);
        toast.success(`Database "${targetName}" cloned successfully`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Clone failed");
    }
  };

  const handleOpenClonedDatabase = () => {
    if (!clonedConnection) {
      return;
    }

    useConnectionTabsStore.getState().addTab({
      id: clonedConnection.id,
      name: clonedConnection.name,
      isLocal: true,
      provider: "direct",
    });
    navigate({
      to: "/database/$connectionId",
      params: { connectionId: clonedConnection.id },
    });

    setIsCloneDialogOpen(false);
    setCloningConnection(null);
    setCloneRowCounts([]);
    setClonedConnection(null);
    resetClone();
  };

  const handleCloseCloneDialog = () => {
    if (!isCloning) {
      setIsCloneDialogOpen(false);
      setCloningConnection(null);
      setCloneRowCounts([]);
      setClonedConnection(null);
      resetClone();
    }
  };

  return (
    <motion.div
      animate={{ paddingLeft: 0 }}
      className="flex h-full flex-col"
      exit={{ paddingLeft: 24 }}
      initial={{ paddingLeft: 24 }}
      transition={{ duration: 0.36, ease: [0.23, 1, 0.32, 1] }}
    >
      <div className="flex flex-1 flex-col overflow-hidden rounded-md border bg-background">
        <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-5 px-5 py-5">
          {/* Page header */}
          <div className="flex items-center justify-between">
            <div className="flex items-baseline gap-2.5">
              <h1 className="font-semibold text-base">Databases</h1>
              {connections.length > 0 && (
                <span className="text-[11px] text-muted-foreground/60 tabular-nums">
                  {connections.length}
                </span>
              )}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    className="h-8 gap-1.5 px-3 text-xs shadow-sm"
                    size="sm"
                  >
                    <Icon className="size-3.5" name="plus" />
                    Add
                  </Button>
                }
              />
              <DropdownMenuContent align="end" className="min-w-[180px]">
                <DropdownMenuItem className="gap-2 text-xs" onClick={handleAdd}>
                  <Icon className="size-3.5" name="database" />
                  Remote Connection
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="gap-2 text-xs"
                  onClick={handleAddLocalDb}
                >
                  <Icon className="size-3.5" name="hard-drive" />
                  New Local Database
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Search + filter status */}
          {connections.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Icon
                    className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground/50"
                    name="search"
                  />
                  <Input
                    className="h-8 bg-muted/20 pl-8 text-xs"
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by name, host, or database…"
                    value={searchQuery}
                  />
                </div>
                <Select
                  onValueChange={(value) => {
                    if (value !== null) {
                      setActiveTagFilter(value);
                    }
                  }}
                  value={activeTagFilter}
                >
                  <SelectTrigger
                    className="h-8 w-[160px] bg-muted/20 text-xs"
                    size="default"
                  >
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
              <div className="flex flex-wrap items-center gap-1">
                {[
                  { label: "All", value: "all", count: connections.length },
                  { label: "Local", value: "local", count: localCount },
                  { label: "Remote", value: "remote", count: remoteCount },
                ].map((chip) => (
                  <button
                    className={cn(
                      "flex items-center gap-1.5 rounded-full border px-3 py-1 font-medium text-[11px] transition-colors duration-150 active:scale-[0.97]",
                      activeFilter === chip.value
                        ? "border-primary/40 bg-primary/10 text-primary shadow-sm"
                        : "border-border/60 text-muted-foreground hover:border-muted-foreground/40 hover:bg-muted/30 hover:text-foreground"
                    )}
                    key={chip.value}
                    onClick={() => setActiveFilter(chip.value)}
                    type="button"
                  >
                    {chip.label}
                    <span className="text-[10px] text-muted-foreground/50 tabular-nums">
                      {chip.count}
                    </span>
                  </button>
                ))}
              </div>
              {(searchQuery ||
                activeFilter !== "all" ||
                activeTagFilter !== "all-tags") &&
                connections.length !== fullyFilteredConnections.length && (
                  <p className="text-[10px] text-muted-foreground/50 tabular-nums">
                    Showing {fullyFilteredConnections.length} of{" "}
                    {connections.length}
                  </p>
                )}
            </div>
          )}

          {/* Divider */}
          <div className="border-border/40 border-t" />

          {/* Connection list */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
            <ConnectionList
              branchesByDbId={branchesByDbId}
              connections={fullyFilteredConnections}
              isLoading={isLoadingConnections}
              localDbById={localDbById}
              onAdd={handleAdd}
              onCloneToLocal={handleCloneToLocal}
              onCreateBranch={async (localDbId, input) => {
                const result = await ipc.client.db.createBranch({
                  localDbId,
                  ...input,
                });
                await loadBranchesForDb(localDbId);
                return result;
              }}
              onDelete={handleDeleteRequest}
              onDeleteBranch={async (localDbId, branchId) => {
                await ipc.client.db.deleteBranch({ localDbId, branchId });
                await loadBranchesForDb(localDbId);
              }}
              onEdit={handleEdit}
              onPauseLocal={pauseLocalDb}
              onPreviewDeleteBranch={async (localDbId, branchId) =>
                ipc.client.db.previewDeleteBranch({ localDbId, branchId })
              }
              onSelect={handleSelectConnection}
              onStartLocal={async (id) => {
                await startLocalDb(id);
                // Load branches after starting
                loadBranchesForDb(id);
              }}
              onSwitchBranch={async (localDbId, branchId) => {
                const result = await ipc.client.db.switchBranch({
                  localDbId,
                  branchId,
                });
                await loadBranchesForDb(localDbId);
                invalidateLocalDbCache();
                await queryClient.invalidateQueries({
                  predicate: (query) =>
                    Array.isArray(query.queryKey) &&
                    query.queryKey.includes(localDbId),
                });
                return result;
              }}
            />
          </div>
        </div>
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog
        onOpenChange={(open) => {
          if (!open) {
            setPendingDelete(null);
          }
        }}
        open={!!pendingDelete}
      >
        <AlertDialogContent className="t-resize sm:max-w-[400px]">
          <AlertDialogHeader className="gap-2">
            <AlertDialogTitle className="flex items-center gap-2 text-sm">
              <Icon
                className="size-4 text-destructive/70"
                name="alert-triangle"
              />
              Delete connection?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs leading-relaxed">
              This will remove{" "}
              <strong className="text-foreground">{pendingDelete?.name}</strong>{" "}
              from your saved connections.
              {pendingDelete?.is_local &&
                " The local database will also be deleted."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2.5 border-t bg-muted/30 px-6 py-3.5">
            <AlertDialogCancel className="h-8 px-3 text-xs">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-8 gap-1.5 px-5 text-xs shadow-sm"
              disabled={isDeleting}
              onClick={handleDeleteConfirm}
              variant="destructive"
            >
              {isDeleting ? (
                <>
                  <Icon className="size-3.5 animate-spin" name="loader" />
                  Deleting…
                </>
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ConnectionForm
        connection={editingConnection}
        connections={connections}
        isOpen={isFormOpen}
        isSaving={isSaving}
        isTesting={isTesting}
        onClose={() => setIsFormOpen(false)}
        onSave={handleSave}
        onTest={handleTest}
      />

      <CreateLocalDbDialog
        isCreating={isCreatingLocalDb}
        isOpen={isLocalDbDialogOpen}
        onClose={() => setIsLocalDbDialogOpen(false)}
        onCreate={handleCreateLocalDb}
      />

      <CloneToLocalDialog
        clonedDatabaseName={clonedConnection?.name}
        error={cloneError}
        isCloning={isCloning}
        isLoadingSchema={isLoadingCloneSchema}
        isOpen={isCloneDialogOpen}
        onCancelClone={cancelClone}
        onClose={handleCloseCloneDialog}
        onOpenClonedDatabase={handleOpenClonedDatabase}
        onStartClone={handleStartClone}
        progress={cloneProgress}
        sourceConnection={cloningConnection}
        tableRowCounts={cloneRowCounts}
      />
    </motion.div>
  );
}

export const Route = createFileRoute("/")({
  component: Home,
});
