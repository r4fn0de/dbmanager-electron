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
import { toast } from "sonner";
import { QueryResults } from "./QueryResults";
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
import type { Connection, QueryResult } from "@/ipc/db/types";

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

interface SqlDocument {
  id: string | null;
  title: string;
  sql: string;
  updatedAt: string;
}

interface SqlHistoryEntry {
  id: string;
  sql: string;
  executedAt: string;
  durationMs: number;
  rowCount: number;
  error: string | null;
}

interface SqlSavedQuery {
  id: string;
  title: string;
  sql: string;
  updatedAt: string;
}

const DEFAULT_SQL = `/*
Try creating a sample table and querying it.
*/
SELECT now() as server_time;`;

const MAX_HISTORY_PREVIEW = 140;
const MAX_LOGS = 200;

const STORAGE_KEY_HISTORY = "sql-history";
const STORAGE_KEY_SAVED = "sql-saved-queries";
const MAX_HISTORY = 50;

type MonacoEditor = Parameters<OnMount>[0];

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

function nowIso() {
  return new Date().toISOString();
}

function formatDuration(ms: number) {
  return `${Math.max(0, Math.round(ms))}ms`;
}

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function newLogId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  return (
    g.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

interface SqlExecutionLog {
  id: string;
  level: "info" | "success" | "error";
  message: string;
  createdAt: string;
  durationMs?: number;
  rowCount?: number;
}

function loadHistory(): SqlHistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_HISTORY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(entries: SqlHistoryEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(entries.slice(0, MAX_HISTORY)));
  } catch {}
}

function loadSavedQueries(): SqlSavedQuery[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SAVED);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSavedQueries(queries: SqlSavedQuery[]) {
  try {
    localStorage.setItem(STORAGE_KEY_SAVED, JSON.stringify(queries));
  } catch {}
}

function previewSql(sql: string): string {
  const normalized = sql.replace(/\s+/g, " ").trim();
  if (normalized.length <= 140) return normalized;
  return `${normalized.slice(0, 140)}...`;
}

