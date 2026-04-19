import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import {
  ChevronLeft,
  Database,
  Play,
  RefreshCw,
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
import { useConnections } from "@/hooks/useConnections";
import { useConnectionTabsStore } from "@/lib/stores/connection-tabs";
import type { SchemaTableSummary, QueryResult } from "@/ipc/db/types";

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
  const { setTabSection } = useConnectionTabsStore();

  const [tables, setTables] = useState<SchemaTableSummary[]>([]);
  const [schemas, setSchemas] = useState<string[]>([]);
  const [selectedSchema, setSelectedSchema] = useState<string>("public");
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"data" | "query">("data");
  const [queryText, setQueryText] = useState("SELECT * FROM ");
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);

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
    setTabSection(connectionId, activeTab === "query" ? "sql-editor" : "tables");
  }, [connectionId, activeTab, setTabSection]);

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

  const handleTableClick = (table: SchemaTableSummary) => {
    setSelectedTable(table.name);
    setQueryText(`SELECT * FROM "${table.schema}"."${table.name}" LIMIT 100`);
    setActiveTab("data");
  };

  const filteredTables = useMemo(() => {
    return tables.filter((t) => t.schema === selectedSchema);
  }, [tables, selectedSchema]);

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
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b bg-background/60">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate({ to: "/" })}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="font-semibold">{connection.name}</h1>
            <p className="text-xs text-muted-foreground">
              {connection.host}:{connection.port}/{connection.database}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            disabled={isLoading}
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <div className="flex border rounded-md">
            <Button
              variant={activeTab === "data" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setActiveTab("data")}
            >
              <Table2 className="h-4 w-4 mr-1" />
              Data
            </Button>
            <Button
              variant={activeTab === "query" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setActiveTab("query")}
            >
              <Terminal className="h-4 w-4 mr-1" />
              Query
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <ResizablePanelGroup orientation="horizontal" className="flex-1">
        {/* Sidebar */}
        <ResizablePanel defaultSize={20} minSize={15} maxSize={35}>
          <div className="h-full flex flex-col border-r bg-background/40">
            <div className="p-2 border-b">
              <select
                value={selectedSchema}
                onChange={(e) => setSelectedSchema(e.target.value)}
                className="w-full px-2 py-1 text-sm rounded border bg-background"
              >
                {schemas.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {isLoading ? (
                <div className="text-center py-4 text-sm text-muted-foreground">
                  Loading...
                </div>
              ) : filteredTables.length === 0 ? (
                <div className="text-center py-4 text-sm text-muted-foreground">
                  No tables
                </div>
              ) : (
                <div className="space-y-1">
                  {filteredTables.map((table) => (
                    <button
                      key={`${table.schema}.${table.name}`}
                      onClick={() => handleTableClick(table)}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded text-left transition-colors ${
                        selectedTable === table.name
                          ? "bg-accent text-accent-foreground"
                          : "hover:bg-muted"
                      }`}
                    >
                      <Table2 className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="truncate">{table.name}</span>
                      {table.has_rls && (
                        <span className="ml-auto text-[10px] bg-muted px-1 rounded">
                          RLS
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </ResizablePanel>

        <ResizableHandle />

        {/* Main Area */}
        <ResizablePanel defaultSize={80}>
          <div className="h-full flex flex-col bg-background/60">
            {activeTab === "query" ? (
              <>
                {/* SQL Editor */}
                <div className="flex-1 p-4">
                  <textarea
                    value={queryText}
                    onChange={(e) => setQueryText(e.target.value)}
                    placeholder="Enter SQL query..."
                    className="w-full h-full min-h-[200px] p-3 font-mono text-sm rounded-md border bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                    spellCheck={false}
                  />
                </div>
                {/* Toolbar */}
                <div className="flex items-center justify-between px-4 py-2 border-t">
                  <div className="text-xs text-muted-foreground">
                    {queryResult && `${queryResult.row_count} rows`}
                  </div>
                  <Button
                    onClick={handleExecuteQuery}
                    disabled={isExecuting || !queryText.trim()}
                  >
                    <Play className="h-4 w-4 mr-1" />
                    {isExecuting ? "Running..." : "Run Query"}
                  </Button>
                </div>
                {/* Results */}
                {queryResult && (
                  <div className="flex-1 overflow-auto border-t">
                    <table className="w-full text-sm">
                      <thead className="bg-muted sticky top-0">
                        <tr>
                          {queryResult.columns.map((col) => (
                            <th key={col.name} className="px-3 py-2 text-left font-medium">
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
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center p-8">
                {selectedTable ? (
                  <div className="text-center">
                    <Table2 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <h3 className="font-medium mb-2">{selectedTable}</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      Table data view coming soon
                    </p>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setQueryText(
                          `SELECT * FROM "${selectedSchema}"."${selectedTable}" LIMIT 100`
                        );
                        setActiveTab("query");
                      }}
                    >
                      <Terminal className="h-4 w-4 mr-1" />
                      Query This Table
                    </Button>
                  </div>
                ) : (
                  <div className="text-center">
                    <Database className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <h3 className="font-medium mb-2">{connection.name}</h3>
                    <p className="text-sm text-muted-foreground">
                      Select a table from the sidebar or switch to Query tab
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
