import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ChevronLeft,
  Copy,
  Database,
  FileSearch,
  GitGraph,
  Loader2,
  Lock,
  LockOpen,
  LockKeyhole,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Table2,
  Terminal,
  Trash2,
} from "lucide-react";
import { startTransition, useCallback, useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AddColumnDialog,
  AlterColumnTypeDialog,
  CreateIndexDialog,
  CreateSchemaDialog,
  CreateTableDialog,
  DropColumnDialog,
  DropTableDialog,
  ImportCsvDialog,
  RenameColumnDialog,
  RenameTableDialog,
  SetColumnDefaultDialog,
  SetColumnNullableDialog,
} from "@/components/TableDdlDialogs";
import { RlsPoliciesDialog } from "@/components/RlsPoliciesDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useConnections } from "@/hooks/useConnections";
import { useLocalDatabases } from "@/hooks/useLocalDatabases";
import {
  buildConnectionTab,
  useConnectionTabsStore,
} from "@/lib/stores/connection-tabs";
import { DatabaseOverview } from "@/components/DatabaseOverview";
import { SqlEditor } from "@/components/SqlEditor";
import { TableDataEditor } from "@/components/TableDataEditor";
import { SchemaVisualizer } from "@/components/SchemaVisualizer";
import type { SchemaTableSummary, DatabaseInfo, LocalDbInfo, SchemaTableDetails, SchemaPolicy } from "@/ipc/db/types";

type SidebarSection = "overview" | "tables" | "sql-editor" | "visualizer" | "settings";

export const Route = createFileRoute("/database/$connectionId")({
  component: DatabasePage,
});

function DatabasePage() {
  const { connectionId } = Route.useParams();
  // The actual content is rendered by TabbedConnectionView (keep-alive).
  // This route component only ensures the URL is matched and the tab
  // is registered in the store. It renders nothing itself — the tab
  // container renders DatabasePageContent for all open tabs with CSS
  // show/hide so their state is preserved when switching.
  const store = useConnectionTabsStore.getState();
  if (!store.tabs.some((t) => t.id === connectionId)) {
    // Tab not yet in the store — the page will register it via the
    // useEffect inside DatabasePageContent when it mounts.
  }
  return null;
}

interface DatabasePageContentProps {
  connectionId: string;
  isActive?: boolean;
}

