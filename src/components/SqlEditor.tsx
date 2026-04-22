import {
  Bot,
  Clock,
  FileCode2,
  Loader2,
  Pencil,
  Play,
  Save,
  Search,
  Sparkles,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { useTheme } from "next-themes";
import type { KeyboardEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { QueryResults } from "@/components/QueryResults";
import { AiChatPanel } from "@/components/AiChatPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { LazyMonacoEditor, type OnMount } from "@/components/LazyMonacoEditor";

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  type Layout,
  type GroupImperativeHandle,
  useDefaultLayout,
} from "@/components/ui/resizable";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  useSqlWorkspace,
  type SqlHistoryEntry,
  type SqlSavedQuery,
} from "@/hooks/useSqlWorkspace";
import { fixSql } from "@/hooks/ai-actions";
import { formatDuration } from "@/lib/utils";
import {
  buildExplainSql,
  formatSql,
  registerSqlCompletion,
  disposeSqlCompletion,
  updateSchemaData,
  supportsExplainAnalyze,
  type SchemaCompletionData,
} from "@/lib/monaco-sql-setup";
import { cn } from "@/utils/tailwind";
import * as monaco from "monaco-editor";
import "@/lib/monaco-loader";
import type {
  Connection,
  DatabaseType,
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
  /** Active database type for AI context */
  dbType?: DatabaseType;
  /** Schema context string for AI — table/column names so the AI can write accurate SQL from the start */
  schemaContext?: string;
  /** Schema data for autocomplete — table names, column names, schemas */
  schemaCompletionData?: SchemaCompletionData;
}

const DEFAULT_SQL = `/*
Try creating a sample table and querying it.
*/
SELECT now() as server_time;`;

const MAX_HISTORY_PREVIEW = 140;
const MAX_HISTORY_RESULT_ROWS = 50;
const MAX_HISTORY_RESULT_COLUMNS = 30;
const DANGEROUS_SQL_KEYWORDS = ["DELETE", "UPDATE", "DROP", "RENAME", "TRUNCATE", "ALTER"] as const;

type MonacoEditor = Parameters<OnMount>[0];

interface SqlDocument {
  id: string | null;
  title: string;
  sql: string;
  updatedAt: string;
}

interface SqlRunResult {
  id: string;
  query: string;
  status: "success" | "error";
  result: QueryResult | null;
  error: string | null;
  durationMs: number;
  rowCount: number;
}

const MONACO_OPTIONS = {
  minimap: { enabled: false },
  fontSize: 14,
  lineNumbers: "on",
  roundedSelection: false,
  scrollBeyondLastLine: false,
  automaticLayout: false, // We use ResizeObserver + debounced layout() instead of 100ms polling
  padding: { top: 12 },
  tabSize: 2,
} as const;

function previewSql(sql: string): string {
  const normalized = sql.replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_HISTORY_PREVIEW) return normalized;
  return `${normalized.slice(0, MAX_HISTORY_PREVIEW)}...`;
}

