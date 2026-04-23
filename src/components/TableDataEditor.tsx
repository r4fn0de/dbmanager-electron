import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  Columns3,
  Database,
  Download,
  Expand,
  Filter,
  Loader2,
  PanelLeft,
  PanelLeftClose,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Undo2,
} from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { setUnsavedChanges as setWindowUnsavedChanges } from "@/actions/window";
import { CellExpandPopover } from "@/components/CellExpandPopover";
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
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
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
  ListRowsInput,
  SaveChangesInput,
  SaveChangesResponse,
  SchemaColumn,
  SchemaForeignKey,
  SchemaTable,
  TableFilter,
  TableRef,
  TableRowsResponse,
  TableSort,
} from "@/ipc/db/types";
import { cn } from "@/lib/utils";

interface TableDataEditorProps {
  connectionId: string;
  table: SchemaTable;
  tableListRows: (input: ListRowsInput) => Promise<TableRowsResponse>;
  tableSaveChanges: (input: SaveChangesInput) => Promise<SaveChangesResponse>;
  tableTruncate: (tableRef: TableRef) => Promise<void>;
  tableFkLookup: (input: {
    tableRef: TableRef;
    column: string;
    query: string;
    page: number;
    pageSize: number;
  }) => Promise<FkLookupResponse>;
  onOpenRelatedTable?: (schema: string, table: string) => void;
  isSwitchingTable?: boolean;
  /** Opcional: abre o dialog de criação de coluna. Se não passado, botão não aparece. */
  onRequestAddColumn?: () => void;
  onRequestDropColumn?: (columnName: string) => void;
  onRequestRenameColumn?: (columnName: string) => void;
  onRequestAlterColumnType?: (column: SchemaColumn) => void;
  onRequestSetColumnDefault?: (column: SchemaColumn) => void;
  onRequestSetColumnNullable?: (column: SchemaColumn) => void;
  /** Whether the tables explorer sidebar is currently visible */
  isSidebarVisible?: boolean;
  /** Toggle the tables explorer sidebar visibility */
  onToggleSidebar?: () => void;
}

type RowRecord = Record<string, unknown>;

type RowUpdateDraft = {
  primaryKey: RowRecord;
  changes: RowRecord;
};

type DeleteDraft = {
  rowKey: string;
  primaryKey: RowRecord;
  sqlPreview: string;
};

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function quoteValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number")
    return Number.isFinite(value) ? `${value}` : "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "object") {
    return `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
  }
  return `'${String(value).replaceAll("'", "''")}'`;
}

