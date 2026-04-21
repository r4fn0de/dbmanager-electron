import Editor, { type OnMount } from "@monaco-editor/react";
import {
  Clock,
  FileCode2,
  Loader2,
  Pencil,
  Play,
  Save,
  Search,
  Star,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { useTheme } from "next-themes";
import type { KeyboardEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QueryResults } from "@/components/QueryResults";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd, KbdGroup } from "@/components/ui/kbd";

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  type Layout,
} from "@/components/ui/resizable";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  useSqlWorkspace,
  type SqlExecutionLog,
  type SqlHistoryEntry,
  type SqlSavedQuery,
} from "@/hooks/useSqlWorkspace";
import { formatDuration } from "@/lib/utils";
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
  onWorkspaceSidebarResize?: (widthPx: number) => void;
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
const MAX_HISTORY_RESULT_ROWS = 50;
const MAX_HISTORY_RESULT_COLUMNS = 30;

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

function toHistoryResultPreview(result: QueryResult): {
  columns: { name: string; type_name: string }[];
  rows: unknown[][];
  row_count: number;
} {
  const columns = result.columns.slice(0, MAX_HISTORY_RESULT_COLUMNS);
  const rows = result.rows
    .slice(0, MAX_HISTORY_RESULT_ROWS)
    .map((row) => row.slice(0, MAX_HISTORY_RESULT_COLUMNS));

  return {
    columns,
    rows,
    row_count: result.row_count,
  };
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
  onWorkspaceSidebarResize,
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

  // Persist sidebar width across sessions via localStorage
  const savedSidebarLayout = useMemo(() => {
    if (!selectedConnection) return undefined;
    try {
      const raw = localStorage.getItem(`sql-sidebar-layout:${selectedConnection}`);
      return raw ? (JSON.parse(raw) as Layout) : undefined;
    } catch {
      return undefined;
    }
  }, [selectedConnection]);
  const persistSidebarLayout = useCallback(
    (layout: Layout) => {
      if (!selectedConnection) return;
      try {
        localStorage.setItem(`sql-sidebar-layout:${selectedConnection}`, JSON.stringify(layout));
      } catch { /* quota exceeded or private mode */ }
    },
    [selectedConnection],
  );

  // Persist editor/results vertical split across sessions
  const savedEditorSplitLayout = useMemo(() => {
    if (!selectedConnection) return undefined;
    try {
      const raw = localStorage.getItem(`sql-editor-split:${selectedConnection}`);
      return raw ? (JSON.parse(raw) as Layout) : undefined;
    } catch {
      return undefined;
    }
  }, [selectedConnection]);
  const persistEditorSplitLayout = useCallback(
    (layout: Layout) => {
      if (!selectedConnection) return;
      try {
        localStorage.setItem(`sql-editor-split:${selectedConnection}`, JSON.stringify(layout));
      } catch { /* quota exceeded or private mode */ }
    },
    [selectedConnection],
  );

  const [isExecuting, setIsExecuting] = useState(false);
  const [lastResult, setLastResult] = useState<QueryResult | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastDurationMs, setLastDurationMs] = useState<number | undefined>();
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

      setLastDurationMs(entry.durationMs);
      if (entry.status === "success") {
        setLastError(null);
        setLastResult(entry.resultPreview ?? null);
        setActiveResultTab("result");
      } else {
        setLastResult(null);
        setLastError(entry.errorMessage ?? "Query failed");
        setActiveResultTab("logs");
      }

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
      setLastDurationMs(durationMs);

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
        resultPreview: toHistoryResultPreview(result),
      });
    } catch (err) {
      if (controller.signal.aborted) return;
      const durationMs = performance.now() - startedAt;
      const message = err instanceof Error ? err.message : "Unknown error";

      setLastError(message);
      setLastDurationMs(durationMs);
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
      <ResizablePanelGroup
        className="h-full min-h-0"
        defaultLayout={savedSidebarLayout}
        onLayoutChanged={persistSidebarLayout}
      >
        {showWorkspaceSidebar && (            <ResizablePanel
            id="sql-sidebar"
            defaultSize="22%"
            minSize="15%"
            maxSize="40%"
            onResize={(size) => {
              onWorkspaceSidebarResize?.(size.inPixels);
            }}
            className="min-h-0 bg-sidebar"
          >
          <aside className="h-full min-h-0 flex flex-col bg-sidebar">
            {/* Sidebar Header */}
            <div className="px-3 pt-3 pb-1 shrink-0">
              {/* Title Row */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <FileCode2 className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-semibold tracking-tight text-foreground">Workspace</span>
                  {isExecuting ? (
                    <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                  ) : (
                    savedQueries.length > 0 && (
                      <span className="text-[10px] text-muted-foreground tabular-nums">
                        {savedQueries.length} saved · {history.length} history
                      </span>
                    )
                  )}
                </div>
              </div>

              {/* Search Bar */}
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
                <Input
                  ref={searchInputRef}
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  placeholder="Filter queries..."
                  className="h-7 pl-7 pr-7 text-xs bg-muted/40 border-dashed focus:bg-background focus:border-solid"
                />
                {searchText && (
                  <button
                    type="button"
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => setSearchText("")}
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>

            {/* Tabs */}
            <Tabs
              value={activeSidebarTab}
              onValueChange={(value) =>
                setActiveSidebarTab(value as "saved" | "history")
              }
              className="flex-1 min-h-0 flex flex-col"
            >
              <TabsList variant="line" className="mx-3 shrink-0">
                <TabsTrigger value="saved" className="gap-1.5 text-xs">
                  <Star className="h-3 w-3" />
                  Saved
                </TabsTrigger>
                <TabsTrigger value="history" className="gap-1.5 text-xs">
                  <Clock className="h-3 w-3" />
                  History
                </TabsTrigger>
              </TabsList>

              {/* Saved queries */}
              <ScrollArea className="flex-1 min-h-0">
                <div className="px-2 py-1.5">
                  <div className="space-y-0.5">
                    {filteredSaved.map((entry) => (
                      <div
                        key={entry.id}
                        className="group/saved rounded-md px-2.5 py-[7px] hover:bg-muted/50 transition-colors relative"
                      >
                        <button
                          type="button"
                          className="w-full text-left pr-12"
                          onClick={() => hydrateFromSaved(entry)}
                        >
                          <p className="text-[13px] font-medium truncate leading-tight">
                            {entry.title}
                          </p>
                          <p className="text-[11px] text-muted-foreground truncate font-mono leading-4 mt-0.5">
                            {previewSql(entry.sql)}
                          </p>
                        </button>
                        {/* Hover-reveal actions */}
                        <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover/saved:opacity-100 transition-opacity">
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <Button
                                  variant="ghost"
                                  size="icon-xs"
                                  onClick={() => {
                                    const next = window.prompt(
                                      "Rename query",
                                      entry.title,
                                    );
                                    if (next?.trim()) {
                                      void renameQuery(entry.id, next.trim());
                                    }
                                  }}
                                  className="text-muted-foreground hover:text-foreground"
                                >
                                  <Pencil className="h-3 w-3" />
                                </Button>
                              }
                            />
                            <TooltipContent>Rename query</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <Button
                                  variant="ghost"
                                  size="icon-xs"
                                  onClick={() => void deleteQuery(entry.id)}
                                  className="text-muted-foreground hover:text-destructive"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              }
                            />
                            <TooltipContent>Delete query</TooltipContent>
                          </Tooltip>
                        </div>
                      </div>
                    ))}
                  </div>

                  {filteredSaved.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
                      <Star className="h-4 w-4 text-muted-foreground/50 mb-2" />
                      <p className="text-xs text-muted-foreground">
                        {searchText ? "No matches found" : "No saved queries"}
                      </p>
                      {searchText && (
                        <p className="text-[11px] text-muted-foreground/60 mt-1">
                          Press ⌘S to save queries
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </ScrollArea>

              {/* History */}
              <TabsContent
                value="history"
                className="min-h-0 flex flex-col"
              >
                <ScrollArea className="flex-1 min-h-0">
                  <div className="px-2 py-1.5">
                    <div className="space-y-0.5">
                      {filteredHistory.map((entry) => (
                        <button
                          key={entry.id}
                          type="button"
                          className="group/history w-full flex items-start gap-2.5 px-2.5 py-[7px] rounded-md text-left hover:bg-muted/50 transition-colors"
                          onClick={() => hydrateFromHistory(entry)}
                        >
                          {/* Status indicator */}
                          <span
                            className={`mt-1 inline-block h-1.5 w-1.5 rounded-full shrink-0 ${
                              entry.status === "success"
                                ? "bg-emerald-500"
                                : "bg-destructive/60"
                            }`}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-medium truncate leading-tight">
                              {entry.sqlPreview}
                            </p>

                            {/* Meta row */}
                            <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-muted-foreground">
                              <span>{formatDuration(entry.durationMs)}</span>
                              <span className="opacity-30">·</span>
                              <span>{entry.rowCount} rows</span>
                              <span className="opacity-30">·</span>
                              <span>{new Date(entry.createdAt).toLocaleTimeString()}</span>
                            </div>

                            {/* Error message */}
                            {entry.status === "error" && entry.errorMessage && (
                              <p className="text-[10px] text-destructive/60 mt-0.5 truncate">
                                {entry.errorMessage}
                              </p>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>

                    {filteredHistory.length === 0 && (
                      <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
                        <Clock className="h-4 w-4 text-muted-foreground/50 mb-2" />
                        <p className="text-xs text-muted-foreground">
                          {searchText ? "No matches found" : "No history yet"}
                        </p>
                        {searchText && (
                          <p className="text-[11px] text-muted-foreground/60 mt-1">
                            Run a query with ⌘⏎
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </aside>
          </ResizablePanel>
        )}
        {showWorkspaceSidebar && <ResizableHandle withHandle />}
        <ResizablePanel id="sql-editor" className="min-h-0">
        <section className="h-full min-h-0 flex flex-col">
          {/* ── Editor toolbar (single row) ──────────────────── */}
          <div className="flex items-center gap-2 border-b px-3 py-1.5">
            {/* Query title */}
            <Input
              className="h-7 w-[180px] rounded-md border-transparent bg-transparent px-1.5 font-medium text-sm hover:bg-muted/60 focus:bg-background focus:border-border transition-colors"
              value={doc.title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Untitled query"
            />

            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => void saveCurrentQuery()}
                    className="gap-1"
                  >
                    <Save className="h-3 w-3" />
                    Save
                  </Button>
                }
              />
              <TooltipContent>
                Save query
                <KbdGroup>
                  <Kbd>⌘</Kbd>
                  <Kbd>S</Kbd>
                </KbdGroup>
              </TooltipContent>
            </Tooltip>

            <Separator orientation="vertical" className="h-5" />

            {/* Current connection (fixed by page context) */}
            <span
              className={`inline-block h-2 w-2 rounded-full shrink-0 ${
                selectedConnection
                  ? "bg-emerald-500"
                  : "bg-muted-foreground/40"
              }`}
            />
            <span className="max-w-[260px] truncate text-xs text-muted-foreground">
              {selectedConnectionMeta.label || "No connection selected"}
            </span>

            {/* Run button */}
            <div className="ml-auto flex items-center gap-2 shrink-0">
              {isExecuting && (
                <span className="text-xs text-muted-foreground font-mono animate-pulse">
                  Running…
                </span>
              )}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      size="sm"
                      onClick={() => void runSql()}
                      disabled={!selectedConnection || isExecuting || !doc.sql.trim()}
                      className="gap-1.5"
                    >
                      {isExecuting ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Play className="h-3.5 w-3.5" />
                      )}
                      Run
                    </Button>
                  }
                />
                <TooltipContent>
                  Execute query
                  <KbdGroup>
                    <Kbd>⌘</Kbd>
                    <Kbd>⏎</Kbd>
                  </KbdGroup>
                </TooltipContent>
              </Tooltip>
            </div>
          </div>

          <ResizablePanelGroup
            orientation="vertical"
            className="flex-1 min-h-0"
            defaultLayout={savedEditorSplitLayout}
            onLayoutChanged={persistEditorSplitLayout}
          >
            <ResizablePanel id="sql-editor-pane" defaultSize="50%" minSize="20%" maxSize="80%" className="min-h-0">
              <div className="h-full min-h-0">
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
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel id="sql-results-pane" defaultSize="50%" minSize="20%" maxSize="80%" className="min-h-0">
            <Tabs
              value={activeResultTab}
              onValueChange={(value) =>
                setActiveResultTab(value as "result" | "logs")
              }
              className="h-full min-h-0 flex flex-col"
            >
              <div className="border-b px-3 py-2 shrink-0">
                <TabsList>
                  <TabsTrigger value="result">Result</TabsTrigger>
                  <TabsTrigger value="logs">Logs</TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="result" className="min-h-0 overflow-auto px-3 pb-3">
                <QueryResults result={lastResult} error={lastError} durationMs={lastDurationMs} />
              </TabsContent>

              <TabsContent value="logs" className="min-h-0 overflow-auto px-3 py-2">
                <div className="space-y-0.5">
                  {logs.map((log) => (
                    <div
                      key={log.id}
                      className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted/40 transition-colors"
                    >
                      {/* Level indicator dot */}
                      <span
                        className={`mt-1 inline-block h-1.5 w-1.5 rounded-full shrink-0 ${
                          log.level === "error"
                            ? "bg-destructive/60"
                            : log.level === "success"
                              ? "bg-emerald-500"
                              : "bg-muted-foreground/40"
                        }`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-xs leading-4">{log.message}</p>
                          <span className="text-[10px] text-muted-foreground shrink-0 ml-auto">
                            {new Date(log.createdAt).toLocaleTimeString()}
                          </span>
                        </div>
                        {(log.durationMs !== undefined ||
                          log.rowCount !== undefined) && (
                          <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-muted-foreground">
                            {log.durationMs !== undefined && (
                              <span>{formatDuration(log.durationMs)}</span>
                            )}
                            {log.durationMs !== undefined &&
                              log.rowCount !== undefined && (
                                <span className="opacity-30">·</span>
                              )}
                            {log.rowCount !== undefined && (
                              <span>{log.rowCount} rows</span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}

                  {logs.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                      <Terminal className="h-6 w-6 mb-2 opacity-20" />
                      <p className="text-xs font-medium">No logs yet</p>
                      <p className="text-[11px] mt-1 opacity-50">
                        Execute a query to see activity here
                      </p>
                    </div>
                  )}
                </div>
              </TabsContent>
            </Tabs>
            </ResizablePanel>
          </ResizablePanelGroup>
        </section>
        </ResizablePanel>
      </ResizablePanelGroup>
    </section>
  );
}
