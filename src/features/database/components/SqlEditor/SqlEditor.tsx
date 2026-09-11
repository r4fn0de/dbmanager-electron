import { useQueryClient } from "@tanstack/react-query";
import * as monaco from "monaco-editor";
import { initVimMode } from "monaco-vim";
import { AnimatePresence, motion } from "motion/react";
import type { Size } from "motion-panels/react";
import { useTheme } from "next-themes";
import type { DragEvent, KeyboardEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon as UiIcon } from "@/components/ui/Icon";
import { Input } from "@/components/ui/input";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import {
  Panel,
  PanelGroup,
  PanelSeparator,
} from "@/components/ui/motion-panels";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { fixSql, updateSql } from "@/features/ai/hooks/ai-actions";
import {
  buildExplainSql,
  disposeSqlCompletion,
  formatSql,
  registerSqlCompletion,
  supportsExplainAnalyze,
  updateSchemaData,
} from "@/lib/monaco-sql-setup";
import { useAiChatGlobalStore } from "@/lib/stores/ai-chat-global";
import { useEditorPreferencesStore } from "@/lib/stores/editor-preferences";
import { useSafeModeStore } from "@/lib/stores/safe-mode";
import type { SafeModeLevel } from "@/lib/stores/safe-mode-types";
import {
  SAFE_MODE_DESCRIPTIONS,
  SAFE_MODE_LABELS,
} from "@/lib/stores/safe-mode-types";
import {
  percentageToPixels,
  usePersistedPanelSize,
} from "@/lib/use-persisted-panel-size";
import { cn, formatDuration } from "@/lib/utils";
import {
  type SqlHistoryEntry,
  type SqlSavedQuery,
  useSqlWorkspace,
} from "../../hooks/useSqlWorkspace";
import { LazyMonacoEditor, type OnMount } from "../LazyMonacoEditor";
import { QueryResults } from "../QueryResults";
import "@/lib/monaco-loader";
import { cancelQuery } from "@/features/database/hooks/db-actions";
import type { QueryResult } from "@/ipc/db/types";
import type {
  SqlDocument,
  SqlEditorProps,
  SqlRunResult,
  SqlTab,
} from "./types";
import {
  buildItemsTree,
  buildSmartSqlFromColumnRefs,
  filterItemsTree,
  getStatementRangeAtOffset,
  makeQualifiedColumnRef,
  makeTableSelectSql,
  mergeDroppedColumnsIntoStatement,
  normalizeColumnRefs,
} from "./utils/itemsUtils";
import {
  hasDangerousSqlKeywords,
  nowIso,
  previewSql,
  splitSqlStatements,
  toHistoryResultPreview,
  truncateForContext,
} from "./utils/sqlUtils";

const DEFAULT_SQL = "";

type MonacoEditor = Parameters<OnMount>[0];

const MONACO_OPTIONS = {
  automaticLayout: false, // We use ResizeObserver + debounced layout() instead of 100ms polling
  fontSize: 14,
  lineNumbers: "on",
  minimap: { enabled: false },
  padding: { top: 12 },
  roundedSelection: false,
  scrollBeyondLastLine: false,
  tabSize: 2,
} as const;

const INITIAL_TAB_ID = "initial-tab";

