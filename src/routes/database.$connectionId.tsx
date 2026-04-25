import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Database,
  Loader2,
  Pause,
  Play,
} from "lucide-react";
import { AnimatePresence } from "motion/react";
import { Suspense, lazy, startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  type PanelImperativeHandle,
  useDefaultLayout,
} from "@/components/ui/resizable";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useConnectionsList } from "@/hooks/useConnectionsList";
import {
  getSchemaSummary,
  executeQuery,
  getDatabaseInfo,
  testConnection,
  getTableDetails,
  tableListRows,
  tableSaveChanges,
  tableTruncate,
  tableFkLookup,
  createTable,
  dropTable,
  renameTable,
  addColumn,
  createSchema,
  createIndex,
  dropColumn,
  renameColumn,
  alterColumnType,
  setColumnDefault,
  setColumnNullable,
} from "@/hooks/db-actions";
import { useLocalDatabases } from "@/hooks/useLocalDatabases";
import { getClickhouseEffectivePort } from "@/ipc/db/types";
import {
  buildConnectionTab,
  detectConnectionProvider,
  type ConnectionTabChrome,
  type SidebarSection,
  useConnectionTabsStore,
} from "@/lib/stores/connection-tabs";
import { DatabaseNavSidebar } from "@/components/DatabaseNavSidebar";
import { TablesExplorerSidebar } from "@/components/TablesExplorerSidebar";
import { DatabaseOverview } from "@/components/DatabaseOverview";
import { TableDataEditor } from "@/components/TableDataEditor";
import type { SchemaTableSummary, DatabaseInfo, LocalDbInfo, SchemaTableDetails, SchemaPolicy } from "@/ipc/db/types";

// ── Lazy-loaded components ──────────────────────────────────────────
// Heavy components (~2MB Monaco + ~150KB xyflow/dagre) and rarely-used
// DDL dialogs are deferred via React.lazy() to reduce initial bundle size.
// All use named exports → re-export as default for React.lazy().

const SqlEditor = lazy(() => import("@/components/SqlEditor").then((m) => ({ default: m.SqlEditor })));
const SchemaVisualizer = lazy(() => import("@/components/SchemaVisualizer").then((m) => ({ default: m.SchemaVisualizer })));

const CreateTableDialog = lazy(() => import("@/components/TableDdlDialogs").then((m) => ({ default: m.CreateTableDialog })));
const DropTableDialog = lazy(() => import("@/components/TableDdlDialogs").then((m) => ({ default: m.DropTableDialog })));
const RenameTableDialog = lazy(() => import("@/components/TableDdlDialogs").then((m) => ({ default: m.RenameTableDialog })));
const AddColumnDialog = lazy(() => import("@/components/TableDdlDialogs").then((m) => ({ default: m.AddColumnDialog })));
const DropColumnDialog = lazy(() => import("@/components/TableDdlDialogs").then((m) => ({ default: m.DropColumnDialog })));
const RenameColumnDialog = lazy(() => import("@/components/TableDdlDialogs").then((m) => ({ default: m.RenameColumnDialog })));
const AlterColumnTypeDialog = lazy(() => import("@/components/TableDdlDialogs").then((m) => ({ default: m.AlterColumnTypeDialog })));
const SetColumnDefaultDialog = lazy(() => import("@/components/TableDdlDialogs").then((m) => ({ default: m.SetColumnDefaultDialog })));
const SetColumnNullableDialog = lazy(() => import("@/components/TableDdlDialogs").then((m) => ({ default: m.SetColumnNullableDialog })));
const CreateSchemaDialog = lazy(() => import("@/components/TableDdlDialogs").then((m) => ({ default: m.CreateSchemaDialog })));
const CreateIndexDialog = lazy(() => import("@/components/TableDdlDialogs").then((m) => ({ default: m.CreateIndexDialog })));
const ImportCsvDialog = lazy(() => import("@/components/TableDdlDialogs").then((m) => ({ default: m.ImportCsvDialog })));
const RlsPoliciesDialog = lazy(() => import("@/components/RlsPoliciesDialog").then((m) => ({ default: m.RlsPoliciesDialog })));
const ViewDdlDialog = lazy(() => import("@/components/TableDdlDialogs").then((m) => ({ default: m.ViewDdlDialog })));
const SchemaExportDialog = lazy(() => import("@/components/SchemaExportDialog").then((m) => ({ default: m.SchemaExportDialog })));
const DefinitionsBrowserPanel = lazy(() => import("@/components/DefinitionsBrowserPanel").then((m) => ({ default: m.DefinitionsBrowserPanel })));

const SECTION_SHORTCUTS: Record<string, SidebarSection> = {
  "1": "overview",
  "2": "tables",
  "3": "sql-editor",
  "4": "visualizer",
  "5": "definitions",
};

export const Route = createFileRoute("/database/$connectionId")({
  component: DatabasePage,
});

function DatabasePage() {
  const { connectionId } = Route.useParams();
  // The actual content is rendered by TabbedConnectionView (keep-alive).
  // This route component only ensures the URL is matched and the tab
  // is registered in the store. It renders nothing itself — the tab
  // container renders DatabasePageContent for all open tabs with CSS
  // show/hide so their state is preserved when switching.
  const store = useConnectionTabsStore.getState();
  if (!store.tabs.some((t) => t.id === connectionId)) {
    // Tab not yet in the store — the page will register it via the
    // useEffect inside DatabasePageContent when it mounts.
  }
  return null;
}

