import { useTheme } from "next-themes";
import type { DragEvent, KeyboardEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { QueryResults } from "../QueryResults";
import { Icon as UiIcon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { LazyMonacoEditor, type OnMount } from "../LazyMonacoEditor";

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  useDefaultLayout,
} from "@/components/ui/resizable";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSqlWorkspace,
  type SqlHistoryEntry,
  type SqlSavedQuery,
} from "../../hooks/useSqlWorkspace";
import { fixSql, updateSql } from "@/features/ai/hooks/ai-actions";
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
import { cn } from "@/lib/utils";
import { useAiChatGlobalStore } from "@/lib/stores/ai-chat-global";
import * as monaco from "monaco-editor";
import "@/lib/monaco-loader";
import type { QueryResult } from "@/ipc/db/types";
import type { SqlEditorProps, SqlDocument, SqlRunResult, SqlTab } from "./types";
import {
  previewSql,
  hasDangerousSqlKeywords,
  truncateForContext,
  splitSqlStatements,
  nowIso,
  toHistoryResultPreview,
} from "./utils/sqlUtils";
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
import { cancelQuery } from "@/features/database/hooks/db-actions";


const DEFAULT_SQL = `/*
Try creating a sample table and querying it.
*/
SELECT now() as server_time;`;

type MonacoEditor = Parameters<OnMount>[0];

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

