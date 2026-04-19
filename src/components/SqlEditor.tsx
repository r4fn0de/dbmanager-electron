import Editor, { type OnMount } from "@monaco-editor/react";
import {
  Database,
  History,
  Loader2,
  Play,
  Save,
  Star,
  Trash2,
} from "lucide-react";
import { useTheme } from "next-themes";
import type { KeyboardEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QueryResults } from "@/components/QueryResults";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useSqlWorkspace,
  type SqlExecutionLog,
  type SqlHistoryEntry,
  type SqlSavedQuery,
} from "@/hooks/useSqlWorkspace";
import "@/lib/monaco-loader";
import type {
  Connection,
  QueryResult,
} from "@/ipc/db/types";

interface SqlEditorProps {
  connections: Connection[];
  selectedConnection: string | null;
  onSelectConnection: (id: string) => void;
  executeQuery: (connectionId: string, sql: string) => Promise<QueryResult>;
  showWorkspaceSidebar?: boolean;
  loadRequest?: {
    key: string;
    title: string;
    sql: string;
    connectionId: null | string;
  } | null;
}

const DEFAULT_SQL = `/*
Try creating a sample table and querying it.
*/
SELECT now() as server_time;`;

const MAX_HISTORY_PREVIEW = 140;
const MAX_LOGS = 200;

type MonacoEditor = Parameters<OnMount>[0];

interface SqlDocument {
  id: string | null;
  title: string;
  sql: string;
  updatedAt: string;
}

const MONACO_OPTIONS = {
  minimap: { enabled: false },
  fontSize: 14,
  lineNumbers: "on",
  roundedSelection: false,
  scrollBeyondLastLine: false,
  automaticLayout: true,
  padding: { top: 12 },
  tabSize: 2,
} as const;

function previewSql(sql: string): string {
  const normalized = sql.replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_HISTORY_PREVIEW) return normalized;
  return `${normalized.slice(0, MAX_HISTORY_PREVIEW)}...`;
}

function nowIso() {
  return new Date().toISOString();
}

function formatDuration(ms: number) {
  return `${Math.max(0, Math.round(ms))}ms`;
}