interface DatabasePageContentProps {
  connectionId: string;
  isActive?: boolean;
  animateNavOnMount?: boolean;
}

export function DatabasePageContent({
  connectionId,
  isActive = true,
  animateNavOnMount = true,
}: DatabasePageContentProps) {
  const navigate = useNavigate();
  const {
    connections,
    refetch,
  } = useConnectionsList();
  const { start: startLocalDb, pause: pauseLocalDb, databases: localDatabases, isLoading: isLoadingLocalDatabases, invalidateCache } = useLocalDatabases();
  const { setTabNavState, updateTab, tabs } = useConnectionTabsStore();

  const storedTab = tabs.find((t) => t.id === connectionId);
  const [activeSection, setActiveSection] = useState<SidebarSection>(
    storedTab?.lastSection ?? "overview"
  );
  const [selectedSchema, setSelectedSchema] = useState<string>(
    storedTab?.lastSchema ?? "public"
  );
  const [selectedTableKey, setSelectedTableKey] = useState<string | null>(
    storedTab?.lastTable ?? null
  );

  // Schema data via React Query — enables caching, stale-while-revalidate,
  // and sharing with route loader prefetch (same pattern as conar).
  // Previously used useState+useEffect which ran AFTER mount (visible loading)
  // and couldn't be prefetched or shared.
  const schemaSummaryQueryKey = useMemo(
    () => ["schema-summary", connectionId] as const,
    [connectionId],
  );

  const {
    data: schemaSummaryData,
    isLoading: isLoadingSchema,
    refetch: refetchSchema,
  } = useQuery({
    queryKey: schemaSummaryQueryKey,
    queryFn: () => getSchemaSummary(connectionId),
    enabled: isActive,
    staleTime: 60_000, // Schema structure rarely changes — 1 min staleTime
    gcTime: 5 * 60_000,
  });

  const schemas = schemaSummaryData?.schemas ?? [];
  const tables = schemaSummaryData?.tables ?? [];
  const [initialSqlQuery, setInitialSqlQuery] = useState<string | null>(null);
  const [tableSearch, setTableSearch] = useState("");

  // Sidebar visibility: persisted per-connection in localStorage
  const [isSidebarVisible, setIsSidebarVisible] = useState(() => {
    try {
      const raw = localStorage.getItem(`db-tables-sidebar-visible:${connectionId}`);
      return raw !== null ? raw === "true" : true; // visible by default
    } catch {
      return true;
    }
  });
  const sidebarPanelRef = useRef<PanelImperativeHandle>(null);
  const [isSidebarAnimating, setIsSidebarAnimating] = useState(false);
  const [isNavVisible, setIsNavVisible] = useState(true);
  const [tablesSidebarWidthPx, setTablesSidebarWidthPx] = useState(280);
  const [sqlSidebarWidthPx, setSqlSidebarWidthPx] = useState(280);
  const animationTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const tablesSidebarWidthRef = useRef(tablesSidebarWidthPx);
  const tabWidthUpdateTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Layout persistence via useDefaultLayout (same pattern as conar)
  // onLayoutChanged fires AFTER drag ends — no debouncing needed
  const tablesLayout = useDefaultLayout({
    id: `db-tables-layout-${connectionId}`,
    storage: localStorage,
  });

  const toggleSidebar = useCallback(() => {
    const panel = sidebarPanelRef.current;
    if (!panel) return;
    setIsSidebarAnimating(true);
    if (animationTimeoutRef.current) clearTimeout(animationTimeoutRef.current);
    if (panel.isCollapsed()) {
      panel.expand();
    } else {
      panel.collapse();
    }
    animationTimeoutRef.current = setTimeout(() => setIsSidebarAnimating(false), 220);
  }, []);

  const handleBackToConnections = useCallback(() => {
    setIsNavVisible(false);
    window.setTimeout(() => {
      navigate({ to: "/" });
    }, 180);
  }, [navigate]);

  // Clean up animation timeout on unmount
  useEffect(() => {
    return () => {
      if (animationTimeoutRef.current) clearTimeout(animationTimeoutRef.current);
      if (tabWidthUpdateTimeoutRef.current) clearTimeout(tabWidthUpdateTimeoutRef.current);
    };
  }, []);


  // Track sidebar visibility in a ref so onResize can skip redundant setState during drag
  const sidebarVisibleRef = useRef(isSidebarVisible);
  sidebarVisibleRef.current = isSidebarVisible;

  // Sync isSidebarVisible when sidebar panel resizes (including collapse/expand)
  // Width is only updated on layout change (after drag), not per-pixel
  const handleSidebarResize = useCallback(
    (panelSize: { asPercentage: number; inPixels: number }) => {
      const visible = panelSize.asPercentage !== 0;
      tablesSidebarWidthRef.current = panelSize.inPixels;
      if (sidebarVisibleRef.current !== visible) {
        setIsSidebarVisible(visible);
      }
    },
    [],
  );

  // Persist sidebar visibility to localStorage when it changes
  useEffect(() => {
    try {
      localStorage.setItem(`db-tables-sidebar-visible:${connectionId}`, String(isSidebarVisible));
    } catch { /* quota exceeded or private mode */ }
  }, [isSidebarVisible, connectionId]);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<null | "copied" | "failed">(null);
  const [isTogglingLocalDb, setIsTogglingLocalDb] = useState(false);
  const [databaseInfo, setDatabaseInfo] = useState<DatabaseInfo | null>(null);
  const [isLoadingDatabaseInfo, setIsLoadingDatabaseInfo] = useState(false);
  // connection must be defined BEFORE localDbStatus since it references connection?.is_local
  const connection = useMemo(
    () => connections.find((c) => c.id === connectionId),
    [connections, connectionId],
  );
  // Use shared cache data for local db status — stays in sync across all tabs
  const localDbStatus = useMemo(
    () => connection?.is_local ? localDatabases.find((db) => db.id === connectionId) ?? null : null,
    [localDatabases, connectionId, connection?.is_local],
  );
  // Use shared cache loading state so loading indicator works during refetch
  const isLoadingLocalDbStatus = isLoadingLocalDatabases;
  const [copyConnFeedback, setCopyConnFeedback] = useState<null | "copied" | "failed">(null);
  const [isCreateTableOpen, setIsCreateTableOpen] = useState(false);
  const [isCreateSchemaOpen, setIsCreateSchemaOpen] = useState(false);
  const [isCreateIndexOpen, setIsCreateIndexOpen] = useState(false);
  const [isImportCsvOpen, setIsImportCsvOpen] = useState(false);
  const [ddlDropTarget, setDdlDropTarget] = useState<{ schema: string; name: string } | null>(null);
  const [ddlRenameTarget, setDdlRenameTarget] = useState<{ schema: string; name: string } | null>(null);
  const [ddlAddColumnTarget, setDdlAddColumnTarget] = useState<{ schema: string; name: string } | null>(null);
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
  const [rlsPoliciesTarget, setRlsPoliciesTarget] = useState<{ schema: string; name: string } | null>(null);
  const [ddlViewTarget, setDdlViewTarget] = useState<{ schema: string; name: string } | null>(null);
  const [schemaExportTarget, setSchemaExportTarget] = useState<{ schema: string; name: string } | null>(null);
  const [rlsPolicies, setRlsPolicies] = useState<SchemaPolicy[]>([]);
  const [isLoadingRlsPolicies, setIsLoadingRlsPolicies] = useState(false);
  const queryClient = useQueryClient();

  // Section flags - definidas antes de serem usadas
  const isTablesSection = activeSection === "tables";
  const isSqlEditorSection = activeSection === "sql-editor";
  const isOverviewSection = activeSection === "overview";
  const isVisualizerSection = activeSection === "visualizer";
  const isDefinitionsSection = activeSection === "definitions";
  const tabChrome = useMemo<ConnectionTabChrome | undefined>(() => {
    if (isTablesSection && isSidebarVisible) return "tables-sidebar";
    if (isSqlEditorSection) return "sql-sidebar";
    return undefined;
  }, [isTablesSection, isSidebarVisible, isSqlEditorSection]);
  const tabChromeWidthPx = useMemo(() => {
    if (isTablesSection && isSidebarVisible) return tablesSidebarWidthPx;
    if (isSqlEditorSection) return sqlSidebarWidthPx;
    return 0;
  }, [isTablesSection, isSidebarVisible, tablesSidebarWidthPx, isSqlEditorSection, sqlSidebarWidthPx]);

  const connectionProvider = useMemo(
    () => connection ? detectConnectionProvider(connection) : undefined,
    [connection],
  );

  // Ensure a tab exists for this connection (handles page refresh / direct URL)
  // This is synchronizing with an external store (zustand) — a valid use of Effect.
  useEffect(() => {
    if (!connection) return;
    const store = useConnectionTabsStore.getState();
    if (!store.tabs.some((t) => t.id === connectionId)) {
      store.addTab(buildConnectionTab(connection));
    } else if (store.activeTabId !== connectionId) {
      store.setActiveTab(connectionId);
    }
  }, [connection, connectionId]);

  // Auto-select first schema when schemas load and none is selected
  useEffect(() => {
    if (schemas.length > 0 && !storedTab?.lastSchema && selectedSchema === (storedTab?.lastSchema ?? "public")) {
      const defaultSchema = schemas.includes("public") ? "public" : schemas[0];
      if (selectedSchema !== defaultSchema) {
        setSelectedSchema(defaultSchema);
      }
    }
  }, [schemas, storedTab?.lastSchema, selectedSchema]);

  const isLoading = isLoadingSchema;

  useEffect(() => {
    updateTab(connectionId, { chrome: tabChrome });
  }, [connectionId, tabChrome, updateTab]);

  useEffect(() => {
    if (tabWidthUpdateTimeoutRef.current) clearTimeout(tabWidthUpdateTimeoutRef.current);
    tabWidthUpdateTimeoutRef.current = setTimeout(() => {
      updateTab(connectionId, { chromeWidthPx: tabChromeWidthPx });
    }, 120);
    return () => {
      if (tabWidthUpdateTimeoutRef.current) clearTimeout(tabWidthUpdateTimeoutRef.current);
    };
  }, [connectionId, tabChromeWidthPx, updateTab]);

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
  }, [connectionId]);

  // Load database info (including size) on mount when overview section is active
  useEffect(() => {
    if (!isActive) return;
    if (activeSection === "overview") {
      loadDatabaseInfo();
    }
  }, [isActive, activeSection, loadDatabaseInfo]);

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
    () => ["selected-schema-details", connectionId, selectedSchema, tables.length] as const,
    [connectionId, selectedSchema, tables.length],
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
    // This eliminates the 50-parallel getTableDetails calls that fired on
    // every page load even when the user was just browsing tables.
    enabled: isActive && tables.length > 0 && selectedSchema.length > 0 &&
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

  const changeSection = useCallback((section: SidebarSection) => {
    setActiveSection(section);
    setTabNavState(connectionId, {
      section,
      schema: selectedSchema,
      table: selectedTableKey ?? undefined,
    });
    if (section === "overview") {
      loadDatabaseInfo();
    }
  }, [connectionId, selectedSchema, selectedTableKey, setTabNavState, loadDatabaseInfo]);

  const changeSchema = useCallback((schema: string) => {
    setSelectedSchema(schema);
    setTabNavState(connectionId, {
      section: activeSection,
      schema,
      table: selectedTableKey ?? undefined,
    });
  }, [connectionId, activeSection, selectedTableKey, setTabNavState]);

  const changeTable = useCallback((tableKey: string | null) => {
    // Mark the (potentially expensive) table switch as a non-urgent transition
    // so React can prioritize the click feedback (highlight, focus) and
    // interrupt if the user quickly clicks another table.
    startTransition(() => {
      setSelectedTableKey(tableKey);
    });
    setTabNavState(connectionId, {
      section: activeSection,
      schema: selectedSchema,
      table: tableKey ?? undefined,
    });
  }, [connectionId, activeSection, selectedSchema, setTabNavState]);

  // Stable ref for keyboard handler — avoids re-registering the listener
  // when changeSection/activeSection/toggleSidebar change (rerender-optimization)
  const keyboardHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyboardHandlerRef.current = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (e.target as HTMLElement)?.isContentEditable) return;
    const el = e.target as HTMLElement;
    if (el.closest(".monaco-editor, [data-monaco-editor], .cm-editor")) return;
    if (document.querySelector("[data-radix-select-viewport], [data-radix-popper-content-wrapper]")) return;

    const section = SECTION_SHORTCUTS[e.key];
    if (section && section !== activeSection) {
      e.preventDefault();
      changeSection(section);
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b" && isTablesSection) {
      e.preventDefault();
      toggleSidebar();
    }

    // Cmd+R / Ctrl+R: Refresh schema
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "r") {
      e.preventDefault();
      handleRefresh();
    }
  };

  // Keyboard shortcuts: 1–5 switch sidebar sections — effect only depends on isActive
  useEffect(() => {
    if (!isActive) return;
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
      queryClient.invalidateQueries({ queryKey: ["selected-schema-details", connectionId] });
      if (activeSection === "overview") {
        loadDatabaseInfo();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to refresh");
    } finally {
      setIsRefreshing(false);
    }
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
      invalidateCache(); // Refresh shared cache so all tabs see the update
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
      invalidateCache(); // Refresh shared cache so all tabs see the update
      toast.success("Database paused");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to pause database");
    } finally {
      setIsTogglingLocalDb(false);
    }
  };

  const buildConnStr = useCallback(() => {
    if (!connection) return "";
    if (connection.url) return connection.url;
    const protocol = connection.db_type === "mysql" || connection.db_type === "mariadb" ? "mysql" : connection.db_type === "clickhouse" ? (connection.ssl_mode === "require" ? "clickhouses" : "clickhouse") : "postgres";
    const port = connection.db_type === "clickhouse" ? getClickhouseEffectivePort(connection.ssl_mode, connection.port) : connection.port;
    const sslParam = protocol === "mysql" ? `ssl=${connection.ssl_mode === "disable" ? "false" : "true"}` : protocol.startsWith("clickhouse") ? (connection.ssl_mode === "require" ? "ssl=true" : "") : `sslmode=${connection.ssl_mode}`;
    const queryPart = sslParam ? `?${sslParam}` : "";
    return `${protocol}://${connection.username}:${connection.password}@${connection.host}:${port}/${connection.database}${queryPart}`;
  }, [connection]);

  const handleCopyConnectionString = async () => {
    if (!connection) return;
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
    if (!connection) return;
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

  // Build a comprehensive schema context string for the AI assistant.
  // Includes table names, columns with types, primary keys, foreign keys,
  // and table relationships to help AI write accurate JOIN queries.
  const schemaContextForAi = useMemo(() => {
    if (tables.length === 0) return undefined;

    const lines: string[] = [];

    // Header with database overview
    lines.push(`Database Overview:`);
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
          `${tableKey}.${fk.column_name} → ${fk.referenced_schema ?? d.schema}.${fk.referenced_table}.${fk.referenced_column}`,
        );
      }
    }

    // Add relationship section if we have any FKs
    if (relationships.length > 0) {
      lines.push(`Known Foreign Key Relationships:`);
      for (const rel of relationships.slice(0, 20)) { // Cap at 20 to avoid token overflow
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
            const rowCount = t.estimated_row_count > 0 ? ` (~${t.estimated_row_count.toLocaleString()} rows)` : "";
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
              fkColumns.set(fk.column_name, `${fk.referenced_table}.${fk.referenced_column}`);
            }

            // Columns with PK/FK indicators
            const colLines: string[] = [];
            for (const c of detail.columns) {
              const pk = pkColumns.has(c.name) ? " [PK]" : "";
              const fk = fkColumns.get(c.name) ? ` → ${fkColumns.get(c.name)}` : "";
              const nullable = c.is_nullable ? "" : " [NOT NULL]";
              const defaultVal = c.column_default ? ` = ${c.column_default.slice(0, 30)}` : "";
              colLines.push(`  - ${c.name}: ${c.data_type}${nullable}${pk}${fk}${defaultVal}`);
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
      lines.push("- Use JOIN clauses based on the Foreign Key relationships shown above");
      lines.push("- Primary Keys (PK) are marked on columns");
      lines.push("- RLS = Row Level Security (PostgreSQL feature)");
      if (connection?.db_type === "postgresql") {
        lines.push("- For PostgreSQL: Use ILIKE for case-insensitive matching");
      }
    }

    return lines.join("\n");
  }, [tables, schemas, tablesBySchema, selectedSchema, selectedSchemaDetails, connection?.db_type]);

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
    if (!selectedTableKey) return null;
    const dotIdx = selectedTableKey.indexOf(".");
    if (dotIdx <= 0) return null;
    return {
      schema: selectedTableKey.slice(0, dotIdx),
      name: selectedTableKey.slice(dotIdx + 1),
    };
  }, [selectedTableKey]);

  const selectedTable = selectedTableRef?.name ?? null;

  // React Query for table details — gives us cache, keepPreviousData for smooth
  // transitions, and automatic revalidation. Trocar para uma tabela já visitada
  // é instantâneo (cache hit); primeira visita mostra skeleton.
  const tableDetailsQueryKey = useMemo(
    () => [
      "table-details",
      connectionId,
      selectedTableRef?.schema ?? null,
      selectedTableRef?.name ?? null,
    ] as const,
    [connectionId, selectedTableRef],
  );

  const {
    data: selectedTableDetails = null,
    isFetching: isFetchingTableDetails,
  } = useQuery({
    queryKey: tableDetailsQueryKey,
    queryFn: () => {
      if (!selectedTableRef) return null;
      return getTableDetails(connectionId, selectedTableRef.schema, selectedTableRef.name);
    },
    enabled: isActive && !!selectedTableRef,
    // Keep the previous table's details rendered while the new one loads —
    // header/chrome stays mounted; TableDataEditor gets isSwitchingTable=true.
    placeholderData: keepPreviousData,
    staleTime: 2 * 60_000,
    gcTime: 15 * 60_000,
  });

  const isLoadingTableDetails = isFetchingTableDetails;

  // Invalidate table details cache on DDL changes so next read refetches.
  const invalidateTableDetails = useCallback(
    (schema?: string, name?: string) => {
      if (schema && name) {
        queryClient.invalidateQueries({
          queryKey: ["table-details", connectionId, schema, name],
        });
      } else {
        queryClient.invalidateQueries({
          queryKey: ["table-details", connectionId],
        });
      }
      // Also invalidate the consolidated schema-details query used by
      // the AI context builder and visualizer, so they refresh after DDL.
      queryClient.invalidateQueries({
        queryKey: ["selected-schema-details", connectionId],
      });
    },
    [connectionId, queryClient],
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
      queryClient.prefetchQuery({
        queryKey: ["table-details", connectionId, schema, name],
        queryFn: () => getTableDetails(connectionId, schema, name),
        staleTime: 2 * 60_000,
      });
      queryClient.prefetchQuery({
        queryKey: [
          "table-rows",
          connectionId,
          schema,
          name,
          0, // page
          50, // default pageSize (matches TableDataEditor)
          [], // sort
          [], // filters
        ],
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
    [connectionId, queryClient],
  );

  const handleDropTableSuccess = useCallback(
    async (droppedKey: string) => {
      await handleDdlSuccess();
      if (selectedTableKey === droppedKey) {
        changeTable(null);
      }
    },
    [handleDdlSuccess, selectedTableKey, changeTable],
  );

  const handleRenameTableSuccess = useCallback(
    async (oldKey: string, newKey: string) => {
      await handleDdlSuccess();
      if (selectedTableKey === oldKey) {
        changeTable(newKey);
      }
    },
    [handleDdlSuccess, selectedTableKey, changeTable],
  );

  // Load table details when selected table changes
  // Load RLS policies when target changes
  useEffect(() => {
    if (!isActive) return;
    if (rlsPoliciesTarget) {
      const loadPolicies = async () => {
        setIsLoadingRlsPolicies(true);
        try {
          const details = await getTableDetails(connectionId, rlsPoliciesTarget.schema, rlsPoliciesTarget.name);
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

  const isLocalConnectionStopped = Boolean(
    connection.is_local &&
    !isLoadingLocalDbStatus &&
    (!localDbStatus || !localDbStatus.running),
  );

  if (isLocalConnectionStopped) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8">
        <Database className="h-12 w-12 text-muted-foreground mb-4" />
        <h2 className="text-lg font-semibold mb-2">Local database is paused</h2>
        <p className="text-muted-foreground mb-6 text-center max-w-md">
          Start this local database before accessing tables, schema, and queries.
        </p>
        <div className="flex items-center gap-2">
          <Button onClick={handleStartLocalDb} disabled={isTogglingLocalDb}>
            {isTogglingLocalDb ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Play className="h-4 w-4 mr-2" />
            )}
            Start local database
          </Button>
          <Button variant="outline" onClick={() => navigate({ to: "/" })}>
            Back to Connections
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 min-h-0 flex bg-transparent">
        <AnimatePresence initial={animateNavOnMount}>
          {isNavVisible && (
            <DatabaseNavSidebar
              connection={connection}
              provider={connectionProvider}
              activeSection={activeSection}
              onSectionChange={changeSection}
              onRefresh={handleRefresh}
              onCopyConnection={handleCopyConnection}
              isRefreshing={isRefreshing}
              copyFeedback={copyFeedback}
              onBackToConnections={handleBackToConnections}
            />
          )}
        </AnimatePresence>

        <div
          className="border-x border-b rounded-md flex-1 flex min-h-0 bg-background overflow-hidden"
        >
          {/* Main Content Area */}
          <div className="flex-1 min-w-0 flex flex-col min-h-0">
          {isTablesSection && (
            <ResizablePanelGroup
              className="flex-1 min-w-0"
              defaultLayout={isSidebarVisible ? tablesLayout.defaultLayout : undefined}
              onLayoutChanged={(layout) => {
                // Don't persist layout while sidebar is collapsed — avoids saving [0, 100]
                if (isSidebarVisible) {
                  tablesLayout.onLayoutChanged(layout);
                  // Update tab chrome width after drag ends (not per-pixel)
                  setTablesSidebarWidthPx(tablesSidebarWidthRef.current);
                }
              }}
            >
              {/* Tables Sidebar — always mounted, collapses to 0 for smooth animation */}
              <ResizablePanel
                id="tables-sidebar"
                defaultSize={isSidebarVisible ? 25 : 0}
                minSize="15%"
                maxSize="25%"
                collapsible
                collapsedSize={0}
                panelRef={sidebarPanelRef}
                onResize={handleSidebarResize}
                className={`min-w-0 ${isSidebarAnimating ? 'transition-[flex-grow] duration-200 ease-out' : ''}`}
              >
                <TablesExplorerSidebar
                  tablesBySchema={tablesBySchema}
                  filteredTables={filteredTablesForSchema}
                  schemas={schemas}
                  selectedSchema={selectedSchema}
                  selectedTableKey={selectedTableKey}
                  selectedTableRef={selectedTableRef}
                  tableSearch={tableSearch}
                  isLoading={isLoading}
                  onSchemaChange={changeSchema}
                  onTableSelect={changeTable}
                  onTableSearchChange={setTableSearch}
                  onPrefetchTable={prefetchTableDetails}
                  onCreateSchema={() => setIsCreateSchemaOpen(true)}
                  onCreateTable={() => setIsCreateTableOpen(true)}
                  onCreateIndex={() => setIsCreateIndexOpen(true)}
                  onImportCsv={() => setIsImportCsvOpen(true)}
                  onRenameTable={setDdlRenameTarget}
                  onDropTable={setDdlDropTarget}
                  onViewRlsPolicies={setRlsPoliciesTarget}
                  onViewDdl={setDdlViewTarget}
                  onExportSchema={setSchemaExportTarget}
                />
              </ResizablePanel>

              <ResizableHandle withHandle />

              {/* Main Panel */}
              <ResizablePanel id="tables-main" minSize={30} className={`min-w-0 ${isSidebarAnimating ? 'transition-[flex-grow] duration-200 ease-out' : ''}`}>
                {(() => {
                  if (!selectedTable) {
                    return (
                      <div className="h-full flex items-center justify-center p-8">
                        <div className="text-center space-y-3">
                          <div className="mx-auto w-fit rounded-full bg-muted/40 p-3">
                            <Database className="h-5 w-5 text-muted-foreground/50" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-muted-foreground">
                              Select a table
                            </p>
                            <p className="text-xs text-muted-foreground/60 mt-0.5">
                              {isSidebarVisible
                                ? "Choose a table from the sidebar to get started"
                                : "Show the explorer sidebar to select a table"}
                            </p>
                          </div>
                          {!isSidebarVisible && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={toggleSidebar}
                              className="mt-1"
                            >
                              <Database className="h-3.5 w-3.5 mr-1.5" />
                              Show explorer
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  }

                  if (!selectedTableDetails) {
                    return (
                      <div className="h-full flex items-center justify-center p-8">
                        <div className="flex items-center gap-3 text-muted-foreground">
                          {isLoadingTableDetails ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" />
                              <span className="text-sm">
                                Loading {selectedTableRef?.schema}.{selectedTable}…
                              </span>
                            </>
                          ) : (
                            <span className="text-sm">Failed to load table details</span>
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
                  const isSwitching = isLoadingTableDetails && !detailsMatch;

                  return (
                    <TableDataEditor
                      connectionId={connectionId}
                      table={td}
                      tableListRows={tableListRows}
                      tableSaveChanges={tableSaveChanges}
                      tableTruncate={tableTruncate}
                      tableFkLookup={tableFkLookup}
                      isSwitchingTable={isSwitching}
                      isSidebarVisible={isSidebarVisible}
                      onToggleSidebar={toggleSidebar}
                      onRequestAddColumn={() =>
                        setDdlAddColumnTarget({
                          schema: td.schema,
                          name: td.name,
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
                      onRequestAlterColumnType={(column) =>
                        setDdlAlterColumnTypeTarget({
                          schema: td.schema,
                          table: td.name,
                          column: column.name,
                          currentType: column.data_type,
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
                    />
                  );
                })()}
              </ResizablePanel>
            </ResizablePanelGroup>
          )}
          {isSqlEditorSection && (
            <Suspense fallback={<div className="flex-1 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}>
              <SqlEditor
                key={connectionId}
                connections={connections}
                selectedConnection={connectionId}
                onSelectConnection={(id) => {
                  navigate({ to: "/database/$connectionId", params: { connectionId: id } });
                }}
                executeQuery={executeQuery}
                showWorkspaceSidebar={true}
                onWorkspaceSidebarResize={setSqlSidebarWidthPx}
                dbType={connection.db_type || "postgresql"}
                schemaContext={schemaContextForAi}
                schemaCompletionData={schemaCompletionData}
                isRouteActive={isActive}
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
            </Suspense>
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
              onNewQuery={() => changeSection("sql-editor")}
              onTestConnection={handleTestConnection}
              onViewTables={() => changeSection("tables")}
              onStartLocalDb={handleStartLocalDb}
              onPauseLocalDb={handlePauseLocalDb}
              connectionString={buildConnStr()}
              copyConnectionStringFeedback={copyConnFeedback}
              onCopyConnectionString={handleCopyConnectionString}
            />
          )}
          {isVisualizerSection && (
            <Suspense fallback={<div className="flex-1 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /><span className="ml-2 text-sm text-muted-foreground">Loading schema...</span></div>}>
              <div className="flex-1 min-w-0 min-h-0">
                {isLoadingVisualizer ? (
                  <div className="flex h-full items-center justify-center">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    <span className="ml-2 text-sm text-muted-foreground">Loading schema...</span>
                  </div>
                ) : visualizerTables.length === 0 ? (
                  <div className="flex h-full items-center justify-center">
                    <p className="text-muted-foreground">No tables to visualize</p>
                  </div>
                ) : (
                  <SchemaVisualizer
                    tables={visualizerTables}
                    schemas={schemas}
                    currentSchema={selectedSchema}
                    onSchemaChange={changeSchema}
                    onTableClick={(schema, table) => {
                      changeSection("tables");
                      changeSchema(schema);
                      changeTable(`${schema}.${table}`);
                    }}
                    isLoading={isLoadingVisualizer}
                    onNavigateToTables={() => changeSection("tables")}
                  />
                )}
              </div>
            </Suspense>
          )}
          {isDefinitionsSection && (
            <Suspense fallback={<div className="flex-1 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /><span className="ml-2 text-sm text-muted-foreground">Loading definitions...</span></div>}>
              <DefinitionsBrowserPanel
                connectionId={connectionId}
                dbType={connection.db_type || "postgresql"}
                schemas={schemas}
                selectedSchema={selectedSchema}
                onSchemaChange={changeSchema}
              />
            </Suspense>
          )}
        </div>
        </div>
      </div>
      {/* Lazy-loaded DDL dialogs — Suspense boundary for all of them */}
      <Suspense fallback={null}>
      {connection && selectedSchema && (
        <CreateTableDialog
          isOpen={isCreateTableOpen}
          onClose={() => setIsCreateTableOpen(false)}
          connectionId={connection.id}
          schema={selectedSchema}
          createTable={createTable}
          onSuccess={() => {
            void handleDdlSuccess();
          }}
        />
      )}
      {connection && ddlDropTarget && (
        <DropTableDialog
          isOpen
          onClose={() => setDdlDropTarget(null)}
          connectionId={connection.id}
          schema={ddlDropTarget.schema}
          tableName={ddlDropTarget.name}
          dropTable={dropTable}
          onSuccess={() => {
            void handleDropTableSuccess(`${ddlDropTarget.schema}.${ddlDropTarget.name}`);
          }}
        />
      )}
      {connection && ddlRenameTarget && (
        <RenameTableDialog
          isOpen
          onClose={() => setDdlRenameTarget(null)}
          connectionId={connection.id}
          schema={ddlRenameTarget.schema}
          currentName={ddlRenameTarget.name}
          renameTable={renameTable}
          onSuccess={() => {
            void handleRenameTableSuccess(
              `${ddlRenameTarget.schema}.${ddlRenameTarget.name}`,
              `${ddlRenameTarget.schema}.${ddlRenameTarget.name}`,
            );
          }}
        />
      )}
      {connection && ddlAddColumnTarget && (
        <AddColumnDialog
          isOpen
          onClose={() => setDdlAddColumnTarget(null)}
          connectionId={connection.id}
          schema={ddlAddColumnTarget.schema}
          tableName={ddlAddColumnTarget.name}
          addColumn={addColumn}
          onSuccess={() => {
            void handleDdlSuccess();
          }}
        />
      )}
      {connection && ddlDropColumnTarget && (
        <DropColumnDialog
          isOpen
          onClose={() => setDdlDropColumnTarget(null)}
          connectionId={connection.id}
          schema={ddlDropColumnTarget.schema}
          tableName={ddlDropColumnTarget.table}
          columnName={ddlDropColumnTarget.column}
          dropColumn={dropColumn}
          onSuccess={() => {
            void handleDdlSuccess();
          }}
        />
      )}
      {connection && ddlRenameColumnTarget && (
        <RenameColumnDialog
          isOpen
          onClose={() => setDdlRenameColumnTarget(null)}
          connectionId={connection.id}
          schema={ddlRenameColumnTarget.schema}
          tableName={ddlRenameColumnTarget.table}
          currentName={ddlRenameColumnTarget.column}
          renameColumn={renameColumn}
          onSuccess={() => {
            void handleDdlSuccess();
          }}
        />
      )}
      {connection && ddlAlterColumnTypeTarget && (
        <AlterColumnTypeDialog
          isOpen
          onClose={() => setDdlAlterColumnTypeTarget(null)}
          connectionId={connection.id}
          schema={ddlAlterColumnTypeTarget.schema}
          tableName={ddlAlterColumnTypeTarget.table}
          columnName={ddlAlterColumnTypeTarget.column}
          currentType={ddlAlterColumnTypeTarget.currentType}
          alterColumnType={alterColumnType}
          onSuccess={() => {
            void handleDdlSuccess();
          }}
        />
      )}
      {connection && ddlSetColumnDefaultTarget && (
        <SetColumnDefaultDialog
          isOpen
          onClose={() => setDdlSetColumnDefaultTarget(null)}
          connectionId={connection.id}
          schema={ddlSetColumnDefaultTarget.schema}
          tableName={ddlSetColumnDefaultTarget.table}
          columnName={ddlSetColumnDefaultTarget.column}
          currentDefault={ddlSetColumnDefaultTarget.currentDefault}
          setColumnDefault={setColumnDefault}
          onSuccess={() => {
            void handleDdlSuccess();
          }}
        />
      )}
      {connection && ddlSetColumnNullableTarget && (
        <SetColumnNullableDialog
          isOpen
          onClose={() => setDdlSetColumnNullableTarget(null)}
          connectionId={connection.id}
          schema={ddlSetColumnNullableTarget.schema}
          tableName={ddlSetColumnNullableTarget.table}
          columnName={ddlSetColumnNullableTarget.column}
          isCurrentlyNullable={ddlSetColumnNullableTarget.isNullable}
          setColumnNullable={setColumnNullable}
          onSuccess={() => {
            void handleDdlSuccess();
          }}
        />
      )}
      {connection && (
        <CreateSchemaDialog
          isOpen={isCreateSchemaOpen}
          onClose={() => setIsCreateSchemaOpen(false)}
          connectionId={connection.id}
          createSchema={createSchema}
          onSuccess={() => {
            void handleDdlSuccess();
          }}
        />
      )}
      {connection && selectedSchema && (
        <CreateIndexDialog
          isOpen={isCreateIndexOpen}
          onClose={() => setIsCreateIndexOpen(false)}
          connectionId={connection.id}
          schema={selectedSchema}
          defaultTableName={selectedTableRef?.name ?? ""}
          createIndex={createIndex}
          onSuccess={() => {
            void handleDdlSuccess();
          }}
        />
      )}
      {connection && selectedSchema && (
        <ImportCsvDialog
          isOpen={isImportCsvOpen}
          onClose={() => setIsImportCsvOpen(false)}
          connectionId={connection.id}
          schema={selectedSchema}
          defaultTableName={selectedTableRef?.name ?? ""}
          tableSaveChanges={tableSaveChanges}
          onSuccess={() => {
            void handleDdlSuccess();
          }}
        />
      )}
      {rlsPoliciesTarget && (
        <RlsPoliciesDialog
          isOpen={Boolean(rlsPoliciesTarget)}
          onClose={() => setRlsPoliciesTarget(null)}
          schema={rlsPoliciesTarget.schema}
          tableName={rlsPoliciesTarget.name}
          policies={rlsPolicies}
        />
      )}
      {ddlViewTarget && (
        <ViewDdlDialog
          isOpen
          onClose={() => setDdlViewTarget(null)}
          connectionId={connection.id}
          schema={ddlViewTarget.schema}
          tableName={ddlViewTarget.name}
          dbType={connection.db_type || "postgresql"}
          cachedDetails={
            selectedTableDetails &&
            selectedTableDetails.schema === ddlViewTarget.schema &&
            selectedTableDetails.name === ddlViewTarget.name
              ? selectedTableDetails
              : null
          }
        />
      )}
      {schemaExportTarget && (
        <SchemaExportDialog
          isOpen
          onClose={() => setSchemaExportTarget(null)}
          connectionId={connection.id}
          schema={schemaExportTarget.schema}
          tableName={schemaExportTarget.name}
          dbType={connection.db_type || "postgresql"}
          cachedDetails={
            selectedTableDetails &&
            selectedTableDetails.schema === schemaExportTarget.schema &&
            selectedTableDetails.name === schemaExportTarget.name
              ? selectedTableDetails
              : null
          }
        />
      )}
      </Suspense>
    </div>
  );
}