function hasDangerousSqlKeywords(sql: string): boolean {
  const uncommentedLines = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  const dangerousKeywordsPattern = DANGEROUS_SQL_KEYWORDS
    .map((keyword) => `\\b${keyword}\\b`)
    .join("|");
  return new RegExp(dangerousKeywordsPattern, "gi").test(uncommentedLines);
}

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;
  let dollarTag: string | null = null;

  const pushCurrent = () => {
    const trimmed = current.trim();
    if (trimmed) statements.push(trimmed);
    current = "";
  };

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = i + 1 < sql.length ? sql[i + 1] : "";

    if (inLineComment) {
      current += ch;
      if (ch === "\n") inLineComment = false;
      continue;
    }

    if (inBlockComment) {
      current += ch;
      if (ch === "*" && next === "/") {
        current += next;
        i++;
        inBlockComment = false;
      }
      continue;
    }

    if (dollarTag) {
      if (sql.startsWith(dollarTag, i)) {
        current += dollarTag;
        i += dollarTag.length - 1;
        dollarTag = null;
      } else {
        current += ch;
      }
      continue;
    }

    if (inSingleQuote) {
      current += ch;
      if (ch === "'" && next === "'") {
        current += next;
        i++;
      } else if (ch === "'") {
        inSingleQuote = false;
      }
      continue;
    }

    if (inDoubleQuote) {
      current += ch;
      if (ch === '"' && next === '"') {
        current += next;
        i++;
      } else if (ch === '"') {
        inDoubleQuote = false;
      }
      continue;
    }

    if (inBacktick) {
      current += ch;
      if (ch === "`") inBacktick = false;
      continue;
    }

    if (ch === "-" && next === "-") {
      current += ch + next;
      i++;
      inLineComment = true;
      continue;
    }

    if (ch === "/" && next === "*") {
      current += ch + next;
      i++;
      inBlockComment = true;
      continue;
    }

    if (ch === "$") {
      const match = sql.slice(i).match(/^\$[a-z_]\w*\$|^\$\$/i);
      if (match) {
        const tag = match[0];
        current += tag;
        i += tag.length - 1;
        dollarTag = tag;
        continue;
      }
    }

    if (ch === "'") {
      current += ch;
      inSingleQuote = true;
      continue;
    }

    if (ch === '"') {
      current += ch;
      inDoubleQuote = true;
      continue;
    }

    if (ch === "`") {
      current += ch;
      inBacktick = true;
      continue;
    }

    if (ch === ";") {
      pushCurrent();
      continue;
    }

    current += ch;
  }

  pushCurrent();
  return statements;
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

