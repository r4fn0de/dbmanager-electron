import { useQuery, useQueryClient } from "@tanstack/react-query";
import { dbQueryKeys, dbQueryOptions } from "@/lib/query-options";
import { useVirtualizer } from "@tanstack/react-virtual";
import { IconArrowsDiagonal2 } from "@tabler/icons-react";
import { Database, KeyRound, Link2, ShieldCheck } from "lucide-react";
import {
  forwardRef,
  type ForwardedRef,
  useCallback,
  useDeferredValue,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { setUnsavedChanges as setWindowUnsavedChanges } from "@/features/shell/actions/window";
import { Icon as UiIcon } from "@/components/ui/Icon";
import { CellExpandPopover } from "../CellExpandPopover";
import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  FkLookupResponse,
  SchemaColumn,
  SchemaForeignKey,
  TableFilter,
  TableRef,
  TableSort,
} from "@/ipc/db/types";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type {
  TableDataEditorProps,
  RowRecord,
  RowUpdateDraft,
  DeleteDraft,
  TableDataEditorHandle,
} from "./types";
import { quoteIdentifier, quoteValue } from "./utils/sqlHelpers";
import { normalizeDisplay, getCellTitle, parseByType } from "./utils/valueParsers";
import { buildEffectiveRows, getGridCellIndex } from "./utils/tableDataTransforms";
import { createTableEditorPerfTracker } from "./utils/performance";
import { TableEditorFooter } from "./components/TableEditorFooter";
import { TableEditorDialogs } from "./components/TableEditorDialogs";
import { TableEditorRowDetailsOverlay } from "./components/TableEditorRowDetailsOverlay";
import { TableEditorGrid } from "./components/TableEditorGrid";

function getDefaultColumnWidth(column: SchemaColumn): number {
  const name = column.name.toLowerCase();
  const type = column.data_type.toLowerCase();
  const udt = (column.udt_name ?? "").toLowerCase();

  // Larguras compactas estilo Neon/Supabase - baseadas no conteúdo típico
  if (/(^|_)id$/.test(name) || /(^|_)id_/.test(name)) return 140;
  if (/(bool)/.test(type)) return 80;
  if (/(timestamp|timestamptz)/.test(type)) return 170;
  if (/(date)/.test(type)) return 100;
  if (/(time)/.test(type)) return 90;
  if (/(uuid)/.test(type)) return 220;
  if (/(json|jsonb)/.test(type)) return 200;
  if (/(int|serial|smallint)/.test(type)) return 90;
  if (/(bigint)/.test(type)) return 120;
  if (/(numeric|decimal)/.test(type)) return 120;
  if (/(double|real|float)/.test(type)) return 110;
  if (/(text|varchar|char)/.test(type)) return 150;
  if (/(bytea)/.test(type)) return 180;
  if (/(inet|cidr)/.test(type)) return 130;
  if (/(macaddr)/.test(type)) return 110;
  if (type === "array" || udt.startsWith("_") || type.endsWith("[]"))
    return 180;
  if (type === "user-defined" || type === "USER-DEFINED".toLowerCase())
    return 140;

  return 120;
}