function getQueryErrorMessage(err: unknown): string {
  const rawMessage =
    err instanceof Error ? err.message : typeof err === "string" ? err : "";

  const message = rawMessage.trim();
  if (!message) {
    return "Query failed. Please check your SQL and connection.";
  }

  const lower = message.toLowerCase();
  if (lower === "internal server error") {
    return "Query failed on the server. Please check your SQL syntax, permissions, and connection status.";
  }

  return message;
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
  isRouteActive = true,
  insertRequest = null,
}: SqlEditorProps) {
  const {
    savedQueries,
    history,
    saveQuery,
    deleteQuery,
    renameQuery,
    appendHistory,
  } = useSqlWorkspace(selectedConnection);

  const [tabs, setTabs] = useState<SqlTab[]>([
    {
      doc: {
        id: null,
        sql: DEFAULT_SQL,
        title: "Untitled",
        updatedAt: nowIso(),
      },
      id: INITIAL_TAB_ID,
      lastSavedSql: DEFAULT_SQL,
    },
  ]);
  const [activeTabId, setActiveTabId] = useState(INITIAL_TAB_ID);

  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;
  const tabCounterRef = useRef(1);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];
  const doc = activeTab?.doc ?? {
    id: null,
    sql: "",
    title: "Untitled",
    updatedAt: nowIso(),
  };

  const updateTab = useCallback(
    (tabId: string, updater: (tab: SqlTab) => SqlTab) => {
      setTabs((prev) => prev.map((t) => (t.id === tabId ? updater(t) : t)));
    },
    []
  );

  const addTab = useCallback((docOverrides?: Partial<SqlDocument>) => {
    const id = crypto.randomUUID();
    tabCounterRef.current += 1;
    const title = docOverrides?.title ?? `Untitled ${tabCounterRef.current}`;
    const sql = docOverrides?.sql ?? DEFAULT_SQL;
    const newTab: SqlTab = {
      doc: {
        id: docOverrides?.id ?? null,
        sql,
        title,
        updatedAt: docOverrides?.updatedAt ?? nowIso(),
      },
      id,
      lastSavedSql: sql,
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(id);
  }, []);

  const closeTab = useCallback((tabId: string) => {
    const current = tabsRef.current;
    if (current.length <= 1) {
      return;
    }
    const idx = current.findIndex((t) => t.id === tabId);
    const next = current.filter((t) => t.id !== tabId);
    setTabs(next);
    if (tabId === activeTabIdRef.current) {
      const newIdx = Math.min(idx, next.length - 1);
      setActiveTabId(next[newIdx].id);
    }
  }, []);

  const [activeSidebarTab, setActiveSidebarTab] = useState<
    "saved" | "history" | "items"
  >("saved");
  const [searchText, setSearchText] = useState("");
  const [expandedSchemas, setExpandedSchemas] = useState<
    Record<string, boolean>
  >({});
  const [expandedTables, setExpandedTables] = useState<Record<string, boolean>>(
    {}
  );
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [lastSelectedColumn, setLastSelectedColumn] = useState<string | null>(
    null
  );

  // Panel sizes persist per connection. motion-panels reports a new size once a
  // drag or key press lands, so there is nothing to debounce.
  const [sidebarSize, setSidebarSize] = usePersistedPanelSize(
    `sql-sidebar-${selectedConnection ?? "default"}`,
    "22%",
    "sql-sidebar"
  );
  const [resultsSize, setResultsSize] = usePersistedPanelSize(
    `sql-editor-split-${selectedConnection ?? "default"}`,
    "50%",
    "sql-results-pane"
  );

  const [isExecuting, setIsExecuting] = useState(false);
  const [lastResult, setLastResult] = useState<QueryResult | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastDurationMs, setLastDurationMs] = useState<number | undefined>();
  const [runResults, setRunResults] = useState<SqlRunResult[]>([]);
  const [activeRunResultId, setActiveRunResultId] = useState<string | null>(
    null
  );

  const { resolvedTheme } = useTheme();
  const monacoTheme = resolvedTheme === "dark" ? "vs-dark" : "vs";

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const inlineAiInputRef = useRef<HTMLInputElement | null>(null);
  const editorRef = useRef<MonacoEditor | null>(null);
  const executionAbort = useRef<AbortController | null>(null);
  const activeRequestIdRef = useRef<string | null>(null);
  const monacoResizeObserverRef = useRef<ResizeObserver | null>(null);
  const monacoSelectionListenerRef = useRef<monaco.IDisposable | null>(null);
  const monacoContentListenerRef = useRef<monaco.IDisposable | null>(null);
  const vimModeRef = useRef<{ dispose: () => void } | null>(null);
  const inlineStreamRequestIdRef = useRef<string | null>(null);
  const inlineStreamTextRef = useRef("");
  const inlinePreviousSqlRef = useRef("");
  const inlineStreamTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const inlineStartFallbackTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  // Measured to turn the sidebar's percentage size into the pixel width the
  // connection tab chrome aligns to.
  const workspaceRef = useRef<HTMLElement>(null);

  const handleSidebarResize = useCallback(
    (next: Size) => {
      setSidebarSize(next);
      const width = workspaceRef.current?.clientWidth ?? 0;
      if (onWorkspaceSidebarResize && width > 0) {
        onWorkspaceSidebarResize(percentageToPixels(next, width));
      }
    },
    [onWorkspaceSidebarResize, setSidebarSize]
  );

  // AI panel state
  const [isFixingSql, setIsFixingSql] = useState(false);
  const [isInlineAiPromptOpen, setIsInlineAiPromptOpen] = useState(false);
  const [inlineAiPrompt, setInlineAiPrompt] = useState("");
  const [isGeneratingInlineAi, setIsGeneratingInlineAi] = useState(false);
  const [selectedSqlForAi, setSelectedSqlForAi] = useState("");
  // EXPLAIN state (driven by keyboard shortcuts only, no toolbar button)
  const [_isExplaining, setIsExplaining] = useState(false);
  const explainQueryClient = useQueryClient();

  const setSqlContext = useAiChatGlobalStore((state) => state.setSqlContext);
  const clearSqlContext = useAiChatGlobalStore(
    (state) => state.clearSqlContext
  );
  const vimMode = useEditorPreferencesStore((state) => state.vimMode);
  const safeModeLevel = useSafeModeStore((state) =>
    state.getLevel(selectedConnection ?? "")
  );
  const isReadOnlySafeMode = safeModeLevel === "readonly";
  const sqlContextSourceIdRef = useRef<string>(
    `sql-editor-${selectedConnection ?? "none"}-${Math.random().toString(36).slice(2)}`
  );

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
      label: found
        ? found.name?.trim() || found.database?.trim() || "Unnamed connection"
        : "",
      name: found?.name ?? "No connection",
    };
  }, [connections, selectedConnection]);

  const aiChatContext = useMemo(() => {
    const blocks: string[] = [];

    if (schemaContext?.trim()) {
      blocks.push(`## Database Schema Context\n${schemaContext.trim()}`);
    }

    blocks.push(
      `## Editor Context\n- Connection: ${selectedConnectionMeta.label || "none"}\n- Database type: ${dbType}`
    );

    if (selectedSqlForAi.trim()) {
      blocks.push(
        `## Selected SQL in Editor (Priority)\n${truncateForContext(selectedSqlForAi.trim(), 5000)}`
      );
    }

    if (doc.sql.trim()) {
      blocks.push(
        `## Current SQL in Editor\n${truncateForContext(doc.sql.trim(), 12_000)}`
      );
    }

    if (lastError?.trim()) {
      blocks.push(
        `## Last SQL Error\n${truncateForContext(lastError.trim(), 2500)}`
      );
    }

    return blocks.join("\n\n");
  }, [
    schemaContext,
    selectedConnectionMeta.label,
    dbType,
    selectedSqlForAi,
    doc.sql,
    lastError,
  ]);

  const aiChatContextPreview = useMemo(() => {
    const selection = selectedSqlForAi.trim();
    const error = lastError?.trim() ?? "";
    return {
      connectionLabel: selectedConnectionMeta.label || "No connection",
      dbType,
      errorPreview: error ? truncateForContext(error, 120) : "",
      selectionPreview: selection ? truncateForContext(selection, 160) : "",
    };
  }, [selectedSqlForAi, lastError, selectedConnectionMeta.label, dbType]);

  useEffect(() => {
    if (!isRouteActive) {
      return;
    }

    setSqlContext(sqlContextSourceIdRef.current, {
      connectionId: selectedConnection,
      connectionLabel: selectedConnectionMeta.label || "No connection",
      contextPreview: aiChatContextPreview,
      dbType,
      schemaContext: aiChatContext,
    });

    return () => {
      clearSqlContext(sqlContextSourceIdRef.current);
    };
  }, [
    aiChatContext,
    aiChatContextPreview,
    clearSqlContext,
    dbType,
    isRouteActive,
    selectedConnection,
    selectedConnectionMeta.label,
    setSqlContext,
  ]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run only when the load request key changes.
  useEffect(() => {
    if (!loadRequest) {
      return;
    }
    const sql = loadRequest.sql;
    updateTab(activeTabIdRef.current, () => ({
      doc: {
        id: null,
        sql,
        title: loadRequest.title || "Untitled",
        updatedAt: nowIso(),
      },
      id: activeTabIdRef.current,
      lastSavedSql: sql,
    }));
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
      if (inlineStreamTimeoutRef.current) {
        clearTimeout(inlineStreamTimeoutRef.current);
        inlineStreamTimeoutRef.current = null;
      }
      if (inlineStartFallbackTimeoutRef.current) {
        clearTimeout(inlineStartFallbackTimeoutRef.current);
        inlineStartFallbackTimeoutRef.current = null;
      }
      if (inlineStreamRequestIdRef.current) {
        window.electron?.aiInline?.abort(inlineStreamRequestIdRef.current);
      }
      monacoResizeObserverRef.current?.disconnect();
      monacoResizeObserverRef.current = null;
      monacoSelectionListenerRef.current?.dispose();
      monacoSelectionListenerRef.current = null;
      monacoContentListenerRef.current?.dispose();
      monacoContentListenerRef.current = null;
    };
  }, []);

  const filteredSaved = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) {
      return savedQueries;
    }

    return savedQueries.filter(
      (entry) =>
        entry.title.toLowerCase().includes(q) ||
        entry.sql.toLowerCase().includes(q)
    );
  }, [savedQueries, searchText]);

  const filteredHistory = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) {
      return history;
    }

    return history.filter(
      (entry) =>
        entry.sqlPreview.toLowerCase().includes(q) ||
        (entry.errorMessage ?? "").toLowerCase().includes(q)
    );
  }, [history, searchText]);

  const itemsTree = useMemo(
    () => buildItemsTree(schemaCompletionData),
    [schemaCompletionData]
  );

  const filteredItemsTree = useMemo(
    () => filterItemsTree(itemsTree, searchText),
    [itemsTree, searchText]
  );

  useEffect(() => {
    if (!searchText.trim()) {
      return;
    }
    const nextSchemas: Record<string, boolean> = {};
    const nextTables: Record<string, boolean> = {};
    for (const schema of filteredItemsTree) {
      nextSchemas[schema.name] = true;
      for (const table of schema.tables) {
        nextTables[`${schema.name}.${table.name}`] = true;
      }
    }
    setExpandedSchemas((prev) => ({ ...prev, ...nextSchemas }));
    setExpandedTables((prev) => ({ ...prev, ...nextTables }));
  }, [filteredItemsTree, searchText]);

  const activeRunResult = useMemo(() => {
    if (runResults.length === 0) {
      return null;
    }
    if (!activeRunResultId) {
      return runResults[0];
    }
    return (
      runResults.find((item) => item.id === activeRunResultId) ?? runResults[0]
    );
  }, [activeRunResultId, runResults]);
  const runResultStats = useMemo(() => {
    const total = runResults.length;
    const success = runResults.filter(
      (item) => item.status === "success"
    ).length;
    return {
      error: total - success,
      success,
      total,
    };
  }, [runResults]);

  const isEditorEmpty = useMemo(() => doc.sql.trim().length === 0, [doc.sql]);

  const setSql = useCallback(
    (sql: string) => {
      updateTab(activeTabIdRef.current, (tab) => {
        if (tab.doc.sql === sql) {
          return tab;
        }
        return { ...tab, doc: { ...tab.doc, sql, updatedAt: nowIso() } };
      });
    },
    [updateTab]
  );

  const insertIntoEditor = useCallback(
    (text: string) => {
      const editorInstance = editorRef.current;
      if (editorInstance) {
        const selection = editorInstance.getSelection();
        const range =
          selection ?? editorInstance.getModel()?.getFullModelRange();
        if (range) {
          editorInstance.executeEdits("sidebar-items-insert", [
            {
              forceMoveMarkers: true,
              range,
              text,
            },
          ]);
          editorInstance.focus();
          return;
        }
      }
      setSql(text);
    },
    [setSql]
  );

  // External insert requests should merge into current editor selection/cursor
  // and preserve undo/redo via executeEdits.
  // biome-ignore lint/correctness/useExhaustiveDependencies: consume one-shot inserts by key only.
  useEffect(() => {
    if (!insertRequest?.text) {
      return;
    }
    insertIntoEditor(insertRequest.text);
  }, [insertRequest?.key]);

  const replaceStatementAtCursor = useCallback(
    (nextStatementSql: string): boolean => {
      const editorInstance = editorRef.current;
      const model = editorInstance?.getModel();
      const position = editorInstance?.getPosition();
      if (!(editorInstance && model && position)) {
        return false;
      }

      const offset = model.getOffsetAt(position);
      const statement = getStatementRangeAtOffset(model.getValue(), offset);
      if (!statement) {
        return false;
      }

      const startPos = model.getPositionAt(statement.start);
      const endPos = model.getPositionAt(statement.end);
      editorInstance.executeEdits("sidebar-items-merge-statement", [
        {
          forceMoveMarkers: true,
          range: new monaco.Range(
            startPos.lineNumber,
            startPos.column,
            endPos.lineNumber,
            endPos.column
          ),
          text: nextStatementSql,
        },
      ]);
      editorInstance.focus();
      return true;
    },
    []
  );

  const insertSqlBelowStatementAtCursor = useCallback(
    (nextSql: string): boolean => {
      const editorInstance = editorRef.current;
      const model = editorInstance?.getModel();
      const position = editorInstance?.getPosition();
      if (!(editorInstance && model && position)) {
        return false;
      }

      const source = model.getValue();
      const offset = model.getOffsetAt(position);
      const statement = getStatementRangeAtOffset(source, offset);
      if (!statement) {
        return false;
      }
      let insertOffset = statement.end;
      if (source[insertOffset] === ";") {
        insertOffset += 1;
      }
      const insertPos = model.getPositionAt(insertOffset);
      const text = `\n\n${nextSql}`;
      editorInstance.executeEdits("sidebar-items-insert-below", [
        {
          forceMoveMarkers: true,
          range: new monaco.Range(
            insertPos.lineNumber,
            insertPos.column,
            insertPos.lineNumber,
            insertPos.column
          ),
          text,
        },
      ]);
      editorInstance.focus();
      return true;
    },
    []
  );

  const toggleSchemaExpanded = useCallback((schema: string) => {
    setExpandedSchemas((prev) => ({ ...prev, [schema]: !prev[schema] }));
  }, []);

  const toggleTableExpanded = useCallback((tableKey: string) => {
    setExpandedTables((prev) => ({ ...prev, [tableKey]: !prev[tableKey] }));
  }, []);

  const handleInsertTableFromItems = useCallback(
    (schema: string, table: string) => {
      insertIntoEditor(makeTableSelectSql(schema, table));
    },
    [insertIntoEditor]
  );

  const toggleColumnSelection = useCallback((qualifiedColumn: string) => {
    setSelectedColumns((prev) => {
      if (prev.includes(qualifiedColumn)) {
        return prev.filter((col) => col !== qualifiedColumn);
      }
      return [...prev, qualifiedColumn];
    });
    setLastSelectedColumn(qualifiedColumn);
  }, []);

  const setMultiItemDragPreview = useCallback(
    (event: DragEvent<HTMLElement>, items: string[]) => {
      if (items.length <= 1) {
        return;
      }
      const preview = document.createElement("div");
      preview.style.position = "fixed";
      preview.style.top = "-9999px";
      preview.style.left = "-9999px";
      preview.style.pointerEvents = "none";
      preview.style.padding = "8px 10px";
      preview.style.borderRadius = "8px";
      preview.style.background = "rgba(24,24,27,0.92)";
      preview.style.border = "1px solid rgba(255,255,255,0.12)";
      preview.style.color = "#f4f4f5";
      preview.style.fontFamily =
        "ui-monospace, SFMono-Regular, Menlo, monospace";
      preview.style.fontSize = "12px";
      preview.style.lineHeight = "1.2";
      preview.style.maxWidth = "340px";
      preview.style.boxShadow = "0 6px 24px rgba(0,0,0,0.35)";

      const first = items[0] ?? "";
      const restCount = items.length - 1;
      preview.textContent =
        restCount > 0 ? `${first} + ${restCount} itens` : first;

      document.body.append(preview);
      event.dataTransfer.setDragImage(preview, 12, 12);
      requestAnimationFrame(() => preview.remove());
    },
    []
  );

  const selectRangeInTable = useCallback(
    (
      schema: string,
      table: string,
      columns: { name: string; dataType: string }[],
      anchorQualified: string,
      targetQualified: string
    ) => {
      const tableKey = `${schema}.${table}.`;
      if (
        !(
          anchorQualified.startsWith(tableKey) &&
          targetQualified.startsWith(tableKey)
        )
      ) {
        setSelectedColumns([targetQualified]);
        setLastSelectedColumn(targetQualified);
        return;
      }

      const names = columns.map((column) => column.name);
      const anchorName = anchorQualified.slice(tableKey.length);
      const targetName = targetQualified.slice(tableKey.length);
      const anchorIndex = names.indexOf(anchorName);
      const targetIndex = names.indexOf(targetName);
      if (anchorIndex < 0 || targetIndex < 0) {
        setSelectedColumns([targetQualified]);
        setLastSelectedColumn(targetQualified);
        return;
      }

      const [start, end] =
        anchorIndex < targetIndex
          ? [anchorIndex, targetIndex]
          : [targetIndex, anchorIndex];
      const rangeSelection = names
        .slice(start, end + 1)
        .map((name) => makeQualifiedColumnRef(schema, table, name));
      setSelectedColumns(rangeSelection);
      setLastSelectedColumn(targetQualified);
    },
    []
  );

  const clearInlineStreamTimeout = useCallback(() => {
    if (inlineStreamTimeoutRef.current) {
      clearTimeout(inlineStreamTimeoutRef.current);
      inlineStreamTimeoutRef.current = null;
    }
  }, []);

  const clearInlineStartFallbackTimeout = useCallback(() => {
    if (inlineStartFallbackTimeoutRef.current) {
      clearTimeout(inlineStartFallbackTimeoutRef.current);
      inlineStartFallbackTimeoutRef.current = null;
    }
  }, []);

  const fallbackInlineGenerateSql = useCallback(
    async (requestId: string, prompt: string, sqlSeed: string) => {
      try {
        const result = await updateSql(sqlSeed, prompt, dbType, schemaContext);
        if (requestId !== inlineStreamRequestIdRef.current) {
          return;
        }

        clearInlineStreamTimeout();
        clearInlineStartFallbackTimeout();
        inlineStreamTextRef.current = result.sql;
        setSql(result.sql);
        inlineStreamRequestIdRef.current = null;
        setIsGeneratingInlineAi(false);
        setIsInlineAiPromptOpen(false);
        setInlineAiPrompt("");
        toast.success("SQL generated with AI");
      } catch (err) {
        if (requestId !== inlineStreamRequestIdRef.current) {
          return;
        }
        clearInlineStreamTimeout();
        clearInlineStartFallbackTimeout();
        inlineStreamRequestIdRef.current = null;
        setIsGeneratingInlineAi(false);
        setSql(inlinePreviousSqlRef.current);
        toast.error(
          err instanceof Error ? err.message : "Failed to generate SQL with AI"
        );
      }
    },
    [
      clearInlineStartFallbackTimeout,
      clearInlineStreamTimeout,
      dbType,
      schemaContext,
      setSql,
    ]
  );

  const scheduleInlineStartFallback = useCallback(
    (requestId: string, prompt: string, sqlSeed: string) => {
      clearInlineStartFallbackTimeout();
      inlineStartFallbackTimeoutRef.current = setTimeout(() => {
        if (requestId !== inlineStreamRequestIdRef.current) {
          return;
        }
        if (inlineStreamTextRef.current.trim().length > 0) {
          return;
        }
        window.electron?.aiInline?.abort(requestId);
        void fallbackInlineGenerateSql(requestId, prompt, sqlSeed);
      }, 4000);
    },
    [clearInlineStartFallbackTimeout, fallbackInlineGenerateSql]
  );

  const scheduleInlineStreamTimeout = useCallback(() => {
    clearInlineStreamTimeout();
    inlineStreamTimeoutRef.current = setTimeout(() => {
      const requestId = inlineStreamRequestIdRef.current;
      if (!requestId) {
        return;
      }
      window.electron?.aiInline?.abort(requestId);
      const hasPartial = inlineStreamTextRef.current.trim().length > 0;
      if (!hasPartial) {
        setSql(inlinePreviousSqlRef.current);
      }
      clearInlineStartFallbackTimeout();
      inlineStreamRequestIdRef.current = null;
      setIsGeneratingInlineAi(false);
      toast.error(
        "AI generation timed out. Try a shorter prompt or check provider settings."
      );
    }, 30_000);
  }, [clearInlineStartFallbackTimeout, clearInlineStreamTimeout, setSql]);

  // AI: inline SQL generation from natural language prompt (streaming)
  const handleGenerateSqlInline = useCallback(async () => {
    const prompt = inlineAiPrompt.trim();
    if (!prompt) {
      return;
    }
    const aiInline = window.electron?.aiInline;
    if (!aiInline) {
      toast.error("AI inline generation is not available");
      return;
    }
    if (isGeneratingInlineAi) {
      return;
    }

    setIsGeneratingInlineAi(true);
    const requestId = `inline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const sqlSeed = doc.sql.trim() === DEFAULT_SQL.trim() ? "" : doc.sql;
    inlineStreamRequestIdRef.current = requestId;
    inlineStreamTextRef.current = "";
    inlinePreviousSqlRef.current = doc.sql;
    setSql("");
    scheduleInlineStreamTimeout();
    scheduleInlineStartFallback(requestId, prompt, sqlSeed);
    aiInline.start({
      dbType,
      prompt,
      requestId,
      schemaContext,
      sql: sqlSeed,
    });
  }, [
    inlineAiPrompt,
    isGeneratingInlineAi,
    doc.sql,
    dbType,
    schemaContext,
    setSql,
    scheduleInlineStartFallback,
    scheduleInlineStreamTimeout,
  ]);

  useEffect(() => {
    if (!isInlineAiPromptOpen) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      inlineAiInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [isInlineAiPromptOpen]);

  useEffect(() => {
    const aiInline = window.electron?.aiInline;
    if (!aiInline) {
      return;
    }

    const unsubChunk = aiInline.onChunk((chunk: AiInlineChunk) => {
      if (chunk.requestId !== inlineStreamRequestIdRef.current) {
        return;
      }
      clearInlineStartFallbackTimeout();
      scheduleInlineStreamTimeout();
      inlineStreamTextRef.current += chunk.text;
      setSql(inlineStreamTextRef.current);
    });

    const unsubDone = aiInline.onDone(({ requestId }) => {
      if (requestId !== inlineStreamRequestIdRef.current) {
        return;
      }
      clearInlineStartFallbackTimeout();
      clearInlineStreamTimeout();
      inlineStreamRequestIdRef.current = null;
      setIsGeneratingInlineAi(false);
      setIsInlineAiPromptOpen(false);
      setInlineAiPrompt("");
      toast.success("SQL generated with AI");
    });

    const unsubError = aiInline.onError(({ requestId, message }) => {
      if (requestId !== inlineStreamRequestIdRef.current) {
        return;
      }
      clearInlineStartFallbackTimeout();
      clearInlineStreamTimeout();
      const hasPartial = inlineStreamTextRef.current.trim().length > 0;
      if (!hasPartial) {
        setSql(inlinePreviousSqlRef.current);
      }
      inlineStreamRequestIdRef.current = null;
      setIsGeneratingInlineAi(false);
      toast.error(message || "Failed to generate SQL with AI");
    });

    return () => {
      unsubChunk();
      unsubDone();
      unsubError();
    };
  }, [
    clearInlineStartFallbackTimeout,
    clearInlineStreamTimeout,
    scheduleInlineStreamTimeout,
    setSql,
  ]);

  // ── Format SQL (Prettify) — driven by keyboard shortcut only (⌘⇧F), no toolbar button ──
  const handleFormatSql = useCallback(() => {
    const editorInstance = editorRef.current;
    if (!editorInstance) {
      return;
    }
    const sql = editorInstance.getValue();
    if (!sql.trim()) {
      return;
    }
    const formatted = formatSql(sql, dbType);
    if (formatted === sql) {
      return;
    }
    // Use executeEdits to preserve undo history (unlike setValue/setSql which reset it)
    const model = editorInstance.getModel();
    if (model) {
      editorInstance.executeEdits("sql-format", [
        {
          range: model.getFullModelRange(),
          text: formatted,
        },
      ]);
      toast.success("SQL formatted");
    }
  }, [dbType]);

  // ── EXPLAIN Query (cached via queryClient.fetchQuery) ────────────
  // Repeated Ctrl+E on the same query returns cached result within 5min staleTime,
  // avoiding redundant round-trips to the database.
  const handleExplainSql = useCallback(
    async (analyze = false) => {
      if (!(selectedConnection && doc.sql.trim())) {
        return;
      }
      if (isExecuting) {
        return;
      }

      const editorInstance = editorRef.current;
      const selection = editorInstance?.getSelection();
      const model = editorInstance?.getModel();
      const selectedText =
        selection && model ? model.getValueInRange(selection).trim() : "";
      const sqlToExplain = selectedText.length > 0 ? selectedText : doc.sql;
      if (!sqlToExplain.trim()) {
        return;
      }

      // EXPLAIN ANALYZE actually executes the query — warn for destructive SQL
      if (analyze && hasDangerousSqlKeywords(sqlToExplain)) {
        const confirmed = window.confirm(
          "EXPLAIN ANALYZE will actually execute this query, which contains potentially destructive operations (DELETE/UPDATE/DROP/etc). Continue?"
        );
        if (!confirmed) {
          return;
        }
      }

      const explainSql = buildExplainSql(sqlToExplain, dbType, analyze);
      setIsExplaining(true);
      try {
        // Use fetchQuery to leverage cache — same EXPLAIN SQL within 5min = instant
        const result = await explainQueryClient.fetchQuery({
          queryFn: () => executeQuery(selectedConnection, explainSql),
          queryKey: ["explain", selectedConnection, explainSql],
          staleTime: 5 * 60_000,
        });
        const resultId = `explain-${nowIso()}`;
        setRunResults([
          {
            durationMs: 0,
            error: null,
            id: resultId,
            query: explainSql,
            result,
            rowCount: result.row_count,
            status: "success",
          },
        ]);
        setActiveRunResultId(resultId);
        setLastResult(result);
        setLastError(null);
      } catch (err) {
        const message = getQueryErrorMessage(err);
        const resultId = `explain-${nowIso()}`;
        setRunResults([
          {
            durationMs: 0,
            error: message,
            id: resultId,
            query: explainSql,
            result: null,
            rowCount: 0,
            status: "error",
          },
        ]);
        setActiveRunResultId(resultId);
        setLastError(message);
        setLastResult(null);
      } finally {
        setIsExplaining(false);
      }
    },
    [
      selectedConnection,
      doc.sql,
      dbType,
      isExecuting,
      executeQuery,
      explainQueryClient,
    ]
  );

  // AI: Fix SQL — send current SQL + last error to AI for correction
  const handleFixSql = useCallback(
    async (sqlOverride?: string, errorOverride?: string) => {
      if (!selectedConnection) {
        return;
      }
      const sqlToFix = (sqlOverride ?? doc.sql).trim();
      const errorToFix = (errorOverride ?? lastError ?? "").trim();
      if (!(sqlToFix && errorToFix)) {
        return;
      }
      setIsFixingSql(true);
      try {
        const result = await fixSql(sqlToFix, errorToFix, dbType);
        if (result.sql?.trim()) {
          setSql(result.sql);
          toast.success("SQL fixed by AI");
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to fix SQL");
      } finally {
        setIsFixingSql(false);
      }
    },
    [selectedConnection, doc.sql, lastError, dbType, setSql]
  );

  const setTitle = useCallback(
    (title: string) => {
      updateTab(activeTabIdRef.current, (tab) => ({
        ...tab,
        doc: { ...tab.doc, title, updatedAt: nowIso() },
      }));
    },
    [updateTab]
  );

  const hydrateFromSaved = useCallback(
    (query: SqlSavedQuery) => {
      const tabId = activeTabIdRef.current;
      updateTab(tabId, () => ({
        doc: {
          id: query.id,
          sql: query.sql,
          title: query.title,
          updatedAt: query.updatedAt,
        },
        id: tabId,
        lastSavedSql: query.sql,
      }));
      if (query.connectionId !== selectedConnection) {
        onSelectConnection(query.connectionId);
      }
    },
    [onSelectConnection, selectedConnection, updateTab]
  );

  const hydrateFromHistory = useCallback(
    (entry: SqlHistoryEntry) => {
      const tabId = activeTabIdRef.current;
      updateTab(tabId, () => ({
        doc: {
          id: null,
          sql: entry.executedSql,
          title: "Untitled",
          updatedAt: nowIso(),
        },
        id: tabId,
        lastSavedSql: entry.executedSql,
      }));

      setLastDurationMs(entry.durationMs);
      if (entry.status === "success") {
        const resultId = `history-${entry.id}`;
        const previewResult: QueryResult = entry.resultPreview ?? {
          columns: [],
          row_count: entry.rowCount,
          rows: [],
        };
        setRunResults([
          {
            durationMs: entry.durationMs,
            error: null,
            id: resultId,
            query: entry.executedSql,
            result: previewResult,
            rowCount: entry.rowCount,
            status: "success",
          },
        ]);
        setActiveRunResultId(resultId);
        setLastError(null);
        setLastResult(previewResult);
      } else {
        const resultId = `history-${entry.id}`;
        const errorMessage = entry.errorMessage ?? "Query failed";
        setRunResults([
          {
            durationMs: entry.durationMs,
            error: errorMessage,
            id: resultId,
            query: entry.executedSql,
            result: null,
            rowCount: 0,
            status: "error",
          },
        ]);
        setActiveRunResultId(resultId);
        setLastResult(null);
        setLastError(errorMessage);
      }

      if (entry.connectionId !== selectedConnection) {
        onSelectConnection(entry.connectionId);
      }
    },
    [onSelectConnection, selectedConnection]
  );

  const saveCurrentQuery = useCallback(async () => {
    if (!selectedConnection) {
      return;
    }
    const currentDoc = (
      tabsRef.current.find((t) => t.id === activeTabIdRef.current) ??
      tabsRef.current[0]
    )?.doc;
    if (!currentDoc) {
      return;
    }

    const persisted = await saveQuery({
      connectionId: selectedConnection,
      id: currentDoc.id ?? undefined,
      sql: currentDoc.sql,
      title: currentDoc.title.trim() || "Untitled",
    });

    if (persisted) {
      updateTab(activeTabIdRef.current, (tab) => ({
        ...tab,
        doc: {
          ...tab.doc,
          id: persisted.id,
          title: persisted.title,
          updatedAt: persisted.updatedAt,
        },
        lastSavedSql: tab.doc.sql,
      }));
    }
  }, [saveQuery, selectedConnection, updateTab]);

  const runSql = useCallback(async () => {
    if (!(selectedConnection && doc.sql.trim())) {
      return;
    }
    if (executionAbort.current) {
      return; // already running
    }

    const editorInstance = editorRef.current;
    const selection = editorInstance?.getSelection();
    const model = editorInstance?.getModel();

    const selectedText =
      selection && model ? model.getValueInRange(selection).trim() : "";

    const sqlToRun = selectedText.length > 0 ? selectedText : doc.sql;
    if (!sqlToRun.trim()) {
      return;
    }

    const statements = splitSqlStatements(sqlToRun);
    if (statements.length === 0) {
      return;
    }

    const hasDangerous = statements.some((statement) =>
      hasDangerousSqlKeywords(statement)
    );

    // Safe mode: block destructive queries in read-only mode
    if (isReadOnlySafeMode && hasDangerous) {
      toast.error(
        "Read-only mode is active. Destructive queries (DELETE, UPDATE, DROP, TRUNCATE, ALTER) are blocked.",
        {
          duration: 5000,
        }
      );
      return;
    }

    // Safe mode: show confirmation in alert mode (default)
    if (hasDangerous && safeModeLevel !== "silent") {
      const confirmed = window.confirm(
        "This SQL contains potentially destructive operations (DELETE/UPDATE/DROP/etc). Do you want to continue?"
      );
      if (!confirmed) {
        return;
      }
    }

    const controller = new AbortController();
    executionAbort.current = controller;

    // Generate a requestId for server-side cancellation support
    const currentRequestId = `sql-run-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    activeRequestIdRef.current = currentRequestId;

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
        if (controller.signal.aborted) {
          return;
        }
        const statement = statements[index];
        const runStart = performance.now();

        try {
          const result = await executeQuery(
            selectedConnection,
            statement,
            currentRequestId
          );
          if (controller.signal.aborted) {
            return;
          }
          const durationMs = performance.now() - runStart;
          const runResult: SqlRunResult = {
            durationMs,
            error: null,
            id: `${nowIso()}-${index}-ok`,
            query: statement,
            result,
            rowCount: result.row_count,
            status: "success",
          };
          collectedResults.push(runResult);
          setRunResults([...collectedResults]);
          setActiveRunResultId(runResult.id);

          lastSuccessResult = result;

          await appendHistory({
            connectionId: selectedConnection,
            createdAt: nowIso(),
            durationMs,
            executedSql: statement,
            resultPreview: toHistoryResultPreview(result),
            rowCount: result.row_count,
            sqlPreview: previewSql(statement),
            status: "success",
          });
        } catch (err) {
          if (controller.signal.aborted) {
            return;
          }
          const durationMs = performance.now() - runStart;
          const message = getQueryErrorMessage(err);
          const runResult: SqlRunResult = {
            durationMs,
            error: message,
            id: `${nowIso()}-${index}-err`,
            query: statement,
            result: null,
            rowCount: 0,
            status: "error",
          };
          collectedResults.push(runResult);
          setRunResults([...collectedResults]);
          setActiveRunResultId(runResult.id);
          hadError = true;
          lastErrorMessage = message;

          await appendHistory({
            connectionId: selectedConnection,
            createdAt: nowIso(),
            durationMs,
            errorMessage: message,
            executedSql: statement,
            rowCount: 0,
            sqlPreview: previewSql(statement),
            status: "error",
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
      activeRequestIdRef.current = null;
      setIsExecuting(false);
    }
  }, [appendHistory, doc.sql, executeQuery, selectedConnection]);

  // Refs to always access latest handlers from Monaco actions (avoids stale closure)
  const handleFormatSqlRef = useRef(handleFormatSql);
  handleFormatSqlRef.current = handleFormatSql;
  const handleExplainSqlRef = useRef(handleExplainSql);
  handleExplainSqlRef.current = handleExplainSql;

  const handleEditorMount = useCallback<OnMount>(
    (mounted) => {
      editorRef.current = mounted;

      const syncSelectedSql = () => {
        const selection = mounted.getSelection();
        const model = mounted.getModel();
        if (!(selection && model)) {
          setSelectedSqlForAi("");
          return;
        }
        const selected = model.getValueInRange(selection).trim();
        setSelectedSqlForAi(selected.length > 0 ? selected : "");
      };
      syncSelectedSql();

      // ResizeObserver + RAF-throttled layout() replaces automaticLayout:true polling.
      // automaticLayout uses a 100ms MutationObserver that triggers relayout on every
      // DOM mutation during resize — very expensive. ResizeObserver only fires when the
      // container actually changes size, and RAF coalesces layout calls into one per frame.
      monacoResizeObserverRef.current?.disconnect();
      monacoResizeObserverRef.current = null;
      const container = mounted.getDomNode()?.parentElement;
      if (container) {
        let rafId: number | null = null;
        const observer = new ResizeObserver(() => {
          if (rafId !== null) {
            cancelAnimationFrame(rafId);
          }
          rafId = requestAnimationFrame(() => {
            rafId = null;
            mounted.layout();
          });
        });
        observer.observe(container);
        monacoResizeObserverRef.current = observer;
      }

      monacoSelectionListenerRef.current?.dispose();
      monacoSelectionListenerRef.current = mounted.onDidChangeCursorSelection(
        () => {
          syncSelectedSql();
        }
      );
      monacoContentListenerRef.current?.dispose();
      monacoContentListenerRef.current = mounted.onDidChangeModelContent(() => {
        syncSelectedSql();
      });

      // Register Monaco editor actions (format, explain)
      // These use refs to avoid stale closures — the actual handler logic lives in the callbacks above.
      mounted.addAction({
        id: "sql-format",
        keybindings: [
          monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF,
        ],
        label: "Format SQL",
        run: () => {
          handleFormatSqlRef.current();
        },
      });

      mounted.addAction({
        id: "sql-explain",
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyE],
        label: "EXPLAIN Query",
        run: () => {
          void handleExplainSqlRef.current(false);
        },
      });

      // EXPLAIN ANALYZE — only available for databases that support it
      if (supportsExplainAnalyze(dbType)) {
        mounted.addAction({
          id: "sql-explain-analyze",
          keybindings: [
            monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyE,
          ],
          label: "EXPLAIN ANALYZE Query",
          run: () => {
            void handleExplainSqlRef.current(true);
          },
        });
      }

      // Vim mode — initialized here so it re-applies when editor re-mounts (e.g. tab switch)
      vimModeRef.current?.dispose();
      vimModeRef.current = null;
      if (vimMode) {
        try {
          const statusEl = document.getElementById("vim-status-bar");
          vimModeRef.current = initVimMode(mounted, statusEl ?? undefined);
        } catch {
          // Vim mode init can fail in some environments — silently ignore
        }
      }
    },
    [dbType]
  );

  // React to vim mode toggle (runs after editor is already mounted)
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    vimModeRef.current?.dispose();
    vimModeRef.current = null;
    if (vimMode) {
      try {
        const statusEl = document.getElementById("vim-status-bar");
        vimModeRef.current = initVimMode(editor, statusEl ?? undefined);
      } catch {
        // Vim mode init can fail in some environments — silently ignore
      }
    }
  }, [vimMode]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const isMeta = event.metaKey || event.ctrlKey;
      if (!isMeta) {
        return;
      }

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

      if (event.key.toLowerCase() === "t") {
        event.preventDefault();
        addTab();
      }

      if (event.key.toLowerCase() === "w") {
        event.preventDefault();
        closeTab(activeTabIdRef.current);
      }

      const digit = Number.parseInt(event.key, 10);
      if (digit >= 1 && digit <= 9) {
        const target = tabsRef.current[digit - 1];
        if (target) {
          event.preventDefault();
          setActiveTabId(target.id);
        }
      }
    },
    [runSql, saveCurrentQuery, addTab, closeTab]
  );

  return (
    <section
      aria-label="SQL editor workspace"
      className="h-full min-h-0 rounded-none bg-background"
      onKeyDown={handleKeyDown}
      ref={workspaceRef}
    >
      <PanelGroup className="h-full min-h-0">
        {showWorkspaceSidebar && (
          <Panel
            className="min-h-0 bg-sidebar"
            maxSize="40%"
            minSize="15%"
            onSizeChange={handleSidebarResize}
            size={sidebarSize}
          >
            <aside className="flex h-full min-h-0 flex-col bg-sidebar">
              {/* Sidebar Header */}
              <div className="shrink-0 px-3 pt-3 pb-1">
                {/* Title Row */}
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <UiIcon
                      className="size-3.5 text-muted-foreground"
                      name="file-code-2"
                    />
                    <span className="font-semibold text-foreground text-xs tracking-tight">
                      Workspace
                    </span>
                    {isExecuting ? (
                      <UiIcon
                        className="size-3 animate-spin text-muted-foreground"
                        name="loader"
                      />
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
                  <UiIcon
                    className="pointer-events-none absolute top-1/2 left-2 size-3 -translate-y-1/2 text-muted-foreground"
                    name="search"
                  />
                  <Input
                    className="h-7 border-dashed bg-muted/40 pr-7 pl-7 text-xs focus:border-solid focus:bg-background"
                    onChange={(event) => setSearchText(event.target.value)}
                    placeholder={
                      activeSidebarTab === "items"
                        ? "Filter items..."
                        : "Filter queries..."
                    }
                    ref={searchInputRef}
                    value={searchText}
                  />
                  {searchText && (
                    <button
                      className="absolute top-1/2 right-1.5 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                      onClick={() => setSearchText("")}
                      type="button"
                    >
                      <UiIcon className="size-3" name="x" />
                    </button>
                  )}
                </div>
              </div>

              {/* Tabs */}
              <Tabs
                className="flex min-h-0 flex-1 flex-col"
                onValueChange={(value) =>
                  setActiveSidebarTab(value as "saved" | "history" | "items")
                }
                value={activeSidebarTab}
              >
                <TabsList className="mx-3 shrink-0" variant="line">
                  <TabsTrigger className="gap-1.5 text-xs" value="items">
                    <UiIcon className="size-3" name="layout-grid" />
                    Items
                  </TabsTrigger>
                  <TabsTrigger className="gap-1.5 text-xs" value="saved">
                    <UiIcon className="size-3" name="star" />
                    Saved
                  </TabsTrigger>
                  <TabsTrigger className="gap-1.5 text-xs" value="history">
                    <UiIcon className="size-3" name="clock" />
                    History
                  </TabsTrigger>
                </TabsList>

                {/* Items */}
                <TabsContent
                  className="flex min-h-0 flex-1 flex-col"
                  value="items"
                >
                  <ScrollArea className="min-h-0 flex-1">
                    <div className="px-2 py-1.5">
                      {filteredItemsTree.length === 0 ? (
                        <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
                          <UiIcon
                            className="mb-2 size-4 text-muted-foreground/50"
                            name="layout-grid"
                          />
                          <p className="text-muted-foreground text-xs">
                            {searchText
                              ? "No matches found"
                              : "No items available"}
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-0.5">
                          {filteredItemsTree.map((schema) => {
                            const isSchemaExpanded =
                              expandedSchemas[schema.name] ?? true;
                            return (
                              <div className="rounded-md" key={schema.name}>
                                <button
                                  className="group flex w-full items-center gap-2 rounded-md px-2.5 py-[7px] text-left transition-colors hover:bg-muted/50"
                                  onClick={() =>
                                    toggleSchemaExpanded(schema.name)
                                  }
                                  type="button"
                                >
                                  <UiIcon
                                    className={cn(
                                      "size-3 text-muted-foreground transition-transform",
                                      isSchemaExpanded && "rotate-90"
                                    )}
                                    name="chevron-right"
                                  />
                                  <UiIcon
                                    className="size-3.5 text-muted-foreground"
                                    name="database"
                                  />
                                  <span className="flex-1 truncate font-medium text-[13px] leading-tight">
                                    {schema.name}
                                  </span>
                                  <span className="text-[10px] text-muted-foreground tabular-nums">
                                    {schema.tables.length}
                                  </span>
                                </button>

                                {isSchemaExpanded && (
                                  <div className="mt-0.5 ml-4 space-y-0.5">
                                    {schema.tables.map((table) => {
                                      const tableKey = `${schema.name}.${table.name}`;
                                      const isTableExpanded =
                                        expandedTables[tableKey] ?? true;
                                      return (
                                        <div
                                          className="rounded-md"
                                          key={tableKey}
                                        >
                                          <div className="flex items-center gap-1">
                                            <button
                                              className="group flex w-full items-center gap-2 rounded-md px-2.5 py-[6px] text-left transition-colors hover:bg-muted/40"
                                              onClick={() =>
                                                toggleTableExpanded(tableKey)
                                              }
                                              type="button"
                                            >
                                              <UiIcon
                                                className={cn(
                                                  "size-3 text-muted-foreground transition-transform",
                                                  isTableExpanded && "rotate-90"
                                                )}
                                                name="chevron-right"
                                              />
                                              <UiIcon
                                                className="size-3.5 text-muted-foreground"
                                                name="table"
                                              />
                                              <span className="flex-1 truncate font-medium text-[12px]">
                                                {table.name}
                                              </span>
                                              <span className="text-[10px] text-muted-foreground tabular-nums">
                                                {table.columns.length}
                                              </span>
                                            </button>
                                            <Button
                                              className="mr-1 text-muted-foreground hover:text-foreground"
                                              draggable
                                              onClick={() =>
                                                handleInsertTableFromItems(
                                                  schema.name,
                                                  table.name
                                                )
                                              }
                                              onDragStart={(event) => {
                                                event.dataTransfer.setData(
                                                  "text/sql-table-ref",
                                                  `${schema.name}.${table.name}`
                                                );
                                                event.dataTransfer.effectAllowed =
                                                  "copy";
                                              }}
                                              size="icon-xs"
                                              variant="ghost"
                                            >
                                              <UiIcon
                                                className="size-3"
                                                name="plus"
                                              />
                                            </Button>
                                          </div>

                                          {isTableExpanded && (
                                            <div className="ml-6 space-y-0.5">
                                              {table.columns.map((column) => (
                                                <button
                                                  className={cn(
                                                    "group flex w-full items-center gap-2 rounded-md px-2.5 py-[5px] text-left transition-colors",
                                                    selectedColumns.includes(
                                                      makeQualifiedColumnRef(
                                                        schema.name,
                                                        table.name,
                                                        column.name
                                                      )
                                                    )
                                                      ? "bg-accent text-accent-foreground"
                                                      : "hover:bg-muted/30"
                                                  )}
                                                  draggable
                                                  key={`${tableKey}.${column.name}`}
                                                  onClick={(event) => {
                                                    const qualified =
                                                      makeQualifiedColumnRef(
                                                        schema.name,
                                                        table.name,
                                                        column.name
                                                      );
                                                    if (
                                                      event.shiftKey &&
                                                      lastSelectedColumn
                                                    ) {
                                                      selectRangeInTable(
                                                        schema.name,
                                                        table.name,
                                                        table.columns,
                                                        lastSelectedColumn,
                                                        qualified
                                                      );
                                                      return;
                                                    }
                                                    if (
                                                      event.metaKey ||
                                                      event.ctrlKey
                                                    ) {
                                                      toggleColumnSelection(
                                                        qualified
                                                      );
                                                      return;
                                                    }
                                                    setSelectedColumns([
                                                      qualified,
                                                    ]);
                                                    setLastSelectedColumn(
                                                      qualified
                                                    );
                                                  }}
                                                  onDragStart={(event) => {
                                                    const qualified =
                                                      makeQualifiedColumnRef(
                                                        schema.name,
                                                        table.name,
                                                        column.name
                                                      );
                                                    const fromSameTable =
                                                      selectedColumns.filter(
                                                        (selected) =>
                                                          selected.startsWith(
                                                            `${schema.name}.${table.name}.`
                                                          )
                                                      );
                                                    const dragColumns =
                                                      fromSameTable.includes(
                                                        qualified
                                                      )
                                                        ? fromSameTable
                                                        : [qualified];
                                                    event.dataTransfer.setData(
                                                      "text/sql-column-ref",
                                                      dragColumns[0] ??
                                                        qualified
                                                    );
                                                    event.dataTransfer.setData(
                                                      "text/sql-column-refs",
                                                      JSON.stringify(
                                                        dragColumns
                                                      )
                                                    );
                                                    event.dataTransfer.setData(
                                                      "text/plain",
                                                      dragColumns.join(", ")
                                                    );
                                                    event.dataTransfer.effectAllowed =
                                                      "copy";
                                                    setMultiItemDragPreview(
                                                      event,
                                                      dragColumns
                                                    );
                                                  }}
                                                  type="button"
                                                >
                                                  <UiIcon
                                                    className="size-3 text-muted-foreground/70"
                                                    name="key"
                                                  />
                                                  <span className="flex-1 truncate font-mono text-[11px]">
                                                    {column.name}
                                                  </span>
                                                  <span className="max-w-24 truncate text-[10px] text-muted-foreground/70">
                                                    {column.dataType}
                                                  </span>
                                                </button>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                </TabsContent>

                {/* Saved queries */}
                <TabsContent
                  className="flex min-h-0 flex-1 flex-col"
                  value="saved"
                >
                  <ScrollArea className="min-h-0 flex-1">
                    <div className="px-2 py-1.5">
                      <div className="space-y-0.5">
                        {filteredSaved.map((entry) => (
                          <div
                            className="group/saved relative rounded-md px-2.5 py-[7px] transition-colors hover:bg-muted/50"
                            key={entry.id}
                          >
                            <button
                              className="w-full pr-12 text-left"
                              onClick={() => hydrateFromSaved(entry)}
                              type="button"
                            >
                              <p className="truncate font-medium text-[13px] leading-tight">
                                {entry.title}
                              </p>
                              <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground leading-4">
                                {previewSql(entry.sql)}
                              </p>
                            </button>
                            {/* Hover-reveal actions */}
                            <div className="absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-hover/saved:opacity-100">
                              <Tooltip>
                                <TooltipTrigger
                                  render={
                                    <Button
                                      className="text-muted-foreground hover:text-foreground"
                                      onClick={() => {
                                        const next = window.prompt(
                                          "Rename query",
                                          entry.title
                                        );
                                        if (next?.trim()) {
                                          void renameQuery(
                                            entry.id,
                                            next.trim()
                                          );
                                        }
                                      }}
                                      size="icon-xs"
                                      variant="ghost"
                                    >
                                      <UiIcon
                                        className="size-3"
                                        name="pencil"
                                      />
                                    </Button>
                                  }
                                />
                                <TooltipContent>Rename query</TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger
                                  render={
                                    <Button
                                      className="text-muted-foreground hover:text-destructive"
                                      onClick={() => void deleteQuery(entry.id)}
                                      size="icon-xs"
                                      variant="ghost"
                                    >
                                      <UiIcon className="size-3" name="trash" />
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
                        <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
                          <UiIcon
                            className="mb-2 size-4 text-muted-foreground/50"
                            name="star"
                          />
                          <p className="text-muted-foreground text-xs">
                            {searchText
                              ? "No matches found"
                              : "No saved queries"}
                          </p>
                          {searchText && (
                            <p className="mt-1 text-[11px] text-muted-foreground/60">
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
                  className="flex min-h-0 flex-1 flex-col"
                  value="history"
                >
                  <ScrollArea className="min-h-0 flex-1">
                    <div className="px-2 py-1.5">
                      <div className="space-y-0.5">
                        {filteredHistory.map((entry) => (
                          <button
                            className="group/history flex w-full items-start gap-2.5 rounded-md px-2.5 py-[7px] text-left transition-colors hover:bg-muted/50"
                            key={entry.id}
                            onClick={() => hydrateFromHistory(entry)}
                            type="button"
                          >
                            {/* Status indicator */}
                            <span
                              className={cn(
                                "mt-1 inline-block size-1.5 shrink-0 rounded-full",
                                entry.status === "success"
                                  ? "bg-emerald-500"
                                  : "bg-destructive/60"
                              )}
                            />
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-medium text-[13px] leading-tight">
                                {entry.sqlPreview}
                              </p>

                              {/* Meta row */}
                              <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                                <span>{formatDuration(entry.durationMs)}</span>
                                <span className="opacity-30">·</span>
                                <span>{entry.rowCount} rows</span>
                                <span className="opacity-30">·</span>
                                <span>
                                  {new Date(
                                    entry.createdAt
                                  ).toLocaleTimeString()}
                                </span>
                              </div>

                              {/* Error message */}
                              {entry.status === "error" &&
                                entry.errorMessage && (
                                  <p className="mt-0.5 truncate text-[10px] text-destructive/60">
                                    {entry.errorMessage}
                                  </p>
                                )}
                            </div>
                          </button>
                        ))}
                      </div>

                      {filteredHistory.length === 0 && (
                        <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
                          <UiIcon
                            className="mb-2 size-4 text-muted-foreground/50"
                            name="clock"
                          />
                          <p className="text-muted-foreground text-xs">
                            {searchText ? "No matches found" : "No history yet"}
                          </p>
                          {searchText && (
                            <p className="mt-1 text-[11px] text-muted-foreground/60">
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
          </Panel>
        )}
        {showWorkspaceSidebar && <PanelSeparator withHandle />}
        <Panel className="min-h-0 min-w-0">
          <div className="flex h-full min-w-0 flex-col">
            {/* ── Tab bar ────────────────────────────────────────── */}
            <div className="flex h-[34px] shrink-0 items-end border-border/60 border-b bg-background pl-1">
              <div className="scrollbar-none flex min-w-0 flex-1 items-end overflow-x-auto">
                {tabs.map((tab) => {
                  const isActive = tab.id === activeTabId;
                  const isDirty = tab.doc.sql !== tab.lastSavedSql;
                  return (
                    <button
                      className={cn(
                        "group/tab relative flex h-[30px] items-center gap-1.5 whitespace-nowrap px-3 text-[12px] leading-none",
                        tabs.length > 1 && "pr-7",
                        "transition-colors duration-150",
                        isActive
                          ? "bg-muted/50 text-foreground"
                          : "text-muted-foreground hover:bg-muted/30 hover:text-foreground",
                        "[@media(hover:hover)_and_(pointer:fine)]:active:scale-[0.98] [@media(hover:hover)_and_(pointer:fine)]:active:transition-transform [@media(hover:hover)_and_(pointer:fine)]:active:duration-100"
                      )}
                      key={tab.id}
                      onClick={() => setActiveTabId(tab.id)}
                      type="button"
                    >
                      {isActive && (
                        <span className="absolute inset-x-0 -bottom-[1px] h-[2px] rounded-full bg-foreground" />
                      )}
                      <UiIcon
                        className={cn(
                          "size-[13px] shrink-0",
                          isActive
                            ? "text-foreground/70"
                            : "text-muted-foreground/60"
                        )}
                        name="file-code-2"
                      />
                      <span className="max-w-[140px] select-text truncate">
                        {tab.doc.title}
                      </span>
                      {isDirty && (
                        <span
                          className={cn(
                            "size-[5px] shrink-0 rounded-full",
                            isActive
                              ? "bg-foreground/60"
                              : "bg-muted-foreground/50"
                          )}
                        />
                      )}
                      {tabs.length > 1 && (
                        <span
                          className={cn(
                            "absolute top-1/2 right-1 -translate-y-1/2 rounded-[3px] p-[2px]",
                            "select-none",
                            "opacity-0 transition-opacity duration-100 group-hover/tab:opacity-100",
                            "hover:bg-muted-foreground/15 hover:text-destructive"
                          )}
                          onClick={(e) => {
                            e.stopPropagation();
                            closeTab(tab.id);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              e.stopPropagation();
                              closeTab(tab.id);
                            }
                          }}
                          role="button"
                          tabIndex={0}
                        >
                          <UiIcon className="size-[11px]" name="x" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      className="mx-1 mb-[5px] shrink-0 text-muted-foreground/60 hover:text-foreground"
                      onClick={() => addTab()}
                      size="icon-xs"
                      variant="ghost"
                    >
                      <UiIcon className="size-3.5" name="plus" />
                    </Button>
                  }
                />
                <TooltipContent>
                  New tab
                  <KbdGroup className="ml-1.5">
                    <Kbd>⌘</Kbd>
                    <Kbd>T</Kbd>
                  </KbdGroup>
                </TooltipContent>
              </Tooltip>
            </div>

            {/* ── Editor toolbar ──────────────────── */}
            <div className="flex h-9 items-center gap-1.5 border-border/50 border-b px-2">
              {/* ── Left: Document actions ─────── */}
              <div className="flex items-center gap-1">
                <Input
                  className="h-7 w-[180px] rounded-md border-0 bg-transparent px-1.5 font-medium text-sm transition-colors hover:bg-muted/60 focus:bg-muted focus-visible:ring-0"
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Untitled query"
                  value={doc.title}
                />

                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        className="gap-1"
                        onClick={() => void saveCurrentQuery()}
                        size="xs"
                        variant="ghost"
                      >
                        <UiIcon className="size-3" name="device-floppy" />
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
              </div>

              <Separator className="h-4" orientation="vertical" />

              {/* ── Center: Connection ─────────── */}
              <div className="flex items-center gap-1.5 px-1.5">
                <span
                  className={cn(
                    "inline-block size-[7px] shrink-0 rounded-full",
                    selectedConnection
                      ? "bg-emerald-500"
                      : "bg-muted-foreground/40"
                  )}
                />
                <span className="max-w-[260px] truncate text-foreground/70 text-xs">
                  {selectedConnectionMeta.label || "No connection selected"}
                </span>
              </div>

              <Separator className="h-4" orientation="vertical" />

              {/* ── Right: Editor settings ─────── */}
              <div className="flex items-center gap-1">
                <DropdownMenu>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <DropdownMenuTrigger
                          render={
                            <Button
                              className={cn(
                                "h-6 gap-1 px-1.5 font-medium text-[10px]",
                                isReadOnlySafeMode && "text-red-500",
                                safeModeLevel === "alert" && "text-amber-500",
                                safeModeLevel === "silent" &&
                                  "text-muted-foreground"
                              )}
                              size="xs"
                              variant="ghost"
                            >
                              <UiIcon
                                className="size-3"
                                name={
                                  isReadOnlySafeMode
                                    ? "alert-triangle"
                                    : safeModeLevel === "alert"
                                      ? "shield-check"
                                      : "shield"
                                }
                              />
                              {SAFE_MODE_LABELS[safeModeLevel]}
                            </Button>
                          }
                        />
                      }
                    />
                    <TooltipContent>
                      {SAFE_MODE_DESCRIPTIONS[safeModeLevel]}
                    </TooltipContent>
                  </Tooltip>
                  <DropdownMenuContent align="start" className="w-56">
                    {(
                      ["off", "silent", "alert", "readonly"] as SafeModeLevel[]
                    ).map((level) => (
                      <DropdownMenuItem
                        className={cn(
                          "flex items-center gap-2 text-xs",
                          safeModeLevel === level && "bg-accent"
                        )}
                        key={level}
                        onClick={() =>
                          useSafeModeStore
                            .getState()
                            .setLevel(selectedConnection ?? "", level)
                        }
                      >
                        <UiIcon
                          className={cn(
                            "size-3.5",
                            level === "readonly" && "text-red-500",
                            level === "alert" && "text-amber-500",
                            level === "silent" && "text-muted-foreground"
                          )}
                          name={
                            level === "readonly"
                              ? "alert-triangle"
                              : level === "alert"
                                ? "shield-check"
                                : "shield"
                          }
                        />
                        <div className="flex flex-col">
                          <span className="font-medium">
                            {SAFE_MODE_LABELS[level]}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {SAFE_MODE_DESCRIPTIONS[level]}
                          </span>
                        </div>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <Separator className="h-4" orientation="vertical" />

              {/* ── Run ────────────────────────── */}
              <div className="ml-auto flex shrink-0 items-center gap-2">
                {isExecuting && (
                  <div className="flex items-center gap-2">
                    <span className="animate-pulse font-mono text-muted-foreground text-xs">
                      Running…
                    </span>
                    <Button
                      onClick={() => {
                        executionAbort.current?.abort();
                        if (activeRequestIdRef.current) {
                          cancelQuery(activeRequestIdRef.current);
                        }
                      }}
                      size="sm"
                      variant="ghost"
                    >
                      Cancel
                    </Button>
                  </div>
                )}
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        className="gap-1.5"
                        disabled={
                          !selectedConnection || isExecuting || !doc.sql.trim()
                        }
                        onClick={() => void runSql()}
                        size="sm"
                      >
                        {isExecuting ? (
                          <UiIcon
                            className="size-3.5 animate-spin"
                            name="loader"
                          />
                        ) : (
                          <UiIcon className="size-3.5" name="play" />
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

            <PanelGroup className="min-h-0 flex-1" orientation="vertical">
              <Panel className="min-h-0">
                <div
                  className="relative h-full min-h-0"
                  onDragOver={(e) => {
                    const supportsTable =
                      e.dataTransfer?.types.includes("text/sql-table-ref");
                    const supportsColumn = e.dataTransfer?.types.includes(
                      "text/sql-column-ref"
                    );
                    const supportsColumns = e.dataTransfer?.types.includes(
                      "text/sql-column-refs"
                    );
                    if (supportsTable || supportsColumn || supportsColumns) {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "copy";
                    }
                  }}
                  onDrop={(e) => {
                    const columnRefsRaw = e.dataTransfer?.getData(
                      "text/sql-column-refs"
                    );
                    if (columnRefsRaw) {
                      try {
                        const columnRefs = JSON.parse(
                          columnRefsRaw
                        ) as string[];
                        const normalized = normalizeColumnRefs(columnRefs);
                        if (normalized.length > 0) {
                          e.preventDefault();
                          const editorInstance = editorRef.current;
                          const selection = editorInstance?.getSelection();
                          const hasExplicitSelection = Boolean(
                            selection &&
                              (selection.startLineNumber !==
                                selection.endLineNumber ||
                                selection.startColumn !== selection.endColumn)
                          );
                          const refs = normalized.map((item) => item.qualified);

                          const model = editorInstance?.getModel();
                          const position = editorInstance?.getPosition();
                          if (!hasExplicitSelection && model && position) {
                            const offset = model.getOffsetAt(position);
                            const statement = getStatementRangeAtOffset(
                              model.getValue(),
                              offset
                            );
                            if (statement) {
                              const merged = mergeDroppedColumnsIntoStatement(
                                statement.text,
                                refs,
                                schemaCompletionData
                              );
                              if (
                                merged.merged &&
                                replaceStatementAtCursor(merged.sql)
                              ) {
                                return;
                              }
                            }
                          }

                          const sql = buildSmartSqlFromColumnRefs(
                            refs,
                            schemaCompletionData
                          );
                          if (sql) {
                            if (
                              !hasExplicitSelection &&
                              insertSqlBelowStatementAtCursor(sql)
                            ) {
                              return;
                            }
                            insertIntoEditor(sql);
                            return;
                          }
                          insertIntoEditor(refs.join(", "));
                          return;
                        }
                      } catch {
                        // Ignore malformed payload and try legacy paths below.
                      }
                    }

                    const columnRef = e.dataTransfer
                      ?.getData("text/sql-column-ref")
                      ?.trim();
                    if (columnRef) {
                      e.preventDefault();
                      insertIntoEditor(columnRef);
                      return;
                    }

                    const tableRef =
                      e.dataTransfer?.getData("text/sql-table-ref");
                    if (tableRef) {
                      e.preventDefault();
                      const dot = tableRef.indexOf(".");
                      if (dot > 0) {
                        const schema = tableRef.slice(0, dot);
                        const table = tableRef.slice(dot + 1);
                        insertIntoEditor(makeTableSelectSql(schema, table));
                        return;
                      }
                      insertIntoEditor(
                        `SELECT *\nFROM ${tableRef}\nLIMIT 100;`
                      );
                    }
                  }}
                >
                  <LazyMonacoEditor
                    defaultLanguage="sql"
                    height="100%"
                    key={activeTabId}
                    onChange={(value: string | undefined) =>
                      setSql(value || "")
                    }
                    onMount={handleEditorMount}
                    options={MONACO_OPTIONS}
                    theme={monacoTheme}
                    value={doc.sql}
                  />
                  {vimMode && (
                    <div
                      className="absolute right-0 bottom-0 left-0 z-10 flex h-5 items-center bg-muted/90 px-2 font-mono text-[10px] text-muted-foreground"
                      id="vim-status-bar"
                    />
                  )}

                  <AnimatePresence>
                    {isEditorEmpty && !isInlineAiPromptOpen && (
                      <motion.div
                        animate={{
                          opacity: 1,
                          transition: {
                            duration: 0.2,
                            ease: [0.23, 1, 0.32, 1],
                          },
                          y: 0,
                        }}
                        className="pointer-events-none absolute top-[12px] left-[70px] z-10 font-mono text-muted-foreground/40 text-sm leading-5"
                        exit={{
                          opacity: 0,
                          transition: { duration: 0.12 },
                          y: 2,
                        }}
                        initial={{ opacity: 0, y: 4 }}
                      >
                        <span className="pointer-events-auto">
                          Type SQL or{" "}
                          <button
                            className="font-medium text-primary/60 transition-colors duration-150 hover:text-primary hover:underline"
                            onClick={() => setIsInlineAiPromptOpen(true)}
                            type="button"
                          >
                            Generate with AI...
                          </button>
                        </span>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <AnimatePresence>
                    {isInlineAiPromptOpen && (
                      <motion.div
                        animate={{
                          opacity: 1,
                          scale: 1,
                          transition: {
                            duration: 0.2,
                            ease: [0.23, 1, 0.32, 1],
                          },
                          y: 0,
                        }}
                        className="absolute top-[34px] left-[44px] z-20 w-[min(560px,calc(100%-56px))] rounded-lg border border-border/60 bg-background/95 px-2.5 py-2 shadow-lg backdrop-blur-sm"
                        exit={{
                          opacity: 0,
                          scale: 0.98,
                          transition: {
                            duration: 0.15,
                            ease: [0.23, 1, 0.32, 1],
                          },
                          y: -2,
                        }}
                        initial={{ opacity: 0, scale: 0.97, y: -4 }}
                        key="inline-ai-prompt"
                        style={{ transformOrigin: "left center" }}
                      >
                        {isGeneratingInlineAi ? (
                          <div className="flex items-center gap-2 px-3 py-2">
                            <UiIcon
                              className="size-3.5 shrink-0 animate-spin text-muted-foreground"
                              name="loader"
                            />
                            <span className="flex-1 truncate text-muted-foreground text-xs">
                              Generating…
                            </span>
                            <Button
                              className="shrink-0 text-muted-foreground text-xs hover:text-foreground"
                              onClick={() => {
                                if (!inlineStreamRequestIdRef.current) {
                                  return;
                                }
                                window.electron?.aiInline?.abort(
                                  inlineStreamRequestIdRef.current
                                );
                                inlineStreamRequestIdRef.current = null;
                                clearInlineStartFallbackTimeout();
                                clearInlineStreamTimeout();
                                setIsGeneratingInlineAi(false);
                                setSql(inlinePreviousSqlRef.current);
                              }}
                              size="xs"
                              type="button"
                              variant="ghost"
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <Input
                              className="h-7 flex-1 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0"
                              onChange={(e) =>
                                setInlineAiPrompt(e.target.value)
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Escape") {
                                  setIsInlineAiPromptOpen(false);
                                  setInlineAiPrompt("");
                                  return;
                                }
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  void handleGenerateSqlInline();
                                }
                              }}
                              placeholder="Describe the SQL query you want to run..."
                              ref={inlineAiInputRef}
                              value={inlineAiPrompt}
                            />
                            <Button
                              disabled={!inlineAiPrompt.trim()}
                              onClick={() => void handleGenerateSqlInline()}
                              size="icon-xs"
                              type="button"
                              variant="ghost"
                            >
                              <UiIcon
                                className="size-3.5"
                                name="arrow-right-circle"
                              />
                            </Button>
                            <Button
                              onClick={() => {
                                setIsInlineAiPromptOpen(false);
                                setInlineAiPrompt("");
                              }}
                              size="icon-xs"
                              type="button"
                              variant="ghost"
                            >
                              <UiIcon className="size-3.5" name="x" />
                            </Button>
                          </div>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </Panel>
              <PanelSeparator withHandle />
              <Panel
                className="min-h-0"
                maxSize="80%"
                minSize="20%"
                onSizeChange={setResultsSize}
                size={resultsSize}
              >
                <section className="flex h-full min-h-0 flex-col">
                  {(runResultStats.total > 0 || lastResult || lastError) && (
                    <div className="flex shrink-0 items-center justify-end gap-3 border-b px-3 py-2">
                      {runResultStats.total > 0 && (
                        <div className="font-mono text-[11px] text-muted-foreground tabular-nums">
                          {runResultStats.total} total ·{" "}
                          {runResultStats.success} ok · {runResultStats.error}{" "}
                          err
                        </div>
                      )}
                    </div>
                  )}
                  <div className="min-h-0 overflow-auto px-3 pt-2 pb-3">
                    {runResults.length > 1 ? (
                      <Tabs
                        className="flex h-full min-h-0 flex-col"
                        onValueChange={setActiveRunResultId}
                        value={activeRunResult?.id ?? runResults[0]?.id}
                      >
                        <ScrollArea className="border-b py-1">
                          <TabsList className="w-max" variant="line">
                            {runResults.map((item, index) => (
                              <TabsTrigger
                                className={cn(
                                  item.status === "error" && "text-destructive"
                                )}
                                key={item.id}
                                title={item.query}
                                value={item.id}
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
                          <TabsContent
                            className="min-h-0 overflow-auto pt-3"
                            key={item.id}
                            value={item.id}
                          >
                            <QueryResults
                              durationMs={item.durationMs}
                              error={item.error}
                              isFixingWithAi={isFixingSql}
                              onFixWithAi={(() => {
                                const error = item.error;
                                return error
                                  ? () => void handleFixSql(item.query, error)
                                  : undefined;
                              })()}
                              result={item.result}
                            />
                          </TabsContent>
                        ))}
                      </Tabs>
                    ) : (
                      <QueryResults
                        durationMs={
                          activeRunResult?.durationMs ?? lastDurationMs
                        }
                        error={activeRunResult?.error ?? lastError}
                        isFixingWithAi={isFixingSql}
                        onFixWithAi={
                          (activeRunResult?.error ?? lastError)
                            ? () =>
                                void handleFixSql(
                                  activeRunResult?.query ?? doc.sql,
                                  activeRunResult?.error ??
                                    lastError ??
                                    undefined
                                )
                            : undefined
                        }
                        result={activeRunResult?.result ?? lastResult}
                      />
                    )}
                  </div>
                </section>
              </Panel>
            </PanelGroup>
          </div>
        </Panel>
      </PanelGroup>
    </section>
  );
}
