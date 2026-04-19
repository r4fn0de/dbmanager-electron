import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ChevronLeft,
  Copy,
  Database,
  RefreshCw,
  Settings,
  Table2,
  Terminal,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useConnections } from "@/hooks/useConnections";
import { useConnectionTabsStore } from "@/lib/stores/connection-tabs";
import type { SchemaTableSummary, QueryResult } from "@/ipc/db/types";

type SidebarSection = "overview" | "tables" | "sql-editor" | "settings";

export const Route = createFileRoute("/database/$connectionId")({
  component: DatabasePage,
});

function DatabasePage() {
  const { connectionId } = Route.useParams();
  return <DatabasePageContent key={connectionId} connectionId={connectionId} />;
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
  } = useConnections();
  const { tabs, setTabSection } = useConnectionTabsStore();

  const storedSection = tabs.find((t) => t.id === connectionId)?.lastSection;
  const [activeSection, setActiveSection] = useState<SidebarSection>(
    storedSection ?? "tables"
  );

  const [tables, setTables] = useState<SchemaTableSummary[]>([]);
  const [schemas, setSchemas] = useState<string[]>([]);
  const [selectedSchema, setSelectedSchema] = useState<string>("public");
  const [selectedTableKey, setSelectedTableKey] = useState<string | null>(null);
  const [tableSearch, setTableSearch] = useState("");
  const [queryText, setQueryText] = useState("");
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<null | "copied" | "failed">(null);

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

  useEffect(() => {
    setTabSection(connectionId, activeSection);
  }, [connectionId, activeSection, setTabSection]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refetch();
    await loadSchema();
    setIsRefreshing(false);
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

  const handleExecuteQuery = async () => {
    if (!connectionId || !queryText.trim()) return;
    setIsExecuting(true);
    try {
      const result = await executeQuery(connectionId, queryText);
      setQueryResult(result);
      toast.success(`Query executed: ${result.row_count} rows`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Query failed");
    } finally {
      setIsExecuting(false);
    }
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

  const isTablesSection = activeSection === "tables";
  const isSqlEditorSection = activeSection === "sql-editor";
  const isOverviewSection = activeSection === "overview";
  const isSettingsSection = activeSection === "settings";

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
          {isTablesSection ? (
            <ResizablePanelGroup className="min-w-0 flex-1">
              {/* Tables Sidebar */}
              <ResizablePanel defaultSize={230} minSize={230} maxSize={350} className="min-w-0">
                <aside className="h-full min-h-0 border-x border-b bg-background/95 px-3 py-3 overflow-hidden flex flex-col">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-medium">Tables</p>
                    {isLoading && (
                      <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    )}
                  </div>

                  {schemas.length > 0 && (
                    <select
                      value={selectedSchema}
                      onChange={(e) => {
                        setSelectedSchema(e.target.value);
                        const firstTable = tablesBySchema.find(([s]) => s === e.target.value)?.[1][0];
                        setSelectedTableKey(firstTable ? `${firstTable.schema}.${firstTable.name}` : null);
                      }}
                      className="w-full mb-3 px-2 py-1.5 text-sm rounded border bg-background"
                    >
                      {schemas.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  )}

                  <input
                    type="text"
                    placeholder="Search tables..."
                    value={tableSearch}
                    onChange={(e) => setTableSearch(e.target.value)}
                    className="w-full mb-2 px-2 py-1.5 text-sm rounded border bg-background"
                  />

                  <div className="flex-1 overflow-y-auto -mx-1 px-1">
                    {isLoading ? (
                      <div className="text-center py-4 text-sm text-muted-foreground">
                        Loading...
                      </div>
                    ) : filteredTablesForSchema.length === 0 ? (
                      <div className="text-center py-4 text-sm text-muted-foreground">
                        No tables
                      </div>
                    ) : (
                      <div className="space-y-0.5">
                        {filteredTablesForSchema.map((table) => (
                          <button
                            key={`${table.schema}.${table.name}`}
                            onClick={() => setSelectedTableKey(`${table.schema}.${table.name}`)}
                            className={`w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded text-left transition-colors ${
                              selectedTableKey === `${table.schema}.${table.name}`
                                ? "bg-accent text-accent-foreground"
                                : "hover:bg-muted"
                            }`}
                          >
                            <Table2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <span className="truncate">{table.name}</span>
                            {table.has_rls && (
                              <span className="ml-auto text-[10px] bg-muted px-1 rounded shrink-0">
                                RLS
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </aside>
              </ResizablePanel>

              <ResizableHandle />

              {/* Main Panel */}
              <ResizablePanel defaultSize={75} className="min-w-0">
                <div className="h-full flex flex-col bg-background/60">
                  {selectedTable ? (
                    <div className="flex-1 flex items-center justify-center p-8">
                      <div className="text-center">
                        <Table2 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                        <h3 className="font-medium mb-2">{selectedTable}</h3>
                        <p className="text-sm text-muted-foreground mb-4">
                          {selectedTableRef?.schema}.{selectedTable}
                        </p>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setQueryText(`SELECT * FROM "${selectedTableRef?.schema}"."${selectedTable}" LIMIT 100`);
                            setActiveSection("sql-editor");
                          }}
                        >
                          <Terminal className="h-4 w-4 mr-1" />
                          Query This Table
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 flex items-center justify-center p-8">
                      <div className="text-center">
                        <Database className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                        <p className="text-sm text-muted-foreground">
                          Select a table from the sidebar
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          ) : isSqlEditorSection ? (
            <div className="flex-1 flex flex-col min-h-0">
              <div className="flex-1 p-4 min-h-0">
                <textarea
                  value={queryText}
                  onChange={(e) => setQueryText(e.target.value)}
                  placeholder="Enter SQL query..."
                  className="w-full h-full p-3 font-mono text-sm rounded-md border bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                  spellCheck={false}
                />
              </div>
              <div className="flex items-center justify-between px-4 py-2 border-t bg-background/60">
                <div className="text-xs text-muted-foreground">
                  {queryResult ? `${queryResult.row_count} rows` : "Ready"}
                </div>
                <Button
                  onClick={handleExecuteQuery}
                  disabled={isExecuting || !queryText.trim()}
                >
                  <Terminal className="h-4 w-4 mr-1" />
                  {isExecuting ? "Running..." : "Run Query"}
                </Button>
              </div>
              {queryResult && (
                <div className="flex-1 overflow-auto border-t">
                  <table className="w-full text-sm">
                    <thead className="bg-muted sticky top-0">
                      <tr>
                        {queryResult.columns.map((col) => (
                          <th key={col.name} className="px-3 py-2 text-left font-medium border-b">
                            {col.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {queryResult.rows.map((row, i) => (
                        <tr key={i} className="border-b hover:bg-muted/50">
                          {row.map((cell, j) => (
                            <td key={j} className="px-3 py-1.5 text-muted-foreground">
                              {cell === null
                                ? "NULL"
                                : typeof cell === "object"
                                  ? JSON.stringify(cell)
                                  : String(cell)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : isOverviewSection ? (
            <div className="flex-1 flex items-center justify-center p-8">
              <div className="text-center max-w-md">
                <Database className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="font-medium mb-2">{connection.name}</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  {connection.host}:{connection.port}/{connection.database}
                </p>
                <div className="flex gap-2 justify-center">
                  <Button variant="outline" onClick={() => setActiveSection("tables")}>
                    <Table2 className="h-4 w-4 mr-1" />
                    View Tables
                  </Button>
                  <Button variant="outline" onClick={() => setActiveSection("sql-editor")}>
                    <Terminal className="h-4 w-4 mr-1" />
                    SQL Editor
                  </Button>
                </div>
              </div>
            </div>
          ) : (
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