export function SqlEditor({
  connections,
  selectedConnection,
  onSelectConnection,
  executeQuery,
  showWorkspaceSidebar = true,
  onWorkspaceSidebarResize,
  loadRequest = null,
  dbType = "postgresql",
  schemaContext,
  schemaCompletionData,
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
  const [searchText, setSearchText] = useState("");

  // Layout persistence via useDefaultLayout (same pattern as conar)
  // onLayoutChanged fires AFTER drag ends — no debouncing needed
  const sidebarLayout = useDefaultLayout({
    id: `sql-sidebar-${selectedConnection ?? "default"}`,
    storage: localStorage,
  });
  const editorSplitLayout = useDefaultLayout({
    id: `sql-editor-split-${selectedConnection ?? "default"}`,
    storage: localStorage,
  });


  const [isExecuting, setIsExecuting] = useState(false);
  const [lastResult, setLastResult] = useState<QueryResult | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastDurationMs, setLastDurationMs] = useState<number | undefined>();
  const [runResults, setRunResults] = useState<SqlRunResult[]>([]);
  const [activeRunResultId, setActiveRunResultId] = useState<string | null>(null);

  const { resolvedTheme } = useTheme();
  const monacoTheme = resolvedTheme === "dark" ? "vs-dark" : "vs";

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const editorRef = useRef<MonacoEditor | null>(null);
  const executionAbort = useRef<AbortController | null>(null);
  const monacoResizeObserverRef = useRef<ResizeObserver | null>(null);
  // Track sidebar pixel width in a ref (cheap, no setState) — read on layout change
  const sidebarWidthRef = useRef<number>(0);

  // AI panel state
  const [isAiChatOpen, setIsAiChatOpen] = useState(false);
  const [isFixingSql, setIsFixingSql] = useState(false);
  // EXPLAIN state (driven by keyboard shortcuts only, no toolbar button)
  const [isExplaining, setIsExplaining] = useState(false);

  // AI chat layout persistence — skip saving when chat is closed
  const AI_CHAT_DEFAULT_SIZE = 30; // percentage
  const aiChatLayoutStore = useDefaultLayout({
    id: `sql-ai-chat-${selectedConnection ?? "default"}`,
    storage: localStorage,
  });
  const persistAiChatLayout = useCallback(
    (layout: Layout) => {
      // Only persist when AI chat is open — avoid saving collapsed state
      if (!isAiChatOpen) return;
      aiChatLayoutStore.onLayoutChanged(layout);
    },
    [aiChatLayoutStore.onLayoutChanged, isAiChatOpen],
  );

  // Group ref for atomic setLayout() — opens/closes AI chat without remounting the editor
  const aiChatGroupRef = useRef<GroupImperativeHandle>(null);
  // Tracks whether the toggle came from the toolbar button (vs. user dragging)
  const aiChatToggleSource = useRef<"button" | "resize">("resize");

  // Collapse/expand AI chat panel imperatively when toggled
  useEffect(() => {
    if (isAiChatOpen) {
      // Only setLayout when triggered by toolbar/close button — not when user dragged to expand
      // (dragging already sets the correct size; setLayout would override it)
      if (aiChatToggleSource.current === "button") {
        const targetSize = aiChatLayoutStore.defaultLayout?.["sql-ai-chat"] ?? AI_CHAT_DEFAULT_SIZE;
        aiChatGroupRef.current?.setLayout({
          "sql-editor-main": 100 - targetSize,
          "sql-ai-chat": targetSize,
        });
      }
    } else {
      // Closing always collapses the panel regardless of source
      aiChatGroupRef.current?.setLayout({ "sql-editor-main": 100, "sql-ai-chat": 0 });
    }
    aiChatToggleSource.current = "resize"; // reset for next time
  }, [isAiChatOpen, aiChatLayoutStore.defaultLayout]);

  // Compute initial layout for the AI chat panel group
  // When chat starts closed, force the chat panel to 0% to avoid a flash on mount
  const aiChatGroupDefaultLayout = useMemo((): Layout | undefined => {
    if (!isAiChatOpen) {
      return { "sql-editor-main": 100, "sql-ai-chat": 0 };
    }
    return aiChatLayoutStore.defaultLayout ?? { "sql-editor-main": 100 - AI_CHAT_DEFAULT_SIZE, "sql-ai-chat": AI_CHAT_DEFAULT_SIZE };
  }, [isAiChatOpen, aiChatLayoutStore.defaultLayout]); // eslint-disable-line react-hooks/exhaustive-deps — defaultLayout is mount-only but we need isAiChatOpen for initial render

  // ── Autocomplete: register Monaco completion provider on mount, update schema data ──
  useEffect(() => {
    registerSqlCompletion();
    return () => disposeSqlCompletion();
  }, []);

  useEffect(() => {
    if (schemaCompletionData) {
      updateSchemaData(schemaCompletionData);
    }
  }, [schemaCompletionData]);

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
    // Clean up on unmount: abort in-flight execution, disconnect Monaco ResizeObserver
    return () => {
      executionAbort.current?.abort();
      monacoResizeObserverRef.current?.disconnect();
      monacoResizeObserverRef.current = null;
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

  const activeRunResult = useMemo(() => {
    if (runResults.length === 0) return null;
    if (!activeRunResultId) return runResults[0];
    return runResults.find((item) => item.id === activeRunResultId) ?? runResults[0];
  }, [activeRunResultId, runResults]);
  const runResultStats = useMemo(() => {
    const total = runResults.length;
    const success = runResults.filter((item) => item.status === "success").length;
    return {
      total,
      success,
      error: total - success,
    };
  }, [runResults]);

  const setSql = useCallback((sql: string) => {
    setDoc((current) => ({ ...current, sql, updatedAt: nowIso() }));
  }, []);

  // AI: Insert SQL into editor (from AI chat) — strip markdown fences if present
  const handleInsertSqlFromAi = useCallback((sql: string) => {
    const cleaned = sql.trim().replace(/^```sql?\s*\n?/, "").replace(/\n?```\s*$/, "").trim();
    setSql(cleaned);
  }, [setSql]);

  // ── Format SQL (Prettify) — driven by keyboard shortcut only (⌘⇧F), no toolbar button ──
  const handleFormatSql = useCallback(() => {
    const editorInstance = editorRef.current;
    if (!editorInstance) return;
    const sql = editorInstance.getValue();
    if (!sql.trim()) return;
    const formatted = formatSql(sql, dbType);
    if (formatted === sql) return;
    // Use executeEdits to preserve undo history (unlike setValue/setSql which reset it)
    const model = editorInstance.getModel();
    if (model) {
      editorInstance.executeEdits("sql-format", [{
        range: model.getFullModelRange(),
        text: formatted,
      }]);
      toast.success("SQL formatted");
    }
  }, [dbType]);

  // ── EXPLAIN Query ────────────────────────────────────────────────
  const handleExplainSql = useCallback(async (analyze: boolean = false) => {
    if (!selectedConnection || !doc.sql.trim()) return;
    if (isExecuting) return;

    const editorInstance = editorRef.current;
    const selection = editorInstance?.getSelection();
    const model = editorInstance?.getModel();
    const selectedText =
      selection && model ? model.getValueInRange(selection).trim() : "";
    const sqlToExplain = selectedText.length > 0 ? selectedText : doc.sql;
    if (!sqlToExplain.trim()) return;

    // EXPLAIN ANALYZE actually executes the query — warn for destructive SQL
    if (analyze && hasDangerousSqlKeywords(sqlToExplain)) {
      const confirmed = window.confirm(
        "EXPLAIN ANALYZE will actually execute this query, which contains potentially destructive operations (DELETE/UPDATE/DROP/etc). Continue?"
      );
      if (!confirmed) return;
    }

    const explainSql = buildExplainSql(sqlToExplain, dbType, analyze);
    setIsExplaining(true);
    try {
      const result = await executeQuery(selectedConnection, explainSql);
      const resultId = `explain-${nowIso()}`;
      setRunResults([{
        id: resultId,
        query: explainSql,
        status: "success",
        result,
        error: null,
        durationMs: 0,
        rowCount: result.row_count,
      }]);
      setActiveRunResultId(resultId);
      setLastResult(result);
      setLastError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "EXPLAIN failed";
      const resultId = `explain-${nowIso()}`;
      setRunResults([{
        id: resultId,
        query: explainSql,
        status: "error",
        result: null,
        error: message,
        durationMs: 0,
        rowCount: 0,
      }]);
      setActiveRunResultId(resultId);
      setLastError(message);
      setLastResult(null);
    } finally {
      setIsExplaining(false);
    }
  }, [selectedConnection, doc.sql, dbType, isExecuting, executeQuery]);

  // AI: Fix SQL — send current SQL + last error to AI for correction
  const handleFixSql = useCallback(async () => {
    if (!selectedConnection || !doc.sql.trim() || !lastError) return;
    setIsFixingSql(true);
    try {
      const result = await fixSql(doc.sql, lastError, dbType);
      if (result.sql && result.sql.trim()) {
        setSql(result.sql);
        toast.success("SQL fixed by AI");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to fix SQL");
    } finally {
      setIsFixingSql(false);
    }
  }, [selectedConnection, doc.sql, lastError, dbType, setSql]);

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
        const resultId = `history-${entry.id}`;
        const previewResult: QueryResult = entry.resultPreview ?? {
          columns: [],
          rows: [],
          row_count: entry.rowCount,
        };
        setRunResults([{
          id: resultId,
          query: entry.executedSql,
          status: "success",
          result: previewResult,
          error: null,
          durationMs: entry.durationMs,
          rowCount: entry.rowCount,
        }]);
        setActiveRunResultId(resultId);
        setLastError(null);
        setLastResult(previewResult);
      } else {
        const resultId = `history-${entry.id}`;
        const errorMessage = entry.errorMessage ?? "Query failed";
        setRunResults([{
          id: resultId,
          query: entry.executedSql,
          status: "error",
          result: null,
          error: errorMessage,
          durationMs: entry.durationMs,
          rowCount: 0,
        }]);
        setActiveRunResultId(resultId);
        setLastResult(null);
        setLastError(errorMessage);
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
    }
  }, [doc.id, doc.sql, doc.title, saveQuery, selectedConnection]);

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

    const statements = splitSqlStatements(sqlToRun);
    if (statements.length === 0) return;

    const hasDangerous = statements.some((statement) =>
      hasDangerousSqlKeywords(statement)
    );
    if (hasDangerous) {
      const confirmed = window.confirm(
        "This SQL contains potentially destructive operations (DELETE/UPDATE/DROP/etc). Do you want to continue?"
      );
      if (!confirmed) {
        return;
      }
    }

    const controller = new AbortController();
    executionAbort.current = controller;

    setIsExecuting(true);
    setLastError(null);
    setRunResults([]);
    setActiveRunResultId(null);

    const startedAt = performance.now();

    let hadError = false;
    let lastErrorMessage: string | null = null;
    let lastSuccessResult: QueryResult | null = null;
    const collectedResults: SqlRunResult[] = [];

    try {
      for (let index = 0; index < statements.length; index++) {
        if (controller.signal.aborted) return;
        const statement = statements[index];
        const runStart = performance.now();

        try {
          const result = await executeQuery(selectedConnection, statement);
          if (controller.signal.aborted) return;
          const durationMs = performance.now() - runStart;
          const runResult: SqlRunResult = {
            id: `${nowIso()}-${index}-ok`,
            query: statement,
            status: "success",
            result,
            error: null,
            durationMs,
            rowCount: result.row_count,
          };
          collectedResults.push(runResult);
          setRunResults([...collectedResults]);
          setActiveRunResultId(runResult.id);

          lastSuccessResult = result;

          await appendHistory({
            connectionId: selectedConnection,
            sqlPreview: previewSql(statement),
            executedSql: statement,
            status: "success",
            rowCount: result.row_count,
            durationMs,
            createdAt: nowIso(),
            resultPreview: toHistoryResultPreview(result),
          });
        } catch (err) {
          if (controller.signal.aborted) return;
          const durationMs = performance.now() - runStart;
          const message = err instanceof Error ? err.message : "Unknown error";
          const runResult: SqlRunResult = {
            id: `${nowIso()}-${index}-err`,
            query: statement,
            status: "error",
            result: null,
            error: message,
            durationMs,
            rowCount: 0,
          };
          collectedResults.push(runResult);
          setRunResults([...collectedResults]);
          setActiveRunResultId(runResult.id);
          hadError = true;
          lastErrorMessage = message;

          await appendHistory({
            connectionId: selectedConnection,
            sqlPreview: previewSql(statement),
            executedSql: statement,
            status: "error",
            rowCount: 0,
            durationMs,
            createdAt: nowIso(),
            errorMessage: message,
          });
        }
      }

      const totalDurationMs = performance.now() - startedAt;
      setLastDurationMs(totalDurationMs);
      setLastResult(lastSuccessResult);

      if (hadError) {
        setLastError(
          statements.length > 1
            ? `One or more queries failed.${lastErrorMessage ? ` Last error: ${lastErrorMessage}` : ""}`
            : (lastErrorMessage ?? "Query failed")
        );
      } else {
        setLastError(null);
      }
    } finally {
      if (executionAbort.current === controller) {
        executionAbort.current = null;
      }
      setIsExecuting(false);
    }
  }, [appendHistory, doc.sql, executeQuery, selectedConnection]);

  // Refs to always access latest handlers from Monaco actions (avoids stale closure)
  const handleFormatSqlRef = useRef(handleFormatSql);
  handleFormatSqlRef.current = handleFormatSql;
  const handleExplainSqlRef = useRef(handleExplainSql);
  handleExplainSqlRef.current = handleExplainSql;

  const handleEditorMount = useCallback<OnMount>((mounted) => {
    editorRef.current = mounted;

    // ResizeObserver + RAF-throttled layout() replaces automaticLayout:true polling.
    // automaticLayout uses a 100ms MutationObserver that triggers relayout on every
    // DOM mutation during resize — very expensive. ResizeObserver only fires when the
    // container actually changes size, and RAF coalesces layout calls into one per frame.
    const container = mounted.getDomNode()?.parentElement;
    if (container) {
      let rafId: number | null = null;
      const observer = new ResizeObserver(() => {
        if (rafId !== null) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          rafId = null;
          mounted.layout();
        });
      });
      observer.observe(container);
      monacoResizeObserverRef.current = observer;
    }

    // Register Monaco editor actions (format, explain)
    // These use refs to avoid stale closures — the actual handler logic lives in the callbacks above.
    mounted.addAction({
      id: "sql-format",
      label: "Format SQL",
      keybindings: [
        monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF,
      ],
      run: () => {
        handleFormatSqlRef.current();
      },
    });

    mounted.addAction({
      id: "sql-explain",
      label: "EXPLAIN Query",
      keybindings: [
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyE,
      ],
      run: () => {
        void handleExplainSqlRef.current(false);
      },
    });

    // EXPLAIN ANALYZE — only available for databases that support it
    if (supportsExplainAnalyze(dbType)) {
      mounted.addAction({
        id: "sql-explain-analyze",
        label: "EXPLAIN ANALYZE Query",
        keybindings: [
          monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyE,
        ],
        run: () => {
          void handleExplainSqlRef.current(true);
        },
      });
    }
  }, [dbType]);

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
        defaultLayout={sidebarLayout.defaultLayout}
        onLayoutChanged={(layout) => {
          sidebarLayout.onLayoutChanged(layout);
          // Update parent width only after drag ends (onLayoutChanged fires post-drag)
          // using the ref populated by onResize — avoids per-pixel setState during drag.
          if (onWorkspaceSidebarResize && sidebarWidthRef.current > 0) {
            onWorkspaceSidebarResize(sidebarWidthRef.current);
          }
        }}
      >
        {showWorkspaceSidebar && (            <ResizablePanel
            id="sql-sidebar"
            defaultSize="22%"
            minSize="15%"
            maxSize="40%"
            onResize={(size) => {
              // Track width in ref only (cheap, no setState) — read on layout change
              sidebarWidthRef.current = size.inPixels;
            }}
            className="min-h-0 bg-sidebar"
          >
          <aside className="h-full min-h-0 flex flex-col bg-sidebar">
            {/* Sidebar Header */}
            <div className="px-3 pt-3 pb-1 shrink-0">
              {/* Title Row */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <FileCode2 className="size-3.5 text-muted-foreground" />
                  <span className="text-xs font-semibold tracking-tight text-foreground">Workspace</span>
                  {isExecuting ? (
                    <Loader2 className="size-3 animate-spin text-muted-foreground" />
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
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground pointer-events-none" />
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
                    <X className="size-3" />
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
                  <Star className="size-3" />
                  Saved
                </TabsTrigger>
                <TabsTrigger value="history" className="gap-1.5 text-xs">
                  <Clock className="size-3" />
                  History
                </TabsTrigger>
              </TabsList>

              {/* Saved queries */}
              <TabsContent value="saved" className="min-h-0 flex flex-col flex-1">
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
                                    <Pencil className="size-3" />
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
                                    <Trash2 className="size-3" />
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
                        <Star className="size-4 text-muted-foreground/50 mb-2" />
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
              </TabsContent>

              {/* History */}
              <TabsContent
                value="history"
                className="min-h-0 flex flex-col flex-1"
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
                            className={cn(
                              "mt-1 inline-block size-1.5 rounded-full shrink-0",
                              entry.status === "success" ? "bg-emerald-500" : "bg-destructive/60"
                            )}
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
                        <Clock className="size-4 text-muted-foreground/50 mb-2" />
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
        <ResizablePanel id="sql-editor" className="min-h-0 min-w-0">
        <ResizablePanelGroup
          orientation="horizontal"
          className="h-full min-h-0"
          defaultLayout={aiChatGroupDefaultLayout}
          onLayoutChanged={persistAiChatLayout}
          groupRef={aiChatGroupRef}
        >
          <ResizablePanel id="sql-editor-main" defaultSize={`${100 - AI_CHAT_DEFAULT_SIZE}%`} minSize="40%" className="min-h-0 min-w-0">
          <div className="h-full min-w-0 flex flex-col">
          {/* ── Editor toolbar (single row) ──────────────────── */}
          <div className="flex items-center gap-2 border-b border-border/50 px-3 py-1">
            {/* Query title */}
            <Input
              className="h-7 w-[180px] rounded-md border-0 bg-transparent px-1.5 font-medium text-sm hover:bg-muted/60 focus:bg-muted focus-visible:ring-0 transition-colors"
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
                    <Save className="size-3" />
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

            <Separator orientation="vertical" className="h-4" />

            {/* Current connection (fixed by page context) */}
            <span
              className={cn(
                "inline-block size-[7px] rounded-full shrink-0",
                selectedConnection ? "bg-emerald-500" : "bg-muted-foreground/40"
              )}
            />
            <span className="max-w-[260px] truncate text-xs text-foreground/70">
              {selectedConnectionMeta.label || "No connection selected"}
            </span>

            {/* AI Chat */}
            <div className="flex items-center gap-1 shrink-0">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => {
                        aiChatToggleSource.current = "button";
                        setIsAiChatOpen(!isAiChatOpen);
                      }}
                      className={cn("gap-1", isAiChatOpen && "bg-primary/10 text-primary")}
                    >
                      <Bot className="size-3" />
                      AI Chat
                    </Button>
                  }
                />
                <TooltipContent>Toggle AI assistant panel</TooltipContent>
              </Tooltip>
              {lastError && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => void handleFixSql()}
                        disabled={isFixingSql || !doc.sql.trim()}
                        className="gap-1 text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300"
                      >
                        {isFixingSql ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <Sparkles className="size-3" />
                        )}
                        Fix SQL
                      </Button>
                    }
                  />
                  <TooltipContent>Fix SQL with AI</TooltipContent>
                </Tooltip>
              )}
            </div>

            <Separator orientation="vertical" className="h-4" />

            {/* Run button */}
            <div className="ml-auto flex items-center gap-2 shrink-0">
              {isExecuting && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground font-mono animate-pulse">
                    Running…
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      executionAbort.current?.abort();
                    }}
                  >
                    Stop
                  </Button>
                </div>
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
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Play className="size-3.5" />
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
            defaultLayout={editorSplitLayout.defaultLayout}
            onLayoutChanged={editorSplitLayout.onLayoutChanged}
          >
            <ResizablePanel id="sql-editor-pane" defaultSize="50%" minSize="20%" maxSize="80%" className="min-h-0">
              <div
                className="h-full min-h-0"
                onDragOver={(e) => {
                  if (e.dataTransfer?.types.includes("text/sql-table-ref")) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "copy";
                  }
                }}
                onDrop={(e) => {
                  const tableRef = e.dataTransfer?.getData("text/sql-table-ref");
                  if (tableRef) {
                    e.preventDefault();
                    const sql = `SELECT *\nFROM ${tableRef}\nLIMIT 100;`;
                    const editorInstance = editorRef.current;
                    if (editorInstance) {
                      const selection = editorInstance.getSelection();
                      const range = selection ?? editorInstance.getModel()?.getFullModelRange();
                      if (range) {
                        editorInstance.executeEdits("drag-drop-table", [{
                          range,
                          text: sql,
                          forceMoveMarkers: true,
                        }]);
                        return;
                      }
                    }
                    setSql(sql);
                  }
                }}
              >
              <LazyMonacoEditor
                height="100%"
                defaultLanguage="sql"
                value={doc.sql}
                onMount={handleEditorMount}
                onChange={(value: string | undefined) => setSql(value || "")}
                theme={monacoTheme}
                options={MONACO_OPTIONS}
              />
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel id="sql-results-pane" defaultSize="50%" minSize="20%" maxSize="80%" className="min-h-0">
            <section className="h-full min-h-0 flex flex-col">
              {(runResultStats.total > 0 || lastResult || lastError) && (
                <div className="border-b px-3 py-2 shrink-0 flex items-center justify-end gap-3">
                  {runResultStats.total > 0 && (
                    <div className="text-[11px] text-muted-foreground font-mono tabular-nums">
                      {runResultStats.total} total · {runResultStats.success} ok · {runResultStats.error} err
                    </div>
                  )}
                </div>
              )}
              <div className="min-h-0 overflow-auto px-3 pb-3 pt-2">
                {runResults.length > 1 ? (
                  <Tabs
                    value={activeRunResult?.id ?? runResults[0]?.id}
                    onValueChange={setActiveRunResultId}
                    className="h-full min-h-0 flex flex-col"
                  >
                    <ScrollArea className="border-b py-1">
                      <TabsList variant="line" className="w-max">
                        {runResults.map((item, index) => (
                          <TabsTrigger
                            key={item.id}
                            value={item.id}
                            title={item.query}
                            className={cn(
                              item.status === "error" && "text-destructive"
                            )}
                          >
                            Result {index + 1}
                            <span className="ml-1 text-[10px] opacity-70">
                              · {formatDuration(item.durationMs)}
                            </span>
                          </TabsTrigger>
                        ))}
                      </TabsList>
                    </ScrollArea>
                    {runResults.map((item) => (
                      <TabsContent key={item.id} value={item.id} className="min-h-0 overflow-auto pt-3">
                        <QueryResults
                          result={item.result}
                          error={item.error}
                          durationMs={item.durationMs}
                        />
                      </TabsContent>
                    ))}
                  </Tabs>
                ) : (
                  <QueryResults
                    result={activeRunResult?.result ?? lastResult}
                    error={activeRunResult?.error ?? lastError}
                    durationMs={activeRunResult?.durationMs ?? lastDurationMs}
                  />
                )}
              </div>
            </section>
            </ResizablePanel>
          </ResizablePanelGroup>
          </div>
          </ResizablePanel>

          {/* AI Chat sidebar panel — always rendered; collapsed/expanded via imperative panelRef */}
          <ResizableHandle
            withHandle
            className={cn(
              "bg-border/50 hover:bg-border transition-colors duration-150",
              !isAiChatOpen && "pointer-events-none opacity-0",
            )}
          />
          <ResizablePanel
            id="sql-ai-chat"
            defaultSize={`${AI_CHAT_DEFAULT_SIZE}%`}
            minSize="15%"
            maxSize="40%"
            collapsible
            collapsedSize={0}
            onResize={(size, _id, prevSize) => {
              // Sync isAiChatOpen state only when crossing the collapsed/expanded threshold
              const wasCollapsed = prevSize ? prevSize.asPercentage === 0 : false;
              const isCollapsed = size.asPercentage === 0;
              if (wasCollapsed !== isCollapsed) {
                aiChatToggleSource.current = "resize";
                setIsAiChatOpen(!isCollapsed);
              }
            }}
            className="min-h-0 min-w-0"
          >
            {isAiChatOpen && (
              <AiChatPanel
                connectionId={selectedConnection}
                dbType={dbType}
                schemaContext={schemaContext}
                isOpen={isAiChatOpen}
                onInsertSql={handleInsertSqlFromAi}
                onClose={() => {
                  aiChatToggleSource.current = "button";
                  setIsAiChatOpen(false);
                }}
              />
            )}
          </ResizablePanel>
        </ResizablePanelGroup>
        </ResizablePanel>
      </ResizablePanelGroup>
    </section>
  );
}
