import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ChevronLeft,
  Copy,
  Database,
  FileSearch,
  Layers,
  Lock,
  Pause,
  Play,
  RefreshCw,
  Search,
  Settings,
  Table2,
  Terminal,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { useConnectionTabsStore } from "@/lib/stores/connection-tabs";
import { DatabaseOverview } from "@/components/DatabaseOverview";
import { SqlEditor } from "@/components/SqlEditor";
import { TableDataEditor } from "@/components/TableDataEditor";
import type { SchemaTableSummary, DatabaseInfo, LocalDbInfo, SchemaTableDetails } from "@/ipc/db/types";

type SidebarSection = "overview" | "tables" | "sql-editor" | "settings";

export const Route = createFileRoute("/database/$connectionId")({
  component: DatabasePage,
});

function DatabasePage() {
  const { connectionId } = Route.useParams();
  return <DatabasePageContent connectionId={connectionId} />;
}

interface DatabasePageContentProps {
  connectionId: string;
}

function DatabasePageContent({ connectionId }: DatabasePageContentProps) {
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
  } = useConnections();
  const { start: startLocalDb, pause: pauseLocalDb, getStatus: getLocalDbStatus } = useLocalDatabases();
  const { tabs, setTabSection } = useConnectionTabsStore();

  const storedSection = tabs.find((t) => t.id === connectionId)?.lastSection;
  const [activeSection, setActiveSection] = useState<SidebarSection>(
    storedSection ?? "tables"
  );

  const [tables, setTables] = useState<SchemaTableSummary[]>([]);
  const [schemas, setSchemas] = useState<string[]>([]);
  const [selectedSchema, setSelectedSchema] = useState<string>("public");
  const [selectedTableKey, setSelectedTableKey] = useState<string | null>(null);
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

  // Table details for selected table
  const [selectedTableDetails, setSelectedTableDetails] = useState<SchemaTableDetails | null>(null);
  const [isLoadingTableDetails, setIsLoadingTableDetails] = useState(false);

  // Reset state when connectionId changes to avoid showing stale data
  useEffect(() => {
    setTables([]);
    setSchemas([]);
    setSelectedSchema("public");
    setSelectedTableKey(null);
    setInitialSqlQuery(null);
    setTableSearch("");
    setDatabaseInfo(null);
    setLocalDbStatus(null);
  }, [connectionId]);

  // Section flags - definidas antes de serem usadas
  const isTablesSection = activeSection === "tables";
  const isSqlEditorSection = activeSection === "sql-editor";
  const isOverviewSection = activeSection === "overview";
  const isSettingsSection = activeSection === "settings";

  const connection = useMemo(
    () => connections.find((c) => c.id === connectionId),
    [connections, connectionId],
  );

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
    loadSchema();
  }, [loadSchema]);

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

  useEffect(() => {
    if (activeSection === "overview") {
      loadDatabaseInfo();
      loadLocalDbStatus();
    }
  }, [activeSection, loadDatabaseInfo, loadLocalDbStatus]);

  useEffect(() => {
    setTabSection(connectionId, activeSection);
    // Clear initial SQL query after navigating to sql-editor
    if (activeSection === "sql-editor" && initialSqlQuery) {
      // Keep it for the initial render, then clear
      const timer = setTimeout(() => setInitialSqlQuery(null), 100);
      return () => clearTimeout(timer);
    }
  }, [connectionId, activeSection, setTabSection, initialSqlQuery]);

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

  // Load table details when selected table changes
  useEffect(() => {
    if (selectedTableKey && selectedTableRef) {
      const loadTableDetails = async () => {
        setIsLoadingTableDetails(true);
        try {
          const details = await getTableDetails(connectionId, selectedTableRef.schema, selectedTableRef.name);
          setSelectedTableDetails(details);
        } catch (error) {
          console.error("Failed to load table details", error);
        } finally {
          setIsLoadingTableDetails(false);
        }
      };
      loadTableDetails();
    } else {
      setSelectedTableDetails(null);
    }
  }, [selectedTableKey, selectedTableRef, connectionId, getTableDetails]);

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
        <aside className="w-11 min-h-0 bg-background border-x border-b rounded-l-lg py-3 px-2 flex flex-col items-center gap-1 shrink-0">
          <Tooltip>
            <TooltipTrigger>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => navigate({ to: "/" })}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Back</TooltipContent>
          </Tooltip>

          <div className="w-5 h-px bg-border my-1" />

          <nav className="flex flex-col gap-0.5">
            <Tooltip>
              <TooltipTrigger>
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-7 w-7 ${activeSection === "overview" ? "bg-muted" : ""}`}
                  onClick={() => setActiveSection("overview")}
                >
                  <Database className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Overview</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger>
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-7 w-7 ${activeSection === "tables" ? "bg-muted" : ""}`}
                  onClick={() => setActiveSection("tables")}
                >
                  <Table2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Tables</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger>
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-7 w-7 ${activeSection === "sql-editor" ? "bg-muted" : ""}`}
                  onClick={() => setActiveSection("sql-editor")}
                >
                  <Terminal className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">SQL Editor</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger>
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-7 w-7 ${activeSection === "settings" ? "bg-muted" : ""}`}
                  onClick={() => setActiveSection("settings")}
                >
                  <Settings className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Settings</TooltipContent>
            </Tooltip>
          </nav>

          <div className="flex-1" />

          <div className="flex flex-col gap-0.5">
            <Tooltip>
              <TooltipTrigger>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={handleRefresh}
                  disabled={isRefreshing}
                >
                  <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Refresh</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={handleCopyConnection}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
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
                <aside className="h-full min-h-0 flex flex-col bg-sidebar">
                  {/* Header */}
                  <div className="px-3 pt-3 pb-2 space-y-2.5 shrink-0">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                          Tables
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {!isLoading && filteredTablesForSchema.length > 0 && (
                          <Badge variant="secondary" className="font-mono text-[10px] h-5 px-1.5">
                            {filteredTablesForSchema.length}
                          </Badge>
                        )}
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
                          if (value) setSelectedSchema(value);
                          const firstTable = tablesBySchema.find(([s]) => s === value)?.[1][0];
                          setSelectedTableKey(firstTable ? `${firstTable.schema}.${firstTable.name}` : null);
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
                          <div className="rounded-full bg-muted/60 p-2.5 mb-3">
                            <FileSearch className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <p className="text-xs font-medium text-muted-foreground">
                            {tableSearch ? "No matches found" : "No tables"}
                          </p>
                          <p className="text-[11px] text-muted-foreground/70 mt-0.5">
                            {tableSearch
                              ? "Try a different search term"
                              : "This schema has no tables yet"}
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-0.5">
                          {filteredTablesForSchema.map((table) => {
                            const isActive = selectedTableKey === `${table.schema}.${table.name}`;
                            return (
                              <button
                                key={`${table.schema}.${table.name}`}
                                onClick={() => setSelectedTableKey(`${table.schema}.${table.name}`)}
                                className={`group w-full flex items-center gap-2.5 px-2.5 py-[7px] rounded-md text-left transition-all duration-150 ${
                                  isActive
                                    ? "bg-accent text-accent-foreground shadow-sm"
                                    : "hover:bg-muted/60 text-foreground/80 hover:text-foreground"
                                }`}
                              >
                                <Table2 className={`h-3.5 w-3.5 shrink-0 transition-colors ${
                                  isActive ? "text-accent-foreground" : "text-muted-foreground group-hover:text-foreground/70"
                                }`} />
                                <span className="flex-1 truncate text-[13px] font-medium leading-none">
                                  {table.name}
                                </span>
                                {table.has_rls && (
                                  <Badge
                                    variant={isActive ? "outline" : "secondary"}
                                    className="font-mono text-[9px] h-4 px-1 gap-0.5 shrink-0"
                                  >
                                    <Lock className="h-2 w-2" />
                                    RLS
                                  </Badge>
                                )}
                              </button>
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
                  {selectedTable && selectedTableDetails ? (
                    <TableDataEditor
                      connectionId={connectionId}
                      table={selectedTableDetails}
                      listRows={({ schema, table, page, pageSize }) =>
                        tableListRows({ tableRef: { connectionId, schema, table }, page, pageSize, sort: [], filters: [] })
                      }
                      saveChanges={({ schema, table, inserts, updates, deletes }) =>
                        tableSaveChanges({ tableRef: { connectionId, schema, table }, inserts, updates, deletes })
                      }
                      truncate={({ schema, table }) =>
                        tableTruncate({ connectionId, schema, table })
                      }
                    />
                  ) : selectedTable ? (
                    <div className="flex-1 flex items-center justify-center p-8">
                      <div className="text-center max-w-xs space-y-4">
                        <div className="mx-auto w-fit rounded-xl bg-muted/50 p-3">
                          <Table2 className="h-8 w-8 text-muted-foreground" />
                        </div>
                        <div>
                          <h3 className="font-heading text-lg font-semibold tracking-tight">
                            {selectedTable}
                          </h3>
                          <p className="font-mono text-xs text-muted-foreground mt-1">
                            {selectedTableRef?.schema}.{selectedTable}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          onClick={() => {
                            setInitialSqlQuery(`SELECT * FROM "${selectedTableRef?.schema}"."${selectedTable}" LIMIT 100`);
                            setActiveSection("sql-editor");
                          }}
                          className="gap-1.5"
                        >
                          <Terminal className="h-3.5 w-3.5" />
                          Query This Table
                        </Button>
                      </div>
                    </div>
                  ) : (
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
                  )}
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
              onNewQuery={() => setActiveSection("sql-editor")}
              onTestConnection={handleTestConnection}
              onViewTables={() => setActiveSection("tables")}
              onStartLocalDb={handleStartLocalDb}
              onPauseLocalDb={handlePauseLocalDb}
              connectionString={connection.url || `postgres://${connection.username}:${connection.password}@${connection.host}:${connection.port}/${connection.database}?sslmode=${connection.ssl_mode}`}
              copyConnectionStringFeedback={copyConnFeedback}
              onCopyConnectionString={handleCopyConnectionString}
            />
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
    </div>
  );
}