function TableDataEditorInner({
  connectionId,
  table,
  tableSaveChanges,
  tableTruncate,
  tableFkLookup,
  onOpenRelatedTable,
  isSwitchingTable = false,
  onRequestAddColumn,
  onRequestDropColumn,
  onRequestRenameColumn,
  onRequestAlterColumnType,
  onRequestSetColumnDefault,
  onRequestSetColumnNullable,
  isSidebarVisible = true,
  onToggleSidebar,
  onSeedData,
  onExportData,
  tableKey: externalTableKey,
  onDirtyChange,
  disableWindowUnsavedTracking = false,
}: TableDataEditorProps, ref: ForwardedRef<TableDataEditorHandle>) {
  const pressableClass =
    "transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]";

  const pressableTextClass = "transition-colors duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]";

  const tableRef = useMemo<TableRef>(
    () => ({ connectionId, schema: table.schema, table: table.name }),
    [connectionId, table.name, table.schema],
  );

  const tableKey = `${connectionId}::${table.schema}.${table.name}`;
  const perfTrackerRef = useRef(createTableEditorPerfTracker());
  const pendingEditPerfRowKeyRef = useRef<string | null>(null);

  const queryClient = useQueryClient();

  const [isSaving, setIsSaving] = useState(false);
  const [isTruncating, setIsTruncating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const defaultVisibleColumns = useMemo(
    () => table.columns.map((column) => column.name),
    [table.columns],
  );
  const defaultFilterColumn = table.columns[0]?.name ?? "";

  type TableViewState = {
    page: number;
    pageSize: number;
    sort: TableSort[];
    filterColumn: string;
    filterValue: string;
    visibleColumns: string[];
    columnWidths: Record<string, number>;
  };

  const viewStateByTableRef = useRef<Map<string, TableViewState>>(new Map());
  const previousTableKeyRef = useRef<string>(tableKey);

  const getInitialViewState = (): TableViewState => {
    const saved = viewStateByTableRef.current.get(tableKey);
    if (saved) return saved;
    return {
      page: 0,
      pageSize: 50,
      sort: [],
      filterColumn: defaultFilterColumn,
      filterValue: "",
      visibleColumns: defaultVisibleColumns,
      columnWidths: {},
    };
  };

  const [page, setPage] = useState<number>(() => getInitialViewState().page);
  const [pageSize, setPageSize] = useState<number>(
    () => getInitialViewState().pageSize,
  );
  const [sort, setSort] = useState<TableSort[]>(
    () => getInitialViewState().sort,
  );
  const [filterColumn, setFilterColumn] = useState<string>(
    () => getInitialViewState().filterColumn,
  );
  const [filterValue, setFilterValue] = useState<string>(
    () => getInitialViewState().filterValue,
  );
  const [showFilters, setShowFilters] = useState(false);

  const [visibleColumns, setVisibleColumns] = useState<string[]>(
    () => getInitialViewState().visibleColumns,
  );

  const [draftInserts, setDraftInserts] = useState<RowRecord[]>([]);
  const [draftUpdates, setDraftUpdates] = useState<
    Record<string, RowUpdateDraft>
  >({});
  const [draftDeletes, setDraftDeletes] = useState<Record<string, DeleteDraft>>(
    {},
  );
  const draftsByTableRef = useRef<
    Map<
      string,
      {
        inserts: RowRecord[];
        updates: Record<string, RowUpdateDraft>;
        deletes: Record<string, DeleteDraft>;
      }
    >
  >(new Map());

  const [editingCell, setEditingCell] = useState<{
    rowKey: string;
    column: string;
    source: "existing" | "insert";
    insertIndex?: number;
  } | null>(null);
  const [editingValue, setEditingValue] = useState("");

  const [fkOptions, setFkOptions] = useState<FkLookupResponse | null>(null);
  const [isLoadingFk, setIsLoadingFk] = useState(false);
  const fkLookupRequestIdRef = useRef(0);
  const fkDebounceTimeoutRef = useRef<
    ReturnType<typeof setTimeout> | undefined
  >(undefined);

  const [pendingTruncate, setPendingTruncate] = useState(false);
  const [pendingBatchDelete, setPendingBatchDelete] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  // View mode: Data | Structure | JSON
  type ViewMode = "data" | "structure" | "json";
  const [viewMode, setViewMode] = useState<ViewMode>("data");

  // Row selection
  const [selectedRowKeys, setSelectedRowKeys] = useState<Set<string>>(
    new Set(),
  );
  const lastClickedRowRef = useRef<{ rowKey: string; index: number } | null>(
    null,
  );

  // Column resizing
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const resizeRef = useRef<{
    column: string;
    startX: number;
    startWidth: number;
  } | null>(null);
  const resizeRafRef = useRef<number | null>(null);
  const pendingResizeRef = useRef<{ column: string; width: number } | null>(
    null,
  );

  // Keyboard navigation – focused cell
  const [focusedCell, setFocusedCell] = useState<{
    rowKey: string;
    column: string;
  } | null>(null);
  const hoveredRowAnchorRef = useRef<null | {
    rowKey: string;
    row: RowRecord;
    index: number;
    top: number;
    left: number;
    width: number;
    height: number;
  }>(null);
  const floatingRowButtonRef = useRef<HTMLButtonElement>(null);
  const hoverClearTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [expandedRow, setExpandedRow] = useState<{
    rowKey: string;
    row: RowRecord;
    index: number;
  } | null>(null);
  const [expandedRowOutline, setExpandedRowOutline] = useState<null | {
    top: number;
    left: number;
    width: number;
    height: number;
  }>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);


  const liveViewStateRef = useRef({
    page,
    pageSize,
    sort,
    filterColumn,
    filterValue,
    visibleColumns,
    columnWidths,
  });
  liveViewStateRef.current = {
    page,
    pageSize,
    sort,
    filterColumn,
    filterValue,
    visibleColumns,
    columnWidths,
  };
  const liveDraftStateRef = useRef({
    inserts: draftInserts,
    updates: draftUpdates,
    deletes: draftDeletes,
  });
  liveDraftStateRef.current = {
    inserts: draftInserts,
    updates: draftUpdates,
    deletes: draftDeletes,
  };

  useEffect(() => {
    if (previousTableKeyRef.current === tableKey) return;

    perfTrackerRef.current.start("table_switch_to_first_usable_frame");
    viewStateByTableRef.current.set(
      previousTableKeyRef.current,
      liveViewStateRef.current,
    );
    draftsByTableRef.current.set(
      previousTableKeyRef.current,
      liveDraftStateRef.current,
    );

    const saved = viewStateByTableRef.current.get(tableKey);
    if (saved) {
      setPage(saved.page);
      setPageSize(saved.pageSize);
      setSort(saved.sort);
      setFilterColumn(saved.filterColumn);
      setFilterValue(saved.filterValue);
      setVisibleColumns(saved.visibleColumns);
      setColumnWidths(saved.columnWidths);
    } else {
      setPage(0);
      setPageSize(50);
      setSort([]);
      setFilterColumn(defaultFilterColumn);
      setFilterValue("");
      setVisibleColumns(defaultVisibleColumns);
      setColumnWidths({});
    }

    const savedDrafts = draftsByTableRef.current.get(tableKey);
    setDraftInserts(savedDrafts?.inserts ?? []);
    setDraftUpdates(savedDrafts?.updates ?? {});
    setDraftDeletes(savedDrafts?.deletes ?? {});
    setError(null);
    setSelectedRowKeys(new Set());
    setFocusedCell(null);

    previousTableKeyRef.current = tableKey;
  }, [tableKey, defaultFilterColumn, defaultVisibleColumns]);

  const deferredFilterValue = useDeferredValue(filterValue);

  const serverFilters = useMemo<TableFilter[]>(() => {
    if (!deferredFilterValue.trim() || !filterColumn) return [];
    return [
      {
        column: filterColumn,
        operator: "contains",
        value: deferredFilterValue.trim(),
      },
    ];
  }, [filterColumn, deferredFilterValue]);

  useEffect(() => {
    perfTrackerRef.current.start("sort_to_rows_settled");
    setPage((current) => (current === 0 ? current : 0));
  }, [sort, filterColumn, deferredFilterValue]);

  const {
    data: rowsResponse = null,
    isFetching: isLoading,
    error: rowsError,
  } = useQuery(dbQueryOptions.tableRows(
    connectionId, table.schema, table.name, page, pageSize, sort, serverFilters,
  ));

  useEffect(() => {
    if (!rowsError) {
      setError(null);
      return;
    }
    setError(
      rowsError instanceof Error
        ? rowsError.message
        : "Failed to load table rows",
    );
  }, [rowsError]);

  // Clear selection when page, sort, or filters change
  useEffect(() => {
    setSelectedRowKeys(new Set());
  }, [page, sort, serverFilters]);

  const primaryKey = rowsResponse?.primaryKey ?? [];
  const foreignKeys = rowsResponse?.foreignKeys ?? [];
  const foreignKeysByColumn = useMemo(() => {
    const map = new Map<string, SchemaForeignKey>();
    for (const fk of foreignKeys) {
      map.set(fk.column_name, fk);
    }
    return map;
  }, [foreignKeys]);

  const rows = rowsResponse?.rows ?? [];
  const isBlockingTableLoading = isLoading && !rowsResponse;

  const effectiveRows = useMemo(() => {
    return buildEffectiveRows(rows, primaryKey, draftDeletes);
  }, [rows, draftDeletes, primaryKey]);

  const effectiveRowsRef = useRef(effectiveRows);
  effectiveRowsRef.current = effectiveRows;

  useEffect(() => {
    if (isLoading) return;
    perfTrackerRef.current.end("filter_to_rows_painted", {
      rows: effectiveRows.length,
      page,
    });
    perfTrackerRef.current.end("sort_to_rows_settled", {
      rows: effectiveRows.length,
      page,
    });
    if (!isBlockingTableLoading) {
      requestAnimationFrame(() => {
        perfTrackerRef.current.end("table_switch_to_first_usable_frame", {
          rows: effectiveRows.length,
        });
      });
    }
  }, [isLoading, isBlockingTableLoading, effectiveRows.length, page]);

  useEffect(() => {
    if (!expandedRow) return;
    const stillExists = effectiveRows.some((entry) => entry.rowKey === expandedRow.rowKey);
    if (!stillExists) {
      setExpandedRow(null);
      setExpandedRowOutline(null);
    }
  }, [expandedRow, effectiveRows]);

  useEffect(() => {
    if (!expandedRow) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setExpandedRow(null);
        setExpandedRowOutline(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expandedRow]);

  useEffect(() => {
    const button = floatingRowButtonRef.current;
    if (!button) return;
    if (expandedRow) {
      button.style.opacity = "0";
      button.style.pointerEvents = "none";
      return;
    }
    if (hoveredRowAnchorRef.current) {
      button.style.opacity = "1";
      button.style.pointerEvents = "auto";
    }
  }, [expandedRow]);

  useEffect(() => {
    const clearHoverAnchor = () => {
      hoveredRowAnchorRef.current = null;
      const button = floatingRowButtonRef.current;
      if (button) {
        button.style.opacity = "0";
        button.style.pointerEvents = "none";
      }
    };
    window.addEventListener("resize", clearHoverAnchor);
    window.addEventListener("scroll", clearHoverAnchor, {
      capture: true,
      passive: true,
    });
    return () => {
      window.removeEventListener("resize", clearHoverAnchor);
      window.removeEventListener("scroll", clearHoverAnchor, true);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (hoverClearTimeoutRef.current) {
        clearTimeout(hoverClearTimeoutRef.current);
      }
    };
  }, []);

  // ── Row virtualization ────────────────────────────────────────
  const scrollRef = useRef<HTMLDivElement>(null);
  const ROW_HEIGHT = 28; // h-7 ≈ 28px
  const totalVirtualRows = draftInserts.length + effectiveRows.length;
  const rowVirtualizer = useVirtualizer({
    count: totalVirtualRows,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });
  const virtualItems = rowVirtualizer.getVirtualItems();

  const visibleInsertIndices = useMemo(
    () => new Set(virtualItems.reduce<number[]>((indices, virtualItem) => {
      if (virtualItem.index < draftInserts.length) {
        indices.push(virtualItem.index);
      }
      return indices;
    }, [])),
    [virtualItems, draftInserts.length],
  );
  const visibleEffectiveArrayIndices = useMemo(
    () => new Set(virtualItems.reduce<number[]>((indices, virtualItem) => {
      if (virtualItem.index >= draftInserts.length) {
        indices.push(virtualItem.index - draftInserts.length);
      }
      return indices;
    }, [])),
    [virtualItems, draftInserts.length],
  );

  // Memoized visible rows for rendering (preserves original indices)
  const visibleDraftInserts = useMemo<Array<{ row: RowRecord; insertIndex: number }>>(
    () => {
      const result: Array<{ row: RowRecord; insertIndex: number }> = [];
      for (let i = 0; i < draftInserts.length; i++) {
        if (visibleInsertIndices.has(i)) {
          result.push({ row: draftInserts[i], insertIndex: i });
        }
      }
      return result;
    },
    [draftInserts, visibleInsertIndices],
  );
  const visibleEffectiveRows = useMemo(
    () => effectiveRows.filter((_, arrayIdx) => visibleEffectiveArrayIndices.has(arrayIdx)),
    [effectiveRows, visibleEffectiveArrayIndices],
  );

  const topSpacerHeight = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const bottomSpacerHeight = virtualItems.length > 0
    ? rowVirtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end
    : 0;

  // Scroll focused cell into view when it moves outside the virtualized range
  useEffect(() => {
    if (!focusedCell) return;
    // Find the virtual index for the focused row
    const insertPrefix = `insert:`;
    if (focusedCell.rowKey.startsWith(insertPrefix)) {
      const insertIdx = Number(focusedCell.rowKey.slice(insertPrefix.length));
      if (!Number.isNaN(insertIdx)) {
        rowVirtualizer.scrollToIndex(insertIdx, { align: 'auto' });
      }
    } else {
      const effectiveIdx = effectiveRows.findIndex(r => r.rowKey === focusedCell.rowKey);
      if (effectiveIdx >= 0) {
        rowVirtualizer.scrollToIndex(draftInserts.length + effectiveIdx, { align: 'auto' });
      }
    }
  }, [focusedCell, draftInserts.length, effectiveRows, rowVirtualizer]);

  const dirtyCounts = useMemo(
    () => ({
      inserts: draftInserts.length,
      updates: Object.keys(draftUpdates).length,
      deletes: Object.keys(draftDeletes).length,
    }),
    [draftDeletes, draftInserts.length, draftUpdates],
  );

  const hasDraftChanges =
    dirtyCounts.inserts + dirtyCounts.updates + dirtyCounts.deletes > 0;

  const structureStats = useMemo(() => {
    const nullableCount = table.columns.filter((column) => column.is_nullable).length;
    const defaultCount = table.columns.filter((column) => column.column_default !== null).length;
    return {
      columns: table.columns.length,
      nullable: nullableCount,
      notNull: table.columns.length - nullableCount,
      defaults: defaultCount,
      primaryKeys: primaryKey.length,
      foreignKeys: foreignKeys.length,
      hasRls: table.has_rls,
    };
  }, [foreignKeys.length, primaryKey.length, table.columns, table.has_rls]);

  useEffect(() => {
    if (!pendingEditPerfRowKeyRef.current) return;
    perfTrackerRef.current.end("edit_confirm_to_draft_updated", {
      rowKey: pendingEditPerfRowKeyRef.current,
    });
    pendingEditPerfRowKeyRef.current = null;
  }, [draftInserts, draftUpdates]);

  useEffect(() => {
    if (!externalTableKey || !onDirtyChange) return;
    onDirtyChange(externalTableKey, hasDraftChanges);
  }, [hasDraftChanges, onDirtyChange, externalTableKey]);

  useEffect(() => {
    if (disableWindowUnsavedTracking) return;
    const scope = `table:${connectionId}:${table.schema}.${table.name}`;
    void setWindowUnsavedChanges(scope, hasDraftChanges);
    return () => {
      void setWindowUnsavedChanges(scope, false);
    };
  }, [
    connectionId,
    table.schema,
    table.name,
    hasDraftChanges,
    disableWindowUnsavedTracking,
  ]);

  const columnMap = useMemo(() => {
    const map: Record<string, SchemaColumn> = {};
    for (const column of table.columns) {
      map[column.name] = column;
    }
    return map;
  }, [table.columns]);

  const [ddlColumnName, setDdlColumnName] = useState(
    table.columns[0]?.name ?? "",
  );

  useEffect(() => {
    if (table.columns.length === 0) {
      setDdlColumnName("");
      return;
    }
    if (!table.columns.some((c) => c.name === ddlColumnName)) {
      setDdlColumnName(table.columns[0].name);
    }
  }, [ddlColumnName, table.columns]);

  const defaultColumnWidths = useMemo(() => {
    const map: Record<string, number> = {};
    for (const column of table.columns) {
      map[column.name] = getDefaultColumnWidth(column);
    }
    return map;
  }, [table.columns]);

  const resolveColumnWidth = useCallback(
    (columnName: string) =>
      columnWidths[columnName] ?? defaultColumnWidths[columnName] ?? 200,
    [columnWidths, defaultColumnWidths],
  );

  const findFkForColumn = useCallback(
    (column: string): SchemaForeignKey | undefined =>
      foreignKeysByColumn.get(column),
    [foreignKeysByColumn],
  );

  const loadFkOptions = useCallback(
    async (columnName: string, query: string) => {
      const fk = findFkForColumn(columnName);
      if (!fk) {
        setFkOptions(null);
        setIsLoadingFk(false);
        return;
      }

      const requestId = ++fkLookupRequestIdRef.current;
      setIsLoadingFk(true);
      try {
        const response = await tableFkLookup({
          tableRef,
          column: columnName,
          query,
          page: 0,
          pageSize: 8,
        });
        if (requestId === fkLookupRequestIdRef.current) {
          setFkOptions(response);
        }
      } catch {
        if (requestId === fkLookupRequestIdRef.current) {
          setFkOptions(null);
        }
      } finally {
        if (requestId === fkLookupRequestIdRef.current) {
          setIsLoadingFk(false);
        }
      }
    },
    [findFkForColumn, tableFkLookup, tableRef],
  );

  const loadFkOptionsDebounced = useCallback(
    (columnName: string, query: string) => {
      if (fkDebounceTimeoutRef.current) clearTimeout(fkDebounceTimeoutRef.current);
      fkDebounceTimeoutRef.current = setTimeout(() => {
        void loadFkOptions(columnName, query);
      }, 180);
    },
    [loadFkOptions],
  );

  useEffect(() => {
    return () => {
      if (fkDebounceTimeoutRef.current) clearTimeout(fkDebounceTimeoutRef.current);
    };
  }, []);

  const beginEditExistingCell = useCallback(
    (
      rowKey: string,
      row: RowRecord,
      columnName: string,
      options?: { selectAllOnFocus?: boolean },
    ) => {
      if (primaryKey.length === 0) return;

      const draftedValue = draftUpdates[rowKey]?.changes[columnName];
      const currentValue = draftedValue ?? row[columnName];
      suppressInlineEditorMouseUpRef.current =
        options?.selectAllOnFocus ?? true;
      setEditingCell({ rowKey, column: columnName, source: "existing" });
      setEditingValue(normalizeDisplay(currentValue));
      void loadFkOptions(columnName, normalizeDisplay(currentValue));
    },
    [primaryKey, draftUpdates, loadFkOptions],
  );

  const beginEditInsertCell = (
    insertIndex: number,
    columnName: string,
    options?: { selectAllOnFocus?: boolean },
  ) => {
    const value = draftInserts[insertIndex]?.[columnName];
    suppressInlineEditorMouseUpRef.current = options?.selectAllOnFocus ?? true;
    setEditingCell({
      rowKey: `insert:${insertIndex}`,
      column: columnName,
      source: "insert",
      insertIndex,
    });
    setEditingValue(normalizeDisplay(value ?? ""));
    void loadFkOptions(columnName, normalizeDisplay(value ?? ""));
  };

  const cancelEditing = () => {
    if (fkDebounceTimeoutRef.current) clearTimeout(fkDebounceTimeoutRef.current);
    fkLookupRequestIdRef.current += 1; // invalidate stale async responses
    setEditingCell(null);
    setEditingValue("");
    setFkOptions(null);
    setIsLoadingFk(false);
  };

  const keepCaretNavigationInsideInlineInput = (
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    // Do not let arrow navigation leak to the table/container while editing.
    if (
      event.key !== "ArrowLeft" &&
      event.key !== "ArrowRight" &&
      event.key !== "ArrowUp" &&
      event.key !== "ArrowDown"
    ) {
      return;
    }

    event.stopPropagation();

    const input = event.currentTarget;
    const start = input.selectionStart ?? 0;
    const end = input.selectionEnd ?? 0;
    const hasSelection = start !== end;

    if (event.key === "ArrowLeft" && !hasSelection && start === 0) {
      event.preventDefault();
    }

    if (
      event.key === "ArrowRight" &&
      !hasSelection &&
      end >= input.value.length
    ) {
      event.preventDefault();
    }

    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
    }
  };

  const persistEditing = (baseRow?: RowRecord) => {
    if (!editingCell) return;
    const column = columnMap[editingCell.column];
    if (!column) return;
    const parsed = parseByType(editingValue, column);

    if (editingCell.source === "insert") {
      pendingEditPerfRowKeyRef.current = editingCell.rowKey;
      perfTrackerRef.current.start("edit_confirm_to_draft_updated");
      const insertIndex = editingCell.insertIndex ?? 0;
      setDraftInserts((current) => {
        const next = [...current];
        const row = { ...(next[insertIndex] ?? {}) };
        row[editingCell.column] = parsed;
        next[insertIndex] = row;
        return next;
      });
      cancelEditing();
      return;
    }

    if (!baseRow) return;

    const originalValue = baseRow[editingCell.column];
    const unchanged = JSON.stringify(originalValue) === JSON.stringify(parsed);

    pendingEditPerfRowKeyRef.current = editingCell.rowKey;
    perfTrackerRef.current.start("edit_confirm_to_draft_updated");
    setDraftUpdates((current) => {
      const next = { ...current };
      const existing = next[editingCell.rowKey] ?? {
        primaryKey: Object.fromEntries(
          primaryKey.map((pk) => [pk, baseRow[pk]]),
        ),
        changes: {},
      };

      const changes = { ...existing.changes };
      if (unchanged) {
        delete changes[editingCell.column];
      } else {
        changes[editingCell.column] = parsed;
      }

      if (Object.keys(changes).length === 0) {
        delete next[editingCell.rowKey];
      } else {
        next[editingCell.rowKey] = { ...existing, changes };
      }

      return next;
    });

    cancelEditing();
  };

  /**
   * Aplica um valor editado no popover de expansão para uma linha existente.
   *
   * Difere de `persistEditing` por receber `rawText` + `baseRow` diretamente,
   * sem depender do estado `editingCell`/`editingValue` usado pela edição inline.
   */
  const applyExpandedEditToRow = useCallback(
    (
      rowKey: string,
      baseRow: RowRecord,
      columnName: string,
      rawText: string,
    ) => {
      if (primaryKey.length === 0) return;
      const column = columnMap[columnName];
      if (!column) return;

      const parsed = parseByType(rawText, column);
      const originalValue = baseRow[columnName];
      const unchanged =
        JSON.stringify(originalValue) === JSON.stringify(parsed);

      pendingEditPerfRowKeyRef.current = rowKey;
      perfTrackerRef.current.start("edit_confirm_to_draft_updated");
      setDraftUpdates((current) => {
        const next = { ...current };
        const existing = next[rowKey] ?? {
          primaryKey: Object.fromEntries(
            primaryKey.map((pk) => [pk, baseRow[pk]]),
          ),
          changes: {},
        };

        const changes = { ...existing.changes };
        if (unchanged) {
          delete changes[columnName];
        } else {
          changes[columnName] = parsed;
        }

        if (Object.keys(changes).length === 0) {
          delete next[rowKey];
        } else {
          next[rowKey] = { ...existing, changes };
        }

        return next;
      });
    },
    [columnMap, primaryKey],
  );

  /** Aplica um valor do popover em uma linha de insert em rascunho. */
  const applyExpandedEditToInsert = useCallback(
    (insertIndex: number, columnName: string, rawText: string) => {
      const column = columnMap[columnName];
      if (!column) return;
      const parsed = parseByType(rawText, column);

      pendingEditPerfRowKeyRef.current = `insert:${insertIndex}`;
      perfTrackerRef.current.start("edit_confirm_to_draft_updated");
      setDraftInserts((current) => {
        const next = [...current];
        const row = { ...(next[insertIndex] ?? {}) };
        row[columnName] = parsed;
        next[insertIndex] = row;
        return next;
      });
    },
    [columnMap],
  );

  const handleAddDraftRecord = () => {
    const row: RowRecord = {};
    for (const column of table.columns) {
      row[column.name] = null;
    }
    setDraftInserts((current) => [...current, row]);
  };

  const discardDrafts = () => {
    setDraftInserts([]);
    setDraftUpdates({});
    setDraftDeletes({});
    cancelEditing();
  };

  const saveAllChanges = async () => {
    if (!hasDraftChanges) return;

    setIsSaving(true);
    setError(null);
    try {
      const inserts = draftInserts.map((row) => {
        const clean: RowRecord = {};
        for (const [key, value] of Object.entries(row)) {
          if (value !== undefined) clean[key] = value;
        }
        return clean;
      });

      const updates = Object.values(draftUpdates).map((entry) => ({
        primaryKey: entry.primaryKey,
        changes: entry.changes,
      }));

      const deletes = Object.values(draftDeletes).map((entry) => ({
        primaryKey: entry.primaryKey,
      }));

      await tableSaveChanges({ tableRef, inserts, updates, deletes });
      discardDrafts();
      await queryClient.invalidateQueries({
        queryKey: dbQueryKeys.tableRowsPrefix(connectionId, table.schema, table.name),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save changes");
    } finally {
      setIsSaving(false);
    }
  };

  const saveAllDraftsAcrossTabs = useCallback(async () => {
    const draftsSnapshot = new Map(draftsByTableRef.current);
    draftsSnapshot.set(tableKey, {
      inserts: draftInserts,
      updates: draftUpdates,
      deletes: draftDeletes,
    });

    for (const [key, draftState] of draftsSnapshot.entries()) {
      const inserts = draftState.inserts.map((row) => {
        const clean: RowRecord = {};
        for (const [k, value] of Object.entries(row)) {
          if (value !== undefined) clean[k] = value;
        }
        return clean;
      });
      const updates = Object.values(draftState.updates).map((entry) => ({
        primaryKey: entry.primaryKey,
        changes: entry.changes,
      }));
      const deletes = Object.values(draftState.deletes).map((entry) => ({
        primaryKey: entry.primaryKey,
      }));
      if (inserts.length + updates.length + deletes.length === 0) continue;

      const scopedKey = key.includes("::") ? key.slice(key.indexOf("::") + 2) : key;
      const dotIdx = scopedKey.indexOf(".");
      if (dotIdx <= 0 || dotIdx === scopedKey.length - 1) continue;
      const schema = scopedKey.slice(0, dotIdx);
      const tableName = scopedKey.slice(dotIdx + 1);

      await tableSaveChanges({
        tableRef: { connectionId, schema, table: tableName },
        inserts,
        updates,
        deletes,
      });
      draftsByTableRef.current.set(key, { inserts: [], updates: {}, deletes: {} });
      await queryClient.invalidateQueries({
        queryKey: dbQueryKeys.tableRowsPrefix(connectionId, schema, tableName),
      });
    }

    if (draftsByTableRef.current.get(tableKey)) {
      setDraftInserts([]);
      setDraftUpdates({});
      setDraftDeletes({});
    }
  }, [
    connectionId,
    draftDeletes,
    draftInserts,
    draftUpdates,
    queryClient,
    tableKey,
    tableSaveChanges,
  ]);

  useImperativeHandle(
    ref,
    () => ({
      saveAllChanges,
      saveAllDraftsAcrossTabs,
      discardAllChanges: discardDrafts,
      hasDraftChanges: () => hasDraftChanges,
    }),
    [discardDrafts, hasDraftChanges, saveAllDraftsAcrossTabs],
  );

  const truncateSqlPreview = `TRUNCATE TABLE ${quoteIdentifier(table.schema)}.${quoteIdentifier(table.name)};`;

  const runTruncate = async () => {
    setIsTruncating(true);
    setError(null);
    try {
      await tableTruncate(tableRef);
      discardDrafts();
      await queryClient.invalidateQueries({
        queryKey: dbQueryKeys.tableRowsPrefix(connectionId, table.schema, table.name),
      });
      setPendingTruncate(false);
      setConfirmText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to truncate table");
    } finally {
      setIsTruncating(false);
    }
  };

  const totalPages = useMemo(() => {
    const total = rowsResponse?.totalEstimate ?? 0;
    return Math.max(Math.ceil(total / pageSize), 1);
  }, [pageSize, rowsResponse?.totalEstimate]);

  useEffect(() => {
    if (!rowsResponse) return;
    const nextPage = page + 1;
    if (nextPage >= totalPages) return;
    void queryClient.prefetchQuery(
      dbQueryOptions.tableRows(
        connectionId,
        table.schema,
        table.name,
        nextPage,
        pageSize,
        sort,
        serverFilters,
      ),
    );
  }, [
    rowsResponse,
    page,
    totalPages,
    queryClient,
    connectionId,
    table.schema,
    table.name,
    pageSize,
    sort,
    serverFilters,
  ]);

  // ── Row selection ──────────────────────────────────────────────
  const allVisibleRowKeys = useMemo(
    () => new Set(effectiveRows.map((r) => r.rowKey)),
    [effectiveRows],
  );

  const isAllSelected =
    allVisibleRowKeys.size > 0 &&
    [...allVisibleRowKeys].every((key) => selectedRowKeys.has(key));

  const isSomeSelected =
    !isAllSelected &&
    [...allVisibleRowKeys].some((key) => selectedRowKeys.has(key));

  const toggleSelectAll = useCallback(() => {
    if (isAllSelected) {
      setSelectedRowKeys(new Set());
    } else {
      setSelectedRowKeys(new Set(allVisibleRowKeys));
    }
  }, [isAllSelected, allVisibleRowKeys]);

  const handleRowClick = useCallback(
    (rowKey: string, index: number, event: React.MouseEvent) => {
      const target = event.target as HTMLElement;
      if (
        target.closest(
          "input,textarea,select,button,a,[contenteditable='true']",
        )
      ) {
        return;
      }
      if (event.shiftKey && lastClickedRowRef.current) {
        const start = Math.min(lastClickedRowRef.current.index, index);
        const end = Math.max(lastClickedRowRef.current.index, index);
        const rangeKeys = effectiveRows
          .slice(start, end + 1)
          .map((r) => r.rowKey);
        setSelectedRowKeys((prev) => {
          const next = new Set(prev);
          for (const key of rangeKeys) next.add(key);
          return next;
        });
      } else if (event.metaKey || event.ctrlKey) {
        setSelectedRowKeys((prev) => {
          const next = new Set(prev);
          if (next.has(rowKey)) next.delete(rowKey);
          else next.add(rowKey);
          return next;
        });
      } else {
        setSelectedRowKeys((prev) => {
          // Clique simples na mesma linha alterna entre selecionar/desmarcar.
          if (prev.size === 1 && prev.has(rowKey)) return new Set();
          return new Set([rowKey]);
        });
      }
      lastClickedRowRef.current = { rowKey, index };
    },
    [effectiveRows],
  );

  const clearSelectionOnOutsideClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      if (target.closest('[data-row-selection-scope="row"]')) return;
      if (!focusedCell) return;
      setFocusedCell(null);
    },
    [focusedCell],
  );

  const batchDeleteSelected = useCallback(() => {
    if (primaryKey.length === 0) return;
    const toDelete: Record<string, DeleteDraft> = {};
    const effectiveRowsByKey = new Map(effectiveRows.map((entry) => [entry.rowKey, entry]));
    for (const rowKey of selectedRowKeys) {
      const entry = effectiveRowsByKey.get(rowKey);
      if (!entry) continue;
      const row = entry.row;
      const pk = Object.fromEntries(
        primaryKey.map((column) => [column, row[column]]),
      );
      const whereSql = primaryKey
        .map((column) => {
          const value = pk[column];
          return value === null || value === undefined
            ? `${quoteIdentifier(column)} IS NULL`
            : `${quoteIdentifier(column)} = ${quoteValue(value)}`;
        })
        .join(" AND ");
      toDelete[rowKey] = {
        rowKey,
        primaryKey: pk,
        sqlPreview: `DELETE FROM ${quoteIdentifier(table.schema)}.${quoteIdentifier(table.name)} WHERE ${whereSql};`,
      };
    }
    setDraftDeletes((current) => ({ ...current, ...toDelete }));
    setSelectedRowKeys(new Set());
  }, [primaryKey, selectedRowKeys, effectiveRows, table.schema, table.name]);

  const toggleRowSelection = useCallback((rowKey: string) => {
    setSelectedRowKeys((prev) => {
      const next = new Set(prev);
      if (next.has(rowKey)) next.delete(rowKey);
      else next.add(rowKey);
      return next;
    });
  }, []);

  const openRowDetails = useCallback((rowKey: string, row: RowRecord, index: number) => {
    setExpandedRow({
      rowKey,
      row: { ...row },
      index,
    });
  }, []);

  const closeRowDetails = useCallback(() => {
    setExpandedRow(null);
    setExpandedRowOutline(null);
  }, []);

  const cancelPendingHoverClear = useCallback(() => {
    if (!hoverClearTimeoutRef.current) return;
    clearTimeout(hoverClearTimeoutRef.current);
    hoverClearTimeoutRef.current = null;
  }, []);

  const scheduleHoverClear = useCallback(() => {
    cancelPendingHoverClear();
    hoverClearTimeoutRef.current = setTimeout(() => {
      hoveredRowAnchorRef.current = null;
      const button = floatingRowButtonRef.current;
      if (button) {
        button.style.opacity = "0";
        button.style.pointerEvents = "none";
      }
      hoverClearTimeoutRef.current = null;
    }, 180);
  }, [cancelPendingHoverClear]);

  const expandedRowFields = useMemo(() => {
    if (!expandedRow) return [];
    const sourceRow = effectiveRows.find((entry) => entry.rowKey === expandedRow.rowKey)?.row
      ?? expandedRow.row;
    const isInsertRow = expandedRow.rowKey.startsWith("insert:");
    const pendingChanges = draftUpdates[expandedRow.rowKey]?.changes ?? {};
    return table.columns.map((column) => {
      const value = sourceRow[column.name];
      return {
        name: column.name,
        type: column.data_type,
        value,
        textValue: normalizeDisplay(value),
        hasPendingChange: isInsertRow
          ? value !== null && value !== undefined
          : Object.prototype.hasOwnProperty.call(pendingChanges, column.name),
      };
    });
  }, [draftUpdates, effectiveRows, expandedRow, table.columns]);

  const handleFieldSaveInOverlay = useCallback((columnName: string, rawText: string) => {
    if (!expandedRow) return;
    if (expandedRow.rowKey.startsWith("insert:")) {
      const insertIndex = Number(expandedRow.rowKey.slice(7));
      if (!Number.isNaN(insertIndex)) {
        applyExpandedEditToInsert(insertIndex, columnName, rawText);
      }
      return;
    }

    const entry = effectiveRows.find((rowEntry) => rowEntry.rowKey === expandedRow.rowKey);
    if (!entry) return;
    applyExpandedEditToRow(expandedRow.rowKey, entry.row, columnName, rawText);
  }, [applyExpandedEditToInsert, applyExpandedEditToRow, effectiveRows, expandedRow]);

  const showFloatingRowButton = useCallback(
    (payload: {
      rowKey: string;
      row: RowRecord;
      index: number;
      top: number;
      left: number;
      width: number;
      height: number;
    }) => {
      hoveredRowAnchorRef.current = payload;
      const button = floatingRowButtonRef.current;
      if (!button) return;
      button.style.top = `${payload.top}px`;
      button.style.left = `${payload.left - 8}px`;
      button.style.opacity = expandedRow ? "0" : "1";
      button.style.pointerEvents = expandedRow ? "none" : "auto";
    },
    [expandedRow],
  );

  // ── Column resizing ───────────────────────────────────────────
  const columnWidthsRef = useRef(columnWidths);
  columnWidthsRef.current = columnWidths;
  const defaultColumnWidthsRef = useRef(defaultColumnWidths);
  defaultColumnWidthsRef.current = defaultColumnWidths;
  const suppressInlineEditorMouseUpRef = useRef(false);

  const handleResizeMouseDown = useCallback(
    (column: string, event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const currentWidth =
        columnWidthsRef.current[column] ??
        defaultColumnWidthsRef.current[column] ??
        200;
      resizeRef.current = {
        column,
        startX: event.clientX,
        startWidth: currentWidth,
      };
      const handleMouseMove = (e: MouseEvent) => {
        const resizeState = resizeRef.current;
        if (!resizeState) return;
        const delta = e.clientX - resizeState.startX;
        const newWidth = Math.max(60, resizeState.startWidth + delta);
        pendingResizeRef.current = { column: resizeState.column, width: newWidth };
        if (resizeRafRef.current !== null) return;
        resizeRafRef.current = requestAnimationFrame(() => {
          const pending = pendingResizeRef.current;
          resizeRafRef.current = null;
          if (!pending) return;
          setColumnWidths((prev) => {
            if (prev[pending.column] === pending.width) return prev;
            return {
              ...prev,
              [pending.column]: pending.width,
            };
          });
        });
      };
      const handleMouseUp = () => {
        resizeRef.current = null;
        pendingResizeRef.current = null;
        if (resizeRafRef.current !== null) {
          cancelAnimationFrame(resizeRafRef.current);
          resizeRafRef.current = null;
        }
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [],
  );

  useEffect(() => {
    return () => {
      if (resizeRafRef.current !== null) {
        cancelAnimationFrame(resizeRafRef.current);
        resizeRafRef.current = null;
      }
      pendingResizeRef.current = null;
    };
  }, []);

  // ── Keyboard navigation ───────────────────────────────────────
  const effectiveRowIndexByKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const [index, entry] of effectiveRows.entries()) {
      map.set(entry.rowKey, index);
    }
    return map;
  }, [effectiveRows]);

  const handleTableKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (editingCell) return; // let the Input handle its own keys
      if (!focusedCell) return;
      const currentRowIndex = effectiveRowIndexByKey.get(focusedCell.rowKey);
      const currentColumnIndex = visibleColumns.indexOf(focusedCell.column);
      if (currentRowIndex === undefined || currentColumnIndex === -1) return;
      const columnsCount = visibleColumns.length;
      if (columnsCount === 0) return;
      const rowsCount = effectiveRows.length;
      const totalCells = rowsCount * columnsCount;
      const currentCellIndex = getGridCellIndex(
        currentRowIndex,
        currentColumnIndex,
        columnsCount,
      );

      let nextIdx = currentCellIndex;

      switch (event.key) {
        case "ArrowRight":
          event.preventDefault();
          nextIdx = Math.min(currentCellIndex + 1, totalCells - 1);
          break;
        case "ArrowLeft":
          event.preventDefault();
          nextIdx = Math.max(currentCellIndex - 1, 0);
          break;
        case "ArrowDown":
          event.preventDefault();
          nextIdx = Math.min(currentCellIndex + columnsCount, totalCells - 1);
          break;
        case "ArrowUp":
          event.preventDefault();
          nextIdx = Math.max(currentCellIndex - columnsCount, 0);
          break;
        case "Tab":
          event.preventDefault();
          if (event.shiftKey) {
            nextIdx = Math.max(currentCellIndex - 1, 0);
          } else {
            nextIdx = Math.min(currentCellIndex + 1, totalCells - 1);
          }
          break;
        case "Enter": {
          event.preventDefault();
          // Enter on a focused cell starts editing
          const entry = effectiveRowsRef.current.find(
            (r) => r.rowKey === focusedCell.rowKey,
          );
          if (entry)
            beginEditExistingCell(
              focusedCell.rowKey,
              entry.row,
              focusedCell.column,
              { selectAllOnFocus: false },
            );
          return;
        }
        case "Escape":
          event.preventDefault();
          setFocusedCell(null);
          return;
        default:
          return;
      }

      const nextRowIndex = Math.floor(nextIdx / columnsCount);
      const nextColumnIndex = nextIdx % columnsCount;
      const nextRow = effectiveRows[nextRowIndex];
      const nextColumn = visibleColumns[nextColumnIndex];
      if (nextRow && nextColumn) {
        setFocusedCell({ rowKey: nextRow.rowKey, column: nextColumn });
      }
    },
    [
      editingCell,
      focusedCell,
      visibleColumns,
      effectiveRows,
      effectiveRowIndexByKey,
      beginEditExistingCell,
    ],
  );

  // ── Export CSV / JSON ──────────────────────────────────────────
  const exportData = useCallback(
    (format: "csv" | "json") => {
      const dataRows = effectiveRows.map(({ row }) => {
        const obj: Record<string, unknown> = {};
        for (const col of visibleColumns) {
          obj[col] = row[col] ?? null;
        }
        return obj;
      });

      let content: string;
      let mimeType: string;
      let extension: string;

      if (format === "json") {
        content = JSON.stringify(dataRows, null, 2);
        mimeType = "application/json";
        extension = "json";
      } else {
        const csvEscape = (v: unknown): string => {
          const s = normalizeDisplay(v);
          if (s.includes(",") || s.includes('"') || s.includes("\n")) {
            return `"${s.replaceAll('"', '""')}"`;
          }
          return s;
        };
        const header = visibleColumns.join(",");
        const rows = dataRows.map((row) =>
          visibleColumns.map((col) => csvEscape(row[col])).join(","),
        );
        content = [header, ...rows].join("\n");
        mimeType = "text/csv";
        extension = "csv";
      }

      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${table.schema}_${table.name}.${extension}`;
      a.click();
      URL.revokeObjectURL(url);
    },
    [effectiveRows, visibleColumns, table.schema, table.name],
  );

  // ── Copy TSV / JSON ────────────────────────────────────────────
  const copyAsTsv = useCallback(async () => {
    const dataRows = effectiveRows.map(({ row }) => {
      const obj: Record<string, unknown> = {};
      for (const col of visibleColumns) {
        obj[col] = row[col] ?? null;
      }
      return obj;
    });
    const tsvEscape = (v: unknown): string => {
      const s = normalizeDisplay(v);
      if (s.includes("\t") || s.includes("\n")) {
        return s.replaceAll("\t", " ").replaceAll("\n", " ");
      }
      return s;
    };
    const header = visibleColumns.join("\t");
    const rows = dataRows.map((row) =>
      visibleColumns.map((col) => tsvEscape(row[col])).join("\t"),
    );
    const tsv = [header, ...rows].join("\n");
    await navigator.clipboard.writeText(tsv);
    toast.success(`Copied ${dataRows.length} rows as TSV`);
  }, [effectiveRows, visibleColumns]);

  const copyAsJson = useCallback(async () => {
    const dataRows = effectiveRows.map(({ row }) => {
      const obj: Record<string, unknown> = {};
      for (const col of visibleColumns) {
        obj[col] = row[col] ?? null;
      }
      return obj;
    });
    const json = JSON.stringify(dataRows, null, 2);
    await navigator.clipboard.writeText(json);
    toast.success(`Copied ${dataRows.length} rows as JSON`);
  }, [effectiveRows, visibleColumns]);

  return (
    <div
      ref={editorContainerRef}
      className="relative h-full flex flex-col min-h-0 overflow-hidden"
      onClickCapture={clearSelectionOnOutsideClick}
    >
      <div className="border-b bg-background/95 backdrop-blur-sm supports-[backdrop-filter]:bg-background/80 px-3 py-2 flex items-center justify-between gap-3">
        {/* ── Left: Add row + View mode ─────────────────────── */}
        <div className="flex items-center gap-1.5 min-w-0">
          {viewMode === "data" && (
            <Button
              variant="default"
              size="sm"
              className={cn("font-medium", pressableClass)}
              onClick={handleAddDraftRecord}
            >
              <UiIcon name="plus" className="h-3.5 w-3.5" />
              Add row
            </Button>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-[11px] font-medium"
                >
                  {viewMode === "data" ? "Data" : viewMode === "structure" ? "Structure" : "JSON"}
                  <UiIcon name="chevron-down" className="size-3 opacity-50" />
                </Button>
              }
            />
            <DropdownMenuContent align="start" className="min-w-32">
              <DropdownMenuItem onClick={() => setViewMode("data")}>
                <UiIcon name="table" className="size-3.5" />
                Data
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setViewMode("structure")}>
                <UiIcon name="columns-3" className="size-3.5" />
                Structure
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setViewMode("json")}>
                <UiIcon name="braces" className="size-3.5" />
                JSON
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {viewMode === "data" && selectedRowKeys.size > 0 && (
            <Button
              variant="destructive"
              size="sm"
              className={cn("font-medium", pressableClass)}
              onClick={() => setPendingBatchDelete(true)}
              disabled={primaryKey.length === 0}
            >
              <UiIcon name="trash" className="h-3.5 w-3.5" />
              Delete {selectedRowKeys.size}
            </Button>
          )}
        </div>

        {/* ── Right: Info + actions ──────────────────────── */}
        <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
          {(isLoading || isSwitchingTable) && rowsResponse && (
            <UiIcon name="loader" className="h-3 w-3 animate-spin" />
          )}
          <span>{(rowsResponse?.totalEstimate ?? 0).toLocaleString()} rows</span>
          {hasDraftChanges && (
            <span className="flex items-center gap-1">
              {dirtyCounts.inserts > 0 && <span className="text-emerald-600 dark:text-emerald-400">+{dirtyCounts.inserts}</span>}
              {dirtyCounts.updates > 0 && <span className="text-amber-600 dark:text-amber-400">~{dirtyCounts.updates}</span>}
              {dirtyCounts.deletes > 0 && <span className="text-red-600 dark:text-red-400">-{dirtyCounts.deletes}</span>}
            </span>
          )}

          <Separator orientation="vertical" className="h-4 mx-1" />

          {viewMode === "data" && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className={cn(
                      showFilters ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
                      pressableClass,
                    )}
                    onClick={() => setShowFilters((v) => !v)}
                  >
                    <UiIcon name="filter" className="h-3.5 w-3.5" />
                  </Button>
                }
              />
              <TooltipContent side="bottom" sideOffset={4}>
                Filter rows
              </TooltipContent>
            </Tooltip>
          )}

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className={cn(
                    "text-muted-foreground hover:text-foreground",
                    pressableClass,
                  )}
                  onClick={() =>
                    queryClient.invalidateQueries({
                      queryKey: [
                        "table-rows",
                        connectionId,
                        table.schema,
                        table.name,
                      ],
                    })
                  }
                >
                  <UiIcon name="refresh" className="h-3.5 w-3.5" />
                </Button>
              }
            />
            <TooltipContent side="bottom" sideOffset={4}>
              Refresh rows
            </TooltipContent>
          </Tooltip>

          {viewMode === "data" && (
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className={cn(
                            "text-muted-foreground hover:text-foreground",
                            pressableClass,
                          )}
                        >
                          <UiIcon name="columns-3" className="h-3.5 w-3.5" />
                        </Button>
                      }
                    />
                  }
                />
                <TooltipContent side="bottom" sideOffset={4}>
                  Column visibility
                </TooltipContent>
              </Tooltip>
              <DropdownMenuContent className="min-w-48" align="end">
                {table.columns.map((column) => (
                  <DropdownMenuCheckboxItem
                    key={column.name}
                    checked={visibleColumns.includes(column.name)}
                    onCheckedChange={(checked) => {
                      setVisibleColumns((current) => {
                        if (checked) {
                          return current.includes(column.name)
                            ? current
                            : [...current, column.name];
                        }
                        if (current.length === 1) return current;
                        return current.filter((name) => name !== column.name);
                      });
                    }}
                  >
                    {column.name}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* ── Overflow menu ────────────────────────────── */}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger
                render={
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className={cn(
                          "text-muted-foreground hover:text-foreground",
                          pressableClass,
                        )}
                      >
                        <UiIcon name="more-horizontal" className="h-3.5 w-3.5" />
                      </Button>
                    }
                  />
                }
              />
              <TooltipContent side="bottom" sideOffset={4}>
                More actions
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-52">
              {onToggleSidebar && (
                <DropdownMenuItem onClick={onToggleSidebar}>
                  <UiIcon name={isSidebarVisible ? "panel-left-close" : "panel-left"} className="size-3.5" />
                  {isSidebarVisible ? "Hide" : "Show"} explorer
                </DropdownMenuItem>
              )}
              {viewMode === "data" && onRequestAddColumn && (
                <DropdownMenuItem onClick={onRequestAddColumn}>
                  <UiIcon name="plus" className="size-3.5" />
                  Add column
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              {viewMode === "data" && (
                <>
                  <DropdownMenuItem onClick={() => void copyAsTsv()}>
                    <UiIcon name="copy" className="size-3.5" />
                    Copy as TSV
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => void copyAsJson()}>
                    <UiIcon name="copy" className="size-3.5" />
                    Copy as JSON
                  </DropdownMenuItem>
                </>
              )}
              {onExportData && (
                <DropdownMenuItem onClick={onExportData}>
                  <UiIcon name="download" className="size-3.5" />
                  Export data
                </DropdownMenuItem>
              )}
              {onSeedData && (
                <DropdownMenuItem onClick={onSeedData}>
                  <UiIcon name="dice" className="size-3.5" />
                  Seed data
                </DropdownMenuItem>
              )}
              {(onRequestDropColumn ||
                onRequestRenameColumn ||
                onRequestAlterColumnType ||
                onRequestSetColumnDefault ||
                onRequestSetColumnNullable) && viewMode === "data" && (
                <DropdownMenuSeparator />
              )}
              {(onRequestDropColumn ||
                onRequestRenameColumn ||
                onRequestAlterColumnType ||
                onRequestSetColumnDefault ||
                onRequestSetColumnNullable) && viewMode === "data" && (
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Column DDL</DropdownMenuLabel>
                  {table.columns.slice(0, 8).map((column) => (
                    <DropdownMenuItem
                      key={column.name}
                      onClick={() => setDdlColumnName(column.name)}
                      className={cn(
                        "text-[11px] font-mono",
                        ddlColumnName === column.name && "bg-accent",
                      )}
                    >
                      {column.name}
                    </DropdownMenuItem>
                  ))}
                  {table.columns.length > 8 && (
                    <DropdownMenuItem disabled className="text-[11px] text-muted-foreground">
                      +{table.columns.length - 8} more columns…
                    </DropdownMenuItem>
                  )}
                  {onRequestRenameColumn && ddlColumnName && (
                    <DropdownMenuItem onClick={() => onRequestRenameColumn(ddlColumnName)}>
                      Rename column
                    </DropdownMenuItem>
                  )}
                  {onRequestAlterColumnType && ddlColumnName && columnMap[ddlColumnName] && (
                    <DropdownMenuItem onClick={() => onRequestAlterColumnType(columnMap[ddlColumnName])}>
                      Alter column type
                    </DropdownMenuItem>
                  )}
                  {onRequestSetColumnDefault && ddlColumnName && columnMap[ddlColumnName] && (
                    <DropdownMenuItem onClick={() => onRequestSetColumnDefault(columnMap[ddlColumnName])}>
                      Set / Drop default
                    </DropdownMenuItem>
                  )}
                  {onRequestSetColumnNullable && ddlColumnName && columnMap[ddlColumnName] && (
                    <DropdownMenuItem onClick={() => onRequestSetColumnNullable(columnMap[ddlColumnName])}>
                      Set / Drop NOT NULL
                    </DropdownMenuItem>
                  )}
                  {onRequestDropColumn && ddlColumnName && (
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => onRequestDropColumn(ddlColumnName)}
                    >
                      Drop column
                    </DropdownMenuItem>
                  )}
                </DropdownMenuGroup>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => {
                  setPendingTruncate(true);
                  setConfirmText("");
                }}
              >
                <UiIcon name="trash" className="size-3.5" />
                Truncate table
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {showFilters && (
        <div className="border-b px-3 py-2 grid grid-cols-[220px_1fr] gap-2 bg-muted/30">
          <Select
            value={filterColumn}
            onValueChange={(value) => {
              if (value) {
                setFilterColumn(value);
                setPage(0);
              }
            }}
          >
            <SelectTrigger className="h-8 text-sm w-full bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {table.columns.map((column) => (
                <SelectItem key={column.name} value={column.name}>
                  {column.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={filterValue}
            onChange={(event) => {
              perfTrackerRef.current.start("filter_to_rows_painted");
              setFilterValue(event.target.value);
              setPage(0);
            }}
            placeholder="Contains..."
            className="bg-background h-8"
          />
        </div>
      )}

      {error && (
        <div className="px-3 py-2 text-xs text-destructive border-b bg-destructive/5 flex items-center justify-between gap-2">
          <span className="truncate">{error}</span>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 h-6 text-[10px]"
            onClick={() => {
              setError(null);
              queryClient.invalidateQueries({ queryKey: dbQueryKeys.tableRowsPrefix(connectionId, table.schema, table.name) });
            }}
          >
            <UiIcon name="refresh" className="h-3 w-3" />
            Retry
          </Button>
        </div>
      )}

      {viewMode === "data" ? (
        <div className="flex-1 min-h-0 overflow-hidden">
        <TableEditorGrid
          isBlockingTableLoading={isBlockingTableLoading}
          scrollRef={scrollRef}
          onGridScroll={() => {
            hoveredRowAnchorRef.current = null;
            const button = floatingRowButtonRef.current;
            if (button) {
              button.style.opacity = "0";
              button.style.pointerEvents = "none";
            }
          }}
          handleTableKeyDown={handleTableKeyDown}
          isAllSelected={isAllSelected}
          isSomeSelected={isSomeSelected}
          toggleSelectAll={toggleSelectAll}
          visibleColumns={visibleColumns}
          sort={sort}
          columnMap={columnMap}
          resolveColumnWidth={resolveColumnWidth}
          onSortColumn={(columnName) => {
            perfTrackerRef.current.start("sort_to_rows_settled");
            setSort((current) => {
              if (current[0]?.column !== columnName) {
                return [{ column: columnName, direction: "asc" }];
              }
              if (current[0]?.direction === "asc") {
                return [{ column: columnName, direction: "desc" }];
              }
              return [];
            });
          }}
          handleResizeMouseDown={handleResizeMouseDown}
          topSpacerHeight={topSpacerHeight}
          bottomSpacerHeight={bottomSpacerHeight}
          visibleDraftInserts={visibleDraftInserts}
          editingCell={editingCell}
          focusedCell={focusedCell}
          beginEditInsertCell={beginEditInsertCell}
          setFocusedCell={setFocusedCell}
          editingValue={editingValue}
          setEditingValue={setEditingValue}
          loadFkOptionsDebounced={loadFkOptionsDebounced}
          persistEditing={persistEditing}
          suppressInlineEditorMouseUpRef={suppressInlineEditorMouseUpRef}
          keepCaretNavigationInsideInlineInput={keepCaretNavigationInsideInlineInput}
          cancelEditing={cancelEditing}
          applyExpandedEditToInsert={applyExpandedEditToInsert}
          visibleEffectiveRows={visibleEffectiveRows}
          selectedRowKeys={selectedRowKeys}
          draftUpdates={draftUpdates}
          handleRowClick={handleRowClick}
          cancelPendingHoverClear={cancelPendingHoverClear}
          showFloatingRowButton={showFloatingRowButton}
          scheduleHoverClear={scheduleHoverClear}
          onToggleRowSelection={toggleRowSelection}
          findFkForColumn={findFkForColumn}
          beginEditExistingCell={beginEditExistingCell}
          effectiveRowIndexByKey={effectiveRowIndexByKey}
          effectiveRowsRef={effectiveRowsRef}
          isLoadingFk={isLoadingFk}
          fkOptions={fkOptions}
          onOpenRelatedTable={onOpenRelatedTable}
          tableSchema={table.schema}
          primaryKey={primaryKey}
          applyExpandedEditToRow={applyExpandedEditToRow}
          totalVirtualRows={totalVirtualRows}
        />
      </div>
      ) : viewMode === "structure" ? (
        <div className="flex-1 min-h-0 overflow-auto bg-[radial-gradient(circle_at_0%_0%,hsl(var(--muted)/0.32),transparent_44%),radial-gradient(circle_at_100%_100%,hsl(var(--muted)/0.2),transparent_46%)] p-4">
          <div className="mx-auto w-full max-w-5xl rounded-xl border border-border/60 bg-background/92 p-4 shadow-sm backdrop-blur-sm">
            <div className="flex flex-wrap items-center gap-2 border-b border-border/50 pb-4">
              <div className="flex min-w-[170px] items-center gap-2 rounded-md border border-border/60 bg-muted/25 px-3 py-2">
                <Database className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Table name</p>
                  <p className="font-mono text-xs font-medium text-foreground">{table.name}</p>
                </div>
              </div>
              <div className="flex min-w-[150px] items-center gap-2 rounded-md border border-border/60 bg-muted/25 px-3 py-2">
                <UiIcon name="table" className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Schema</p>
                  <p className="font-mono text-xs font-medium text-foreground">{table.schema}</p>
                </div>
              </div>
              <div className="ml-auto flex min-w-[190px] items-center gap-2 rounded-md border border-border/60 bg-muted/25 px-3 py-2">
                <ShieldCheck className={cn("h-4 w-4", structureStats.hasRls ? "text-emerald-400" : "text-muted-foreground")} />
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Row level security</p>
                  <p className="text-xs font-medium text-foreground">{structureStats.hasRls ? "Enabled" : "Disabled"}</p>
                </div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-7">
              {[
                { label: "Columns", value: structureStats.columns },
                { label: "Not null", value: structureStats.notNull },
                { label: "Nullable", value: structureStats.nullable },
                { label: "Defaults", value: structureStats.defaults },
                { label: "PK", value: structureStats.primaryKeys },
                { label: "FK", value: structureStats.foreignKeys },
                { label: "RLS", value: structureStats.hasRls ? "On" : "Off" },
              ].map((item) => (
                <div key={item.label} className="rounded-md border border-border/50 bg-muted/20 px-2.5 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{item.label}</p>
                  <p className="mt-0.5 font-mono text-xs font-semibold text-foreground">{item.value}</p>
                </div>
              ))}
            </div>

            <div className="mt-5 rounded-lg border border-border/60 bg-background">
              <div className="border-b border-border/50 px-3 py-2">
                <h3 className="text-xs font-semibold tracking-wide text-foreground">COLUMNS</h3>
              </div>
              <table className="w-full border-collapse text-xs">
                <thead className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm">
                  <tr className="border-b border-border/50">
                    <th className="h-8 px-3 text-left font-medium whitespace-nowrap" scope="col">#</th>
                    <th className="h-8 px-3 text-left font-medium whitespace-nowrap" scope="col">Name</th>
                    <th className="h-8 px-3 text-left font-medium whitespace-nowrap" scope="col">Definition</th>
                  </tr>
                </thead>
                <tbody>
                  {table.columns.map((col, i) => {
                    const typeName = (col.udt_name ?? col.data_type).toUpperCase();
                    const isPrimaryKey = primaryKey.includes(col.name);
                    const isForeignKey = foreignKeysByColumn.has(col.name);
                    const isNullable = col.is_nullable;
                    const defaultValue = col.column_default;
                    return (
                      <tr key={col.name} className="border-b border-border/40 transition-colors hover:bg-muted/30">
                        <td className="h-9 px-3 font-mono text-[11px] text-muted-foreground align-top">{i + 1}</td>
                        <td className="h-9 px-3 align-top">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-medium text-foreground">{col.name}</span>
                            {isPrimaryKey ? <KeyRound className="h-3.5 w-3.5 text-amber-400" /> : null}
                            {isForeignKey ? <Link2 className="h-3.5 w-3.5 text-cyan-400" /> : null}
                          </div>
                        </td>
                        <td className="h-9 px-3 pb-2 align-top font-mono leading-6">
                          <span className="text-rose-400">{typeName}</span>
                          {isPrimaryKey ? <span className="text-rose-400"> PRIMARY KEY</span> : null}
                          {isForeignKey ? (
                            <span className="text-rose-400">
                              {" "}REFERENCES {foreignKeysByColumn.get(col.name)?.referenced_table}({foreignKeysByColumn.get(col.name)?.referenced_column})
                            </span>
                          ) : null}
                          {!isNullable ? <span className="text-rose-400"> NOT NULL</span> : null}
                          {defaultValue ? (
                            <>
                              <span className="text-rose-400"> DEFAULT</span>{" "}
                              <span className="text-sky-300">{defaultValue}</span>
                            </>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {(primaryKey.length > 0 || foreignKeys.length > 0) ? (
              <div className="mt-4 rounded-lg border border-border/60 bg-background">
                <div className="border-b border-border/50 px-3 py-2">
                  <h3 className="text-xs font-semibold tracking-wide text-foreground">CONSTRAINTS</h3>
                </div>
                <div className="p-2">
                  {primaryKey.map((columnName) => (
                    <div key={`pk-${columnName}`} className="rounded-md px-2 py-1.5 font-mono text-xs hover:bg-muted/25">
                      <span className="text-rose-400">PRIMARY KEY</span> ({columnName})
                    </div>
                  ))}
                  {foreignKeys.map((fk) => (
                    <div key={fk.name} className="rounded-md px-2 py-1.5 font-mono text-xs hover:bg-muted/25">
                      <span className="text-rose-400">FOREIGN KEY</span> ({fk.column_name})
                      <span className="text-muted-foreground"> REFERENCES </span>
                      {fk.referenced_schema ? `${fk.referenced_schema}.` : ""}
                      {fk.referenced_table}({fk.referenced_column})
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto bg-[radial-gradient(circle_at_0%_0%,hsl(var(--muted)/0.32),transparent_44%),radial-gradient(circle_at_100%_100%,hsl(var(--muted)/0.2),transparent_46%)] p-4">
          <div className="mx-auto w-full max-w-5xl rounded-xl border border-border/60 bg-background/92 p-4 shadow-sm backdrop-blur-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-3">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">JSON view</p>
                <p className="font-mono text-xs text-foreground">
                  {table.schema}.{table.name}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-md border border-border/60 bg-muted/25 px-2 py-1 font-mono text-[11px] text-muted-foreground">
                  rows: {effectiveRows.length}
                </span>
                <span className="rounded-md border border-border/60 bg-muted/25 px-2 py-1 font-mono text-[11px] text-muted-foreground">
                  cols: {visibleColumns.length}
                </span>
              </div>
            </div>
            <div className="mt-3 rounded-lg border border-border/60 bg-[#0f1116]">
              <pre className="max-h-[70vh] overflow-auto p-4 text-xs font-mono leading-5 text-slate-200 whitespace-pre select-text">
                {JSON.stringify(
                  effectiveRows.map(({ row }) => {
                    const obj: Record<string, unknown> = {};
                    for (const col of visibleColumns) {
                      obj[col] = row[col] ?? null;
                    }
                    return obj;
                  }),
                  null,
                  2,
                )}
              </pre>
            </div>
          </div>
        </div>
      )}

      {viewMode === "data" ? (
        <TableEditorFooter
          page={page}
          totalPages={totalPages}
          pageSize={pageSize}
          isLoading={isLoading}
          hasDraftChanges={hasDraftChanges}
          isSaving={isSaving}
          pressableClass={pressableClass}
          onPrevPage={() => setPage((current) => Math.max(current - 1, 0))}
          onNextPage={() => setPage((current) => current + 1)}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(0);
          }}
          onDiscardDrafts={discardDrafts}
          onSaveChanges={() => void saveAllChanges()}
        />
      ) : null}

      <TableEditorDialogs
        tableName={table.name}
        selectedRowCount={selectedRowKeys.size}
        pendingBatchDelete={pendingBatchDelete}
        pendingTruncate={pendingTruncate}
        confirmText={confirmText}
        truncateSqlPreview={truncateSqlPreview}
        isTruncating={isTruncating}
        onConfirmTextChange={setConfirmText}
        onBatchDeleteOpenChange={setPendingBatchDelete}
        onTruncateOpenChange={setPendingTruncate}
        onConfirmBatchDelete={() => {
          batchDeleteSelected();
          setPendingBatchDelete(false);
          setConfirmText("");
        }}
        onConfirmTruncate={() => void runTruncate()}
      />

      <button
        ref={floatingRowButtonRef}
        type="button"
        aria-label="Open row details"
        title="Open row details"
        onClick={(event) => {
          event.stopPropagation();
          const hovered = hoveredRowAnchorRef.current;
          if (!hovered) return;
          const containerRect = editorContainerRef.current?.getBoundingClientRect();
          const minLeft = containerRect ? containerRect.left + 2 : hovered.left;
          const clampedLeft = Math.max(hovered.left, minLeft);
          const maxWidth = containerRect
            ? Math.max(0, containerRect.right - clampedLeft - 2)
            : hovered.width;
          openRowDetails(hovered.rowKey, hovered.row, hovered.index);
          setExpandedRowOutline({
            top: hovered.top - hovered.height / 2,
            left: clampedLeft,
            width: Math.min(hovered.width, maxWidth),
            height: hovered.height,
          });
          hoveredRowAnchorRef.current = null;
          const button = floatingRowButtonRef.current;
          if (button) {
            button.style.opacity = "0";
            button.style.pointerEvents = "none";
          }
        }}
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onMouseEnter={cancelPendingHoverClear}
        onMouseLeave={scheduleHoverClear}
        className="fixed z-[10000] flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-sm border border-border/70 bg-background text-muted-foreground opacity-0 pointer-events-none shadow-xs hover:text-foreground hover:bg-muted cursor-default transition-[background-color,color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]"
      >
        <IconArrowsDiagonal2 className="h-3 w-3" />
      </button>

      <TableEditorRowDetailsOverlay
        tableSchema={table.schema}
        tableName={table.name}
        primaryKey={primaryKey}
        columns={table.columns}
        readOnly={primaryKey.length === 0}
        hasDraftChanges={hasDraftChanges}
        expandedRow={expandedRow}
        expandedRowFields={expandedRowFields}
        expandedRowOutline={expandedRowOutline}
        onFieldSave={handleFieldSaveInOverlay}
        onSaveAll={() => void saveAllChanges()}
        onDiscard={discardDrafts}
        onClose={closeRowDetails}
      />
    </div>
  );
}

export const TableDataEditor = forwardRef(TableDataEditorInner);