export function SqlEditor({
  connections,
  selectedConnection,
  onSelectConnection,
  executeQuery,
  showWorkspaceSidebar = true,
  loadRequest = null,
}: SqlEditorProps) {
  const [doc, setDoc] = useState<SqlDocument>({
    id: null,
    title: "Untitled",
    sql: DEFAULT_SQL,
    updatedAt: nowIso(),
  });

  const [activeSidebarTab, setActiveSidebarTab] = useState<"saved" | "history">("saved");
  const [activeResultTab, setActiveResultTab] = useState<"result" | "logs">("result");
  const [searchText, setSearchText] = useState("");

  const [isExecuting, setIsExecuting] = useState(false);
  const [lastResult, setLastResult] = useState<QueryResult | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [history, setHistory] = useState<SqlHistoryEntry[]>(loadHistory);
  const [savedQueries, setSavedQueries] = useState<SqlSavedQuery[]>(loadSavedQueries);
  const [logs, setLogs] = useState<SqlExecutionLog[]>([]);

  const { resolvedTheme } = useTheme();
  const monacoTheme = resolvedTheme === "dark" ? "vs-dark" : "vs";

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const editorRef = useRef<MonacoEditor | null>(null);

  const selectedConnectionMeta = useMemo(() => {
    const found = connections.find((conn) => conn.id === selectedConnection);
    return {
      name: found?.name ?? "No connection",
      label: !found
        ? ""
        : found.name?.trim() || found.database?.trim() || "Unnamed connection",
    };
  }, [connections, selectedConnection]);

  // Load saved queries on mount
  useEffect(() => {
    setSavedQueries(loadSavedQueries());
  }, []);

  // Handle external load request
  useEffect(() => {
    if (!loadRequest) return;
    setDoc({
      id: loadRequest.key.startsWith("saved:") ? loadRequest.key.replace("saved:", "") : null,
      title: loadRequest.title,
      sql: loadRequest.sql,
      updatedAt: nowIso(),
    });
    if (loadRequest.connectionId) {
      onSelectConnection(loadRequest.connectionId);
    }
  }, [loadRequest, onSelectConnection]);

  const filteredSaved = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return savedQueries;
    return savedQueries.filter(
      (s) =>
        s.title.toLowerCase().includes(q) || s.sql.toLowerCase().includes(q)
    );
  }, [savedQueries, searchText]);

  const filteredHistory = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return history;
    return history.filter(
      (h) => h.sql.toLowerCase().includes(q) || (h.error && h.error.toLowerCase().includes(q))
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

  const handleExecute = useCallback(async () => {
    if (!selectedConnection || !doc.sql.trim()) return;

    const editorInstance = editorRef.current;
    const selection = editorInstance?.getSelection();
    const model = editorInstance?.getModel();

    const selectedText =
      selection && model ? model.getValueInRange(selection).trim() : "";

    const sqlToRun = selectedText.length > 0 ? selectedText : doc.sql;
    if (!sqlToRun.trim()) return;

    setIsExecuting(true);
    setLastError(null);
    setLastResult(null);
    setActiveResultTab("result");

    const start = performance.now();
    appendLog({ level: "info", message: "Running query..." });

    try {
      const result = await executeQuery(selectedConnection, sqlToRun);
      const duration = performance.now() - start;

      setLastResult(result);

      // Add to history
      const entry: SqlHistoryEntry = {
        id: newId(),
        sql: sqlToRun,
        executedAt: nowIso(),
        durationMs: Math.round(duration),
        rowCount: result.row_count,
        error: null,
      };
      setHistory((prev) => {
        const next = [entry, ...prev];
        saveHistory(next);
        return next;
      });

      appendLog({
        level: "success",
        message: `Query completed (${result.row_count} rows)`,
        durationMs: duration,
        rowCount: result.row_count,
      });

      toast.success(`Query executed in ${formatDuration(duration)}`);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const duration = performance.now() - start;
      setLastError(error);

      // Add failed execution to history
      const entry: SqlHistoryEntry = {
        id: newId(),
        sql: sqlToRun,
        executedAt: nowIso(),
        durationMs: Math.round(duration),
        rowCount: 0,
        error,
      };
      setHistory((prev) => {
        const next = [entry, ...prev];
        saveHistory(next);
        return next;
      });

      appendLog({
        level: "error",
        message: error,
        durationMs: duration,
      });

      setActiveResultTab("logs");
      toast.error(error);
    } finally {
      setIsExecuting(false);
    }
  }, [selectedConnection, doc.sql, executeQuery, appendLog]);

  const handleSave = useCallback(() => {
    if (!doc.sql.trim()) return;

    const title = doc.title?.trim() || "Untitled";
    let nextSaved: SqlSavedQuery[];

    if (doc.id) {
      // Update existing
      nextSaved = savedQueries.map((s) =>
        s.id === doc.id
          ? { ...s, sql: doc.sql, title, updatedAt: nowIso() }
          : s
      );
    } else {
      // Create new
      const newSaved: SqlSavedQuery = {
        id: newId(),
        title,
        sql: doc.sql,
        updatedAt: nowIso(),
      };
      nextSaved = [newSaved, ...savedQueries];
      setDoc((d) => ({ ...d, id: newSaved.id }));
    }

    setSavedQueries(nextSaved);
    saveSavedQueries(nextSaved);
    appendLog({
      level: "success",
      message: `Saved query: ${title}`,
    });
    toast.success("Query saved");
  }, [doc, savedQueries, appendLog]);

  const handleDeleteSaved = useCallback((id: string) => {
    setSavedQueries((prev) => {
      const next = prev.filter((s) => s.id !== id);
      saveSavedQueries(next);
      return next;
    });
    if (doc.id === id) {
      setDoc({ id: null, title: "Untitled", sql: doc.sql, updatedAt: nowIso() });
    }
  }, [doc.id, doc.sql]);

  const handleLoadSaved = useCallback((saved: SqlSavedQuery) => {
    setDoc({
      id: saved.id,
      title: saved.title,
      sql: saved.sql,
      updatedAt: saved.updatedAt,
    });
  }, []);

  const handleLoadHistory = useCallback((entry: SqlHistoryEntry) => {
    setDoc((d) => ({
      ...d,
      sql: entry.sql,
      updatedAt: nowIso(),
    }));
  }, []);

  const handleNew = useCallback(() => {
    setDoc({ id: null, title: "Untitled", sql: "", updatedAt: nowIso() });
    setLastResult(null);
    setLastError(null);
  }, []);

  const handleEditorMount = useCallback<OnMount>((mounted) => {
    editorRef.current = mounted;
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const isMeta = event.metaKey || event.ctrlKey;
      if (!isMeta) return;

      if (event.key === "Enter") {
        event.preventDefault();
        void handleExecute();
      }

      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        void handleSave();
      }

      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    },
    [handleExecute, handleSave],
  );

  const hasContent = doc.sql.trim().length > 0;

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
                        onClick={() => handleLoadSaved(entry)}
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
                              const updated = savedQueries.map((s) =>
                                s.id === entry.id
                                  ? { ...s, title: next.trim(), updatedAt: nowIso() }
                                  : s,
                              );
                              setSavedQueries(updated);
                              saveSavedQueries(updated);
                            }
                          }}
                        >
                          Rename
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => handleDeleteSaved(entry.id)}
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
                      onClick={() => handleLoadHistory(entry)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[11px] text-muted-foreground">
                          {new Date(entry.executedAt).toLocaleString()}
                        </p>
                        <Badge
                          variant={
                            entry.error ? "destructive" : "outline"
                          }
                        >
                          {entry.error ? "error" : "success"}
                        </Badge>
                      </div>
                      <p className="text-sm truncate mt-1">
                        {previewSql(entry.sql)}
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
              onChange={(event) =>
                setDoc((d) => ({ ...d, title: event.target.value, updatedAt: nowIso() }))
              }
              placeholder="Untitled"
            />

            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleSave()}
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
                onClick={() => void handleExecute()}
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
                onChange={(value) =>
                  setDoc((d) => ({ ...d, sql: value || "", updatedAt: nowIso() }))
                }
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