function newLogId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  return (
    g.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

export function SqlEditor({
  connections,
  selectedConnection,
  onSelectConnection,
  executeQuery,
  showWorkspaceSidebar = true,
  loadRequest = null,
}: SqlEditorProps) {
  const {
    savedQueries,
    history,
    saveQuery,
    deleteQuery,
    renameQuery,
    appendHistory,
  } = useSqlWorkspace(selectedConnection);

  const [doc, setDoc] = useState<SqlDocument>({
    id: null,
    title: "Untitled",
    sql: DEFAULT_SQL,
    updatedAt: nowIso(),
  });

  const [activeSidebarTab, setActiveSidebarTab] = useState<"saved" | "history">(
    "saved",
  );
  const [activeResultTab, setActiveResultTab] = useState<"result" | "logs">(
    "result",
  );
  const [searchText, setSearchText] = useState("");

  const [isExecuting, setIsExecuting] = useState(false);
  const [lastResult, setLastResult] = useState<QueryResult | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [logs, setLogs] = useState<SqlExecutionLog[]>([]);

  const { resolvedTheme } = useTheme();
  const monacoTheme = resolvedTheme === "dark" ? "vs-dark" : "vs";

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const editorRef = useRef<MonacoEditor | null>(null);
  const executionAbort = useRef<AbortController | null>(null);

  const selectedConnectionMeta = useMemo(() => {
    const found = connections.find((conn) => conn.id === selectedConnection);
    return {
      name: found?.name ?? "No connection",
      label: !found
        ? ""
        : found.name?.trim() || found.database?.trim() || "Unnamed connection",
    };
  }, [connections, selectedConnection]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run only when the load request key changes.
  useEffect(() => {
    if (!loadRequest) return;
    setDoc({
      id: null,
      title: loadRequest.title || "Untitled",
      sql: loadRequest.sql,
      updatedAt: nowIso(),
    });
    if (
      loadRequest.connectionId &&
      loadRequest.connectionId !== selectedConnection
    ) {
      onSelectConnection(loadRequest.connectionId);
    }
  }, [loadRequest?.key]);

  useEffect(() => {
    // Abort any in-flight execution on unmount.
    return () => {
      executionAbort.current?.abort();
    };
  }, []);

  const filteredSaved = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return savedQueries;

    return savedQueries.filter(
      (entry) =>
        entry.title.toLowerCase().includes(q) ||
        entry.sql.toLowerCase().includes(q),
    );
  }, [savedQueries, searchText]);

  const filteredHistory = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return history;

    return history.filter(
      (entry) =>
        entry.sqlPreview.toLowerCase().includes(q) ||
        (entry.errorMessage ?? "").toLowerCase().includes(q),
    );
  }, [history, searchText]);

  const appendLog = useCallback(
    (entry: Omit<SqlExecutionLog, "id" | "createdAt">) => {
      setLogs((current) => {
        const next: SqlExecutionLog = {
          id: newLogId(),
          createdAt: nowIso(),
          ...entry,
        };
        const merged = [next, ...current];
        return merged.length > MAX_LOGS ? merged.slice(0, MAX_LOGS) : merged;
      });
    },
    [],
  );

  const setSql = useCallback((sql: string) => {
    setDoc((current) => ({ ...current, sql, updatedAt: nowIso() }));
  }, []);

  const setTitle = useCallback((title: string) => {
    setDoc((current) => ({ ...current, title, updatedAt: nowIso() }));
  }, []);

  const hydrateFromSaved = useCallback(
    (query: SqlSavedQuery) => {
      setDoc({
        id: query.id,
        title: query.title,
        sql: query.sql,
        updatedAt: query.updatedAt,
      });
      if (query.connectionId !== selectedConnection) {
        onSelectConnection(query.connectionId);
      }
    },
    [onSelectConnection, selectedConnection],
  );

  const hydrateFromHistory = useCallback(
    (entry: SqlHistoryEntry) => {
      setDoc((current) => ({
        ...current,
        id: null,
        title: "Untitled",
        sql: entry.executedSql,
        updatedAt: nowIso(),
      }));
      if (entry.connectionId !== selectedConnection) {
        onSelectConnection(entry.connectionId);
      }
    },
    [onSelectConnection, selectedConnection],
  );

  const saveCurrentQuery = useCallback(async () => {
    if (!selectedConnection) return;

    const persisted = await saveQuery({
      id: doc.id ?? undefined,
      title: doc.title.trim() || "Untitled",
      sql: doc.sql,
      connectionId: selectedConnection,
    });

    if (persisted) {
      setDoc((current) => ({
        ...current,
        id: persisted.id,
        title: persisted.title,
        updatedAt: persisted.updatedAt,
      }));
      appendLog({
        level: "success",
        message: `Saved query: ${persisted.title}`,
      });
    }
  }, [appendLog, doc.id, doc.sql, doc.title, saveQuery, selectedConnection]);

  const runSql = useCallback(async () => {
    if (!selectedConnection || !doc.sql.trim()) return;
    if (executionAbort.current) return; // already running

    const editorInstance = editorRef.current;
    const selection = editorInstance?.getSelection();
    const model = editorInstance?.getModel();

    const selectedText =
      selection && model ? model.getValueInRange(selection).trim() : "";

    const sqlToRun = selectedText.length > 0 ? selectedText : doc.sql;
    if (!sqlToRun.trim()) return;

    const controller = new AbortController();
    executionAbort.current = controller;

    setIsExecuting(true);
    setLastError(null);
    setActiveResultTab("result");

    const startedAt = performance.now();
    appendLog({ level: "info", message: "Running query..." });

    try {
      const result = await executeQuery(selectedConnection, sqlToRun);
      if (controller.signal.aborted) return;
      const durationMs = performance.now() - startedAt;

      setLastResult(result);
      setLastError(null);

      appendLog({
        level: "success",
        message: `Query completed (${result.row_count} rows)`,
        durationMs,
        rowCount: result.row_count,
      });

      await appendHistory({
        connectionId: selectedConnection,
        sqlPreview: previewSql(sqlToRun),
        executedSql: sqlToRun,
        status: "success",
        rowCount: result.row_count,
        durationMs,
        createdAt: nowIso(),
      });
    } catch (err) {
      if (controller.signal.aborted) return;
      const durationMs = performance.now() - startedAt;
      const message = err instanceof Error ? err.message : "Unknown error";

      setLastError(message);
      appendLog({
        level: "error",
        message,
        durationMs,
      });

      await appendHistory({
        connectionId: selectedConnection,
        sqlPreview: previewSql(sqlToRun),
        executedSql: sqlToRun,
        status: "error",
        rowCount: 0,
        durationMs,
        createdAt: nowIso(),
        errorMessage: message,
      });

      setActiveResultTab("logs");
    } finally {
      if (executionAbort.current === controller) {
        executionAbort.current = null;
      }
      setIsExecuting(false);
    }
  }, [appendHistory, appendLog, doc.sql, executeQuery, selectedConnection]);

  const handleEditorMount = useCallback<OnMount>((mounted) => {
    editorRef.current = mounted;
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const isMeta = event.metaKey || event.ctrlKey;
      if (!isMeta) return;

      if (event.key === "Enter") {
        event.preventDefault();
        void runSql();
      }

      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveCurrentQuery();
      }

      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    },
    [runSql, saveCurrentQuery],
  );

  return (
    <section
      className="h-full min-h-0 rounded-none bg-background"
      aria-label="SQL editor workspace"
      onKeyDown={handleKeyDown}
    >
      <div
        className={`h-full min-h-0 grid ${showWorkspaceSidebar ? "grid-cols-[260px_1fr]" : "grid-cols-1"}`}
      >
        {showWorkspaceSidebar && (
          <aside className="min-h-0 flex flex-col">
            <div className="p-4 border-b space-y-3">
              <div>
                <p className="text-lg font-semibold">SQL Editor</p>
                <p className="text-xs text-muted-foreground">
                  {selectedConnectionMeta.name}
                </p>
              </div>
              <Input
                ref={searchInputRef}
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Search saved/history (Cmd/Ctrl+K)"
              />
            </div>

            <Tabs
              value={activeSidebarTab}
              onValueChange={(value) =>
                setActiveSidebarTab(value as "saved" | "history")
              }
              className="flex-1 min-h-0"
            >
              <TabsList className="mx-3 mt-3">
                <TabsTrigger value="saved">
                  <Star className="h-3.5 w-3.5" />
                  Saved
                </TabsTrigger>
                <TabsTrigger value="history">
                  <History className="h-3.5 w-3.5" />
                  History
                </TabsTrigger>
              </TabsList>

              <TabsContent
                value="saved"
                className="min-h-0 overflow-auto px-3 pb-3"
              >
                <div className="space-y-1">
                  {filteredSaved.map((entry) => (
                    <div
                      key={entry.id}
                      className="border rounded-md p-2 hover:bg-muted/40"
                    >
                      <button
                        type="button"
                        className="w-full text-left"
                        onClick={() => hydrateFromSaved(entry)}
                      >
                        <p className="text-sm font-medium truncate">
                          {entry.title}
                        </p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {previewSql(entry.sql)}
                        </p>
                      </button>
                      <div className="mt-2 flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => {
                            const next = window.prompt(
                              "Rename query",
                              entry.title,
                            );
                            if (next?.trim()) {
                              void renameQuery(entry.id, next.trim());
                            }
                          }}
                        >
                          Rename
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => void deleteQuery(entry.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}

                  {filteredSaved.length === 0 && (
                    <div className="text-xs text-muted-foreground text-center py-8">
                      No saved queries.
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent
                value="history"
                className="min-h-0 overflow-auto px-3 pb-3"
              >
                <div className="space-y-1">
                  {filteredHistory.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      className="w-full border rounded-md p-2 text-left hover:bg-muted/40"
                      onClick={() => hydrateFromHistory(entry)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[11px] text-muted-foreground">
                          {new Date(entry.createdAt).toLocaleString()}
                        </p>
                        <Badge
                          variant={
                            entry.status === "success"
                              ? "outline"
                              : "destructive"
                          }
                        >
                          {entry.status}
                        </Badge>
                      </div>
                      <p className="text-sm truncate mt-1">
                        {entry.sqlPreview}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        {formatDuration(entry.durationMs)} • {entry.rowCount}{" "}
                        rows
                      </p>
                    </button>
                  ))}

                  {filteredHistory.length === 0 && (
                    <div className="text-xs text-muted-foreground text-center py-8">
                      Your history is empty.
                    </div>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </aside>
        )}

        <section className="min-h-0 flex flex-col">
          <div className="border-b px-3 py-2 flex flex-wrap items-center gap-2">
            <Input
              className="w-[220px]"
              value={doc.title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Untitled"
            />

            <Button
              variant="outline"
              size="sm"
              onClick={() => void saveCurrentQuery()}
            >
              <Save className="h-3.5 w-3.5" />
              Save
            </Button>

            <div className="h-6 w-px bg-border mx-1" />

            <Database className="h-4 w-4 text-muted-foreground" />
            <Select
              value={selectedConnection || undefined}
              onValueChange={(value) => value && onSelectConnection(value)}
            >
              <SelectTrigger className="w-[280px]">
                <SelectValue placeholder="Select a connection">
                  {selectedConnectionMeta.label}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {connections.map((conn) => (
                  <SelectItem key={conn.id} value={conn.id}>
                    {conn.name?.trim() ||
                      conn.database?.trim() ||
                      "Unnamed connection"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="ml-auto flex items-center gap-2">
              <Badge variant="outline">
                {selectedConnection ? "Ready" : "Disconnected"}
              </Badge>
              <Button
                onClick={() => void runSql()}
                disabled={!selectedConnection || isExecuting || !doc.sql.trim()}
                className="gap-2"
              >
                {isExecuting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                Run
              </Button>
            </div>
          </div>

          <div className="flex-1 min-h-0 grid grid-rows-[minmax(300px,1fr)_260px]">
            <div className="min-h-0 border-b">
              <Editor
                height="100%"
                defaultLanguage="sql"
                value={doc.sql}
                onMount={handleEditorMount}
                onChange={(value) => setSql(value || "")}
                theme={monacoTheme}
                options={MONACO_OPTIONS}
              />
            </div>

            <Tabs
              value={activeResultTab}
              onValueChange={(value) =>
                setActiveResultTab(value as "result" | "logs")
              }
              className="min-h-0 flex flex-col"
            >
              <div className="border-b px-3 py-2">
                <TabsList>
                  <TabsTrigger value="result">Result</TabsTrigger>
                  <TabsTrigger value="logs">Logs</TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="result" className="min-h-0 overflow-auto p-3">
                <QueryResults result={lastResult} error={lastError} />
              </TabsContent>

              <TabsContent value="logs" className="min-h-0 overflow-auto p-3">
                <div className="space-y-2">
                  {logs.map((log) => (
                    <div key={log.id} className="border rounded-md p-2">
                      <div className="flex items-center justify-between gap-2">
                        <Badge
                          variant={
                            log.level === "error"
                              ? "destructive"
                              : log.level === "success"
                                ? "outline"
                                : "secondary"
                          }
                        >
                          {log.level}
                        </Badge>
                        <p className="text-[11px] text-muted-foreground">
                          {new Date(log.createdAt).toLocaleTimeString()}
                        </p>
                      </div>
                      <p className="text-sm mt-1">{log.message}</p>
                      {(log.durationMs !== undefined ||
                        log.rowCount !== undefined) && (
                        <p className="text-[11px] text-muted-foreground mt-1">
                          {log.durationMs !== undefined
                            ? formatDuration(log.durationMs)
                            : ""}
                          {log.durationMs !== undefined &&
                          log.rowCount !== undefined
                            ? " • "
                            : ""}
                          {log.rowCount !== undefined
                            ? `${log.rowCount} rows`
                            : ""}
                        </p>
                      )}
                    </div>
                  ))}

                  {logs.length === 0 && (
                    <div className="text-xs text-muted-foreground text-center py-8">
                      No logs yet.
                    </div>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </section>
      </div>
    </section>
  );
}