function normalizeDisplay(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function getCellTitle(value: unknown): string | undefined {
  // Avoid expensive JSON serialization for every rendered cell.
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function compareSortValues(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;

  if (typeof a === "number" && typeof b === "number") {
    return a - b;
  }

  if (typeof a === "boolean" && typeof b === "boolean") {
    return Number(a) - Number(b);
  }

  const aStr = normalizeDisplay(a);
  const bStr = normalizeDisplay(b);
  return aStr.localeCompare(bStr, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function parseByType(raw: string, column: SchemaColumn): unknown {
  const trimmed = raw.trim();
  // Sentinel vindo do popover expandido (botão "Set NULL") ou textarea vazia.
  if (trimmed.length === 0 || trimmed.toUpperCase() === "NULL") return null;

  const dataType = column.data_type.toLowerCase();

  if (/(^|[^a-z])bool/.test(dataType)) {
    if (trimmed.toLowerCase() === "true") return true;
    if (trimmed.toLowerCase() === "false") return false;
  }

  // Inteiros: envia como number quando cabe em i64 com precisão; caso contrário
  // mantém como string para evitar perda de precisão (Postgres aceita ambos).
  if (/(^|[^a-z])(int|serial|smallint|bigint)/.test(dataType)) {
    if (/^-?\d+$/.test(trimmed)) {
      const n = Number(trimmed);
      if (Number.isSafeInteger(n)) return n;
      return trimmed; // bigint fora do range seguro -> mantém string
    }
  }

  // Floats: number quando parseável.
  if (/(double|real|float)/.test(dataType)) {
    const asNumber = Number(trimmed);
    if (Number.isFinite(asNumber)) return asNumber;
  }

  // Numeric/decimal: sempre mantém como string para preservar precisão.
  if (/(numeric|decimal)/.test(dataType)) {
    return trimmed;
  }

  if (dataType.includes("json")) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  // Arrays PG (ex.: int[], text[]). Aceita ambas formas:
  //   - JSON `[1,2,3]`        -> parse como JSON, backend emite literal PG array.
  //   - Literal PG `{1,2,3}`  -> enviado como string; backend faz cast ao tipo do elemento.
  const udt = column.udt_name?.toLowerCase() ?? "";
  const isArrayColumn =
    dataType === "array" || udt.startsWith("_") || dataType.endsWith("[]");
  if (isArrayColumn) {
    if (trimmed.startsWith("[")) {
      try {
        return JSON.parse(raw);
      } catch {
        // JSON malformado cai no fallback string abaixo.
      }
    }
    if (trimmed.startsWith("{")) {
      // Literal PG. Mantém como string — backend trata ao montar o SQL.
      return trimmed;
    }
  }

  // Demais tipos (text, uuid, timestamp/timestamptz, date, time, bytea, inet, …)
  // são enviados como string. O backend usa `typed_value_literal` e o Postgres
  // faz o cast implícito para o tipo da coluna.
  return raw;
}

function rowKeyFromPk(
  pkColumns: string[],
  row: RowRecord,
  fallback: string,
): string {
  if (pkColumns.length === 0) return fallback;
  const parts = pkColumns.map((column) => normalizeDisplay(row[column]));
  return `pk:${parts.join("|")}`;
}

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

export function TableDataEditor({
  connectionId,
  table,
  tableListRows,
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
}: TableDataEditorProps) {
  const pressableClass =
    "transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]";

  const tableRef = useMemo<TableRef>(
    () => ({ connectionId, schema: table.schema, table: table.name }),
    [connectionId, table.name, table.schema],
  );

  const tableKey = `${connectionId}::${table.schema}.${table.name}`;

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

  if (previousTableKeyRef.current !== tableKey) {
    viewStateByTableRef.current.set(
      previousTableKeyRef.current,
      liveViewStateRef.current,
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

    setDraftInserts([]);
    setDraftUpdates({});
    setDraftDeletes({});
    setError(null);
    setSelectedRowKeys(new Set());
    setFocusedCell(null);

    previousTableKeyRef.current = tableKey;
  }

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
    setPage((current) => (current === 0 ? current : 0));
  }, [sort, filterColumn, deferredFilterValue]);

  const {
    data: rowsResponse = null,
    isFetching: isLoading,
    error: rowsError,
  } = useQuery({
    queryKey: [
      "table-rows",
      connectionId,
      table.schema,
      table.name,
      page,
      pageSize,
      sort,
      serverFilters,
    ],
    queryFn: () =>
      tableListRows({
        tableRef,
        page: page + 1,
        pageSize,
        sort,
        filters: serverFilters,
      }),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });

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
  const displayedRows = useMemo(() => {
    const activeSort = sort[0];
    if (!activeSort?.column) return rows;

    const next = [...rows];
    next.sort((a, b) => {
      const cmp = compareSortValues(a[activeSort.column], b[activeSort.column]);
      return activeSort.direction === "asc" ? cmp : -cmp;
    });
    return next;
  }, [rows, sort]);
  const isBlockingTableLoading = isLoading && !rowsResponse;

  const effectiveRows = useMemo(() => {
    return displayedRows
      .map((row, index) => {
        const key = rowKeyFromPk(primaryKey, row, `row:${index}`);
        return { row, rowKey: key, index };
      })
      .filter((entry) => !draftDeletes[entry.rowKey]);
  }, [displayedRows, draftDeletes, primaryKey]);

  const effectiveRowsRef = useRef(effectiveRows);
  effectiveRowsRef.current = effectiveRows;

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
    () => new Set(virtualItems.filter(v => v.index < draftInserts.length).map(v => v.index)),
    [virtualItems, draftInserts.length],
  );
  const visibleEffectiveArrayIndices = useMemo(
    () =>
      new Set(
        virtualItems
          .filter(v => v.index >= draftInserts.length)
          .map(v => v.index - draftInserts.length),
      ),
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

  useEffect(() => {
    const scope = `table:${connectionId}:${table.schema}.${table.name}`;
    void setWindowUnsavedChanges(scope, hasDraftChanges);
    return () => {
      void setWindowUnsavedChanges(scope, false);
    };
  }, [connectionId, table.schema, table.name, hasDraftChanges]);

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
        queryKey: ["table-rows", connectionId, table.schema, table.name],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save changes");
    } finally {
      setIsSaving(false);
    }
  };

  const truncateSqlPreview = `TRUNCATE TABLE ${quoteIdentifier(table.schema)}.${quoteIdentifier(table.name)};`;

  const runTruncate = async () => {
    setIsTruncating(true);
    setError(null);
    try {
      await tableTruncate(tableRef);
      discardDrafts();
      await queryClient.invalidateQueries({
        queryKey: ["table-rows", connectionId, table.schema, table.name],
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
    for (const rowKey of selectedRowKeys) {
      const entry = effectiveRows.find((r) => r.rowKey === rowKey);
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
  const allNavigableCells = useMemo(() => {
    const cells: Array<{ rowKey: string; column: string }> = [];
    for (const { rowKey } of effectiveRows) {
      for (const column of visibleColumns) {
        cells.push({ rowKey, column });
      }
    }
    return cells;
  }, [effectiveRows, visibleColumns]);

  const handleTableKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (editingCell) return; // let the Input handle its own keys
      if (!focusedCell) return;

      const currentIdx = allNavigableCells.findIndex(
        (c) =>
          c.rowKey === focusedCell.rowKey && c.column === focusedCell.column,
      );
      if (currentIdx === -1) return;

      let nextIdx = currentIdx;
      const colsCount = visibleColumns.length;

      switch (event.key) {
        case "ArrowRight":
          event.preventDefault();
          nextIdx = Math.min(currentIdx + 1, allNavigableCells.length - 1);
          break;
        case "ArrowLeft":
          event.preventDefault();
          nextIdx = Math.max(currentIdx - 1, 0);
          break;
        case "ArrowDown":
          event.preventDefault();
          nextIdx = Math.min(
            currentIdx + colsCount,
            allNavigableCells.length - 1,
          );
          break;
        case "ArrowUp":
          event.preventDefault();
          nextIdx = Math.max(currentIdx - colsCount, 0);
          break;
        case "Tab":
          event.preventDefault();
          if (event.shiftKey) {
            nextIdx = Math.max(currentIdx - 1, 0);
          } else {
            nextIdx = Math.min(currentIdx + 1, allNavigableCells.length - 1);
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

      const next = allNavigableCells[nextIdx];
      if (next) setFocusedCell(next);
    },
    [
      editingCell,
      focusedCell,
      allNavigableCells,
      visibleColumns.length,
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

  return (
    <div
      className="h-full flex flex-col min-h-0"
      onClickCapture={clearSelectionOnOutsideClick}
    >
      <div className="border-b px-3 py-1.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0 overflow-x-auto">
          {onToggleSidebar && (
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
                    onClick={onToggleSidebar}
                  >
                    {isSidebarVisible ? (
                      <PanelLeftClose className="h-4 w-4" />
                    ) : (
                      <PanelLeft className="h-4 w-4" />
                    )}
                  </Button>
                }
              />
              <TooltipContent side="bottom" sideOffset={4}>
                {isSidebarVisible ? "Hide" : "Show"} explorer <KbdGroup className="ml-1.5"><Kbd>⌘</Kbd><Kbd>B</Kbd></KbdGroup>
              </TooltipContent>
            </Tooltip>
          )}

          <Button
            variant="default"
            size="sm"
            className={pressableClass}
            onClick={handleAddDraftRecord}
          >
            <Plus className="h-3.5 w-3.5" />
            Add row
          </Button>

          {onRequestAddColumn && (
            <Button
              variant="outline"
              size="sm"
              className={pressableClass}
              onClick={onRequestAddColumn}
            >
              <Plus className="h-3.5 w-3.5" />
              Column
            </Button>
          )}

          <Button
            variant={showFilters ? "secondary" : "outline"}
            size="sm"
            className={pressableClass}
            onClick={() => setShowFilters((v) => !v)}
          >
            <Filter className="h-3.5 w-3.5" />
            Filter
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="outline"
                  size="sm"
                  className={pressableClass}
                />
              }
            >
              <Columns3 className="h-3.5 w-3.5" />
              Columns
            </DropdownMenuTrigger>
            <DropdownMenuContent className="min-w-48">
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

          {(onRequestDropColumn ||
            onRequestRenameColumn ||
            onRequestAlterColumnType ||
            onRequestSetColumnDefault ||
            onRequestSetColumnNullable) && (
            <>
              <Select
                value={ddlColumnName}
                onValueChange={(value) => {
                  if (value) setDdlColumnName(value);
                }}
              >
                <SelectTrigger className="h-8 text-xs w-auto min-w-32">
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
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="outline"
                      size="sm"
                      className={pressableClass}
                    />
                  }
                >
                  Column DDL
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem
                    disabled={!ddlColumnName || !onRequestRenameColumn}
                    onClick={() =>
                      ddlColumnName && onRequestRenameColumn?.(ddlColumnName)
                    }
                  >
                    Rename column
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!ddlColumnName || !onRequestAlterColumnType}
                    onClick={() => {
                      const column = columnMap[ddlColumnName];
                      if (column) onRequestAlterColumnType?.(column);
                    }}
                  >
                    Alter column type
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!ddlColumnName || !onRequestSetColumnDefault}
                    onClick={() => {
                      const column = columnMap[ddlColumnName];
                      if (column) onRequestSetColumnDefault?.(column);
                    }}
                  >
                    Set / Drop default
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!ddlColumnName || !onRequestSetColumnNullable}
                    onClick={() => {
                      const column = columnMap[ddlColumnName];
                      if (column) onRequestSetColumnNullable?.(column);
                    }}
                  >
                    Set / Drop NOT NULL
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!ddlColumnName || !onRequestDropColumn}
                    onClick={() =>
                      ddlColumnName && onRequestDropColumn?.(ddlColumnName)
                    }
                  >
                    Drop column
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}

          {selectedRowKeys.size > 0 && (
            <Button
              variant="destructive"
              size="sm"
              className={pressableClass}
              onClick={() => setPendingBatchDelete(true)}
              disabled={primaryKey.length === 0}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete {selectedRowKeys.size}
            </Button>
          )}
        </div>

        <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
          {(isLoading || isSwitchingTable) && rowsResponse && (
            <Loader2 className="h-3 w-3 animate-spin" />
          )}
          <span>{(rowsResponse?.totalEstimate ?? 0).toLocaleString()} rows</span>
          {hasDraftChanges && (
            <span className="flex items-center gap-1">
              {dirtyCounts.inserts > 0 && <span className="text-emerald-600 dark:text-emerald-400">+{dirtyCounts.inserts}</span>}
              {dirtyCounts.updates > 0 && <span className="text-amber-600 dark:text-amber-400">~{dirtyCounts.updates}</span>}
              {dirtyCounts.deletes > 0 && <span className="text-red-600 dark:text-red-400">-{dirtyCounts.deletes}</span>}
            </span>
          )}
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
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className={cn(
                    "text-muted-foreground hover:text-foreground",
                    pressableClass,
                  )}
                />
              }
            >
              <Download className="h-3.5 w-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => exportData("csv")}>
                Export as CSV
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportData("json")}>
                Export as JSON
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="ghost"
            size="icon-sm"
            className={cn(
              "text-muted-foreground hover:text-destructive",
              pressableClass,
            )}
            onClick={() => {
              setPendingTruncate(true);
              setConfirmText("");
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {showFilters && (
        <div className="border-b px-3 py-2 grid grid-cols-[220px_1fr] gap-2">
          <Select
            value={filterColumn}
            onValueChange={(value) => {
              if (value) {
                setFilterColumn(value);
                setPage(0);
              }
            }}
          >
            <SelectTrigger className="h-8 text-sm w-full">
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
              setFilterValue(event.target.value);
              setPage(0);
            }}
            placeholder="Contains..."
          />
        </div>
      )}

      {error && (
        <div className="px-3 py-2 text-xs text-destructive border-b">
          {error}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-hidden">
        {isBlockingTableLoading ? (
          <div className="h-full flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div ref={scrollRef} className="h-full overflow-auto">
            <table
              className="w-max table-fixed caption-bottom text-xs border-separate border-spacing-0 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-2px]"
              onKeyDown={handleTableKeyDown}
              tabIndex={0}
            >
              <TableHeader className="sticky top-0 z-10 bg-muted/40 border-b-2 border-border">
              <TableRow className="hover:bg-transparent">
                <TableHead className="sticky left-0 z-[5] w-12 min-w-12 border-r border-border bg-background px-2 py-1 text-center h-8">
                  <div className="flex items-center justify-center">
                    {isAllSelected ? (
                      <Checkbox checked onCheckedChange={toggleSelectAll} />
                    ) : isSomeSelected ? (
                      <button
                        type="button"
                        onClick={toggleSelectAll}
                        className="flex size-4 items-center justify-center rounded-[4px] border border-input bg-primary"
                      >
                        <svg width="8" height="2">
                          <rect width="8" height="2" fill="white" rx="1" />
                        </svg>
                      </button>
                    ) : (
                      <Checkbox
                        checked={false}
                        onCheckedChange={toggleSelectAll}
                      />
                    )}
                  </div>
                </TableHead>
                {visibleColumns.map((columnName) => {
                  const sorted =
                    sort[0]?.column === columnName ? sort[0].direction : null;
                  const column = columnMap[columnName];
                  const width = resolveColumnWidth(columnName);
                  return (
                    <TableHead
                      key={columnName}
                      className="border-r border-border last:border-r-0 select-none hover:bg-muted/60 transition-colors relative group h-8 py-1 px-2 bg-background"
                      style={{ width, minWidth: width, maxWidth: width }}
                    >
                      <button
                        type="button"
                        className="w-full h-full text-left cursor-pointer pr-2 overflow-hidden"
                        onClick={() => {
                          setSort((current) => {
                            if (current[0]?.column !== columnName) {
                              return [{ column: columnName, direction: "asc" }];
                            }
                            if (current[0]?.direction === "asc") {
                              return [
                                { column: columnName, direction: "desc" },
                              ];
                            }
                            return [];
                          });
                        }}
                      >
                        <div className="flex items-center min-w-0 gap-1">
                          <span
                            className="min-w-0 flex-1 basis-0 overflow-hidden text-ellipsis whitespace-nowrap font-semibold text-foreground/90"
                            title={
                              column?.data_type
                                ? `${columnName} (${column.data_type})`
                                : columnName
                            }
                          >
                            {columnName}
                          </span>
                          {column?.data_type ? (
                            <span
                              className="min-w-0 max-w-[42%] truncate whitespace-nowrap text-[10px] font-normal text-muted-foreground/70"
                              title={column.data_type}
                            >
                              {column.data_type}
                            </span>
                          ) : null}
                          {sorted && (
                            <span className="shrink-0 text-[10px] font-medium text-slate-600 dark:text-slate-300">
                              {sorted === "asc" ? "↑" : "↓"}
                            </span>
                          )}
                        </div>
                      </button>
                      {/* Resize handle */}
                      <div
                        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors z-20"
                        onMouseDown={(e) =>
                          handleResizeMouseDown(columnName, e)
                        }
                        onClick={(e) => e.stopPropagation()}
                      />
                    </TableHead>
                  );
                })}
              </TableRow>
            </TableHeader>
            <TableBody className="align-top">
              {/* ── Virtualization: top spacer ────────────────────── */}
              {topSpacerHeight > 0 && (
                <tr aria-hidden="true" className="border-0">
                  <td colSpan={visibleColumns.length + 1} className="border-0 p-0" style={{ height: topSpacerHeight }} />
                </tr>
              )}
              {visibleDraftInserts.map(({ row, insertIndex }) => (
                <TableRow
                  key={`insert:${insertIndex}`}
                  className="bg-emerald-500/5 hover:bg-emerald-500/10"
                >
                  <TableCell className="sticky left-0 z-[1] w-12 min-w-12 border-r border-border bg-background px-2 py-0.5 text-center text-muted-foreground h-7">
                    N
                  </TableCell>
                  {visibleColumns.map((columnName) => {
                    const isEditing =
                      editingCell?.source === "insert" &&
                      editingCell.insertIndex === insertIndex &&
                      editingCell.column === columnName;
                    const value = row[columnName];
                    const isFocusedInsert =
                      focusedCell?.rowKey === `insert:${insertIndex}` &&
                      focusedCell?.column === columnName;
                    const width = resolveColumnWidth(columnName);
                    return (
                      <TableCell
                        key={`insert:${insertIndex}:${columnName}`}
                        className={`group/cell relative truncate font-mono align-middle border-r border-border last:border-r-0 py-0.5 px-2 h-7 ${isFocusedInsert ? "ring-2 ring-primary/40 ring-inset bg-primary/5" : ""}`}
                        style={{ width, minWidth: width, maxWidth: width }}
                        onDoubleClick={() =>
                          beginEditInsertCell(insertIndex, columnName)
                        }
                        onClick={() =>
                          setFocusedCell({
                            rowKey: `insert:${insertIndex}`,
                            column: columnName,
                          })
                        }
                      >
                        {isEditing ? (
                          <div className="relative">
                            <span className="invisible block whitespace-nowrap">
                              {normalizeDisplay(value)}
                            </span>
                            <Input
                              autoFocus
                              value={editingValue}
                              onChange={(event) => {
                                setEditingValue(event.target.value);
                                loadFkOptionsDebounced(
                                  columnName,
                                  event.target.value,
                                );
                              }}
                              onBlur={() => persistEditing()}
                              onFocus={(event) => {
                                if (!suppressInlineEditorMouseUpRef.current)
                                  return;
                                event.currentTarget.select();
                              }}
                              onMouseUp={(event) => {
                                if (!suppressInlineEditorMouseUpRef.current)
                                  return;
                                event.preventDefault();
                                suppressInlineEditorMouseUpRef.current = false;
                              }}
                              onKeyDown={(event) => {
                                keepCaretNavigationInsideInlineInput(event);
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  persistEditing();
                                  // Advance to next column in the same insert row
                                  const colIdx =
                                    visibleColumns.indexOf(columnName);
                                  if (
                                    colIdx >= 0 &&
                                    colIdx < visibleColumns.length - 1
                                  ) {
                                    setFocusedCell({
                                      rowKey: `insert:${insertIndex}`,
                                      column: visibleColumns[colIdx + 1],
                                    });
                                  }
                                }
                                if (event.key === "Escape") cancelEditing();
                              }}
                              onMouseDown={(event) => event.stopPropagation()}
                              className="absolute inset-0 h-auto min-h-0 w-full rounded-none border-0 bg-transparent px-0 py-0 font-mono !text-xs leading-4 md:!text-xs shadow-none focus-visible:ring-0"
                            />
                          </div>
                        ) : (
                          <>
                            <span
                              className={`block truncate whitespace-nowrap ${
                                value === null || value === undefined
                                  ? "italic text-muted-foreground/60"
                                  : ""
                              }`}
                            >
                              {normalizeDisplay(value)}
                            </span>
                            <CellExpandPopover
                              columnName={columnName}
                              column={columnMap[columnName]}
                              initialValue={value}
                              onSave={(rawText) =>
                                applyExpandedEditToInsert(
                                  insertIndex,
                                  columnName,
                                  rawText,
                                )
                              }
                              trigger={
                                <button
                                  type="button"
                                  aria-label={`Expand ${columnName}`}
                                  title="Expand (open editor)"
                                  onClick={(event) => event.stopPropagation()}
                                  onMouseDown={(event) =>
                                    event.stopPropagation()
                                  }
                                  className={`absolute right-1 top-1/2 -translate-y-1/2 z-10 flex h-5 w-5 items-center justify-center rounded border bg-background/95 text-muted-foreground shadow-sm opacity-0 transition-opacity group-hover/cell:opacity-100 focus-visible:opacity-100 hover:text-foreground hover:bg-muted data-[popup-open]:opacity-100 ${isFocusedInsert ? "opacity-100" : ""}`}
                                >
                                  <Expand className="h-3 w-3" />
                                </button>
                              }
                            />
                          </>
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}

              {visibleEffectiveRows.map(({ row, rowKey, index }) => {
                const isSelected = selectedRowKeys.has(rowKey);
                const isRowUpdated = !!draftUpdates[rowKey];
                const selectionCellBackground = isSelected
                  ? "bg-muted"
                  : isRowUpdated
                    ? "bg-background"
                    : index % 2 === 1
                      ? "bg-background"
                      : "bg-background";
                return (
                  <TableRow
                    key={rowKey}
                    data-row-selection-scope="row"
                    className={`${isSelected ? "bg-primary/10" : isRowUpdated ? "bg-amber-500/5" : index % 2 === 1 ? "bg-muted/30" : ""}`}
                    onClick={(e) => handleRowClick(rowKey, index, e)}
                  >
                    <TableCell
                      className={`sticky left-0 z-[1] w-12 min-w-12 border-r border-border px-2 ${selectionCellBackground}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-center">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => {
                            setSelectedRowKeys((prev) => {
                              const next = new Set(prev);
                              if (next.has(rowKey)) next.delete(rowKey);
                              else next.add(rowKey);
                              return next;
                            });
                          }}
                        />
                      </div>
                    </TableCell>
                    {visibleColumns.map((columnName) => {
                      const draftValue =
                        draftUpdates[rowKey]?.changes[columnName];
                      const effectiveValue = draftValue ?? row[columnName];
                      const isEditing =
                        editingCell?.source === "existing" &&
                        editingCell.rowKey === rowKey &&
                        editingCell.column === columnName;
                      const isFocused =
                        focusedCell?.rowKey === rowKey &&
                        focusedCell?.column === columnName;
                      const fk = findFkForColumn(columnName);
                      const isNull =
                        effectiveValue === null || effectiveValue === undefined;
                      const width = resolveColumnWidth(columnName);

                      return (
                        <TableCell
                          key={`${rowKey}:${columnName}`}
                          className={`group/cell relative font-mono align-middle truncate border-r border-border last:border-r-0 py-0.5 px-2 h-7 ${isFocused ? "ring-2 ring-primary/40 ring-inset bg-primary/5" : ""}`}
                          style={{ width, minWidth: width, maxWidth: width }}
                          title={getCellTitle(effectiveValue)}
                          onDoubleClick={() =>
                            beginEditExistingCell(rowKey, row, columnName)
                          }
                          onClick={(e) => {
                            e.stopPropagation();
                            setFocusedCell({ rowKey, column: columnName });
                          }}
                        >
                          {isEditing ? (
                            <div className="relative">
                              <span className="invisible block whitespace-nowrap">
                                {normalizeDisplay(effectiveValue)}
                              </span>
                              <Input
                                autoFocus
                                value={editingValue}
                                onChange={(event) => {
                                  setEditingValue(event.target.value);
                                  loadFkOptionsDebounced(
                                    columnName,
                                    event.target.value,
                                  );
                                }}
                                onBlur={() => persistEditing(row)}
                                onFocus={(event) => {
                                  if (!suppressInlineEditorMouseUpRef.current)
                                    return;
                                  event.currentTarget.select();
                                }}
                                onMouseUp={(event) => {
                                  if (!suppressInlineEditorMouseUpRef.current)
                                    return;
                                  event.preventDefault();
                                  suppressInlineEditorMouseUpRef.current = false;
                                }}
                                onKeyDown={(event) => {
                                  keepCaretNavigationInsideInlineInput(event);
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    persistEditing(row);
                                    // Advance focus to next cell after saving
                                    const cellIdx = allNavigableCells.findIndex(
                                      (c) =>
                                        c.rowKey === rowKey &&
                                        c.column === columnName,
                                    );
                                    const next =
                                      cellIdx >= 0 &&
                                      cellIdx < allNavigableCells.length - 1
                                        ? allNavigableCells[cellIdx + 1]
                                        : null;
                                    if (
                                      next &&
                                      effectiveRowsRef.current.some(
                                        (r) => r.rowKey === next.rowKey,
                                      )
                                    ) {
                                      setFocusedCell(next);
                                    }
                                  }
                                  if (event.key === "Escape") cancelEditing();
                                }}
                                onMouseDown={(event) => event.stopPropagation()}
                                className="absolute inset-0 h-auto min-h-0 w-full rounded-none border-0 bg-transparent px-0 py-0 font-mono !text-xs leading-4 md:!text-xs shadow-none focus-visible:ring-0"
                              />
                              {fk && (
                                <div className="absolute left-0 top-full z-30 mt-1 max-h-24 min-w-[220px] overflow-auto rounded-md border bg-background shadow-lg">
                                  {isLoadingFk && (
                                    <div className="p-1 text-[10px] text-muted-foreground">
                                      Loading...
                                    </div>
                                  )}
                                  {!isLoadingFk &&
                                    fkOptions?.options.map((option, idx) => (
                                      <button
                                        key={`${idx}:${option.label}`}
                                        type="button"
                                        className="w-full text-left px-2 py-1 text-[10px] hover:bg-muted"
                                        onMouseDown={(event) => {
                                          event.preventDefault();
                                          setEditingValue(
                                            normalizeDisplay(option.value),
                                          );
                                        }}
                                      >
                                        {option.label}
                                      </button>
                                    ))}
                                </div>
                              )}
                            </div>
                          ) : (
                            <>
                              <span
                                className={`block truncate whitespace-nowrap ${
                                  draftValue !== undefined
                                    ? "text-amber-700 dark:text-amber-400"
                                    : isNull
                                      ? "italic text-muted-foreground/60"
                                      : ""
                                }`}
                              >
                                {normalizeDisplay(effectiveValue)}
                                {fk ? (
                                  <button
                                    type="button"
                                    className="ml-1 text-[10px] text-muted-foreground/60 underline-offset-2 hover:underline hover:text-muted-foreground"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      onOpenRelatedTable?.(
                                        fk.referenced_schema ?? table.schema,
                                        fk.referenced_table,
                                      );
                                    }}
                                  >
                                    ({fk.referenced_table}.
                                    {fk.referenced_column})
                                  </button>
                                ) : null}
                              </span>
                              {/* Botão de expansão: aparece em hover ou com a célula focada. */}
                              <CellExpandPopover
                                columnName={columnName}
                                column={columnMap[columnName]}
                                initialValue={effectiveValue}
                                readOnly={primaryKey.length === 0}
                                onSave={(rawText) =>
                                  applyExpandedEditToRow(
                                    rowKey,
                                    row,
                                    columnName,
                                    rawText,
                                  )
                                }
                                trigger={
                                  <button
                                    type="button"
                                    aria-label={`Expand ${columnName}`}
                                    title="Expand (open editor)"
                                    onClick={(event) => event.stopPropagation()}
                                    onMouseDown={(event) =>
                                      event.stopPropagation()
                                    }
                                    className={`absolute right-1 top-1/2 -translate-y-1/2 z-10 flex h-5 w-5 items-center justify-center rounded border bg-background/95 text-muted-foreground shadow-sm opacity-0 transition-opacity group-hover/cell:opacity-100 focus-visible:opacity-100 hover:text-foreground hover:bg-muted data-[popup-open]:opacity-100 ${isFocused ? "opacity-100" : ""}`}
                                  >
                                    <Expand className="h-3 w-3" />
                                  </button>
                                }
                              />
                            </>
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })}

              {/* ── Virtualization: bottom spacer ─────────────────── */}
              {bottomSpacerHeight > 0 && (
                <tr aria-hidden="true" className="border-0">
                  <td colSpan={visibleColumns.length + 1} className="border-0 p-0" style={{ height: bottomSpacerHeight }} />
                </tr>
              )}
              {totalVirtualRows === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell
                    colSpan={Math.max(visibleColumns.length + 1, 1)}
                    className="text-center py-8 text-muted-foreground/70 border-r-0"
                  >
                    No rows found on this page.
                  </TableCell>
                </TableRow>
              )}
              </TableBody>
            </table>
          </div>
        )}
      </div>

      <div className="border-t px-3 py-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            className={pressableClass}
            onClick={() => setPage((current) => Math.max(current - 1, 0))}
            disabled={page === 0 || isLoading}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <span className="text-xs text-muted-foreground">
            Page {page + 1} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            className={pressableClass}
            onClick={() => setPage((current) => current + 1)}
            disabled={isLoading || page + 1 >= totalPages}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
          <span className="text-xs text-muted-foreground ml-2">
            Rows per page
          </span>
          {[25, 50, 100].map((size) => (
            <Button
              key={size}
              variant={pageSize === size ? "secondary" : "outline"}
              size="sm"
              className={pressableClass}
              onClick={() => {
                setPageSize(size);
                setPage(0);
              }}
            >
              {size}
            </Button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className={pressableClass}
            onClick={discardDrafts}
            disabled={!hasDraftChanges || isSaving}
          >
            <Undo2 className="h-3.5 w-3.5" />
            Discard
          </Button>
          <Button
            variant="default"
            size="sm"
            className={pressableClass}
            onClick={() => void saveAllChanges()}
            disabled={!hasDraftChanges || isSaving}
          >
            {isSaving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            Save Changes
          </Button>
        </div>
      </div>

      <AlertDialog
        open={pendingBatchDelete}
        onOpenChange={setPendingBatchDelete}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm batch delete</AlertDialogTitle>
            <AlertDialogDescription>
              This will stage deletion of{" "}
              <strong>{selectedRowKeys.size} rows</strong>. Changes are
              persisted only when you click <strong>Save Changes</strong>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Input
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              placeholder={`Type ${table.name} to confirm`}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                batchDeleteSelected();
                setPendingBatchDelete(false);
                setConfirmText("");
              }}
              disabled={confirmText !== table.name}
            >
              Stage Delete ({selectedRowKeys.size})
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={pendingTruncate} onOpenChange={setPendingTruncate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Truncate table</AlertDialogTitle>
            <AlertDialogDescription>
              This operation is immediate and removes all rows from the table.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">SQL preview</p>
            <pre className="text-[11px] bg-muted rounded-md p-2 overflow-auto">
              {truncateSqlPreview}
            </pre>
            <Input
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              placeholder={`Type ${table.name} to confirm`}
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void runTruncate()}
              disabled={confirmText !== table.name || isTruncating}
            >
              {isTruncating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Database className="h-3.5 w-3.5" />
              )}
              Truncate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