export function DatabasePageContent({ connectionId, isActive = true }: DatabasePageContentProps) {
  const navigate = useNavigate();
  const {
    connections,
    getSchemaSummary,
    executeQuery,
    refetch,
    getDatabaseInfo,
    testConnection,
    getTableDetails,
    tableListRows,
    tableSaveChanges,
    tableTruncate,
    tableFkLookup,
    createTable,
    dropTable,
    renameTable,
    addColumn,
    createSchema,
    createIndex,
    dropColumn,
    renameColumn,
    alterColumnType,
    setColumnDefault,
    setColumnNullable,
  } = useConnections();
  const { start: startLocalDb, pause: pauseLocalDb, getStatus: getLocalDbStatus } = useLocalDatabases();
  const { setTabNavState, tabs } = useConnectionTabsStore();

  const storedTab = tabs.find((t) => t.id === connectionId);
  const [activeSection, setActiveSection] = useState<SidebarSection>(
    storedTab?.lastSection ?? "tables"
  );
  const [selectedSchema, setSelectedSchema] = useState<string>(
    storedTab?.lastSchema ?? "public"
  );
  const [selectedTableKey, setSelectedTableKey] = useState<string | null>(
    storedTab?.lastTable ?? null
  );

  const [tables, setTables] = useState<SchemaTableSummary[]>([]);
  const [schemas, setSchemas] = useState<string[]>([]);
  const [initialSqlQuery, setInitialSqlQuery] = useState<string | null>(null);
  const [tableSearch, setTableSearch] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<null | "copied" | "failed">(null);
  const [isTogglingLocalDb, setIsTogglingLocalDb] = useState(false);
  const [databaseInfo, setDatabaseInfo] = useState<DatabaseInfo | null>(null);
  const [isLoadingDatabaseInfo, setIsLoadingDatabaseInfo] = useState(false);
  const [localDbStatus, setLocalDbStatus] = useState<LocalDbInfo | null>(null);
  const [isLoadingLocalDbStatus, setIsLoadingLocalDbStatus] = useState(false);
  const [copyConnFeedback, setCopyConnFeedback] = useState<null | "copied" | "failed">(null);
  const [isCreateTableOpen, setIsCreateTableOpen] = useState(false);
  const [isCreateSchemaOpen, setIsCreateSchemaOpen] = useState(false);
  const [isCreateIndexOpen, setIsCreateIndexOpen] = useState(false);
  const [isImportCsvOpen, setIsImportCsvOpen] = useState(false);
  const [ddlDropTarget, setDdlDropTarget] = useState<{ schema: string; name: string } | null>(null);
  const [ddlRenameTarget, setDdlRenameTarget] = useState<{ schema: string; name: string } | null>(null);
  const [ddlAddColumnTarget, setDdlAddColumnTarget] = useState<{ schema: string; name: string } | null>(null);
  const [ddlDropColumnTarget, setDdlDropColumnTarget] = useState<{
    schema: string;
    table: string;
    column: string;
  } | null>(null);
  const [ddlRenameColumnTarget, setDdlRenameColumnTarget] = useState<{
    schema: string;
    table: string;
    column: string;
  } | null>(null);
  const [ddlAlterColumnTypeTarget, setDdlAlterColumnTypeTarget] = useState<{
    schema: string;
    table: string;
    column: string;
    currentType: string;
  } | null>(null);
  const [ddlSetColumnDefaultTarget, setDdlSetColumnDefaultTarget] = useState<{
    schema: string;
    table: string;
    column: string;
    currentDefault: null | string;
  } | null>(null);
  const [ddlSetColumnNullableTarget, setDdlSetColumnNullableTarget] = useState<{
    schema: string;
    table: string;
    column: string;
    isNullable: boolean;
  } | null>(null);
  const [rlsPoliciesTarget, setRlsPoliciesTarget] = useState<{ schema: string; name: string } | null>(null);
  const [rlsPolicies, setRlsPolicies] = useState<SchemaPolicy[]>([]);
  const [isLoadingRlsPolicies, setIsLoadingRlsPolicies] = useState(false);
  const [visualizerTables, setVisualizerTables] = useState<SchemaTableDetails[]>([]);
  const [isLoadingVisualizer, setIsLoadingVisualizer] = useState(false);

  const queryClient = useQueryClient();

  // Section flags - definidas antes de serem usadas
  const isTablesSection = activeSection === "tables";
  const isSqlEditorSection = activeSection === "sql-editor";
  const isOverviewSection = activeSection === "overview";
  const isVisualizerSection = activeSection === "visualizer";
  const isSettingsSection = activeSection === "settings";

  const connection = useMemo(
    () => connections.find((c) => c.id === connectionId),
    [connections, connectionId],
  );

  // Ensure a tab exists for this connection (handles page refresh / direct URL)
  // This is synchronizing with an external store (zustand) — a valid use of Effect.
  useEffect(() => {
    if (!connection) return;
    const store = useConnectionTabsStore.getState();
    if (!store.tabs.some((t) => t.id === connectionId)) {
      store.addTab(buildConnectionTab(connection));
    } else if (store.activeTabId !== connectionId) {
      store.setActiveTab(connectionId);
    }
  }, [connection, connectionId]);

  const loadSchema = useCallback(async () => {
    if (!connectionId) return;
    setIsLoading(true);
    try {
      const summary = await getSchemaSummary(connectionId);
      setSchemas(summary.schemas);
      setTables(summary.tables);
      if (summary.schemas.length > 0 && !selectedSchema) {
        setSelectedSchema(summary.schemas[0]);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load schema");
    } finally {
      setIsLoading(false);
    }
  }, [connectionId, getSchemaSummary, selectedSchema]);

  useEffect(() => {
    // Only load schema when the tab is active — skip IPC calls for background tabs
    if (!isActive) return;
    loadSchema();
  }, [loadSchema, isActive]);

  const loadDatabaseInfo = useCallback(async () => {
    if (!connectionId) return;
    setIsLoadingDatabaseInfo(true);
    try {
      const info = await getDatabaseInfo(connectionId);
      setDatabaseInfo(info);
    } catch (error) {
      console.error("Failed to load database info", error);
    } finally {
      setIsLoadingDatabaseInfo(false);
    }
  }, [connectionId, getDatabaseInfo]);

  const loadLocalDbStatus = useCallback(async () => {
    if (!connectionId || !connection?.is_local) return;
    setIsLoadingLocalDbStatus(true);
    try {
      const status = await getLocalDbStatus(connectionId);
      setLocalDbStatus(status);
    } catch (error) {
      console.error("Failed to load local db status", error);
    } finally {
      setIsLoadingLocalDbStatus(false);
    }
  }, [connectionId, connection?.is_local, getLocalDbStatus]);

  // Helpers: update state AND persist to store in the same event handler
  // (instead of separate Effects that watch these values — anti-pattern per React docs)
  const loadVisualizerData = useCallback(async () => {
    if (!connectionId || tables.length === 0) return;
    setIsLoadingVisualizer(true);
    try {
      const tableDetails = await Promise.all(
        tables.map((t) => getTableDetails(connectionId, t.schema, t.name))
      );
      setVisualizerTables(tableDetails);
    } catch (error) {
      console.error("Failed to load visualizer data", error);
      toast.error("Failed to load schema visualizer data");
    } finally {
      setIsLoadingVisualizer(false);
    }
  }, [connectionId, tables, getTableDetails]);

  const changeSection = useCallback((section: SidebarSection) => {
    setActiveSection(section);
    setTabNavState(connectionId, {
      section,
      schema: selectedSchema,
      table: selectedTableKey ?? undefined,
    });
    if (section === "overview") {
      loadDatabaseInfo();
      loadLocalDbStatus();
    }
    if (section === "visualizer") {
      loadVisualizerData();
    }
  }, [connectionId, selectedSchema, selectedTableKey, setTabNavState, loadDatabaseInfo, loadLocalDbStatus, loadVisualizerData]);

  const changeSchema = useCallback((schema: string) => {
    setSelectedSchema(schema);
    setTabNavState(connectionId, {
      section: activeSection,
      schema,
      table: selectedTableKey ?? undefined,
    });
  }, [connectionId, activeSection, selectedTableKey, setTabNavState]);

  const changeTable = useCallback((tableKey: string | null) => {
    // Mark the (potentially expensive) table switch as a non-urgent transition
    // so React can prioritize the click feedback (highlight, focus) and
    // interrupt if the user quickly clicks another table.
    startTransition(() => {
      setSelectedTableKey(tableKey);
    });
    setTabNavState(connectionId, {
      section: activeSection,
      schema: selectedSchema,
      table: tableKey ?? undefined,
    });
  }, [connectionId, activeSection, selectedSchema, setTabNavState]);

  // Clean up initial SQL query after sql-editor renders it (valid Effect:
  // synchronizing with a child component that consumes the one-shot value)
  useEffect(() => {
    if (activeSection === "sql-editor" && initialSqlQuery) {
      const timer = setTimeout(() => setInitialSqlQuery(null), 100);
      return () => clearTimeout(timer);
    }
  }, [activeSection, initialSqlQuery]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refetch();
    await loadSchema();
    if (activeSection === "overview") {
      await loadDatabaseInfo();
      await loadLocalDbStatus();
    }
    setIsRefreshing(false);
  };

  const handleTestConnection = async () => {
    if (!connection) return;
    try {
      await testConnection(connection);
      toast.success("Connection test successful");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Connection test failed");
    }
  };

  const handleStartLocalDb = async () => {
    if (!connectionId) return;
    setIsTogglingLocalDb(true);
    try {
      await startLocalDb(connectionId);
      await loadLocalDbStatus();
      toast.success("Database started");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to start database");
    } finally {
      setIsTogglingLocalDb(false);
    }
  };

  const handlePauseLocalDb = async () => {
    if (!connectionId) return;
    setIsTogglingLocalDb(true);
    try {
      await pauseLocalDb(connectionId);
      await loadLocalDbStatus();
      toast.success("Database paused");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to pause database");
    } finally {
      setIsTogglingLocalDb(false);
    }
  };

  const handleCopyConnectionString = async () => {
    if (!connection) return;
    try {
      const connStr = connection.url ||
        `postgres://${connection.username}:${connection.password}@${connection.host}:${connection.port}/${connection.database}?sslmode=${connection.ssl_mode}`;
      await navigator.clipboard.writeText(connStr);
      setCopyConnFeedback("copied");
      setTimeout(() => setCopyConnFeedback(null), 2000);
    } catch {
      setCopyConnFeedback("failed");
      setTimeout(() => setCopyConnFeedback(null), 2000);
    }
  };

  const handleCopyConnection = async () => {
    if (!connection) return;
    try {
      const connStr = connection.url ||
        `postgres://${connection.username}:${connection.password}@${connection.host}:${connection.port}/${connection.database}?sslmode=${connection.ssl_mode}`;
      await navigator.clipboard.writeText(connStr);
      setCopyFeedback("copied");
      toast.success("Connection string copied");
    } catch {
      setCopyFeedback("failed");
      toast.error("Failed to copy");
    }
    setTimeout(() => setCopyFeedback(null), 2000);
  };

  const tablesBySchema = useMemo(() => {
    const grouped = new Map<string, SchemaTableSummary[]>();
    for (const table of tables) {
      const current = grouped.get(table.schema) ?? [];
      current.push(table);
      grouped.set(table.schema, current);
    }
    for (const arr of grouped.values()) {
      arr.sort((a, b) => a.name.localeCompare(b.name));
    }
    return Array.from(grouped.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [tables]);

  const filteredTablesForSchema = useMemo(() => {
    if (!selectedSchema) return [];
    const group = tablesBySchema.find(([s]) => s === selectedSchema);
    if (!group) return [];
    const needle = tableSearch.trim().toLowerCase();
    if (!needle) return group[1];
    return group[1].filter((table) => table.name.toLowerCase().includes(needle));
  }, [selectedSchema, tablesBySchema, tableSearch]);

  const selectedTableRef = useMemo(() => {
    if (!selectedTableKey) return null;
    const dotIdx = selectedTableKey.indexOf(".");
    if (dotIdx <= 0) return null;
    return {
      schema: selectedTableKey.slice(0, dotIdx),
      name: selectedTableKey.slice(dotIdx + 1),
    };
  }, [selectedTableKey]);

  const selectedTable = selectedTableRef?.name ?? null;

  // React Query for table details — gives us cache, keepPreviousData for smooth
  // transitions, and automatic revalidation. Trocar para uma tabela já visitada
  // é instantâneo (cache hit); primeira visita mostra skeleton.
  const tableDetailsQueryKey = useMemo(
    () => [
      "table-details",
      connectionId,
      selectedTableRef?.schema ?? null,
      selectedTableRef?.name ?? null,
    ] as const,
    [connectionId, selectedTableRef],
  );

  const {
    data: selectedTableDetails = null,
    isFetching: isFetchingTableDetails,
  } = useQuery({
    queryKey: tableDetailsQueryKey,
    queryFn: () => {
      if (!selectedTableRef) return null;
      return getTableDetails(connectionId, selectedTableRef.schema, selectedTableRef.name);
    },
    enabled: isActive && !!selectedTableRef,
    // Keep the previous table's details rendered while the new one loads —
    // header/chrome stays mounted; TableDataEditor gets isSwitchingTable=true.
    placeholderData: keepPreviousData,
    staleTime: 2 * 60_000,
    gcTime: 15 * 60_000,
  });

  const isLoadingTableDetails = isFetchingTableDetails;

  // Invalidate table details cache on DDL changes so next read refetches.
  const invalidateTableDetails = useCallback(
    (schema?: string, name?: string) => {
      if (schema && name) {
        queryClient.invalidateQueries({
          queryKey: ["table-details", connectionId, schema, name],
        });
      } else {
        queryClient.invalidateQueries({
          queryKey: ["table-details", connectionId],
        });
      }
    },
    [connectionId, queryClient],
  );

  const handleDdlSuccess = useCallback(async () => {
    await loadSchema();
    // Invalidate all cached table details for this connection — safest default
    // since DDL can affect any table.
    invalidateTableDetails();
  }, [loadSchema, invalidateTableDetails]);

  // Prefetch table details AND first page of rows on hover — gives near-instant
  // navigation when the user clicks a table they've already hovered over.
  // Inspired by conar's route loader prefetch pattern.
  const prefetchTableDetails = useCallback(
    (schema: string, name: string) => {
      queryClient.prefetchQuery({
        queryKey: ["table-details", connectionId, schema, name],
        queryFn: () => getTableDetails(connectionId, schema, name),
        staleTime: 2 * 60_000,
      });
      queryClient.prefetchQuery({
        queryKey: [
          "table-rows",
          connectionId,
          schema,
          name,
          0, // page
          50, // default pageSize (matches TableDataEditor)
          [], // sort
          [], // filters
        ],
        queryFn: () =>
          tableListRows({
            tableRef: { connectionId, schema, table: name },
            page: 1,
            pageSize: 50,
            sort: [],
            filters: [],
          }),
        staleTime: 5 * 60_000,
      });
    },
    [connectionId, getTableDetails, tableListRows, queryClient],
  );

  const handleDropTableSuccess = useCallback(
    async (droppedKey: string) => {
      await handleDdlSuccess();
      if (selectedTableKey === droppedKey) {
        changeTable(null);
      }
    },
    [handleDdlSuccess, selectedTableKey, changeTable],
  );

  const handleRenameTableSuccess = useCallback(
    async (oldKey: string, newKey: string) => {
      await handleDdlSuccess();
      if (selectedTableKey === oldKey) {
        changeTable(newKey);
      }
    },
    [handleDdlSuccess, selectedTableKey, changeTable],
  );

  // Load table details when selected table changes
  // Load RLS policies when target changes
  useEffect(() => {
    if (!isActive) return;
    if (rlsPoliciesTarget) {
      const loadPolicies = async () => {
        setIsLoadingRlsPolicies(true);
        try {
          const details = await getTableDetails(connectionId, rlsPoliciesTarget.schema, rlsPoliciesTarget.name);
          setRlsPolicies(details.rls_policies);
        } catch (error) {
          console.error("Failed to load RLS policies", error);
          setRlsPolicies([]);
        } finally {
          setIsLoadingRlsPolicies(false);
        }
      };
      loadPolicies();
    } else {
      setRlsPolicies([]);
    }
  }, [rlsPoliciesTarget, connectionId, getTableDetails, isActive]);

  if (!connection) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8">
        <Database className="h-12 w-12 text-muted-foreground mb-4" />
        <h2 className="text-lg font-semibold mb-2">Connection not found</h2>
        <p className="text-muted-foreground mb-4">
          The connection you are looking for does not exist.
        </p>
        <Button onClick={() => navigate({ to: "/" })}>
          Back to Connections
        </Button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="border-x border-b rounded-lg flex-1 flex min-h-0 bg-background overflow-hidden">
        {/* Left Icon Sidebar */}
        <aside className="w-11 min-h-0 bg-muted/40 border-r py-3 px-2 flex flex-col items-center gap-1 shrink-0">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => navigate({ to: "/" })}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
              }
            />
            <TooltipContent side="right">Back</TooltipContent>
          </Tooltip>

          <div className="w-5 h-px bg-border my-1" />

          <nav className="flex flex-col gap-0.5">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className={`h-7 w-7 ${activeSection === "overview" ? "bg-accent text-accent-foreground" : ""}`}
                    onClick={() => changeSection("overview")}
                  >
                    <Database className="h-4 w-4" />
                  </Button>
                }
              />
              <TooltipContent side="right">Overview</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className={`h-7 w-7 ${activeSection === "tables" ? "bg-accent text-accent-foreground" : ""}`}
                    onClick={() => changeSection("tables")}
                  >
                    <Table2 className="h-4 w-4" />
                  </Button>
                }
              />
              <TooltipContent side="right">Tables</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className={`h-7 w-7 ${activeSection === "sql-editor" ? "bg-accent text-accent-foreground" : ""}`}
                    onClick={() => changeSection("sql-editor")}
                  >
                    <Terminal className="h-4 w-4" />
                  </Button>
                }
              />
              <TooltipContent side="right">SQL Editor</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className={`h-7 w-7 ${activeSection === "visualizer" ? "bg-accent text-accent-foreground" : ""}`}
                    onClick={() => changeSection("visualizer")}
                  >
                    <GitGraph className="h-4 w-4" />
                  </Button>
                }
              />
              <TooltipContent side="right">Schema Visualizer</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className={`h-7 w-7 ${activeSection === "settings" ? "bg-accent text-accent-foreground" : ""}`}
                    onClick={() => changeSection("settings")}
                  >
                    <Settings className="h-4 w-4" />
                  </Button>
                }
              />
              <TooltipContent side="right">Settings</TooltipContent>
            </Tooltip>
          </nav>

          <div className="flex-1" />

          <div className="flex flex-col gap-0.5">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={handleRefresh}
                    disabled={isRefreshing}
                  >
                    <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
                  </Button>
                }
              />
              <TooltipContent side="right">Refresh</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={handleCopyConnection}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                }
              />
              <TooltipContent side="right">
                {copyFeedback === "copied" ? "Copied!" : copyFeedback === "failed" ? "Copy failed" : "Copy Connection"}
              </TooltipContent>
            </Tooltip>
          </div>
        </aside>

        {/* Main Content Area */}
        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          {isTablesSection && (
            <ResizablePanelGroup className="min-w-0 flex-1">
              {/* Tables Sidebar */}
              <ResizablePanel defaultSize={230} minSize={230} maxSize={350} className="min-w-0">
                <aside className="h-full min-h-0 flex flex-col bg-muted/30">
                  {/* Header */}
                  <div className="px-3 pt-3 pb-2 space-y-2 shrink-0">
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                        Tables
                      </p>
                      <div className="flex items-center gap-1.5">
                        {!isLoading && filteredTablesForSchema.length > 0 && (
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {filteredTablesForSchema.length}
                          </span>
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                disabled={!selectedSchema}
                              />
                            }
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" side="bottom">
                            <DropdownMenuItem onClick={() => setIsCreateSchemaOpen(true)}>
                              <Database className="h-3.5 w-3.5" />
                              Create schema
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setIsCreateTableOpen(true)}>
                              <Table2 className="h-3.5 w-3.5" />
                              Create table
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setIsCreateIndexOpen(true)}
                              disabled={!selectedTableRef}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              Create index
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => setIsImportCsvOpen(true)}
                              disabled={!selectedTableRef}
                            >
                              <Terminal className="h-3.5 w-3.5" />
                              Import CSV
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        {isLoading && (
                          <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />
                        )}
                      </div>
                    </div>

                    {/* Schema selector */}
                    {schemas.length > 0 && (
                      <Select
                        value={selectedSchema}
                        onValueChange={(value) => {
                          if (value) changeSchema(value);
                          const firstTable = tablesBySchema.find(([s]) => s === value)?.[1][0];
                          changeTable(firstTable ? `${firstTable.schema}.${firstTable.name}` : null);
                        }}
                      >
                        <SelectTrigger size="sm" className="w-full font-mono text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {schemas.map((s) => {
                            const count = tablesBySchema.find(([schema]) => schema === s)?.[1].length ?? 0;
                            return (
                              <SelectItem key={s} value={s} className="text-xs">
                                <div className="flex items-center gap-2">
                                  <Database className="h-3 w-3 text-muted-foreground" />
                                  <span className="font-mono">{s}</span>
                                  <Badge variant="secondary" className="ml-auto font-mono text-[10px] h-4 px-1">
                                    {count}
                                  </Badge>
                                </div>
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                    )}

                    {/* Search */}
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
                      <Input
                        type="text"
                        placeholder="Search tables..."
                        value={tableSearch}
                        onChange={(e) => setTableSearch(e.target.value)}
                        className="h-7 pl-7 text-xs"
                      />
                    </div>
                  </div>

                  <Separator />

                  {/* Table list */}
                  <ScrollArea className="flex-1 min-h-0">
                    <div className="px-2 py-1.5">
                      {isLoading ? (
                        <div className="space-y-2 px-1 py-1">
                          {Array.from({ length: 6 }).map((_, i) => (
                            <div key={i} className="flex items-center gap-2.5 px-2 py-2">
                              <Skeleton className="h-3.5 w-3.5 rounded-sm shrink-0" />
                              <Skeleton className="h-3 w-24" />
                            </div>
                          ))}
                        </div>
                      ) : filteredTablesForSchema.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
                          <FileSearch className="h-4 w-4 text-muted-foreground/50 mb-2" />
                          <p className="text-xs text-muted-foreground">
                            {tableSearch ? "No matches found" : "No tables"}
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-0.5">
                          {filteredTablesForSchema.map((table) => {
                            const isActive = selectedTableKey === `${table.schema}.${table.name}`;
                            return (
                              <ContextMenu key={`${table.schema}.${table.name}`}>
                                <ContextMenuTrigger
                                  render={
                                    <button
                                      type="button"
                                      onClick={() =>
                                        changeTable(`${table.schema}.${table.name}`)
                                      }
                                      onMouseEnter={() =>
                                        prefetchTableDetails(table.schema, table.name)
                                      }
                                      onFocus={() =>
                                        prefetchTableDetails(table.schema, table.name)
                                      }
                                      className={`group w-full flex items-center gap-2.5 px-2.5 py-[7px] rounded-md text-left transition-colors duration-100 ${
                                        isActive
                                          ? "bg-accent text-accent-foreground"
                                          : "hover:bg-muted/50 text-foreground/80 hover:text-foreground"
                                      }`}
                                    >
                                      <Table2
                                        className={`h-3.5 w-3.5 shrink-0 transition-colors ${
                                          isActive
                                            ? "text-accent-foreground"
                                            : "text-muted-foreground group-hover:text-foreground/70"
                                        }`}
                                      />
                                      <span className="flex-1 truncate text-[13px] font-medium leading-none">
                                        {table.name}
                                      </span>
                                      {table.has_rls ? (
                                        <Tooltip>
                                          <TooltipTrigger className="inline-flex shrink-0">
                                            <Lock className="h-3 w-3 text-cyan-500 shrink-0" />
                                          </TooltipTrigger>
                                          <TooltipContent side="bottom" sideOffset={4}>RLS enabled</TooltipContent>
                                        </Tooltip>
                                      ) : (
                                        <Tooltip>
                                          <TooltipTrigger className="inline-flex shrink-0">
                                            <LockOpen className="h-3 w-3 text-muted-foreground/40 shrink-0" />
                                          </TooltipTrigger>
                                          <TooltipContent side="bottom" sideOffset={4}>RLS disabled</TooltipContent>
                                        </Tooltip>
                                      )}
                                    </button>
                                  }
                                />
                                <ContextMenuContent>
                                  <ContextMenuItem
                                    onClick={() =>
                                      setDdlRenameTarget({
                                        schema: table.schema,
                                        name: table.name,
                                      })
                                    }
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                    Rename table
                                  </ContextMenuItem>
                                  {table.has_rls && (
                                    <ContextMenuItem
                                      onClick={() =>
                                        setRlsPoliciesTarget({
                                          schema: table.schema,
                                          name: table.name,
                                        })
                                      }
                                    >
                                      <LockKeyhole className="h-3.5 w-3.5" />
                                      View RLS policies
                                    </ContextMenuItem>
                                  )}
                                  <ContextMenuSeparator />
                                  <ContextMenuItem
                                    variant="destructive"
                                    onClick={() =>
                                      setDdlDropTarget({
                                        schema: table.schema,
                                        name: table.name,
                                      })
                                    }
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                    Drop table
                                  </ContextMenuItem>
                                </ContextMenuContent>
                              </ContextMenu>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                </aside>
              </ResizablePanel>

              <ResizableHandle />

              {/* Main Panel */}
              <ResizablePanel defaultSize={75} className="min-w-0">
                <div className="h-full flex flex-col bg-background/60">
                  {(() => {
                    const detailsMatch =
                      !!selectedTableDetails &&
                      !!selectedTableRef &&
                      selectedTableDetails.name === selectedTableRef.name &&
                      selectedTableDetails.schema === selectedTableRef.schema;

                    if (!selectedTable) {
                      return (
                        <div className="flex-1 flex items-center justify-center p-8">
                          <div className="text-center space-y-3">
                            <div className="mx-auto w-fit rounded-full bg-muted/40 p-3">
                              <Database className="h-5 w-5 text-muted-foreground/50" />
                            </div>
                            <div>
                              <p className="text-sm font-medium text-muted-foreground">
                                Select a table
                              </p>
                              <p className="text-xs text-muted-foreground/60 mt-0.5">
                                Choose a table from the sidebar to get started
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    }

                    // First-time load (no details ever loaded yet) → show skeleton
                    if (!selectedTableDetails) {
                      return (
                        <div className="flex-1 flex items-center justify-center p-8">
                          <div className="flex items-center gap-3 text-muted-foreground">
                            {isLoadingTableDetails ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                <span className="text-sm">
                                  Loading {selectedTableRef?.schema}.{selectedTable}…
                                </span>
                              </>
                            ) : (
                              <span className="text-sm">Failed to load table details</span>
                            )}
                          </div>
                        </div>
                      );
                    }

                    // Keep TableDataEditor mounted while switching tables —
                    // the header/chrome stays visible, only the body shows
                    // a "Loading..." indicator via isSwitchingTable.
                    const td = selectedTableDetails;
                    const isSwitching = isLoadingTableDetails && !detailsMatch;
                    return (
                      <TableDataEditor
                        connectionId={connectionId}
                        table={td}
                        tableListRows={tableListRows}
                        tableSaveChanges={tableSaveChanges}
                        tableTruncate={tableTruncate}
                        tableFkLookup={tableFkLookup}
                        isSwitchingTable={isSwitching}
                        onRequestAddColumn={() =>
                          setDdlAddColumnTarget({
                            schema: td.schema,
                            name: td.name,
                          })
                        }
                        onRequestDropColumn={(columnName) =>
                          setDdlDropColumnTarget({
                            schema: td.schema,
                            table: td.name,
                            column: columnName,
                          })
                        }
                        onRequestRenameColumn={(columnName) =>
                          setDdlRenameColumnTarget({
                            schema: td.schema,
                            table: td.name,
                            column: columnName,
                          })
                        }
                        onRequestAlterColumnType={(column) =>
                          setDdlAlterColumnTypeTarget({
                            schema: td.schema,
                            table: td.name,
                            column: column.name,
                            currentType: column.data_type,
                          })
                        }
                        onRequestSetColumnDefault={(column) =>
                          setDdlSetColumnDefaultTarget({
                            schema: td.schema,
                            table: td.name,
                            column: column.name,
                            currentDefault: column.column_default,
                          })
                        }
                        onRequestSetColumnNullable={(column) =>
                          setDdlSetColumnNullableTarget({
                            schema: td.schema,
                            table: td.name,
                            column: column.name,
                            isNullable: column.is_nullable,
                          })
                        }
                      />
                    );
                  })()}
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          )}
          {isSqlEditorSection && (
            <SqlEditor
              key={connectionId}
              connections={connections}
              selectedConnection={connectionId}
              onSelectConnection={(id) => {
                navigate({ to: "/database/$connectionId", params: { connectionId: id } });
              }}
              executeQuery={executeQuery}
              showWorkspaceSidebar={true}
              loadRequest={initialSqlQuery ? {
                key: `query:${Date.now()}`,
                title: "Query",
                sql: initialSqlQuery,
                connectionId: connectionId,
              } : selectedTableKey ? {
                key: `table:${selectedTableKey}`,
                title: `Query: ${selectedTableKey}`,
                sql: `SELECT * FROM "${selectedTableRef?.schema}"."${selectedTableRef?.name}" LIMIT 100`,
                connectionId: connectionId,
              } : null}
            />
          )}
          {isOverviewSection && (
            <DatabaseOverview
              connection={connection}
              schemaSummary={{ schemas, tables }}
              databaseInfo={databaseInfo}
              isLoadingDatabaseInfo={isLoadingDatabaseInfo}
              localDbStatus={localDbStatus}
              isLoadingLocalDbStatus={isLoadingLocalDbStatus}
              isTogglingLocalDbStatus={isTogglingLocalDb}
              onNewQuery={() => changeSection("sql-editor")}
              onTestConnection={handleTestConnection}
              onViewTables={() => changeSection("tables")}
              onStartLocalDb={handleStartLocalDb}
              onPauseLocalDb={handlePauseLocalDb}
              connectionString={connection.url || `postgres://${connection.username}:${connection.password}@${connection.host}:${connection.port}/${connection.database}?sslmode=${connection.ssl_mode}`}
              copyConnectionStringFeedback={copyConnFeedback}
              onCopyConnectionString={handleCopyConnectionString}
            />
          )}
          {isVisualizerSection && (
            <div className="flex-1 min-w-0 min-h-0 p-4">
              {isLoadingVisualizer ? (
                <div className="flex h-full items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-sm text-muted-foreground">Loading schema...</span>
                </div>
              ) : visualizerTables.length === 0 ? (
                <div className="flex h-full items-center justify-center">
                  <p className="text-muted-foreground">No tables to visualize</p>
                </div>
              ) : (
                <SchemaVisualizer
                  tables={visualizerTables}
                  schemas={schemas}
                  currentSchema={selectedSchema}
                  onSchemaChange={changeSchema}
                  onTableClick={(schema, table) => {
                    changeSection("tables");
                    changeSchema(schema);
                    changeTable(`${schema}.${table}`);
                  }}
                />
              )}
            </div>
          )}
          {isSettingsSection && (
            <div className="flex-1 flex items-center justify-center p-8">
              <div className="text-center max-w-md">
                <Settings className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-sm text-muted-foreground">
                  Connection settings will be managed here.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
      {connection && selectedSchema && (
        <CreateTableDialog
          isOpen={isCreateTableOpen}
          onClose={() => setIsCreateTableOpen(false)}
          connectionId={connection.id}
          schema={selectedSchema}
          createTable={createTable}
          onSuccess={() => {
            void handleDdlSuccess();
          }}
        />
      )}
      {connection && ddlDropTarget && (
        <DropTableDialog
          isOpen
          onClose={() => setDdlDropTarget(null)}
          connectionId={connection.id}
          schema={ddlDropTarget.schema}
          tableName={ddlDropTarget.name}
          dropTable={dropTable}
          onSuccess={() => {
            void handleDropTableSuccess(`${ddlDropTarget.schema}.${ddlDropTarget.name}`);
          }}
        />
      )}
      {connection && ddlRenameTarget && (
        <RenameTableDialog
          isOpen
          onClose={() => setDdlRenameTarget(null)}
          connectionId={connection.id}
          schema={ddlRenameTarget.schema}
          currentName={ddlRenameTarget.name}
          renameTable={renameTable}
          onSuccess={() => {
            void handleRenameTableSuccess(
              `${ddlRenameTarget.schema}.${ddlRenameTarget.name}`,
              `${ddlRenameTarget.schema}.${ddlRenameTarget.name}`,
            );
          }}
        />
      )}
      {connection && ddlAddColumnTarget && (
        <AddColumnDialog
          isOpen
          onClose={() => setDdlAddColumnTarget(null)}
          connectionId={connection.id}
          schema={ddlAddColumnTarget.schema}
          tableName={ddlAddColumnTarget.name}
          addColumn={addColumn}
          onSuccess={() => {
            void handleDdlSuccess();
          }}
        />
      )}
      {connection && ddlDropColumnTarget && (
        <DropColumnDialog
          isOpen
          onClose={() => setDdlDropColumnTarget(null)}
          connectionId={connection.id}
          schema={ddlDropColumnTarget.schema}
          tableName={ddlDropColumnTarget.table}
          columnName={ddlDropColumnTarget.column}
          dropColumn={dropColumn}
          onSuccess={() => {
            void handleDdlSuccess();
          }}
        />
      )}
      {connection && ddlRenameColumnTarget && (
        <RenameColumnDialog
          isOpen
          onClose={() => setDdlRenameColumnTarget(null)}
          connectionId={connection.id}
          schema={ddlRenameColumnTarget.schema}
          tableName={ddlRenameColumnTarget.table}
          currentName={ddlRenameColumnTarget.column}
          renameColumn={renameColumn}
          onSuccess={() => {
            void handleDdlSuccess();
          }}
        />
      )}
      {connection && ddlAlterColumnTypeTarget && (
        <AlterColumnTypeDialog
          isOpen
          onClose={() => setDdlAlterColumnTypeTarget(null)}
          connectionId={connection.id}
          schema={ddlAlterColumnTypeTarget.schema}
          tableName={ddlAlterColumnTypeTarget.table}
          columnName={ddlAlterColumnTypeTarget.column}
          currentType={ddlAlterColumnTypeTarget.currentType}
          alterColumnType={alterColumnType}
          onSuccess={() => {
            void handleDdlSuccess();
          }}
        />
      )}
      {connection && ddlSetColumnDefaultTarget && (
        <SetColumnDefaultDialog
          isOpen
          onClose={() => setDdlSetColumnDefaultTarget(null)}
          connectionId={connection.id}
          schema={ddlSetColumnDefaultTarget.schema}
          tableName={ddlSetColumnDefaultTarget.table}
          columnName={ddlSetColumnDefaultTarget.column}
          currentDefault={ddlSetColumnDefaultTarget.currentDefault}
          setColumnDefault={setColumnDefault}
          onSuccess={() => {
            void handleDdlSuccess();
          }}
        />
      )}
      {connection && ddlSetColumnNullableTarget && (
        <SetColumnNullableDialog
          isOpen
          onClose={() => setDdlSetColumnNullableTarget(null)}
          connectionId={connection.id}
          schema={ddlSetColumnNullableTarget.schema}
          tableName={ddlSetColumnNullableTarget.table}
          columnName={ddlSetColumnNullableTarget.column}
          isCurrentlyNullable={ddlSetColumnNullableTarget.isNullable}
          setColumnNullable={setColumnNullable}
          onSuccess={() => {
            void handleDdlSuccess();
          }}
        />
      )}
      {connection && (
        <CreateSchemaDialog
          isOpen={isCreateSchemaOpen}
          onClose={() => setIsCreateSchemaOpen(false)}
          connectionId={connection.id}
          createSchema={createSchema}
          onSuccess={() => {
            void handleDdlSuccess();
          }}
        />
      )}
      {connection && selectedSchema && (
        <CreateIndexDialog
          isOpen={isCreateIndexOpen}
          onClose={() => setIsCreateIndexOpen(false)}
          connectionId={connection.id}
          schema={selectedSchema}
          defaultTableName={selectedTableRef?.name ?? ""}
          createIndex={createIndex}
          onSuccess={() => {
            void handleDdlSuccess();
          }}
        />
      )}
      {connection && selectedSchema && (
        <ImportCsvDialog
          isOpen={isImportCsvOpen}
          onClose={() => setIsImportCsvOpen(false)}
          connectionId={connection.id}
          schema={selectedSchema}
          defaultTableName={selectedTableRef?.name ?? ""}
          tableSaveChanges={tableSaveChanges}
          onSuccess={() => {
            void handleDdlSuccess();
          }}
        />
      )}
      {rlsPoliciesTarget && (
        <RlsPoliciesDialog
          isOpen={Boolean(rlsPoliciesTarget)}
          onClose={() => setRlsPoliciesTarget(null)}
          schema={rlsPoliciesTarget.schema}
          tableName={rlsPoliciesTarget.name}
          policies={rlsPolicies}
        />
      )}
    </div>
  );
}
