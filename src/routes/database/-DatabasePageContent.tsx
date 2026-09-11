import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { AnimatePresence } from "motion/react";
import type { Size } from "motion-panels/react";
import {
  Suspense,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/Icon";
import {
  Panel,
  PanelGroup,
  PanelSeparator,
} from "@/components/ui/motion-panels";
import { isAiConfigured } from "@/features/ai/hooks/ai-actions";
import { useConnectionsList } from "@/features/connection";
import {
  DatabaseNavSidebar,
  DatabaseOverview,
  TableDataEditor,
  TablesExplorerSidebar,
} from "@/features/database";
import {
  makeTableInsertTemplateSql,
  makeTableRef,
  makeTableSelectSql,
  makeTableUpdateTemplateSql,
} from "@/features/database/components/SqlEditor/utils/itemsUtils";
import type { TableDataEditorHandle } from "@/features/database/components/TableDataEditor/types";
import {
  addColumn,
  alterColumnType,
  createIndex,
  createSchema,
  createTable,
  dropColumn,
  dropTable,
  executeQuery,
  getTableDetails,
  renameColumn,
  renameTable,
  setColumnDefault,
  setColumnNullable,
  tableFkLookup,
  tableListRows,
  tableSaveChanges,
  tableTruncate,
  testConnection,
} from "@/features/database/hooks/db-actions";
import { useSmartTableSearch } from "@/features/database/hooks/useSmartTableSearch";
import { useLocalDatabases } from "@/features/localDb";
import { setUnsavedChanges as setWindowUnsavedChanges } from "@/features/shell/actions/window";
import type {
  SchemaPolicy,
  SchemaTableDetails,
  SchemaTableSummary,
} from "@/ipc/db/types";
import { getClickhouseEffectivePort } from "@/ipc/db/types";
import { dbQueryKeys, dbQueryOptions } from "@/lib/query-options";
import { useAiChatGlobalStore } from "@/lib/stores/ai-chat-global";
import {
  buildConnectionTab,
  type ConnectionTabChrome,
  detectConnectionProvider,
  type SidebarSection,
  useConnectionTabsStore,
} from "@/lib/stores/connection-tabs";
import {
  buildTableEditorTab,
  useTableEditorTabsStore,
} from "@/lib/stores/table-editor-tabs";
import {
  percentageToPixels,
  usePersistedPanelSize,
} from "@/lib/use-persisted-panel-size";
import { cn } from "@/lib/utils";
import {
  AddColumnDialog,
  AlterColumnTypeDialog,
  CreateIndexDialog,
  CreateSchemaDialog,
  CreateTableDialog,
  DefinitionsBrowserPanel,
  DropColumnDialog,
  DropTableDialog,
  ExportDataDialog,
  ImportCsvDialog,
  RenameColumnDialog,
  RenameTableDialog,
  RlsPoliciesDialog,
  SchemaExportDialog,
  SchemaVisualizer,
  SeedDataDialog,
  SetColumnDefaultDialog,
  SetColumnNullableDialog,
  SqlEditor,
  ViewDdlDialog,
} from "./-lazyComponents";

const SECTION_SHORTCUTS: Record<string, SidebarSection> = {
  "1": "overview",
  "2": "tables",
  "3": "sql-editor",
  "4": "visualizer",
  "5": "definitions",
};

interface DatabasePageContentProps {
  connectionId: string;
  isActive?: boolean;
}

export function DatabasePageContent({
  connectionId,
  isActive = true,
}: DatabasePageContentProps) {
  const navigate = useNavigate();
  const { connections, refetch } = useConnectionsList();
  const {
    start: startLocalDb,
    pause: pauseLocalDb,
    databases: localDatabases,
    isLoading: isLoadingLocalDatabases,
    invalidateCache,
  } = useLocalDatabases();
  const { setTabNavState, updateTab, tabs } = useConnectionTabsStore();

  const storedTab = tabs.find((t) => t.id === connectionId);
  const [activeSection, setActiveSection] = useState<SidebarSection>(
    storedTab?.lastSection ?? "overview"
  );
  const [selectedSchema, setSelectedSchema] = useState<string>(
    storedTab?.lastSchema ?? "public"
  );
  const {
    openTab,
    activateTab,
    closeTab,
    closeOthers,
    closeAll,
    replaceTabKey,
    removeMissingTabs,
    byConnectionId: tableTabsByConnectionId,
  } = useTableEditorTabsStore();
  const tableTabsState = tableTabsByConnectionId[connectionId] ?? {
    openTabs: [],
    activeTabKey: null,
  };
  const openTableTabs = tableTabsState.openTabs;
  const selectedTableKey = tableTabsState.activeTabKey;
  const [tabDirtyState, setTabDirtyState] = useState<Record<string, boolean>>(
    {}
  );
  const [pendingCloseTabKey, setPendingCloseTabKey] = useState<string | null>(
    null
  );
  const [isClosingTabWithSave, setIsClosingTabWithSave] = useState(false);
  const [isSavingAllTabs, setIsSavingAllTabs] = useState(false);
  const editorRef = useRef<TableDataEditorHandle | null>(null);

  // Schema data via React Query — centralized queryOptions factory.
  const {
    data: schemaSummaryData,
    isLoading: isLoadingSchema,
    isError: isSchemaError,
    error: schemaError,
    refetch: refetchSchema,
  } = useQuery(dbQueryOptions.schemaSummary(connectionId, isActive));

  const schemas = schemaSummaryData?.schemas ?? [];
  const tables = schemaSummaryData?.tables ?? [];
  const [initialSqlQuery, setInitialSqlQuery] = useState<string | null>(null);
  const [sqlInsertRequest, setSqlInsertRequest] = useState<null | {
    key: string;
    text: string;
  }>(null);
  const [tableSearch, setTableSearch] = useState("");
  const [aiSearchEnabled, setAiSearchEnabled] = useState(false);

  useEffect(() => {
    if (!isActive || tables.length === 0) {
      return;
    }
    const existingKeys = new Set(tables.map((t) => `${t.schema}.${t.name}`));
    const removed = removeMissingTabs(connectionId, existingKeys);
    if (removed.length > 0) {
      setTabDirtyState((prev) => {
        const next = { ...prev };
        for (const key of removed) {
          delete next[key];
        }
        return next;
      });
      toast.info(
        "Some table tabs were closed because the tables no longer exist."
      );
    }
  }, [connectionId, isActive, removeMissingTabs, tables]);

  // Check if AI is configured on mount
  useEffect(() => {
    let cancelled = false;
    void isAiConfigured().then((configured) => {
      if (!cancelled) {
        setAiSearchEnabled(configured);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const isSidebarVisible = true;
  const [isNavVisible, setIsNavVisible] = useState(true);
  const [tablesSidebarWidthPx, setTablesSidebarWidthPx] = useState(280);
  const [sqlSidebarWidthPx, setSqlSidebarWidthPx] = useState(280);
  const tabWidthUpdateTimeoutRef = useRef<
    ReturnType<typeof setTimeout> | undefined
  >(undefined);

  // The tables sidebar keeps its size per connection. motion-panels reports a new
  // size once a drag or key press lands, so there is nothing to debounce.
  const [tablesSidebarSize, setTablesSidebarSize] = usePersistedPanelSize(
    `db-tables-layout-${connectionId}`,
    "25%",
    "tables-sidebar"
  );
  // Measured so the sidebar's percentage size can be reported to the tab chrome in pixels.
  const tablesGroupRef = useRef<HTMLDivElement>(null);

  const handleBackToConnections = useCallback(() => {
    setIsNavVisible(false);
    window.setTimeout(() => {
      navigate({ to: "/" });
    }, 180);
  }, [navigate]);

  // Clean up animation timeout on unmount
  useEffect(
    () => () => {
      if (tabWidthUpdateTimeoutRef.current) {
        clearTimeout(tabWidthUpdateTimeoutRef.current);
      }
    },
    []
  );

  // Reported to the tab chrome once a drag lands, never per pixel.
  const handleTablesSidebarResize = useCallback(
    (next: Size) => {
      setTablesSidebarSize(next);
      const width = tablesGroupRef.current?.clientWidth ?? 0;
      if (width > 0) {
        setTablesSidebarWidthPx(percentageToPixels(next, width));
      }
    },
    [setTablesSidebarSize]
  );

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<null | "copied" | "failed">(
    null
  );
  const [isTogglingLocalDb, setIsTogglingLocalDb] = useState(false);
  // connection must be defined BEFORE localDbStatus since it references connection?.is_local
  const connection = useMemo(
    () => connections.find((c) => c.id === connectionId),
    [connections, connectionId]
  );
  // Use shared cache data for local db status — stays in sync across all tabs
  const localDbStatus = useMemo(
    () =>
      connection?.is_local
        ? (localDatabases.find((db) => db.id === connectionId) ?? null)
        : null,
    [localDatabases, connectionId, connection?.is_local]
  );
  // Use shared cache loading state so loading indicator works during refetch
  const isLoadingLocalDbStatus = isLoadingLocalDatabases;
  const [copyConnFeedback, setCopyConnFeedback] = useState<
    null | "copied" | "failed"
  >(null);
  const [isCreateTableOpen, setIsCreateTableOpen] = useState(false);
  const [isCreateSchemaOpen, setIsCreateSchemaOpen] = useState(false);
  const [isCreateIndexOpen, setIsCreateIndexOpen] = useState(false);
  const [isImportCsvOpen, setIsImportCsvOpen] = useState(false);
  const [isSeedDataOpen, setIsSeedDataOpen] = useState(false);
  const [isExportDataOpen, setIsExportDataOpen] = useState(false);
  const [ddlDropTarget, setDdlDropTarget] = useState<{
    schema: string;
    name: string;
  } | null>(null);
  const [ddlRenameTarget, setDdlRenameTarget] = useState<{
    schema: string;
    name: string;
  } | null>(null);
  const [ddlAddColumnTarget, setDdlAddColumnTarget] = useState<{
    schema: string;
    name: string;
  } | null>(null);
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
  const [rlsPoliciesTarget, setRlsPoliciesTarget] = useState<{
    schema: string;
    name: string;
  } | null>(null);
  const [ddlViewTarget, setDdlViewTarget] = useState<{
    schema: string;
    name: string;
  } | null>(null);
  const [schemaExportTarget, setSchemaExportTarget] = useState<{
    schema: string;
    name: string;
  } | null>(null);
  const [rlsPolicies, setRlsPolicies] = useState<SchemaPolicy[]>([]);
  const [_isLoadingRlsPolicies, setIsLoadingRlsPolicies] = useState(false);
  const queryClient = useQueryClient();

  // Section flags - definidas antes de serem usadas
  const isTablesSection = activeSection === "tables";
  const isSqlEditorSection = activeSection === "sql-editor";
  const isOverviewSection = activeSection === "overview";
  const isVisualizerSection = activeSection === "visualizer";
  const isDefinitionsSection = activeSection === "definitions";

  const {
    data: databaseInfo = null,
    isFetching: isLoadingDatabaseInfo,
    refetch: refetchDatabaseInfo,
  } = useQuery({
    ...dbQueryOptions.databaseInfo(connectionId),
    enabled: isActive && isOverviewSection,
    placeholderData: keepPreviousData,
  });

  const tabChrome = useMemo<ConnectionTabChrome | undefined>(() => {
    if (isTablesSection && isSidebarVisible) {
      return "tables-sidebar";
    }
    if (isSqlEditorSection) {
      return "sql-sidebar";
    }
  }, [isTablesSection, isSidebarVisible, isSqlEditorSection]);
  const tabChromeWidthPx = useMemo(() => {
    if (isTablesSection && isSidebarVisible) {
      return tablesSidebarWidthPx;
    }
    if (isSqlEditorSection) {
      return sqlSidebarWidthPx;
    }
    return 0;
  }, [
    isTablesSection,
    isSidebarVisible,
    tablesSidebarWidthPx,
    isSqlEditorSection,
    sqlSidebarWidthPx,
  ]);

  const connectionProvider = useMemo(
    () => (connection ? detectConnectionProvider(connection) : undefined),
    [connection]
  );

  // Ensure a tab exists for this connection (handles page refresh / direct URL)
  // This is synchronizing with an external store (zustand) — a valid use of Effect.
  useEffect(() => {
    if (!connection) {
      return;
    }
    const store = useConnectionTabsStore.getState();
    if (!store.tabs.some((t) => t.id === connectionId)) {
      store.addTab(buildConnectionTab(connection));
    } else if (store.activeTabId !== connectionId) {
      store.setActiveTab(connectionId);
    }
  }, [connection, connectionId]);

  // Auto-select first schema when schemas load and none is selected,
  // or when the stored/default schema doesn't exist in the current connection
  // (e.g. stored "public" but MySQL returns ["mydb"]).
  useEffect(() => {
    if (schemas.length === 0) {
      return;
    }
    const storedSchema = storedTab?.lastSchema;
    const isStoredSchemaValid = storedSchema && schemas.includes(storedSchema);
    const defaultSchema =
      storedSchema && isStoredSchemaValid
        ? storedSchema
        : schemas.includes("public")
          ? "public"
          : schemas[0];
    if (selectedSchema !== defaultSchema) {
      setSelectedSchema(defaultSchema);
    }
  }, [schemas, storedTab?.lastSchema, selectedSchema]);

  const isLoading = isLoadingSchema;

  useEffect(() => {
    updateTab(connectionId, { chrome: tabChrome });
  }, [connectionId, tabChrome, updateTab]);

  useEffect(() => {
    if (tabWidthUpdateTimeoutRef.current) {
      clearTimeout(tabWidthUpdateTimeoutRef.current);
    }
    tabWidthUpdateTimeoutRef.current = setTimeout(() => {
      updateTab(connectionId, { chromeWidthPx: tabChromeWidthPx });
    }, 120);
    return () => {
      if (tabWidthUpdateTimeoutRef.current) {
        clearTimeout(tabWidthUpdateTimeoutRef.current);
      }
    };
  }, [connectionId, tabChromeWidthPx, updateTab]);

  // Load local db status immediately on mount and when tab becomes active
  // The status is now derived from the shared cache (localDatabases) so it
  // stays in sync across all tabs automatically.

  // Helpers: update state AND persist to store in the same event handler
  // (instead of separate Effects that watch these values — anti-pattern per React docs)
  // Fetch table details (with columns) for the selected schema.
  // Used by both the schema visualizer AND the AI context builder.
  // Always enabled when the tab is active so the AI has column info from
  // the start. React Query caches this for 5 minutes so switching to
  // the visualizer is instant.
  const selectedSchemaDetailsQueryKey = useMemo(
    () =>
      dbQueryKeys.selectedSchemaDetails(
        connectionId,
        selectedSchema,
        tables.length
      ),
    [connectionId, selectedSchema, tables.length]
  );

  const {
    data: selectedSchemaDetails = [],
    isLoading: isLoadingSchemaDetails,
  } = useQuery({
    queryKey: selectedSchemaDetailsQueryKey,
    queryFn: async () => {
      const schemaTables = tables
        .filter((t) => t.schema === selectedSchema)
        .slice(0, 50); // Cap at 50 tables to avoid excessive IPC on large databases
      const details = await Promise.all(
        schemaTables.map((t) => getTableDetails(connectionId, t.schema, t.name))
      );
      return details;
    },
    // Only load schema details when visualizer or SQL editor needs them — not on mount.
    enabled:
      isActive &&
      tables.length > 0 &&
      selectedSchema.length > 0 &&
      (activeSection === "visualizer" || activeSection === "sql-editor"),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  // Alias for the visualizer — same data, clearer name in that context
  const visualizerTables = selectedSchemaDetails;
  const isLoadingVisualizer = isLoadingSchemaDetails;

  // Prefetch table details on hover (handled by prefetchTableDetails callback below).
  // The old useEffect that prefetched 10 tables on mount has been removed —
  // hover-based prefetch is more efficient and doesn't fire unnecessary IPC calls.

  const changeSection = useCallback(
    (section: SidebarSection) => {
      setActiveSection(section);
      setTabNavState(connectionId, {
        section,
        schema: selectedSchema,
        table: selectedTableKey ?? undefined,
      });
    },
    [connectionId, selectedSchema, selectedTableKey, setTabNavState]
  );

  const changeSchema = useCallback(
    (schema: string) => {
      setSelectedSchema(schema);
      setTabNavState(connectionId, {
        section: activeSection,
        schema,
        table: selectedTableKey ?? undefined,
      });
    },
    [connectionId, activeSection, selectedTableKey, setTabNavState]
  );

  const changeTable = useCallback(
    (tableKey: string | null) => {
      if (!tableKey) {
        activateTab(connectionId, null);
        setTabNavState(connectionId, {
          section: activeSection,
          schema: selectedSchema,
          table: undefined,
        });
        return;
      }

      const dotIdx = tableKey.indexOf(".");
      if (dotIdx <= 0 || dotIdx === tableKey.length - 1) {
        return;
      }
      const schema = tableKey.slice(0, dotIdx);
      const table = tableKey.slice(dotIdx + 1);

      // Mark table switch as non-urgent so click feedback is immediate.
      startTransition(() => {
        openTab(connectionId, buildTableEditorTab(schema, table));
      });
      setTabNavState(connectionId, {
        section: activeSection,
        schema: selectedSchema,
        table: tableKey ?? undefined,
      });
    },
    [
      connectionId,
      activeSection,
      selectedSchema,
      setTabNavState,
      activateTab,
      openTab,
    ]
  );

  useEffect(() => {
    if (!storedTab?.lastTable) {
      return;
    }
    if (openTableTabs.length > 0) {
      return;
    }
    const tableKey = storedTab.lastTable;
    const dotIdx = tableKey.indexOf(".");
    if (dotIdx <= 0 || dotIdx === tableKey.length - 1) {
      return;
    }
    openTab(
      connectionId,
      buildTableEditorTab(tableKey.slice(0, dotIdx), tableKey.slice(dotIdx + 1))
    );
  }, [connectionId, openTableTabs.length, openTab, storedTab?.lastTable]);

  useEffect(() => {
    const hasAnyDraft = Object.values(tabDirtyState).some(Boolean);
    const scope = `table-tabs:${connectionId}`;
    void setWindowUnsavedChanges(scope, hasAnyDraft);
    return () => {
      void setWindowUnsavedChanges(scope, false);
    };
  }, [connectionId, tabDirtyState]);

  const requestSqlInsert = useCallback(
    (text: string) => {
      setSqlInsertRequest({
        key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        text,
      });
      if (activeSection !== "sql-editor") {
        changeSection("sql-editor");
      }
    },
    [activeSection, changeSection]
  );

  const pendingChatInsert = useAiChatGlobalStore(
    (state) => state.pendingSqlInsert
  );
  const consumeSqlInsert = useAiChatGlobalStore(
    (state) => state.consumeSqlInsert
  );
  const setSqlContextForTable = useAiChatGlobalStore(
    (state) => state.setSqlContext
  );
  const clearSqlContextForTable = useAiChatGlobalStore(
    (state) => state.clearSqlContext
  );
  const tablesAiSourceIdRef = useRef<string>(
    `tables-${connectionId}-${Math.random().toString(36).slice(2)}`
  );

  useEffect(() => {
    if (!pendingChatInsert) {
      return;
    }
    consumeSqlInsert();
    requestSqlInsert(pendingChatInsert.text);
  }, [pendingChatInsert]);

  // Stable ref for keyboard handler — avoids re-registering the listener
  // when changeSection/activeSection/toggleSidebar change (rerender-optimization)
  const keyboardHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyboardHandlerRef.current = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT" ||
      (e.target as HTMLElement)?.isContentEditable
    ) {
      return;
    }
    const el = e.target as HTMLElement;
    if (el.closest(".monaco-editor, [data-monaco-editor], .cm-editor")) {
      return;
    }
    if (
      document.querySelector(
        "[data-radix-select-viewport], [data-radix-popper-content-wrapper]"
      )
    ) {
      return;
    }

    const section = SECTION_SHORTCUTS[e.key];
    if (section && section !== activeSection) {
      e.preventDefault();
      changeSection(section);
      return;
    }

    // Cmd+R / Ctrl+R: Refresh schema
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "r") {
      e.preventDefault();
      handleRefresh();
    }
  };

  // Keyboard shortcuts: 1–5 switch sidebar sections — effect only depends on isActive
  useEffect(() => {
    if (!isActive) {
      return;
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      keyboardHandlerRef.current(e);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isActive]);

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
    try {
      // refetch (connections list) and refetchSchema are independent — run in parallel
      await Promise.all([refetch(), refetchSchema()]);
      // Invalidate schema details cache so visualizer/AI gets fresh data
      queryClient.invalidateQueries({
        queryKey: dbQueryKeys.selectedSchemaDetailsPrefix(connectionId),
      });
      if (activeSection === "overview") {
        void refetchDatabaseInfo();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to refresh");
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleTestConnection = async () => {
    if (!connection) {
      return;
    }
    try {
      await testConnection(connection);
      toast.success("Connection test successful");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Connection test failed"
      );
    }
  };

  const handleStartLocalDb = async () => {
    if (!connectionId) {
      return;
    }
    setIsTogglingLocalDb(true);
    try {
      await startLocalDb(connectionId);
      invalidateCache(); // Refresh shared cache so all tabs see the update
      toast.success("Database started");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to start database"
      );
    } finally {
      setIsTogglingLocalDb(false);
    }
  };

  const handlePauseLocalDb = async () => {
    if (!connectionId) {
      return;
    }
    setIsTogglingLocalDb(true);
    try {
      await pauseLocalDb(connectionId);
      invalidateCache(); // Refresh shared cache so all tabs see the update
      toast.success("Database paused");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to pause database"
      );
    } finally {
      setIsTogglingLocalDb(false);
    }
  };

  const buildConnStr = useCallback(() => {
    if (!connection) {
      return "";
    }
    if (connection.url) {
      return connection.url;
    }
    const protocol =
      connection.db_type === "mysql" || connection.db_type === "mariadb"
        ? "mysql"
        : connection.db_type === "clickhouse"
          ? connection.ssl_mode === "require"
            ? "clickhouses"
            : "clickhouse"
          : "postgres";
    const port =
      connection.db_type === "clickhouse"
        ? getClickhouseEffectivePort(connection.ssl_mode, connection.port)
        : connection.port;
    const sslParam =
      protocol === "mysql"
        ? `ssl=${connection.ssl_mode === "disable" ? "false" : "true"}`
        : protocol.startsWith("clickhouse")
          ? connection.ssl_mode === "require"
            ? "ssl=true"
            : ""
          : `sslmode=${connection.ssl_mode}`;
    const queryPart = sslParam ? `?${sslParam}` : "";
    return `${protocol}://${connection.username}:${connection.password}@${connection.host}:${port}/${connection.database}${queryPart}`;
  }, [connection]);

  const buildMaskedConnStr = useCallback(() => {
    const raw = buildConnStr();
    if (!raw) {
      return raw;
    }

    try {
      const parsed = new URL(raw);
      if (parsed.password) {
        parsed.password = "****";
      }
      return parsed.toString();
    } catch {
      return raw.replace(/:[^:@/]+@/, ":****@");
    }
  }, [buildConnStr]);

  const handleCopyConnectionString = async () => {
    if (!connection) {
      return;
    }
    try {
      await navigator.clipboard.writeText(buildConnStr());
      setCopyConnFeedback("copied");
      setTimeout(() => setCopyConnFeedback(null), 2000);
    } catch {
      setCopyConnFeedback("failed");
      setTimeout(() => setCopyConnFeedback(null), 2000);
    }
  };

  const handleCopyConnection = async () => {
    if (!connection) {
      return;
    }
    try {
      await navigator.clipboard.writeText(buildConnStr());
      setCopyFeedback("copied");
      toast.success("Connection string copied");
    } catch {
      setCopyFeedback("failed");
      toast.error("Failed to copy");
    }
    setTimeout(() => setCopyFeedback(null), 2000);
  };

  const copyToClipboardWithToast = useCallback(
    async (text: string, successMessage: string) => {
      try {
        await navigator.clipboard.writeText(text);
        toast.success(successMessage);
      } catch {
        toast.error("Failed to copy");
      }
    },
    []
  );

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

  // Tables for the currently selected schema (input to smart search)
  const schemaTables = useMemo(() => {
    if (!selectedSchema) {
      return [];
    }
    const group = tablesBySchema.find(([s]) => s === selectedSchema);
    if (!group) {
      return [];
    }
    return group[1];
  }, [selectedSchema, tablesBySchema]);

  // Hybrid fuzzy + AI search
  const {
    filteredTables: filteredTablesForSchema,
    isAiSearching,
    aiMatchedNames,
  } = useSmartTableSearch(tableSearch, schemaTables, aiSearchEnabled);

  // Build a comprehensive schema context string for the AI assistant.
  // Includes table names, columns with types, primary keys, foreign keys,
  // and table relationships to help AI write accurate JOIN queries.
  const schemaContextForAi = useMemo(() => {
    if (tables.length === 0) {
      return;
    }

    const lines: string[] = [];

    // Header with database overview
    lines.push("Database Overview:");
    lines.push(`- Total schemas: ${schemas.length} (${schemas.join(", ")})`);
    lines.push(`- Total tables: ${tables.length}`);
    lines.push(`- Current schema: ${selectedSchema}`);
    lines.push("");

    // Build a lookup of table name → details for the selected schema
    const detailMap = new Map<string, SchemaTableDetails>();
    for (const d of selectedSchemaDetails) {
      detailMap.set(d.name, d);
    }

    // Collect all foreign key relationships across selected schema tables
    const relationships: string[] = [];

    for (const d of selectedSchemaDetails) {
      const tableKey = `${d.schema}.${d.name}`;

      // Extract foreign key relationships from the foreign_keys array
      for (const fk of d.foreign_keys) {
        relationships.push(
          `${tableKey}.${fk.column_name} → ${fk.referenced_schema ?? d.schema}.${fk.referenced_table}.${fk.referenced_column}`
        );
      }
    }

    // Add relationship section if we have any FKs
    if (relationships.length > 0) {
      lines.push("Known Foreign Key Relationships:");
      for (const rel of relationships.slice(0, 20)) {
        // Cap at 20 to avoid token overflow
        lines.push(`- ${rel}`);
      }
      lines.push("");
    }

    // Detailed schema information
    lines.push(`Schema Details (showing ${selectedSchema} in detail):`);
    lines.push("");

    for (const [schema, schemaTables] of tablesBySchema) {
      if (schema === selectedSchema && selectedSchemaDetails.length > 0) {
        // Selected schema: include detailed table structure
        for (const t of schemaTables) {
          const detail = detailMap.get(t.name);
          const tableKey = `${schema}.${t.name}`;

          if (detail) {
            // Table header with row count if available
            const rowCount =
              t.estimated_row_count > 0
                ? ` (~${t.estimated_row_count.toLocaleString()} rows)`
                : "";
            const hasRls = t.has_rls ? " [RLS enabled]" : "";
            lines.push(`${tableKey}${rowCount}${hasRls}`);

            // Build set of PK columns from indexes
            const pkColumns = new Set<string>();
            for (const idx of detail.indexes) {
              if (idx.is_primary) {
                for (const col of idx.column_names) {
                  pkColumns.add(col);
                }
              }
            }

            // Build map of FK columns
            const fkColumns = new Map<string, string>();
            for (const fk of detail.foreign_keys) {
              fkColumns.set(
                fk.column_name,
                `${fk.referenced_table}.${fk.referenced_column}`
              );
            }

            // Columns with PK/FK indicators
            const colLines: string[] = [];
            for (const c of detail.columns) {
              const pk = pkColumns.has(c.name) ? " [PK]" : "";
              const fk = fkColumns.get(c.name)
                ? ` → ${fkColumns.get(c.name)}`
                : "";
              const nullable = c.is_nullable ? "" : " [NOT NULL]";
              const defaultVal = c.column_default
                ? ` = ${c.column_default.slice(0, 30)}`
                : "";
              colLines.push(
                `  - ${c.name}: ${c.data_type}${nullable}${pk}${fk}${defaultVal}`
              );
            }
            lines.push(...colLines);
          } else {
            lines.push(`${tableKey} (details not loaded)`);
          }
          lines.push("");
        }
      } else {
        // Other schemas: table names only, grouped
        const tableNames = schemaTables.map((t) => t.name).join(", ");
        lines.push(`${schema}: ${tableNames}`);
        lines.push("");
      }
    }

    // Add helpful query patterns based on detected relationships
    if (relationships.length > 0) {
      lines.push("--");
      lines.push("Query Tips:");
      lines.push(
        "- Use JOIN clauses based on the Foreign Key relationships shown above"
      );
      lines.push("- Primary Keys (PK) are marked on columns");
      lines.push("- RLS = Row Level Security (PostgreSQL feature)");
      if (connection?.db_type === "postgresql") {
        lines.push("- For PostgreSQL: Use ILIKE for case-insensitive matching");
      }
    }

    return lines.join("\n");
  }, [
    tables,
    schemas,
    tablesBySchema,
    selectedSchema,
    selectedSchemaDetails,
    connection?.db_type,
  ]);

  // Schema completion data for Monaco autocomplete in SQL editor.
  // NOTE: Only the selected schema has column details loaded (via selectedSchemaDetails).
  // Tables in other schemas will have empty columns[] — they'll still show table names
  // in autocomplete but dot-completion won't suggest columns for them. This is a
  // deliberate tradeoff to avoid loading details for all schemas at once (which
  // could be expensive on databases with many schemas/tables).
  const schemaCompletionData = useMemo(() => {
    // Build a lookup of "schema.name" → details for loaded schemas
    const detailMap = new Map<string, SchemaTableDetails>();
    for (const d of selectedSchemaDetails) {
      detailMap.set(`${d.schema}.${d.name}`, d);
    }

    const completionTables = tables.map((t) => {
      const detail = detailMap.get(`${t.schema}.${t.name}`);
      return {
        schema: t.schema,
        name: t.name,
        columns: detail
          ? detail.columns.map((c) => ({ name: c.name, dataType: c.data_type }))
          : [],
      };
    });

    return { schemas, tables: completionTables };
  }, [tables, schemas, selectedSchemaDetails]);

  const selectedTableRef = useMemo(() => {
    if (!selectedTableKey) {
      return null;
    }
    const dotIdx = selectedTableKey.indexOf(".");
    if (dotIdx <= 0) {
      return null;
    }
    return {
      schema: selectedTableKey.slice(0, dotIdx),
      name: selectedTableKey.slice(dotIdx + 1),
    };
  }, [selectedTableKey]);

  useEffect(() => {
    setTabNavState(connectionId, {
      section: activeSection,
      schema: selectedSchema,
      table: selectedTableKey ?? undefined,
    });
  }, [
    activeSection,
    connectionId,
    selectedSchema,
    selectedTableKey,
    setTabNavState,
  ]);

  const selectedTable = selectedTableRef?.name ?? null;

  const closeTableTabNow = useCallback(
    (tabKey: string) => {
      closeTab(connectionId, tabKey);
      setTabDirtyState((prev) => {
        const next = { ...prev };
        delete next[tabKey];
        return next;
      });
      if (selectedTableKey === tabKey) {
        const nextActive =
          openTableTabs.find((t) => t.key !== tabKey)?.key ?? null;
        setTabNavState(connectionId, {
          section: activeSection,
          schema: selectedSchema,
          table: nextActive ?? undefined,
        });
      }
    },
    [
      closeTab,
      connectionId,
      selectedTableKey,
      openTableTabs,
      setTabNavState,
      activeSection,
      selectedSchema,
    ]
  );

  const requestCloseTableTab = useCallback(
    (tabKey: string) => {
      if (tabDirtyState[tabKey]) {
        setPendingCloseTabKey(tabKey);
        return;
      }
      closeTableTabNow(tabKey);
    },
    [closeTableTabNow, tabDirtyState]
  );

  const handleSaveAllTabs = useCallback(async () => {
    if (isSavingAllTabs) {
      return;
    }
    if (!Object.values(tabDirtyState).some(Boolean)) {
      return;
    }
    setIsSavingAllTabs(true);
    try {
      await editorRef.current?.saveAllDraftsAcrossTabs();
      setTabDirtyState((prev) => {
        const next: Record<string, boolean> = {};
        for (const key of Object.keys(prev)) {
          next[key] = false;
        }
        return next;
      });
      toast.success("All pending table changes were saved.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to save all table changes"
      );
    } finally {
      setIsSavingAllTabs(false);
    }
  }, [isSavingAllTabs, tabDirtyState]);

  const handleDiscardAndCloseTab = useCallback(() => {
    if (!pendingCloseTabKey) {
      return;
    }
    if (pendingCloseTabKey === selectedTableKey) {
      editorRef.current?.discardAllChanges();
    }
    closeTableTabNow(pendingCloseTabKey);
    setPendingCloseTabKey(null);
  }, [closeTableTabNow, pendingCloseTabKey, selectedTableKey]);

  const handleSaveAndCloseTab = useCallback(async () => {
    if (!pendingCloseTabKey) {
      return;
    }
    setIsClosingTabWithSave(true);
    try {
      if (pendingCloseTabKey === selectedTableKey) {
        await editorRef.current?.saveAllChanges();
      } else {
        await editorRef.current?.saveAllDraftsAcrossTabs();
      }
      setTabDirtyState((prev) => ({ ...prev, [pendingCloseTabKey]: false }));
      closeTableTabNow(pendingCloseTabKey);
      setPendingCloseTabKey(null);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save tab changes"
      );
    } finally {
      setIsClosingTabWithSave(false);
    }
  }, [closeTableTabNow, pendingCloseTabKey, selectedTableKey]);

  // React Query for table details — gives us cache, keepPreviousData for smooth
  // transitions, and automatic revalidation. Trocar para uma tabela já visitada
  // é instantâneo (cache hit); primeira visita mostra skeleton.
  const {
    data: selectedTableDetails = null,
    isFetching: isFetchingTableDetails,
  } = useQuery({
    ...dbQueryOptions.tableDetails(
      connectionId,
      selectedTableRef?.schema ?? "",
      selectedTableRef?.name ?? "",
      isActive && !!selectedTableRef
    ),
  });

  const isLoadingTableDetails = isFetchingTableDetails;

  const tablesContextSourceId = tablesAiSourceIdRef.current;

  useEffect(() => {
    if (!(isActive && selectedTableRef && selectedTableDetails)) {
      return;
    }

    const { schema, name } = selectedTableRef;
    const cols = selectedTableDetails.columns;
    const fks = selectedTableDetails.foreign_keys;
    const pkIndex = selectedTableDetails.indexes.find((i) => i.is_primary);
    const pkCols = new Set(pkIndex?.column_names ?? []);

    const colLines = cols.map((c) => {
      const parts = [`  - ${c.name}: ${c.data_type}`];
      if (pkCols.has(c.name)) {
        parts.push("[PK]");
      }
      if (!c.is_nullable) {
        parts.push("[NOT NULL]");
      }
      const fk = fks.find((f) => f.column_name === c.name);
      if (fk) {
        parts.push(`→ ${fk.referenced_table}.${fk.referenced_column}`);
      }
      if (c.column_default) {
        parts.push(`= ${c.column_default.slice(0, 40)}`);
      }
      return parts.join(" ");
    });

    const fkLines =
      fks.length > 0
        ? [
            "\nForeign Keys:",
            ...fks.map(
              (fk) =>
                `  - ${fk.name}: ${schema}.${name}.${fk.column_name} → ${fk.referenced_schema || schema}.${fk.referenced_table}.${fk.referenced_column}`
            ),
          ]
        : [];

    const idxLines =
      selectedTableDetails.indexes.length > 0
        ? [
            "\nIndexes:",
            ...selectedTableDetails.indexes.map(
              (idx) =>
                `  - ${idx.name}: (${idx.column_names.join(", ")})${idx.is_unique ? " UNIQUE" : ""}${idx.is_primary ? " PRIMARY" : ""}`
            ),
          ]
        : [];

    const ctx = [
      `Selected Table: ${schema}.${name}`,
      `Columns (${cols.length}):`,
      ...colLines,
      ...fkLines,
      ...idxLines,
    ].join("\n");

    const preview = `${schema}.${name} (${cols.length} col${cols.length === 1 ? "" : "s"})`;

    setSqlContextForTable(tablesContextSourceId, {
      connectionId,
      connectionLabel:
        connection?.name?.trim() ||
        connection?.database?.trim() ||
        connectionId,
      dbType: connection?.db_type || "postgresql",
      schemaContext: ctx,
      contextPreview: {
        connectionLabel:
          connection?.name?.trim() ||
          connection?.database?.trim() ||
          connectionId,
        dbType: connection?.db_type || "postgresql",
        tablePreview: preview,
      },
    });
  }, [
    selectedTableRef,
    selectedTableDetails,
    isActive,
    setSqlContextForTable,
    clearSqlContextForTable,
    tablesContextSourceId,
    connectionId,
    connection?.name,
    connection?.database,
    connection?.db_type,
  ]);

  useEffect(
    () => () => clearSqlContextForTable(tablesContextSourceId),
    [clearSqlContextForTable, tablesContextSourceId]
  );

  // Invalidate table details cache on DDL changes so next read refetches.
  const invalidateTableDetails = useCallback(
    (schema?: string, name?: string) => {
      if (schema && name) {
        queryClient.invalidateQueries({
          queryKey: dbQueryKeys.tableDetails(connectionId, schema, name),
        });
      } else {
        queryClient.invalidateQueries({
          queryKey: dbQueryKeys.tableDetailsAll(connectionId),
        });
      }
      queryClient.invalidateQueries({
        queryKey: dbQueryKeys.selectedSchemaDetailsPrefix(connectionId),
      });
    },
    [connectionId, queryClient]
  );

  const handleDdlSuccess = useCallback(async () => {
    await refetchSchema();
    // Invalidate all cached table details for this connection — safest default
    // since DDL can affect any table.
    invalidateTableDetails();
  }, [refetchSchema, invalidateTableDetails]);

  // Prefetch table details AND first page of rows on hover — gives near-instant
  // navigation when the user clicks a table they've already hovered over.
  // Inspired by conar's route loader prefetch pattern.
  const prefetchTableDetails = useCallback(
    (schema: string, name: string) => {
      queryClient.prefetchQuery(
        dbQueryOptions.tableDetails(connectionId, schema, name)
      );
      queryClient.prefetchQuery({
        queryKey: dbQueryKeys.tableRows(
          connectionId,
          schema,
          name,
          0,
          50,
          [],
          []
        ),
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
    [connectionId, queryClient]
  );

  const quoteIdentifier = useCallback(
    (value: string) => `"${value.replaceAll('"', '""')}"`,
    []
  );

  const handleBrowseTableData = useCallback(
    (target: { schema: string; name: string }) => {
      changeSchema(target.schema);
      changeTable(`${target.schema}.${target.name}`);
      if (activeSection !== "tables") {
        changeSection("tables");
      }
    },
    [activeSection, changeSchema, changeSection, changeTable]
  );

  const handleTruncateTable = useCallback(
    async (target: { schema: string; name: string }) => {
      const confirmed = window.confirm(
        `Truncate ${target.schema}.${target.name}?\n\nThis will permanently remove all rows.`
      );
      if (!confirmed) {
        return;
      }
      try {
        await tableTruncate({
          connectionId,
          schema: target.schema,
          table: target.name,
        });
        toast.success(`Table ${target.schema}.${target.name} truncated`);
        invalidateTableDetails(target.schema, target.name);
        void refetchSchema();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to truncate table"
        );
      }
    },
    [connectionId, invalidateTableDetails, refetchSchema]
  );

  const handleToggleTableRls = useCallback(
    async (target: { schema: string; name: string; enable: boolean }) => {
      if (connection?.db_type !== "postgresql") {
        return;
      }
      const action = target.enable ? "ENABLE" : "DISABLE";
      const sql = `ALTER TABLE ${quoteIdentifier(target.schema)}.${quoteIdentifier(target.name)} ${action} ROW LEVEL SECURITY;`;
      try {
        await executeQuery(connectionId, sql);
        toast.success(
          `RLS ${target.enable ? "enabled" : "disabled"} for ${target.schema}.${target.name}`
        );
        invalidateTableDetails(target.schema, target.name);
        void refetchSchema();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to update RLS"
        );
      }
    },
    [
      connection?.db_type,
      connectionId,
      invalidateTableDetails,
      quoteIdentifier,
      refetchSchema,
    ]
  );

  const handleDropTableSuccess = useCallback(
    async (droppedKey: string) => {
      await handleDdlSuccess();
      closeTab(connectionId, droppedKey);
      setTabDirtyState((prev) => {
        const next = { ...prev };
        delete next[droppedKey];
        return next;
      });
      if (selectedTableKey === droppedKey) {
        changeTable(null);
      }
    },
    [handleDdlSuccess, selectedTableKey, changeTable, closeTab, connectionId]
  );

  const handleRenameTableSuccess = useCallback(
    async (oldKey: string, newKey: string) => {
      await handleDdlSuccess();
      const dotIdx = newKey.indexOf(".");
      if (dotIdx > 0 && dotIdx < newKey.length - 1) {
        replaceTabKey(
          connectionId,
          oldKey,
          buildTableEditorTab(newKey.slice(0, dotIdx), newKey.slice(dotIdx + 1))
        );
      }
      setTabDirtyState((prev) => {
        if (!prev[oldKey]) {
          return prev;
        }
        const next = { ...prev };
        delete next[oldKey];
        next[newKey] = false;
        return next;
      });
      if (selectedTableKey === oldKey) {
        changeTable(newKey);
      }
    },
    [
      handleDdlSuccess,
      selectedTableKey,
      changeTable,
      replaceTabKey,
      connectionId,
    ]
  );

  // Load table details when selected table changes
  // Load RLS policies when target changes
  useEffect(() => {
    if (!isActive) {
      return;
    }
    if (rlsPoliciesTarget) {
      const loadPolicies = async () => {
        setIsLoadingRlsPolicies(true);
        try {
          const details = await getTableDetails(
            connectionId,
            rlsPoliciesTarget.schema,
            rlsPoliciesTarget.name
          );
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
  }, [rlsPoliciesTarget, connectionId, isActive]);

  if (!connection) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-background p-8">
        <div className="mx-auto mb-4 w-fit rounded-full bg-muted/40 p-3">
          <Icon className="h-5 w-5 text-muted-foreground/50" name="database" />
        </div>
        <h2 className="mb-2 font-semibold text-lg">Connection not found</h2>
        <p className="mb-4 text-muted-foreground text-sm">
          The connection you are looking for does not exist.
        </p>
        <Button onClick={() => navigate({ to: "/" })}>
          Back to Connections
        </Button>
      </div>
    );
  }

  const isLocalConnectionStopped = Boolean(
    connection.is_local &&
      !isLoadingLocalDbStatus &&
      !(localDbStatus?.running)
  );

  if (isLocalConnectionStopped) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-background p-8">
        <div className="mx-auto mb-4 w-fit rounded-full bg-muted/40 p-3">
          <Icon className="h-5 w-5 text-muted-foreground/50" name="pause" />
        </div>
        <h2 className="mb-2 font-semibold text-lg">{connection.name}</h2>
        <p className="mb-6 max-w-md text-center text-muted-foreground text-sm">
          This local database is paused. Start it before accessing tables,
          schema, and queries.
        </p>
        <div className="flex items-center gap-2">
          <Button disabled={isTogglingLocalDb} onClick={handleStartLocalDb}>
            {isTogglingLocalDb ? (
              <Icon className="mr-2 h-4 w-4 animate-spin" name="loader" />
            ) : (
              <Icon className="mr-2 h-4 w-4" name="play" />
            )}
            Start local database
          </Button>
          <Button onClick={() => navigate({ to: "/" })} variant="outline">
            Back to Connections
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1 bg-transparent">
        <AnimatePresence initial={false}>
          {isNavVisible && (
            <DatabaseNavSidebar
              activeSection={activeSection}
              connection={connection}
              copyFeedback={copyFeedback}
              isRefreshing={isRefreshing}
              onBackToConnections={handleBackToConnections}
              onCopyConnection={handleCopyConnection}
              onRefresh={handleRefresh}
              onSectionChange={changeSection}
              provider={connectionProvider}
            />
          )}
        </AnimatePresence>

        <div className="database-content-frame flex min-h-0 flex-1 overflow-hidden rounded-md border bg-background">
          {/* Main Content Area */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div
              aria-hidden={!isTablesSection}
              className={isTablesSection ? "min-h-0 flex-1" : "hidden"}
              ref={tablesGroupRef}
            >
              <PanelGroup className="h-full min-h-0 min-w-0">
                {/* Tables Sidebar — always mounted, so its width animates instead of popping */}
                <Panel
                  className="min-w-0"
                  maxSize="25%"
                  minSize="15%"
                  onSizeChange={handleTablesSidebarResize}
                  size={tablesSidebarSize}
                >
                  <TablesExplorerSidebar
                    aiMatchedNames={aiMatchedNames}
                    aiSearchEnabled={aiSearchEnabled}
                    dbType={connection.db_type}
                    errorMessage={
                      schemaError instanceof Error
                        ? schemaError.message
                        : "Failed to load schema"
                    }
                    filteredTables={filteredTablesForSchema}
                    isAiSearching={isAiSearching}
                    isCollapsed={false}
                    isError={isSchemaError}
                    isLoading={isLoading}
                    onBrowseTableData={handleBrowseTableData}
                    onCopyTableName={({ name }) => {
                      void copyToClipboardWithToast(name, "Table name copied");
                    }}
                    onCopyTableRef={({ schema, name }) => {
                      void copyToClipboardWithToast(
                        makeTableRef(schema, name),
                        "Table reference copied"
                      );
                    }}
                    onCreateIndex={() => setIsCreateIndexOpen(true)}
                    onCreateSchema={() => setIsCreateSchemaOpen(true)}
                    onCreateTable={() => setIsCreateTableOpen(true)}
                    onDropTable={setDdlDropTarget}
                    onExportSchema={setSchemaExportTarget}
                    onImportCsv={() => setIsImportCsvOpen(true)}
                    onInsertTableInsertTemplate={({ schema, name }) => {
                      requestSqlInsert(
                        makeTableInsertTemplateSql(schema, name)
                      );
                    }}
                    onInsertTableSelect={({ schema, name }) => {
                      requestSqlInsert(makeTableSelectSql(schema, name));
                    }}
                    onInsertTableUpdateTemplate={({ schema, name }) => {
                      requestSqlInsert(
                        makeTableUpdateTemplateSql(schema, name)
                      );
                    }}
                    onPrefetchTable={prefetchTableDetails}
                    onRenameTable={setDdlRenameTarget}
                    onRetry={refetchSchema}
                    onSchemaChange={changeSchema}
                    onSeedData={() => setIsSeedDataOpen(true)}
                    onTableSearchChange={setTableSearch}
                    onTableSelect={changeTable}
                    onToggleTableRls={handleToggleTableRls}
                    onTruncateTable={handleTruncateTable}
                    onViewDdl={setDdlViewTarget}
                    onViewRlsPolicies={setRlsPoliciesTarget}
                    schemas={schemas}
                    selectedSchema={selectedSchema}
                    selectedTableKey={selectedTableKey}
                    selectedTableRef={selectedTableRef}
                    tableSearch={tableSearch}
                    tablesBySchema={tablesBySchema}
                  />
                </Panel>

                <PanelSeparator withHandle />

                {/* Main Panel */}
                <Panel className="flex min-h-0 min-w-0 flex-col overflow-hidden">
                  <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b px-2 py-1.5">
                    {openTableTabs.map((tab) => {
                      const isActiveTab = tab.key === selectedTableKey;
                      return (
                        <button
                          className={cn(
                            "group inline-flex shrink-0 items-center gap-2 rounded-md border px-2 py-1 text-xs",
                            isActiveTab
                              ? "border-border bg-muted text-foreground"
                              : "border-transparent bg-background text-muted-foreground hover:border-border/70 hover:text-foreground"
                          )}
                          key={tab.key}
                          onClick={() => changeTable(tab.key)}
                          type="button"
                        >
                          <span>{tab.label}</span>
                          {tabDirtyState[tab.key] ? (
                            <span className="text-orange-500">•</span>
                          ) : null}
                          <span
                            className="rounded p-0.5 opacity-60 hover:opacity-100"
                            onClick={(e) => {
                              e.stopPropagation();
                              requestCloseTableTab(tab.key);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                e.stopPropagation();
                                requestCloseTableTab(tab.key);
                              }
                            }}
                            role="button"
                            tabIndex={0}
                          >
                            <Icon className="h-3 w-3" name="x" />
                          </span>
                        </button>
                      );
                    })}
                    <div className="ml-auto flex shrink-0 items-center gap-1">
                      <Button
                        className="h-7 text-xs"
                        disabled={
                          !Object.values(tabDirtyState).some(Boolean) ||
                          isSavingAllTabs
                        }
                        onClick={() => void handleSaveAllTabs()}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        {isSavingAllTabs ? (
                          <>
                            <Icon
                              className="mr-1 h-3 w-3 animate-spin"
                              name="loader"
                            />
                            Saving…
                          </>
                        ) : (
                          "Save all"
                        )}
                      </Button>
                      <Button
                        className="h-7 text-xs"
                        disabled={!selectedTableKey}
                        onClick={() => {
                          if (!selectedTableKey) {
                            return;
                          }
                          closeOthers(connectionId, selectedTableKey);
                          setTabDirtyState((prev) => {
                            const keepDirty = prev[selectedTableKey] ?? false;
                            return { [selectedTableKey]: keepDirty };
                          });
                        }}
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        Close others
                      </Button>
                      <Button
                        className="h-7 text-xs"
                        disabled={openTableTabs.length === 0}
                        onClick={() => {
                          closeAll(connectionId);
                          setTabDirtyState({});
                          setTabNavState(connectionId, {
                            section: activeSection,
                            schema: selectedSchema,
                            table: undefined,
                          });
                        }}
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        Close all
                      </Button>
                    </div>
                  </div>
                  <div className="min-h-0 flex-1 overflow-hidden">
                    {(() => {
                      if (!selectedTable || openTableTabs.length === 0) {
                        return (
                          <div className="flex h-full items-center justify-center p-8">
                            <div className="space-y-3 text-center">
                              <div className="mx-auto w-fit rounded-full bg-muted/40 p-3">
                                <Icon
                                  className="h-5 w-5 text-muted-foreground/50"
                                  name="database"
                                />
                              </div>
                              <div>
                                <p className="font-medium text-muted-foreground text-sm">
                                  Select a table
                                </p>
                                <p className="mt-0.5 text-muted-foreground/60 text-xs">
                                  Choose a table from the sidebar to get started
                                </p>
                              </div>
                            </div>
                          </div>
                        );
                      }

                      if (!selectedTableDetails) {
                        return (
                          <div className="flex h-full items-center justify-center p-8">
                            <div className="flex items-center gap-3 text-muted-foreground">
                              {isLoadingTableDetails ? (
                                <>
                                  <Icon
                                    className="h-4 w-4 animate-spin"
                                    name="loader"
                                  />
                                  <span className="text-sm">
                                    Loading {selectedTableRef?.schema}.
                                    {selectedTable}…
                                  </span>
                                </>
                              ) : (
                                <span className="text-sm">
                                  Failed to load table details
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      }

                      const td = selectedTableDetails;
                      const detailsMatch =
                        !!selectedTableRef &&
                        td.name === selectedTableRef.name &&
                        td.schema === selectedTableRef.schema;
                      const isSwitching =
                        isLoadingTableDetails && !detailsMatch;

                      return (
                        <TableDataEditor
                          connectionId={connectionId}
                          disableWindowUnsavedTracking
                          isSidebarVisible
                          isSwitchingTable={isSwitching}
                          onDirtyChange={(key, dirty) => {
                            setTabDirtyState((prev) =>
                              prev[key] === dirty
                                ? prev
                                : { ...prev, [key]: dirty }
                            );
                          }}
                          onExportData={() => setIsExportDataOpen(true)}
                          onRequestAddColumn={() =>
                            setDdlAddColumnTarget({
                              schema: td.schema,
                              name: td.name,
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
                          onSeedData={() => setIsSeedDataOpen(true)}
                          ref={editorRef}
                          table={td}
                          tableFkLookup={tableFkLookup}
                          tableKey={
                            selectedTableKey ?? `${td.schema}.${td.name}`
                          }
                          tableSaveChanges={tableSaveChanges}
                          tableTruncate={tableTruncate}
                        />
                      );
                    })()}
                  </div>
                  {connection && selectedSchema && (
                    <SeedDataDialog
                      connectionId={connection.id}
                      defaultTableName={selectedTableRef?.name ?? ""}
                      isOpen={isSeedDataOpen}
                      onClose={() => setIsSeedDataOpen(false)}
                      onSuccess={() => {
                        void handleDdlSuccess();
                      }}
                      schema={selectedSchema}
                      tableColumns={selectedTableDetails?.columns}
                      tableForeignKeys={selectedTableDetails?.foreign_keys}
                      tableIndexes={selectedTableDetails?.indexes}
                    />
                  )}
                  {connection && selectedSchema && (
                    <ExportDataDialog
                      connectionId={connection.id}
                      defaultTableName={selectedTableRef?.name ?? ""}
                      isOpen={isExportDataOpen}
                      onClose={() => setIsExportDataOpen(false)}
                      schema={selectedSchema}
                    />
                  )}
                </Panel>
              </PanelGroup>
            </div>
            <div
              aria-hidden={!isSqlEditorSection}
              className={isSqlEditorSection ? "min-h-0 flex-1" : "hidden"}
            >
              <Suspense
                fallback={
                  <div className="flex flex-1 items-center justify-center">
                    <Icon
                      className="h-6 w-6 animate-spin text-muted-foreground"
                      name="loader"
                    />
                  </div>
                }
              >
                <SqlEditor
                  connections={connections}
                  dbType={connection.db_type || "postgresql"}
                  executeQuery={executeQuery}
                  insertRequest={sqlInsertRequest}
                  isRouteActive={isActive}
                  key={connectionId}
                  loadRequest={
                    initialSqlQuery
                      ? {
                          key: `query:${Date.now()}`,
                          title: "Query",
                          sql: initialSqlQuery,
                          connectionId,
                        }
                      : selectedTableKey
                        ? {
                            key: `table:${selectedTableKey}`,
                            title: `Query: ${selectedTableKey}`,
                            sql: `SELECT * FROM "${selectedTableRef?.schema}"."${selectedTableRef?.name}" LIMIT 100`,
                            connectionId,
                          }
                        : null
                  }
                  onSelectConnection={(id) => {
                    navigate({
                      to: "/database/$connectionId",
                      params: { connectionId: id },
                    });
                  }}
                  onWorkspaceSidebarResize={setSqlSidebarWidthPx}
                  schemaCompletionData={schemaCompletionData}
                  schemaContext={schemaContextForAi}
                  selectedConnection={connectionId}
                  showWorkspaceSidebar={true}
                />
              </Suspense>
            </div>
            <div
              aria-hidden={!isOverviewSection}
              className={isOverviewSection ? "min-h-0 flex-1" : "hidden"}
            >
              <DatabaseOverview
                connection={connection}
                connectionString={buildMaskedConnStr()}
                copyConnectionStringFeedback={copyConnFeedback}
                databaseInfo={databaseInfo}
                isLoadingDatabaseInfo={isLoadingDatabaseInfo}
                isLoadingLocalDbStatus={isLoadingLocalDbStatus}
                isTogglingLocalDbStatus={isTogglingLocalDb}
                localDbStatus={localDbStatus}
                onCopyConnectionString={handleCopyConnectionString}
                onNewQuery={() => changeSection("sql-editor")}
                onPauseLocalDb={handlePauseLocalDb}
                onStartLocalDb={handleStartLocalDb}
                onTestConnection={handleTestConnection}
                onViewTables={() => changeSection("tables")}
                schemaSummary={{ schemas, tables }}
              />
            </div>
            <div
              aria-hidden={!isVisualizerSection}
              className={isVisualizerSection ? "min-h-0 flex-1" : "hidden"}
            >
              {isVisualizerSection && (
                <Suspense
                  fallback={
                    <div className="flex flex-1 items-center justify-center">
                      <Icon
                        className="h-6 w-6 animate-spin text-muted-foreground"
                        name="loader"
                      />
                      <span className="ml-2 text-muted-foreground text-sm">
                        Loading schema...
                      </span>
                    </div>
                  }
                >
                  <div className="flex h-full min-h-0 min-w-0 flex-1">
                    {isLoadingVisualizer ? (
                      <div className="flex h-full w-full items-center justify-center">
                        <Icon
                          className="h-6 w-6 animate-spin text-muted-foreground"
                          name="loader"
                        />
                        <span className="ml-2 text-muted-foreground text-sm">
                          Loading schema...
                        </span>
                      </div>
                    ) : visualizerTables.length === 0 ? (
                      <div className="flex h-full w-full items-center justify-center">
                        <p className="text-muted-foreground">
                          No tables to visualize
                        </p>
                      </div>
                    ) : (
                      <SchemaVisualizer
                        currentSchema={selectedSchema}
                        isLoading={isLoadingVisualizer}
                        onNavigateToTables={() => changeSection("tables")}
                        onSchemaChange={changeSchema}
                        onTableClick={(schema, table) => {
                          changeSection("tables");
                          changeSchema(schema);
                          changeTable(`${schema}.${table}`);
                        }}
                        schemas={schemas}
                        tables={visualizerTables}
                      />
                    )}
                  </div>
                </Suspense>
              )}
            </div>
            <div
              aria-hidden={!isDefinitionsSection}
              className={isDefinitionsSection ? "min-h-0 flex-1" : "hidden"}
            >
              <Suspense
                fallback={
                  <div className="flex flex-1 items-center justify-center">
                    <Icon
                      className="h-6 w-6 animate-spin text-muted-foreground"
                      name="loader"
                    />
                    <span className="ml-2 text-muted-foreground text-sm">
                      Loading definitions...
                    </span>
                  </div>
                }
              >
                <DefinitionsBrowserPanel
                  connectionId={connectionId}
                  dbType={connection.db_type || "postgresql"}
                  onSchemaChange={changeSchema}
                  schemas={schemas}
                  selectedSchema={selectedSchema}
                />
              </Suspense>
            </div>
          </div>
        </div>
      </div>
      {/* Lazy-loaded DDL dialogs — Suspense boundary for all of them */}
      <Suspense fallback={null}>
        {connection && selectedSchema && (
          <CreateTableDialog
            connectionId={connection.id}
            createTable={createTable}
            dbType={connection.db_type || "postgresql"}
            existingTables={selectedSchemaDetails.map((t) => ({
              name: t.name,
              schema: t.schema,
              columns: t.columns.map((c) => ({
                name: c.name,
                type: c.data_type,
              })),
            }))}
            isOpen={isCreateTableOpen}
            onClose={() => setIsCreateTableOpen(false)}
            onSuccess={() => {
              void handleDdlSuccess();
            }}
            schema={selectedSchema}
          />
        )}
        <AlertDialog
          onOpenChange={(open) => {
            if (!open) {
              setPendingCloseTabKey(null);
            }
          }}
          open={!!pendingCloseTabKey}
        >
          <AlertDialogContent className="t-resize sm:max-w-[420px]">
            <AlertDialogHeader>
              <AlertDialogTitle>Unsaved changes in tab</AlertDialogTitle>
              <AlertDialogDescription>
                This table tab has unsaved changes. Save before closing?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDiscardAndCloseTab}>
                Discard
              </AlertDialogAction>
              <AlertDialogAction
                disabled={isClosingTabWithSave}
                onClick={() => void handleSaveAndCloseTab()}
              >
                {isClosingTabWithSave ? "Saving..." : "Save and close"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {connection && ddlDropTarget && (
          <DropTableDialog
            connectionId={connection.id}
            dropTable={dropTable}
            isOpen
            onClose={() => setDdlDropTarget(null)}
            onSuccess={() => {
              void handleDropTableSuccess(
                `${ddlDropTarget.schema}.${ddlDropTarget.name}`
              );
            }}
            schema={ddlDropTarget.schema}
            tableName={ddlDropTarget.name}
          />
        )}
        {connection && ddlRenameTarget && (
          <RenameTableDialog
            connectionId={connection.id}
            currentName={ddlRenameTarget.name}
            isOpen
            onClose={() => setDdlRenameTarget(null)}
            onSuccess={() => {
              void handleRenameTableSuccess(
                `${ddlRenameTarget.schema}.${ddlRenameTarget.name}`,
                `${ddlRenameTarget.schema}.${ddlRenameTarget.name}`
              );
            }}
            renameTable={renameTable}
            schema={ddlRenameTarget.schema}
          />
        )}
        {connection && ddlAddColumnTarget && (
          <AddColumnDialog
            addColumn={addColumn}
            connectionId={connection.id}
            dbType={connection.db_type || "postgresql"}
            isOpen
            onClose={() => setDdlAddColumnTarget(null)}
            onSuccess={() => {
              void handleDdlSuccess();
            }}
            schema={ddlAddColumnTarget.schema}
            tableName={ddlAddColumnTarget.name}
          />
        )}
        {connection && ddlDropColumnTarget && (
          <DropColumnDialog
            columnName={ddlDropColumnTarget.column}
            connectionId={connection.id}
            dropColumn={dropColumn}
            isOpen
            onClose={() => setDdlDropColumnTarget(null)}
            onSuccess={() => {
              void handleDdlSuccess();
            }}
            schema={ddlDropColumnTarget.schema}
            tableName={ddlDropColumnTarget.table}
          />
        )}
        {connection && ddlRenameColumnTarget && (
          <RenameColumnDialog
            connectionId={connection.id}
            currentName={ddlRenameColumnTarget.column}
            isOpen
            onClose={() => setDdlRenameColumnTarget(null)}
            onSuccess={() => {
              void handleDdlSuccess();
            }}
            renameColumn={renameColumn}
            schema={ddlRenameColumnTarget.schema}
            tableName={ddlRenameColumnTarget.table}
          />
        )}
        {connection && ddlAlterColumnTypeTarget && (
          <AlterColumnTypeDialog
            alterColumnType={alterColumnType}
            columnName={ddlAlterColumnTypeTarget.column}
            connectionId={connection.id}
            currentType={ddlAlterColumnTypeTarget.currentType}
            isOpen
            onClose={() => setDdlAlterColumnTypeTarget(null)}
            onSuccess={() => {
              void handleDdlSuccess();
            }}
            schema={ddlAlterColumnTypeTarget.schema}
            tableName={ddlAlterColumnTypeTarget.table}
          />
        )}
        {connection && ddlSetColumnDefaultTarget && (
          <SetColumnDefaultDialog
            columnName={ddlSetColumnDefaultTarget.column}
            connectionId={connection.id}
            currentDefault={ddlSetColumnDefaultTarget.currentDefault}
            isOpen
            onClose={() => setDdlSetColumnDefaultTarget(null)}
            onSuccess={() => {
              void handleDdlSuccess();
            }}
            schema={ddlSetColumnDefaultTarget.schema}
            setColumnDefault={setColumnDefault}
            tableName={ddlSetColumnDefaultTarget.table}
          />
        )}
        {connection && ddlSetColumnNullableTarget && (
          <SetColumnNullableDialog
            columnName={ddlSetColumnNullableTarget.column}
            connectionId={connection.id}
            isCurrentlyNullable={ddlSetColumnNullableTarget.isNullable}
            isOpen
            onClose={() => setDdlSetColumnNullableTarget(null)}
            onSuccess={() => {
              void handleDdlSuccess();
            }}
            schema={ddlSetColumnNullableTarget.schema}
            setColumnNullable={setColumnNullable}
            tableName={ddlSetColumnNullableTarget.table}
          />
        )}
        {connection && (
          <CreateSchemaDialog
            connectionId={connection.id}
            createSchema={createSchema}
            isOpen={isCreateSchemaOpen}
            onClose={() => setIsCreateSchemaOpen(false)}
            onSuccess={() => {
              void handleDdlSuccess();
            }}
          />
        )}
        {connection && selectedSchema && (
          <CreateIndexDialog
            connectionId={connection.id}
            createIndex={createIndex}
            defaultTableName={selectedTableRef?.name ?? ""}
            isOpen={isCreateIndexOpen}
            onClose={() => setIsCreateIndexOpen(false)}
            onSuccess={() => {
              void handleDdlSuccess();
            }}
            schema={selectedSchema}
          />
        )}
        {connection && selectedSchema && (
          <ImportCsvDialog
            connectionId={connection.id}
            defaultTableName={selectedTableRef?.name ?? ""}
            isOpen={isImportCsvOpen}
            onClose={() => setIsImportCsvOpen(false)}
            onSuccess={() => {
              void handleDdlSuccess();
            }}
            schema={selectedSchema}
          />
        )}
        {rlsPoliciesTarget && (
          <RlsPoliciesDialog
            isOpen={Boolean(rlsPoliciesTarget)}
            onClose={() => setRlsPoliciesTarget(null)}
            policies={rlsPolicies}
            schema={rlsPoliciesTarget.schema}
            tableName={rlsPoliciesTarget.name}
          />
        )}
        {ddlViewTarget && (
          <ViewDdlDialog
            cachedDetails={
              selectedTableDetails &&
              selectedTableDetails.schema === ddlViewTarget.schema &&
              selectedTableDetails.name === ddlViewTarget.name
                ? selectedTableDetails
                : null
            }
            connectionId={connection.id}
            dbType={connection.db_type || "postgresql"}
            isOpen
            onClose={() => setDdlViewTarget(null)}
            schema={ddlViewTarget.schema}
            tableName={ddlViewTarget.name}
          />
        )}
        {schemaExportTarget && connection && (
          <SchemaExportDialog
            cachedDetails={
              selectedTableDetails &&
              selectedTableDetails.schema === schemaExportTarget.schema &&
              selectedTableDetails.name === schemaExportTarget.name
                ? selectedTableDetails
                : null
            }
            connectionId={connection.id}
            dbType={connection.db_type || "postgresql"}
            isOpen
            onClose={() => setSchemaExportTarget(null)}
            schema={schemaExportTarget.schema}
            tableName={schemaExportTarget.name}
          />
        )}
      </Suspense>
    </div>
  );
}