const INITIAL_TAB_ID = "initial-tab";


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
      id: INITIAL_TAB_ID,
      doc: { id: null, title: "Untitled", sql: DEFAULT_SQL, updatedAt: nowIso() },
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
  const doc = activeTab?.doc ?? { id: null, title: "Untitled", sql: "", updatedAt: nowIso() };

  const updateTab = useCallback(
    (tabId: string, updater: (tab: SqlTab) => SqlTab) => {
      setTabs((prev) => prev.map((t) => (t.id === tabId ? updater(t) : t)));
    },
    [],
  );

  const addTab = useCallback((docOverrides?: Partial<SqlDocument>) => {
    const id = crypto.randomUUID();
    tabCounterRef.current += 1;
    const title = docOverrides?.title ?? `Untitled ${tabCounterRef.current}`;
    const sql = docOverrides?.sql ?? DEFAULT_SQL;
    const newTab: SqlTab = {
      id,
      doc: {
        id: docOverrides?.id ?? null,
        title,
        sql,
        updatedAt: docOverrides?.updatedAt ?? nowIso(),
      },
      lastSavedSql: sql,
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(id);
  }, []);

  const closeTab = useCallback((tabId: string) => {
    const current = tabsRef.current;
    if (current.length <= 1) return;
    const idx = current.findIndex((t) => t.id === tabId);
    const next = current.filter((t) => t.id !== tabId);
    setTabs(next);
    if (tabId === activeTabIdRef.current) {
      const newIdx = Math.min(idx, next.length - 1);
      setActiveTabId(next[newIdx].id);
    }
  }, []);

  const [activeSidebarTab, setActiveSidebarTab] = useState<"saved" | "history" | "items">(
    "saved",
  );
  const [searchText, setSearchText] = useState("");
  const [expandedSchemas, setExpandedSchemas] = useState<Record<string, boolean>>({});
  const [expandedTables, setExpandedTables] = useState<Record<string, boolean>>({});
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [lastSelectedColumn, setLastSelectedColumn] = useState<string | null>(null);

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
  const inlineAiInputRef = useRef<HTMLInputElement | null>(null);
  const editorRef = useRef<MonacoEditor | null>(null);
  const executionAbort = useRef<AbortController | null>(null);
  const activeRequestIdRef = useRef<string | null>(null);
  const monacoResizeObserverRef = useRef<ResizeObserver | null>(null);
  const monacoSelectionListenerRef = useRef<monaco.IDisposable | null>(null);
  const monacoContentListenerRef = useRef<monaco.IDisposable | null>(null);
  const inlineStreamRequestIdRef = useRef<string | null>(null);
  const inlineStreamTextRef = useRef("");
  const inlinePreviousSqlRef = useRef("");
  const inlineStreamTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inlineStartFallbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track sidebar pixel width in a ref (cheap, no setState) — read on layout change
  const sidebarWidthRef = useRef<number>(0);

  // AI panel state
  const [isFixingSql, setIsFixingSql] = useState(false);
  const [isInlineAiPromptOpen, setIsInlineAiPromptOpen] = useState(false);
  const [inlineAiPrompt, setInlineAiPrompt] = useState("");
  const [isGeneratingInlineAi, setIsGeneratingInlineAi] = useState(false);
  const [selectedSqlForAi, setSelectedSqlForAi] = useState("");
  // EXPLAIN state (driven by keyboard shortcuts only, no toolbar button)
  const [isExplaining, setIsExplaining] = useState(false);
  const explainQueryClient = useQueryClient();

  const setSqlContext = useAiChatGlobalStore((state) => state.setSqlContext);
  const clearSqlContext = useAiChatGlobalStore((state) => state.clearSqlContext);
  const sqlContextSourceIdRef = useRef<string>(
    `sql-editor-${selectedConnection ?? "none"}-${Math.random().toString(36).slice(2)}`,
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
      name: found?.name ?? "No connection",
      label: !found
        ? ""
        : found.name?.trim() || found.database?.trim() || "Unnamed connection",
    };
  }, [connections, selectedConnection]);

  const aiChatContext = useMemo(() => {
    const blocks: string[] = [];

    if (schemaContext?.trim()) {
      blocks.push(`## Database Schema Context\n${schemaContext.trim()}`);
    }

    blocks.push(
      `## Editor Context\n- Connection: ${selectedConnectionMeta.label || "none"}\n- Database type: ${dbType}`,
    );

    if (selectedSqlForAi.trim()) {
      blocks.push(
        `## Selected SQL in Editor (Priority)\n${truncateForContext(selectedSqlForAi.trim(), 5000)}`,
      );
    }

    if (doc.sql.trim()) {
      blocks.push(
        `## Current SQL in Editor\n${truncateForContext(doc.sql.trim(), 12000)}`,
      );
    }

    if (lastError?.trim()) {
      blocks.push(
        `## Last SQL Error\n${truncateForContext(lastError.trim(), 2500)}`,
      );
    }

    return blocks.join("\n\n");
  }, [schemaContext, selectedConnectionMeta.label, dbType, selectedSqlForAi, doc.sql, lastError]);

  const aiChatContextPreview = useMemo(() => {
    const selection = selectedSqlForAi.trim();
    const error = lastError?.trim() ?? "";
    return {
      connectionLabel: selectedConnectionMeta.label || "No connection",
      dbType,
      selectionPreview: selection ? truncateForContext(selection, 160) : "",
      errorPreview: error ? truncateForContext(error, 120) : "",
    };
  }, [selectedSqlForAi, lastError, selectedConnectionMeta.label, dbType]);

  useEffect(() => {
    if (!isRouteActive) return;

    setSqlContext(sqlContextSourceIdRef.current, {
      connectionId: selectedConnection,
      connectionLabel: selectedConnectionMeta.label || "No connection",
      dbType,
      schemaContext: aiChatContext,
      contextPreview: aiChatContextPreview,
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
    if (!loadRequest) return;
    const sql = loadRequest.sql;
    updateTab(activeTabIdRef.current, () => ({
      id: activeTabIdRef.current,
      doc: {
        id: null,
        title: loadRequest.title || "Untitled",
        sql,
        updatedAt: nowIso(),
      },
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

  const itemsTree = useMemo(
    () => buildItemsTree(schemaCompletionData),
    [schemaCompletionData],
  );

  const filteredItemsTree = useMemo(
    () => filterItemsTree(itemsTree, searchText),
    [itemsTree, searchText],
  );

  useEffect(() => {
    if (!searchText.trim()) return;
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

  const isEditorEmpty = useMemo(
    () => doc.sql.trim().length === 0,
    [doc.sql],
  );

  const setSql = useCallback(
    (sql: string) => {
      updateTab(activeTabIdRef.current, (tab) => {
        if (tab.doc.sql === sql) return tab;
        return { ...tab, doc: { ...tab.doc, sql, updatedAt: nowIso() } };
      });
    },
    [updateTab],
  );

  const insertIntoEditor = useCallback(
    (text: string) => {
      const editorInstance = editorRef.current;
      if (editorInstance) {
        const selection = editorInstance.getSelection();
        const range = selection ?? editorInstance.getModel()?.getFullModelRange();
        if (range) {
          editorInstance.executeEdits("sidebar-items-insert", [{
            range,
            text,
            forceMoveMarkers: true,
          }]);
          editorInstance.focus();
          return;
        }
      }
      setSql(text);
    },
    [setSql],
  );

  const replaceStatementAtCursor = useCallback((nextStatementSql: string): boolean => {
    const editorInstance = editorRef.current;
    const model = editorInstance?.getModel();
    const position = editorInstance?.getPosition();
    if (!editorInstance || !model || !position) return false;

    const offset = model.getOffsetAt(position);
    const statement = getStatementRangeAtOffset(model.getValue(), offset);
    if (!statement) return false;

    const startPos = model.getPositionAt(statement.start);
    const endPos = model.getPositionAt(statement.end);
    editorInstance.executeEdits("sidebar-items-merge-statement", [{
      range: new monaco.Range(
        startPos.lineNumber,
        startPos.column,
        endPos.lineNumber,
        endPos.column,
      ),
      text: nextStatementSql,
      forceMoveMarkers: true,
    }]);
    editorInstance.focus();
    return true;
  }, []);

  const insertSqlBelowStatementAtCursor = useCallback((nextSql: string): boolean => {
    const editorInstance = editorRef.current;
    const model = editorInstance?.getModel();
    const position = editorInstance?.getPosition();
    if (!editorInstance || !model || !position) return false;

    const source = model.getValue();
    const offset = model.getOffsetAt(position);
    const statement = getStatementRangeAtOffset(source, offset);
    if (!statement) return false;
    let insertOffset = statement.end;
    if (source[insertOffset] === ";") insertOffset += 1;
    const insertPos = model.getPositionAt(insertOffset);
    const text = `\n\n${nextSql}`;
    editorInstance.executeEdits("sidebar-items-insert-below", [{
      range: new monaco.Range(
        insertPos.lineNumber,
        insertPos.column,
        insertPos.lineNumber,
        insertPos.column,
      ),
      text,
      forceMoveMarkers: true,
    }]);
    editorInstance.focus();
    return true;
  }, []);

  const toggleSchemaExpanded = useCallback((schema: string) => {
    setExpandedSchemas((prev) => ({ ...prev, [schema]: !prev[schema] }));
  }, []);

  const toggleTableExpanded = useCallback((tableKey: string) => {
    setExpandedTables((prev) => ({ ...prev, [tableKey]: !prev[tableKey] }));
  }, []);

  const handleInsertTableFromItems = useCallback((schema: string, table: string) => {
    insertIntoEditor(makeTableSelectSql(schema, table));
  }, [insertIntoEditor]);

  const toggleColumnSelection = useCallback((qualifiedColumn: string) => {
    setSelectedColumns((prev) => {
      if (prev.includes(qualifiedColumn)) {
        return prev.filter((col) => col !== qualifiedColumn);
      }
      return [...prev, qualifiedColumn];
    });
    setLastSelectedColumn(qualifiedColumn);
  }, []);

  const setMultiItemDragPreview = useCallback((
    event: DragEvent<HTMLElement>,
    items: string[],
  ) => {
    if (items.length <= 1) return;
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
    preview.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, monospace";
    preview.style.fontSize = "12px";
    preview.style.lineHeight = "1.2";
    preview.style.maxWidth = "340px";
    preview.style.boxShadow = "0 6px 24px rgba(0,0,0,0.35)";

    const first = items[0] ?? "";
    const restCount = items.length - 1;
    preview.textContent = restCount > 0
      ? `${first} + ${restCount} itens`
      : first;

    document.body.append(preview);
    event.dataTransfer.setDragImage(preview, 12, 12);
    requestAnimationFrame(() => preview.remove());
  }, []);

  const selectRangeInTable = useCallback((
    schema: string,
    table: string,
    columns: { name: string; dataType: string }[],
    anchorQualified: string,
    targetQualified: string,
  ) => {
    const tableKey = `${schema}.${table}.`;
    if (!anchorQualified.startsWith(tableKey) || !targetQualified.startsWith(tableKey)) {
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

    const [start, end] = anchorIndex < targetIndex
      ? [anchorIndex, targetIndex]
      : [targetIndex, anchorIndex];
    const rangeSelection = names
      .slice(start, end + 1)
      .map((name) => makeQualifiedColumnRef(schema, table, name));
    setSelectedColumns(rangeSelection);
    setLastSelectedColumn(targetQualified);
  }, []);

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

  const fallbackInlineGenerateSql = useCallback(async (
    requestId: string,
    prompt: string,
    sqlSeed: string,
  ) => {
    try {
      const result = await updateSql(sqlSeed, prompt, dbType, schemaContext);
      if (requestId !== inlineStreamRequestIdRef.current) return;

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
      if (requestId !== inlineStreamRequestIdRef.current) return;
      clearInlineStreamTimeout();
      clearInlineStartFallbackTimeout();
      inlineStreamRequestIdRef.current = null;
      setIsGeneratingInlineAi(false);
      setSql(inlinePreviousSqlRef.current);
      toast.error(err instanceof Error ? err.message : "Failed to generate SQL with AI");
    }
  }, [clearInlineStartFallbackTimeout, clearInlineStreamTimeout, dbType, schemaContext, setSql]);

  const scheduleInlineStartFallback = useCallback((
    requestId: string,
    prompt: string,
    sqlSeed: string,
  ) => {
    clearInlineStartFallbackTimeout();
    inlineStartFallbackTimeoutRef.current = setTimeout(() => {
      if (requestId !== inlineStreamRequestIdRef.current) return;
      if (inlineStreamTextRef.current.trim().length > 0) return;
      window.electron?.aiInline?.abort(requestId);
      void fallbackInlineGenerateSql(requestId, prompt, sqlSeed);
    }, 4000);
  }, [clearInlineStartFallbackTimeout, fallbackInlineGenerateSql]);

  const scheduleInlineStreamTimeout = useCallback(() => {
    clearInlineStreamTimeout();
    inlineStreamTimeoutRef.current = setTimeout(() => {
      const requestId = inlineStreamRequestIdRef.current;
      if (!requestId) return;
      window.electron?.aiInline?.abort(requestId);
      const hasPartial = inlineStreamTextRef.current.trim().length > 0;
      if (!hasPartial) {
        setSql(inlinePreviousSqlRef.current);
      }
      clearInlineStartFallbackTimeout();
      inlineStreamRequestIdRef.current = null;
      setIsGeneratingInlineAi(false);
      toast.error("AI generation timed out. Try a shorter prompt or check provider settings.");
    }, 30000);
  }, [clearInlineStartFallbackTimeout, clearInlineStreamTimeout, setSql]);

  // AI: inline SQL generation from natural language prompt (streaming)
  const handleGenerateSqlInline = useCallback(async () => {
    const prompt = inlineAiPrompt.trim();
    if (!prompt) return;
    const aiInline = window.electron?.aiInline;
    if (!aiInline) {
      toast.error("AI inline generation is not available");
      return;
    }
    if (isGeneratingInlineAi) return;

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
      requestId,
      dbType,
      prompt,
      sql: sqlSeed,
      schemaContext,
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
    if (!isInlineAiPromptOpen) return;
    const frame = requestAnimationFrame(() => {
      inlineAiInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [isInlineAiPromptOpen]);

  useEffect(() => {
    const aiInline = window.electron?.aiInline;
    if (!aiInline) return;

    const unsubChunk = aiInline.onChunk((chunk: AiInlineChunk) => {
      if (chunk.requestId !== inlineStreamRequestIdRef.current) return;
      clearInlineStartFallbackTimeout();
      scheduleInlineStreamTimeout();
      inlineStreamTextRef.current += chunk.text;
      setSql(inlineStreamTextRef.current);
    });

    const unsubDone = aiInline.onDone(({ requestId }) => {
      if (requestId !== inlineStreamRequestIdRef.current) return;
      clearInlineStartFallbackTimeout();
      clearInlineStreamTimeout();
      inlineStreamRequestIdRef.current = null;
      setIsGeneratingInlineAi(false);
      setIsInlineAiPromptOpen(false);
      setInlineAiPrompt("");
      toast.success("SQL generated with AI");
    });

    const unsubError = aiInline.onError(({ requestId, message }) => {
      if (requestId !== inlineStreamRequestIdRef.current) return;
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

  // ── EXPLAIN Query (cached via queryClient.fetchQuery) ────────────
  // Repeated Ctrl+E on the same query returns cached result within 5min staleTime,
  // avoiding redundant round-trips to the database.
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
      // Use fetchQuery to leverage cache — same EXPLAIN SQL within 5min = instant
      const result = await explainQueryClient.fetchQuery({
        queryKey: ["explain", selectedConnection, explainSql],
        queryFn: () => executeQuery(selectedConnection, explainSql),
        staleTime: 5 * 60_000,
      });
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
  }, [selectedConnection, doc.sql, dbType, isExecuting, executeQuery, explainQueryClient]);

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

  const setTitle = useCallback(
    (title: string) => {
      updateTab(activeTabIdRef.current, (tab) => ({
        ...tab,
        doc: { ...tab.doc, title, updatedAt: nowIso() },
      }));
    },
    [updateTab],
  );

  const hydrateFromSaved = useCallback(
    (query: SqlSavedQuery) => {
      const tabId = activeTabIdRef.current;
      updateTab(tabId, () => ({
        id: tabId,
        doc: {
          id: query.id,
          title: query.title,
          sql: query.sql,
          updatedAt: query.updatedAt,
        },
        lastSavedSql: query.sql,
      }));
      if (query.connectionId !== selectedConnection) {
        onSelectConnection(query.connectionId);
      }
    },
    [onSelectConnection, selectedConnection, updateTab],
  );

  const hydrateFromHistory = useCallback(
    (entry: SqlHistoryEntry) => {
      const tabId = activeTabIdRef.current;
      updateTab(tabId, () => ({
        id: tabId,
        doc: {
          id: null,
          title: "Untitled",
          sql: entry.executedSql,
          updatedAt: nowIso(),
        },
        lastSavedSql: entry.executedSql,
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
    const currentDoc = (tabsRef.current.find((t) => t.id === activeTabIdRef.current) ?? tabsRef.current[0])?.doc;
    if (!currentDoc) return;

    const persisted = await saveQuery({
      id: currentDoc.id ?? undefined,
      title: currentDoc.title.trim() || "Untitled",
      sql: currentDoc.sql,
      connectionId: selectedConnection,
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
        if (controller.signal.aborted) return;
        const statement = statements[index];
        const runStart = performance.now();

        try {
          const result = await executeQuery(selectedConnection, statement, currentRequestId);
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
      activeRequestIdRef.current = null;
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

    const syncSelectedSql = () => {
      const selection = mounted.getSelection();
      const model = mounted.getModel();
      if (!selection || !model) {
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
        if (rafId !== null) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          rafId = null;
          mounted.layout();
        });
      });
      observer.observe(container);
      monacoResizeObserverRef.current = observer;
    }

    monacoSelectionListenerRef.current?.dispose();
    monacoSelectionListenerRef.current = mounted.onDidChangeCursorSelection(() => {
      syncSelectedSql();
    });
    monacoContentListenerRef.current?.dispose();
    monacoContentListenerRef.current = mounted.onDidChangeModelContent(() => {
      syncSelectedSql();
    });

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

      if (event.key.toLowerCase() === "t") {
        event.preventDefault();
        addTab();
      }

      if (event.key.toLowerCase() === "w") {
        event.preventDefault();
        closeTab(activeTabIdRef.current);
      }

      const digit = parseInt(event.key, 10);
      if (digit >= 1 && digit <= 9) {
        const target = tabsRef.current[digit - 1];
        if (target) {
          event.preventDefault();
          setActiveTabId(target.id);
        }
      }
    },
    [runSql, saveCurrentQuery, addTab, closeTab],
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
                  <UiIcon name="file-code-2" className="size-3.5 text-muted-foreground" />
                  <span className="text-xs font-semibold tracking-tight text-foreground">Workspace</span>
                  {isExecuting ? (
                    <UiIcon name="loader" className="size-3 animate-spin text-muted-foreground" />
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
                <UiIcon name="search" className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground pointer-events-none" />
                <Input
                  ref={searchInputRef}
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  placeholder={activeSidebarTab === "items" ? "Filter items..." : "Filter queries..."}
                  className="h-7 pl-7 pr-7 text-xs bg-muted/40 border-dashed focus:bg-background focus:border-solid"
                />
                {searchText && (
                  <button
                    type="button"
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => setSearchText("")}
                  >
                    <UiIcon name="x" className="size-3" />
                  </button>
                )}
              </div>
            </div>

            {/* Tabs */}
            <Tabs
              value={activeSidebarTab}
              onValueChange={(value) =>
                setActiveSidebarTab(value as "saved" | "history" | "items")
              }
              className="flex-1 min-h-0 flex flex-col"
            >
              <TabsList variant="line" className="mx-3 shrink-0">
                <TabsTrigger value="items" className="gap-1.5 text-xs">
                  <UiIcon name="layout-grid" className="size-3" />
                  Items
                </TabsTrigger>
                <TabsTrigger value="saved" className="gap-1.5 text-xs">
                  <UiIcon name="star" className="size-3" />
                  Saved
                </TabsTrigger>
                <TabsTrigger value="history" className="gap-1.5 text-xs">
                  <UiIcon name="clock" className="size-3" />
                  History
                </TabsTrigger>
              </TabsList>

              {/* Items */}
              <TabsContent value="items" className="min-h-0 flex flex-col flex-1">
                <ScrollArea className="flex-1 min-h-0">
                  <div className="px-2 py-1.5">
                    {filteredItemsTree.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
                        <UiIcon name="layout-grid" className="size-4 text-muted-foreground/50 mb-2" />
                        <p className="text-xs text-muted-foreground">
                          {searchText ? "No matches found" : "No items available"}
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-0.5">
                        {filteredItemsTree.map((schema) => {
                          const isSchemaExpanded = expandedSchemas[schema.name] ?? true;
                          return (
                            <div key={schema.name} className="rounded-md">
                              <button
                                type="button"
                                className="group w-full flex items-center gap-2 px-2.5 py-[7px] rounded-md text-left hover:bg-muted/50 transition-colors"
                                onClick={() => toggleSchemaExpanded(schema.name)}
                              >
                                <UiIcon
                                  name="chevron-right"
                                  className={cn(
                                    "size-3 text-muted-foreground transition-transform",
                                    isSchemaExpanded && "rotate-90",
                                  )}
                                />
                                <UiIcon name="database" className="size-3.5 text-muted-foreground" />
                                <span className="flex-1 truncate text-[13px] font-medium leading-tight">
                                  {schema.name}
                                </span>
                                <span className="text-[10px] text-muted-foreground tabular-nums">
                                  {schema.tables.length}
                                </span>
                              </button>

                              {isSchemaExpanded && (
                                <div className="ml-4 mt-0.5 space-y-0.5">
                                  {schema.tables.map((table) => {
                                    const tableKey = `${schema.name}.${table.name}`;
                                    const isTableExpanded = expandedTables[tableKey] ?? true;
                                    return (
                                      <div key={tableKey} className="rounded-md">
                                        <div className="flex items-center gap-1">
                                          <button
                                            type="button"
                                            className="group w-full flex items-center gap-2 px-2.5 py-[6px] rounded-md text-left hover:bg-muted/40 transition-colors"
                                            onClick={() => toggleTableExpanded(tableKey)}
                                          >
                                            <UiIcon
                                              name="chevron-right"
                                              className={cn(
                                                "size-3 text-muted-foreground transition-transform",
                                                isTableExpanded && "rotate-90",
                                              )}
                                            />
                                            <UiIcon name="table" className="size-3.5 text-muted-foreground" />
                                            <span className="flex-1 truncate text-[12px] font-medium">
                                              {table.name}
                                            </span>
                                            <span className="text-[10px] text-muted-foreground tabular-nums">
                                              {table.columns.length}
                                            </span>
                                          </button>
                                          <Button
                                            variant="ghost"
                                            size="icon-xs"
                                            className="mr-1 text-muted-foreground hover:text-foreground"
                                            onClick={() => handleInsertTableFromItems(schema.name, table.name)}
                                            draggable
                                            onDragStart={(event) => {
                                              event.dataTransfer.setData("text/sql-table-ref", `${schema.name}.${table.name}`);
                                              event.dataTransfer.effectAllowed = "copy";
                                            }}
                                          >
                                            <UiIcon name="plus" className="size-3" />
                                          </Button>
                                        </div>

                                        {isTableExpanded && (
                                          <div className="ml-6 space-y-0.5">
                                            {table.columns.map((column) => (
                                              <button
                                                key={`${tableKey}.${column.name}`}
                                                type="button"
                                                className={cn(
                                                  "group w-full flex items-center gap-2 px-2.5 py-[5px] rounded-md text-left transition-colors",
                                                  selectedColumns.includes(makeQualifiedColumnRef(schema.name, table.name, column.name))
                                                    ? "bg-accent text-accent-foreground"
                                                    : "hover:bg-muted/30",
                                                )}
                                                onClick={(event) => {
                                                  const qualified = makeQualifiedColumnRef(schema.name, table.name, column.name);
                                                  if (event.shiftKey && lastSelectedColumn) {
                                                    selectRangeInTable(schema.name, table.name, table.columns, lastSelectedColumn, qualified);
                                                    return;
                                                  }
                                                  if (event.metaKey || event.ctrlKey) {
                                                    toggleColumnSelection(qualified);
                                                    return;
                                                  }
                                                  setSelectedColumns([qualified]);
                                                  setLastSelectedColumn(qualified);
                                                }}
                                                draggable
                                                onDragStart={(event) => {
                                                  const qualified = makeQualifiedColumnRef(schema.name, table.name, column.name);
                                                  const fromSameTable = selectedColumns.filter((selected) =>
                                                    selected.startsWith(`${schema.name}.${table.name}.`),
                                                  );
                                                  const dragColumns = fromSameTable.includes(qualified)
                                                    ? fromSameTable
                                                    : [qualified];
                                                  event.dataTransfer.setData("text/sql-column-ref", dragColumns[0] ?? qualified);
                                                  event.dataTransfer.setData("text/sql-column-refs", JSON.stringify(dragColumns));
                                                  event.dataTransfer.setData("text/plain", dragColumns.join(", "));
                                                  event.dataTransfer.effectAllowed = "copy";
                                                  setMultiItemDragPreview(event, dragColumns);
                                                }}
                                              >
                                                <UiIcon name="key" className="size-3 text-muted-foreground/70" />
                                                <span className="flex-1 truncate text-[11px] font-mono">
                                                  {column.name}
                                                </span>
                                                <span className="truncate text-[10px] text-muted-foreground/70 max-w-24">
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
                                    <UiIcon name="pencil" className="size-3" />
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
                                    <UiIcon name="trash" className="size-3" />
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
                        <UiIcon name="star" className="size-4 text-muted-foreground/50 mb-2" />
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
                        <UiIcon name="clock" className="size-4 text-muted-foreground/50 mb-2" />
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
          <div className="h-full min-w-0 flex flex-col">
          {/* ── Tab bar ────────────────────────────────────────── */}
          <div className="flex items-end h-[34px] border-b border-border/60 bg-background shrink-0 pl-1">
            <div className="flex items-end overflow-x-auto flex-1 min-w-0 scrollbar-none">
              {tabs.map((tab) => {
                const isActive = tab.id === activeTabId;
                const isDirty = tab.doc.sql !== tab.lastSavedSql;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    className={cn(
                      "group/tab relative flex items-center gap-1.5 px-3 h-[30px] rounded-t-[6px] text-[12px] leading-none whitespace-nowrap select-none",
                      tabs.length > 1 && "pr-7",
                      "transition-colors duration-150",
                      isActive
                        ? "bg-muted/50 text-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/30",
                      "[@media(hover:hover)and(pointer:fine)]:active:scale-[0.98] [@media(hover:hover)and(pointer:fine)]:active:transition-transform [@media(hover:hover)and(pointer:fine)]:active:duration-100",
                    )}
                    onClick={() => setActiveTabId(tab.id)}
                  >
                    {isActive && (
                      <span className="absolute inset-x-0 -bottom-[1px] h-[2px] bg-foreground rounded-full" />
                    )}
                    <UiIcon
                      name="file-code-2"
                      className={cn(
                        "size-[13px] shrink-0",
                        isActive ? "text-foreground/70" : "text-muted-foreground/60",
                      )}
                    />
                    <span className="truncate max-w-[140px]">{tab.doc.title}</span>
                    {isDirty && (
                      <span
                        className={cn(
                          "size-[5px] rounded-full shrink-0",
                          isActive ? "bg-foreground/60" : "bg-muted-foreground/50",
                        )}
                      />
                    )}
                    {tabs.length > 1 && (
                      <span
                        role="button"
                        tabIndex={-1}
                        className={cn(
                          "absolute right-1 top-1/2 -translate-y-1/2 rounded-[3px] p-[2px]",
                          "opacity-0 group-hover/tab:opacity-100 transition-opacity duration-100",
                          "hover:bg-muted-foreground/15 hover:text-destructive",
                        )}
                        onClick={(e) => {
                          e.stopPropagation();
                          closeTab(tab.id);
                        }}
                      >
                        <UiIcon name="x" className="size-[11px]" />
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
                    variant="ghost"
                    size="icon-xs"
                    className="mx-1 mb-[5px] shrink-0 text-muted-foreground/60 hover:text-foreground"
                    onClick={() => addTab()}
                  >
                    <UiIcon name="plus" className="size-3.5" />
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

          {/* ── Editor toolbar (single row) ──────────────────── */}
          <div className="flex items-center gap-2 border-b border-border/50 px-3 h-9">
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
                    <UiIcon name="device-floppy" className="size-3" />
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
                        <UiIcon name="loader" className="size-3 animate-spin" />
                      ) : (
                        <UiIcon name="sparkles" className="size-3" />
                      )}
                      Fix SQL
                    </Button>
                  }
                />
                <TooltipContent>Fix SQL with AI</TooltipContent>
              </Tooltip>
            )}

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
                      // Also cancel on the server side
                      if (activeRequestIdRef.current) {
                        cancelQuery(activeRequestIdRef.current);
                      }
                    }}
                  >
                    Cancel
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
                        <UiIcon name="loader" className="size-3.5 animate-spin" />
                      ) : (
                        <UiIcon name="play" className="size-3.5" />
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
                className="h-full min-h-0 relative"
                onDragOver={(e) => {
                  const supportsTable = e.dataTransfer?.types.includes("text/sql-table-ref");
                  const supportsColumn = e.dataTransfer?.types.includes("text/sql-column-ref");
                  const supportsColumns = e.dataTransfer?.types.includes("text/sql-column-refs");
                  if (supportsTable || supportsColumn || supportsColumns) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "copy";
                  }
                }}
                onDrop={(e) => {
                  const columnRefsRaw = e.dataTransfer?.getData("text/sql-column-refs");
                  if (columnRefsRaw) {
                    try {
                      const columnRefs = JSON.parse(columnRefsRaw) as string[];
                      const normalized = normalizeColumnRefs(columnRefs);
                      if (normalized.length > 0) {
                        e.preventDefault();
                        const editorInstance = editorRef.current;
                        const selection = editorInstance?.getSelection();
                        const hasExplicitSelection = Boolean(
                          selection &&
                          (selection.startLineNumber !== selection.endLineNumber ||
                            selection.startColumn !== selection.endColumn),
                        );
                        const refs = normalized.map((item) => item.qualified);

                        if (!hasExplicitSelection && editorInstance?.getModel() && editorInstance.getPosition()) {
                          const model = editorInstance.getModel();
                          const offset = model.getOffsetAt(editorInstance.getPosition());
                          const statement = getStatementRangeAtOffset(model.getValue(), offset);
                          if (statement) {
                            const merged = mergeDroppedColumnsIntoStatement(
                              statement.text,
                              refs,
                              schemaCompletionData,
                            );
                            if (merged.merged && replaceStatementAtCursor(merged.sql)) {
                              return;
                            }
                          }
                        }

                        const sql = buildSmartSqlFromColumnRefs(refs, schemaCompletionData);
                        if (sql) {
                          if (!hasExplicitSelection && insertSqlBelowStatementAtCursor(sql)) {
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

                  const columnRef = e.dataTransfer?.getData("text/sql-column-ref")?.trim();
                  if (columnRef) {
                    e.preventDefault();
                    insertIntoEditor(columnRef);
                    return;
                  }

                  const tableRef = e.dataTransfer?.getData("text/sql-table-ref");
                  if (tableRef) {
                    e.preventDefault();
                    const dot = tableRef.indexOf(".");
                    if (dot > 0) {
                      const schema = tableRef.slice(0, dot);
                      const table = tableRef.slice(dot + 1);
                      insertIntoEditor(makeTableSelectSql(schema, table));
                      return;
                    }
                    insertIntoEditor(`SELECT *\nFROM ${tableRef}\nLIMIT 100;`);
                  }
                }}
              >
              <LazyMonacoEditor
                key={activeTabId}
                height="100%"
                defaultLanguage="sql"
                value={doc.sql}
                onMount={handleEditorMount}
                onChange={(value: string | undefined) => setSql(value || "")}
                theme={monacoTheme}
                options={MONACO_OPTIONS}
              />

              {isEditorEmpty && !isInlineAiPromptOpen && (
                <div className="pointer-events-none absolute left-[70px] top-[12px] z-10 font-mono text-sm leading-5 text-muted-foreground/40">
                  <span className="pointer-events-auto">
                    Type SQL or{" "}
                    <button
                      type="button"
                      onClick={() => setIsInlineAiPromptOpen(true)}
                      className="font-medium text-primary/60 hover:text-primary hover:underline"
                    >
                      Generate with AI...
                    </button>
                  </span>
                </div>
              )}

              {isInlineAiPromptOpen && (
                <div className="absolute left-[44px] top-[34px] z-20 w-[min(560px,calc(100%-56px))] rounded-lg border border-border/60 bg-background/95 px-2.5 py-2 shadow-lg backdrop-blur-sm">
                  {isGeneratingInlineAi ? (
                    <div className="flex items-center gap-2 px-3 py-2">
                      <UiIcon name="loader" className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
                      <span className="flex-1 truncate text-xs text-muted-foreground">
                        Generating…
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => {
                          if (!inlineStreamRequestIdRef.current) return;
                          window.electron?.aiInline?.abort(inlineStreamRequestIdRef.current);
                          inlineStreamRequestIdRef.current = null;
                          clearInlineStartFallbackTimeout();
                          clearInlineStreamTimeout();
                          setIsGeneratingInlineAi(false);
                          setSql(inlinePreviousSqlRef.current);
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <Input
                        ref={inlineAiInputRef}
                        value={inlineAiPrompt}
                        onChange={(e) => setInlineAiPrompt(e.target.value)}
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
                        className="h-7 flex-1 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => void handleGenerateSqlInline()}
                        disabled={!inlineAiPrompt.trim()}
                      >
                        <UiIcon name="arrow-right-circle" className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => {
                          setIsInlineAiPromptOpen(false);
                          setInlineAiPrompt("");
                        }}
                      >
                        <UiIcon name="x" className="size-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
              )}
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
      </ResizablePanelGroup>
    </section>
  );
}
