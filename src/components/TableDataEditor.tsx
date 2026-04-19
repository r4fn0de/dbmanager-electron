import {
  ChevronLeft,
  ChevronRight,
  Columns3,
  Database,
  Download,
  Expand,
  Filter,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Undo2,
  Wand,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { CellExpandPopover } from "./CellExpandPopover";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import type {
  SchemaTableDetails,
  TableRowsResponse,
  SchemaColumn,
  TableForeignKeyMeta,
} from "@/ipc/db/types";

interface TableDataEditorProps {
  connectionId: string;
  table: SchemaTableDetails;
  listRows: (input: {
    connectionId: string;
    schema: string;
    table: string;
    page: number;
    pageSize: number;
  }) => Promise<TableRowsResponse>;
  saveChanges: (input: {
    connectionId: string;
    schema: string;
    table: string;
    inserts: Record<string, unknown>[];
    updates: { primaryKey: Record<string, unknown>; changes: Record<string, unknown> }[];
    deletes: { primaryKey: Record<string, unknown> }[];
  }) => Promise<{ inserted: number; updated: number; deleted: number }>;
  truncate: (input: { connectionId: string; schema: string; table: string }) => Promise<void>;
}

type RowRecord = Record<string, unknown>;
type SortDirection = "asc" | "desc";

interface SortSpec {
  column: string;
  direction: SortDirection;
}

interface UpdateDraft {
  rowKey: string;
  primaryKey: Record<string, unknown>;
  changes: Record<string, unknown>;
}

interface DeleteDraft {
  rowKey: string;
  primaryKey: Record<string, unknown>;
}

export function TableDataEditor({
  connectionId,
  table,
  listRows,
  saveChanges,
  truncate,
}: TableDataEditorProps) {
  const [rowsResponse, setRowsResponse] = useState<TableRowsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTruncating, setIsTruncating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [sort, setSort] = useState<SortSpec[]>([]);

  const [editingCell, setEditingCell] = useState<{
    rowKey: string;
    column: string;
    source: "existing" | "insert";
    insertIndex?: number;
  } | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [focusedCell, setFocusedCell] = useState<{
    rowKey: string;
    column: string;
  } | null>(null);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [visibleColumns, setVisibleColumns] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [filterColumn, setFilterColumn] = useState<string>(table.columns[0]?.name ?? "");
  const [filterValue, setFilterValue] = useState<string>("");
  const suppressInlineEditorMouseUpRef = useRef(false);

  // Draft states
  const [draftInserts, setDraftInserts] = useState<RowRecord[]>([]);
  const [draftUpdates, setDraftUpdates] = useState<Record<string, UpdateDraft>>({});
  const [draftDeletes, setDraftDeletes] = useState<Record<string, DeleteDraft>>({});

  // Editing state

  // Selection state
  const [selectedRowKeys, setSelectedRowKeys] = useState<Set<string>>(new Set());

  // Dialog states
  const [pendingBatchDelete, setPendingBatchDelete] = useState(false);
  const [pendingTruncate, setPendingTruncate] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const columnMap = useMemo(() => {
    const map = new Map<string, SchemaColumn>();
    for (const col of table.columns) {
      map.set(col.name, col);
    }
    return map;
  }, [table.columns]);

  const primaryKey = useMemo(() => rowsResponse?.primaryKey ?? [], [rowsResponse]);

  const loadRows = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await listRows({
        connectionId,
        schema: table.schema,
        table: table.name,
        page: page + 1,
        pageSize,
      });
      setRowsResponse(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load rows");
    } finally {
      setIsLoading(false);
    }
  }, [connectionId, table.schema, table.name, page, pageSize, listRows]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  // Reset page when table changes
  useEffect(() => {
    setPage(0);
    setDraftInserts([]);
    setDraftUpdates({});
    setDraftDeletes({});
    setSelectedRowKeys(new Set());
    setVisibleColumns(table.columns.map((c) => c.name));
  }, [table.schema, table.name, table.columns]);

  const resolveColumnWidth = useCallback(
    (columnName: string): number => {
      return columnWidths[columnName] ?? 150;
    },
    [columnWidths],
  );

  const effectiveRows = useMemo(() => {
    if (!rowsResponse?.rows) return [];
    let rows = rowsResponse.rows.map((row, index) => ({
      row,
      rowKey: primaryKey.length > 0
        ? primaryKey.map((k) => String(row[k] ?? "null")).join("|")
        : `row-${index}`,
      index,
    }));

    // Apply client-side filtering
    if (filterValue.trim() && filterColumn) {
      const searchStr = filterValue.trim().toLowerCase();
      rows = rows.filter(({ row }) => {
        const val = row[filterColumn];
        if (val === null || val === undefined) return false;
        return String(val).toLowerCase().includes(searchStr);
      });
    }

    // Apply client-side sorting
    if (sort.length > 0) {
      const { column, direction } = sort[0];
      rows = [...rows].sort((a, b) => {
        const aVal = a.row[column];
        const bVal = b.row[column];

        if (aVal === null || aVal === undefined) return 1;
        if (bVal === null || bVal === undefined) return -1;

        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return direction === 'asc' ? aVal - bVal : bVal - aVal;
        }

        const aStr = String(aVal);
        const bStr = String(bVal);
        const comparison = aStr.localeCompare(bStr);
        return direction === 'asc' ? comparison : -comparison;
      });
    }

    return rows;
  }, [rowsResponse, primaryKey, sort, filterColumn, filterValue]);

  const effectiveRowsRef = useRef(effectiveRows);
  effectiveRowsRef.current = effectiveRows;

  const totalPages = useMemo(() => {
    const total = rowsResponse?.totalEstimate ?? 0;
    return Math.max(Math.ceil(total / pageSize), 1);
  }, [pageSize, rowsResponse?.totalEstimate]);

  const dirtyCounts = useMemo(
    () => ({
      inserts: draftInserts.length,
      updates: Object.keys(draftUpdates).length,
      deletes: Object.keys(draftDeletes).length,
    }),
    [draftInserts, draftUpdates, draftDeletes]
  );

  const hasDraftChanges = dirtyCounts.inserts + dirtyCounts.updates + dirtyCounts.deletes > 0;

  const allVisibleRowKeys = useMemo(
    () => new Set(effectiveRows.map((r) => r.rowKey)),
    [effectiveRows]
  );

  const isAllSelected =
    allVisibleRowKeys.size > 0 &&
    [...allVisibleRowKeys].every((key) => selectedRowKeys.has(key));

  const isSomeSelected =
    !isAllSelected && [...allVisibleRowKeys].some((key) => selectedRowKeys.has(key));

  const toggleSelectAll = useCallback(() => {
    if (isAllSelected) {
      setSelectedRowKeys(new Set());
    } else {
      setSelectedRowKeys(new Set(allVisibleRowKeys));
    }
  }, [isAllSelected, allVisibleRowKeys]);

  const handleAddDraftRecord = useCallback(() => {
    const newRecord: RowRecord = {};
    table.columns.forEach((col) => {
      newRecord[col.name] = null;
    });
    setDraftInserts((current) => [...current, newRecord]);
  }, [table.columns]);

  const handleExport = useCallback((format: "csv" | "json") => {
    const dataToExport = [...draftInserts, ...effectiveRows.map(({ row }) => row)];
    const columnsToExport = visibleColumns;

    if (format === "csv") {
      const headers = columnsToExport.join(",");
      const rows = dataToExport.map((row) =>
        columnsToExport
          .map((col) => {
            const val = row[col];
            if (val === null || val === undefined) return "";
            const str = String(val);
            if (str.includes(",") || str.includes("\n") || str.includes(`"`)) {
              return `"${str.replace(/"/g, `""`)}"`;
            }
            return str;
          })
          .join(","),
      );
      const csv = [headers, ...rows].join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${table.name}_export.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } else if (format === "json") {
      const json = JSON.stringify(dataToExport, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${table.name}_export.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
  }, [draftInserts, effectiveRows, visibleColumns, table.name]);

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

      const result = await saveChanges({
        connectionId,
        schema: table.schema,
        table: table.name,
        inserts,
        updates,
        deletes,
      });

      discardDrafts();
      await loadRows();
      toast.success(`Saved: ${result.inserted} inserted, ${result.updated} updated, ${result.deleted} deleted`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save changes");
      toast.error(err instanceof Error ? err.message : "Failed to save changes");
    } finally {
      setIsSaving(false);
    }
  };

  const runTruncate = async () => {
    setIsTruncating(true);
    setError(null);
    try {
      await truncate({ connectionId, schema: table.schema, table: table.name });
      discardDrafts();
      await loadRows();
      setPendingTruncate(false);
      setConfirmText("");
      toast.success("Table truncated");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to truncate table");
      toast.error(err instanceof Error ? err.message : "Failed to truncate table");
    } finally {
      setIsTruncating(false);
    }
  };

  const batchDeleteSelected = useCallback(() => {
    if (primaryKey.length === 0) return;
    const toDelete: Record<string, DeleteDraft> = {};
    for (const rowKey of selectedRowKeys) {
      const entry = effectiveRows.find((r) => r.rowKey === rowKey);
      if (!entry) continue;
      const row = entry.row;
      const pk = Object.fromEntries(primaryKey.map((column) => [column, row[column]]));
      toDelete[rowKey] = { rowKey, primaryKey: pk };
    }
    setDraftDeletes((current) => ({ ...current, ...toDelete }));
    setSelectedRowKeys(new Set());
  }, [primaryKey, selectedRowKeys, effectiveRows]);

  const parseByType = (rawText: string, column: SchemaColumn): unknown => {
    if (rawText.trim() === "" || rawText.toLowerCase() === "null") return null;
    if (column.data_type === "integer" || column.data_type === "bigint" || column.data_type === "numeric" || column.data_type === "real" || column.data_type === "double precision") {
      const num = Number(rawText);
      return Number.isNaN(num) ? rawText : num;
    }
    if (column.data_type === "boolean") return rawText.toLowerCase() === "true";
    return rawText;
  };

  const beginEditCell = (rowKey: string, row: RowRecord, columnName: string, options?: { selectAllOnFocus?: boolean }) => {
    if (primaryKey.length === 0) return;
    const draftedValue = draftUpdates[rowKey]?.changes[columnName];
    const currentValue = draftedValue ?? row[columnName];
    suppressInlineEditorMouseUpRef.current = options?.selectAllOnFocus ?? true;
    setEditingCell({ rowKey, column: columnName, source: "existing" });
    setEditingValue(normalizeDisplay(currentValue));
  };

  const beginEditInsertCell = (insertIndex: number, columnName: string, options?: { selectAllOnFocus?: boolean }) => {
    const value = draftInserts[insertIndex]?.[columnName];
    suppressInlineEditorMouseUpRef.current = options?.selectAllOnFocus ?? true;
    setEditingCell({ rowKey: `insert:${insertIndex}`, column: columnName, source: "insert", insertIndex });
    setEditingValue(normalizeDisplay(value ?? ""));
  };

  const cancelEditing = () => {
    setEditingCell(null);
    setEditingValue("");
  };

  const keepCaretNavigationInsideInlineInput = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.stopPropagation();
    const input = event.currentTarget;
    const start = input.selectionStart ?? 0;
    const end = input.selectionEnd ?? 0;
    const hasSelection = start !== end;
    if (event.key === "ArrowLeft" && !hasSelection && start === 0) event.preventDefault();
    if (event.key === "ArrowRight" && !hasSelection && end >= input.value.length) event.preventDefault();
    if (event.key === "ArrowUp" || event.key === "ArrowDown") event.preventDefault();
  };

  const persistEditing = (baseRow?: RowRecord) => {
    if (!editingCell) return;
    const column = columnMap.get(editingCell.column);
    if (!column) { cancelEditing(); return; }
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

    if (!baseRow) { cancelEditing(); return; }

    const originalValue = baseRow[editingCell.column];
    const unchanged = JSON.stringify(originalValue) === JSON.stringify(parsed);

    setDraftUpdates((current) => {
      const next = { ...current };
      const existing = next[editingCell.rowKey] ?? {
        primaryKey: Object.fromEntries(primaryKey.map((pk) => [pk, baseRow[pk]])),
        changes: {},
      };
      const changes = { ...existing.changes };
      if (unchanged) { delete changes[editingCell.column]; } else { changes[editingCell.column] = parsed; }
      if (Object.keys(changes).length === 0) { delete next[editingCell.rowKey]; } else { next[editingCell.rowKey] = { ...existing, changes }; }
      return next;
    });

    cancelEditing();
  };

  // Keyboard navigation
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
      if (editingCell) return;
      if (!focusedCell) return;

      const currentIdx = allNavigableCells.findIndex(
        (c) => c.rowKey === focusedCell.rowKey && c.column === focusedCell.column,
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
          nextIdx = Math.min(currentIdx + colsCount, allNavigableCells.length - 1);
          break;
        case "ArrowUp":
          event.preventDefault();
          nextIdx = Math.max(currentIdx - colsCount, 0);
          break;
        case "Tab":
          event.preventDefault();
          if (event.shiftKey) { nextIdx = Math.max(currentIdx - 1, 0); } else { nextIdx = Math.min(currentIdx + 1, allNavigableCells.length - 1); }
          break;
        case "Enter": {
          event.preventDefault();
          const entry = effectiveRowsRef.current.find((r) => r.rowKey === focusedCell.rowKey);
          if (entry) beginEditCell(focusedCell.rowKey, entry.row, focusedCell.column, { selectAllOnFocus: false });
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
    [editingCell, focusedCell, allNavigableCells, visibleColumns.length, beginEditCell],
  );

  const normalizeDisplay = (value: unknown): string => {
    if (value === null || value === undefined) return "NULL";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  };

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Toolbar */}
      <div className="border-b px-3 py-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowFilters((v) => !v)}>
            <Filter className="h-3.5 w-3.5" />
            Filters
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger>
              <Button variant="outline" size="sm">
                <Columns3 className="h-3.5 w-3.5" />
                Columns
              </Button>
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

          <DropdownMenu>
            <DropdownMenuTrigger>
              <Button variant="outline" size="sm">
                <Download className="h-3.5 w-3.5" />
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => handleExport("csv")}>Export as CSV</DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport("json")}>Export as JSON</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button variant="default" size="sm" onClick={handleAddDraftRecord}>
            <Plus className="h-3.5 w-3.5" />
            Add record
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setPendingTruncate(true);
              setConfirmText("");
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Truncate
          </Button>

          {selectedRowKeys.size > 0 && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setPendingBatchDelete(true)}
              disabled={primaryKey.length === 0}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete ({selectedRowKeys.size})
            </Button>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs">
          <Badge variant="outline">{rowsResponse?.totalEstimate ?? 0} rows</Badge>
          <Badge variant="outline">+{dirtyCounts.inserts}</Badge>
          <Badge variant="outline">~{dirtyCounts.updates}</Badge>
          <Badge variant="outline">-{dirtyCounts.deletes}</Badge>
          {isLoading && (
            <Badge variant="secondary" className="gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading...
            </Badge>
          )}
          <Button variant="outline" size="icon-sm" onClick={loadRows} disabled={isLoading}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Filters */}
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
            onChange={(e) => {
              setFilterValue(e.target.value);
              setPage(0);
            }}
            placeholder="Contains..."
          />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="px-3 py-2 text-xs text-destructive border-b">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="flex-1 min-h-0 overflow-auto">
        {isLoading ? (
          <div className="h-full flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Table className="min-h-full w-max table-fixed text-xs border-separate border-spacing-0 focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2" onKeyDown={handleTableKeyDown} tabIndex={0}>
            <TableHeader className="sticky top-0 z-10 bg-muted/40 backdrop-blur-sm border-b-2 border-border">
              <TableRow className="hover:bg-transparent">
                <TableHead className="sticky left-0 z-5 w-12 min-w-12 border-r border-border bg-background px-2 py-1 text-center h-8">
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
                      <Checkbox checked={false} onCheckedChange={toggleSelectAll} />
                    )}
                  </div>
                </TableHead>
                {visibleColumns.map((columnName) => {
                  const sorted = sort[0]?.column === columnName ? sort[0].direction : null;
                  const column = columnMap.get(columnName);
                  const width = resolveColumnWidth(columnName);
                  return (
                    <TableHead
                      key={columnName}
                      className="cursor-pointer border-r border-border last:border-r-0 select-none hover:bg-muted/60 transition-colors relative group h-8 py-1 px-2 bg-background"
                      style={{ width, minWidth: width, maxWidth: width }}
                      onClick={() => {
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
                    >
                      <span className="font-semibold text-foreground/90">
                        {columnName}
                      </span>
                      <span className="ml-1.5 text-[10px] font-normal text-muted-foreground/70">
                        {column?.data_type}
                      </span>
                      {sorted && (
                        <span className="ml-1 text-[10px] font-medium text-primary">
                          {sorted === "asc" ? "↑" : "↓"}
                        </span>
                      )}
                      {/* Resize handle */}
                      <div
                        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors z-20"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const startX = e.clientX;
                          const startWidth = resolveColumnWidth(columnName);

                          const handleMouseMove = (moveEvent: MouseEvent) => {
                            const deltaX = moveEvent.clientX - startX;
                            const newWidth = Math.max(80, startWidth + deltaX);
                            setColumnWidths((prev) => ({
                              ...prev,
                              [columnName]: newWidth,
                            }));
                          };

                          const handleMouseUp = () => {
                            document.removeEventListener("mousemove", handleMouseMove);
                            document.removeEventListener("mouseup", handleMouseUp);
                            document.body.style.cursor = "";
                            document.body.style.userSelect = "";
                          };

                          document.addEventListener("mousemove", handleMouseMove);
                          document.addEventListener("mouseup", handleMouseUp);
                          document.body.style.cursor = "col-resize";
                          document.body.style.userSelect = "none";
                        }}
                      />
                    </TableHead>
                  );
                })}
              </TableRow>
            </TableHeader>
            <TableBody className="align-top">
              {/* Draft inserts */}
              {draftInserts.map((row, insertIndex) => (
                <TableRow key={`insert:${insertIndex}`} className="bg-emerald-500/5 hover:bg-emerald-500/10">
                  <TableCell className="sticky left-0 z-1 w-12 min-w-12 border-r border-border bg-background px-2 py-0.5 text-center text-muted-foreground h-7">
                    N
                  </TableCell>
                  {visibleColumns.map((columnName) => {
                    const isEditing =
                      editingCell?.source === "insert" &&
                      editingCell.insertIndex === insertIndex &&
                      editingCell.column === columnName;
                    const value = row[columnName];
                    const column = columnMap.get(columnName);
                    const width = resolveColumnWidth(columnName);
                    const isFocusedInsert =
                      focusedCell?.rowKey === `insert:${insertIndex}` &&
                      focusedCell?.column === columnName;
                    return (
                      <TableCell
                        key={`insert:${insertIndex}:${columnName}`}
                        className={`group/cell relative truncate font-mono align-middle border-r border-border last:border-r-0 py-0.5 px-2 h-7 ${isFocusedInsert ? "ring-2 ring-primary/40 ring-inset bg-primary/5" : ""}`}
                        style={{ width, minWidth: width, maxWidth: width }}
                        onDoubleClick={() => beginEditInsertCell(insertIndex, columnName)}
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
                              onChange={(e) => setEditingValue(e.target.value)}
                              onBlur={() => persistEditing()}
                              onFocus={(e) => {
                                if (suppressInlineEditorMouseUpRef.current) e.currentTarget.select();
                              }}
                              onMouseUp={(e) => {
                                if (!suppressInlineEditorMouseUpRef.current) return;
                                e.preventDefault();
                                suppressInlineEditorMouseUpRef.current = false;
                              }}
                              onKeyDown={(e) => {
                                keepCaretNavigationInsideInlineInput(e);
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  persistEditing();
                                  const colIdx = visibleColumns.indexOf(columnName);
                                  if (colIdx >= 0 && colIdx < visibleColumns.length - 1) {
                                    setFocusedCell({
                                      rowKey: `insert:${insertIndex}`,
                                      column: visibleColumns[colIdx + 1],
                                    });
                                  }
                                }
                                if (e.key === "Escape") cancelEditing();
                              }}
                              onMouseDown={(e) => e.stopPropagation()}
                              className="absolute inset-0 h-auto min-h-0 w-full rounded-none border-0 bg-transparent px-0 py-0 font-mono text-xs! leading-4 shadow-none focus-visible:ring-0"
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
                              column={column}
                              initialValue={value}
                              onSave={(rawText) => {
                                if (!column) return;
                                const parsed = parseByType(rawText, column);
                                setDraftInserts((current) => {
                                  const next = [...current];
                                  next[insertIndex] = { ...next[insertIndex], [columnName]: parsed };
                                  return next;
                                });
                              }}
                              trigger={
                                <button
                                  type="button"
                                  aria-label={`Expand ${columnName}`}
                                  title="Expand (open editor)"
                                  onClick={(e) => e.stopPropagation()}
                                  onMouseDown={(e) => e.stopPropagation()}
                                  className={`absolute right-1 top-1/2 -translate-y-1/2 z-10 flex h-5 w-5 items-center justify-center rounded border bg-background/95 text-muted-foreground shadow-sm opacity-0 transition-opacity group-hover/cell:opacity-100 focus-visible:opacity-100 hover:text-foreground hover:bg-muted data-popup-open:opacity-100 ${isFocusedInsert ? "opacity-100" : ""}`}
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

              {/* Existing rows */}
              {effectiveRows.map(({ row, rowKey }) => {
                const isSelected = selectedRowKeys.has(rowKey);
                const isRowUpdated = !!draftUpdates[rowKey];
                const isRowDeleted = !!draftDeletes[rowKey];

                if (isRowDeleted) return null;

                return (
                  <TableRow
                    key={rowKey}
                    className={`${isSelected ? "bg-primary/10" : isRowUpdated ? "bg-amber-500/5" : ""} hover:bg-muted/30`}
                  >
                    <TableCell className="sticky left-0 z-1 w-12 min-w-12 border-r border-border bg-background px-2 py-0.5 text-center h-7">
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
                    </TableCell>
                    {visibleColumns.map((columnName) => {
                      const draftValue = draftUpdates[rowKey]?.changes[columnName];
                      const effectiveValue = draftValue !== undefined ? draftValue : row[columnName];
                      const isEditing =
                        editingCell?.source === "existing" && editingCell?.rowKey === rowKey && editingCell?.column === columnName;
                      const column = columnMap.get(columnName);
                      const width = resolveColumnWidth(columnName);
                      const isFocused =
                        focusedCell?.rowKey === rowKey && focusedCell?.column === columnName;

                      return (
                        <TableCell
                          key={`${rowKey}:${columnName}`}
                          className={`group/cell relative truncate font-mono align-middle border-r border-border last:border-r-0 py-0.5 px-2 h-7 ${isFocused ? "ring-2 ring-primary/40 ring-inset bg-primary/5" : ""}`}
                          style={{ width, minWidth: width, maxWidth: width }}
                          onDoubleClick={() => beginEditCell(rowKey, row, columnName)}
                          onClick={() => {
                            setFocusedCell({
                              rowKey,
                              column: columnName,
                            });
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
                                onChange={(e) => setEditingValue(e.target.value)}
                                onBlur={() => persistEditing(row)}
                                onFocus={(e) => {
                                  if (suppressInlineEditorMouseUpRef.current) e.currentTarget.select();
                                }}
                                onMouseUp={(e) => {
                                  if (!suppressInlineEditorMouseUpRef.current) return;
                                  e.preventDefault();
                                  suppressInlineEditorMouseUpRef.current = false;
                                }}
                                onKeyDown={(e) => {
                                  keepCaretNavigationInsideInlineInput(e);
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    persistEditing(row);
                                  }
                                  if (e.key === "Escape") cancelEditing();
                                }}
                                onMouseDown={(e) => e.stopPropagation()}
                                className="absolute inset-0 h-auto min-h-0 w-full rounded-none border-0 bg-transparent px-0 py-0 font-mono text-xs! leading-4 shadow-none focus-visible:ring-0"
                              />
                            </div>
                          ) : (
                            <>
                              <span
                                className={`block truncate whitespace-nowrap ${
                                  draftValue !== undefined
                                    ? "text-amber-700 dark:text-amber-400"
                                    : effectiveValue === null
                                      ? "italic text-muted-foreground/60"
                                      : ""
                                }`}
                              >
                                {normalizeDisplay(effectiveValue)}
                              </span>
                              <CellExpandPopover
                                columnName={columnName}
                                column={column}
                                initialValue={effectiveValue}
                                onSave={(rawText) => {
                                  if (!column) return;
                                  const parsed = parseByType(rawText, column);
                                  const originalValue = row[columnName];
                                  const unchanged =
                                    JSON.stringify(originalValue) === JSON.stringify(parsed);

                                  if (!unchanged) {
                                    setDraftUpdates((current) => {
                                      const next = { ...current };
                                      const existing = next[rowKey] ?? {
                                        primaryKey: Object.fromEntries(
                                          primaryKey.map((pk) => [pk, row[pk]]),
                                        ),
                                        changes: {},
                                      };
                                      const changes = { ...existing.changes };
                                      changes[columnName] = parsed;
                                      next[rowKey] = { ...existing, changes };
                                      return next;
                                    });
                                  }
                                }}
                                trigger={
                                  <button
                                    type="button"
                                    aria-label={`Expand ${columnName}`}
                                    title="Expand (open editor)"
                                    onClick={(e) => e.stopPropagation()}
                                    onMouseDown={(e) => e.stopPropagation()}
                                    className={`absolute right-1 top-1/2 -translate-y-1/2 z-10 flex h-5 w-5 items-center justify-center rounded border bg-background/95 text-muted-foreground shadow-sm opacity-0 transition-opacity group-hover/cell:opacity-100 focus-visible:opacity-100 hover:text-foreground hover:bg-muted data-popup-open:opacity-100 ${isFocused ? "opacity-100" : ""}`}
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

              {effectiveRows.length === 0 && draftInserts.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={visibleColumns.length + 1}
                    className="text-center py-8 text-muted-foreground border-r border-border"
                  >
                    No rows found on this page.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Footer */}
      <div className="border-t px-3 py-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
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
            onClick={() => setPage((current) => current + 1)}
            disabled={isLoading || page + 1 >= totalPages}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
          <span className="text-xs text-muted-foreground ml-2">Rows per page</span>
          {[25, 50, 100].map((size) => (
            <Button
              key={size}
              variant={pageSize === size ? "secondary" : "outline"}
              size="sm"
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
            onClick={discardDrafts}
            disabled={!hasDraftChanges || isSaving}
          >
            <Undo2 className="h-3.5 w-3.5" />
            Discard
          </Button>
          <Button
            variant="default"
            size="sm"
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

      {/* Batch Delete Dialog */}
      <AlertDialog open={pendingBatchDelete} onOpenChange={setPendingBatchDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm batch delete</AlertDialogTitle>
            <AlertDialogDescription>
              This will stage deletion of <strong>{selectedRowKeys.size} rows</strong>. Changes
              are persisted only when you click <strong>Save Changes</strong>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
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

      {/* Truncate Dialog */}
      <AlertDialog open={pendingTruncate} onOpenChange={setPendingTruncate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Truncate table</AlertDialogTitle>
            <AlertDialogDescription>
              This operation is immediate and removes all rows from the table.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <pre className="text-[11px] bg-muted rounded-md p-2 overflow-auto">
              TRUNCATE TABLE "{table.schema}"."{table.name}";
            </pre>
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
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
                <Trash2 className="h-3.5 w-3.5" />
              )}
              Truncate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
