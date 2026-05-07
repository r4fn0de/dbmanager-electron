import { Icon as UiIcon } from "@/components/ui/Icon";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CellExpandPopover } from "../../CellExpandPopover";
import type { SchemaColumn, SchemaForeignKey, TableSort } from "@/ipc/db/types";
import type { RowRecord, RowUpdateDraft } from "../types";
import { getGridCellIndex } from "../utils/tableDataTransforms";
import { getCellTitle, normalizeDisplay } from "../utils/valueParsers";

interface EditingCell {
  rowKey: string;
  column: string;
  source: "existing" | "insert";
  insertIndex?: number;
}

interface TableEditorGridProps {
  isBlockingTableLoading: boolean;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onGridScroll: () => void;
  handleTableKeyDown: (event: React.KeyboardEvent) => void;
  isAllSelected: boolean;
  isSomeSelected: boolean;
  toggleSelectAll: () => void;
  visibleColumns: string[];
  sort: TableSort[];
  columnMap: Record<string, SchemaColumn>;
  resolveColumnWidth: (columnName: string) => number;
  onSortColumn: (columnName: string) => void;
  handleResizeMouseDown: (column: string, event: React.MouseEvent) => void;
  topSpacerHeight: number;
  bottomSpacerHeight: number;
  visibleDraftInserts: Array<{ row: RowRecord; insertIndex: number }>;
  editingCell: EditingCell | null;
  focusedCell: { rowKey: string; column: string } | null;
  beginEditInsertCell: (insertIndex: number, columnName: string) => void;
  setFocusedCell: React.Dispatch<
    React.SetStateAction<{ rowKey: string; column: string } | null>
  >;
  editingValue: string;
  setEditingValue: React.Dispatch<React.SetStateAction<string>>;
  loadFkOptionsDebounced: (columnName: string, query: string) => void;
  persistEditing: (baseRow?: RowRecord) => void;
  suppressInlineEditorMouseUpRef: React.RefObject<boolean>;
  keepCaretNavigationInsideInlineInput: (
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => void;
  cancelEditing: () => void;
  applyExpandedEditToInsert: (
    insertIndex: number,
    columnName: string,
    rawText: string,
  ) => void;
  visibleEffectiveRows: Array<{ row: RowRecord; rowKey: string; index: number }>;
  selectedRowKeys: Set<string>;
  draftUpdates: Record<string, RowUpdateDraft>;
  handleRowClick: (
    rowKey: string,
    index: number,
    event: React.MouseEvent,
  ) => void;
  cancelPendingHoverClear: () => void;
  showFloatingRowButton: (payload: {
    rowKey: string;
    row: RowRecord;
    index: number;
    top: number;
    left: number;
    width: number;
    height: number;
  }) => void;
  scheduleHoverClear: () => void;
  onToggleRowSelection: (rowKey: string) => void;
  findFkForColumn: (column: string) => SchemaForeignKey | undefined;
  beginEditExistingCell: (
    rowKey: string,
    row: RowRecord,
    columnName: string,
    options?: { selectAllOnFocus?: boolean },
  ) => void;
  effectiveRowIndexByKey: Map<string, number>;
  effectiveRowsRef: React.RefObject<
    Array<{ row: RowRecord; rowKey: string; index: number }>
  >;
  isLoadingFk: boolean;
  fkOptions: { options: Array<{ label: string; value: unknown }> } | null;
  onOpenRelatedTable?: (schema: string, table: string) => void;
  tableSchema: string;
  primaryKey: string[];
  applyExpandedEditToRow: (
    rowKey: string,
    baseRow: RowRecord,
    columnName: string,
    rawText: string,
  ) => void;
  totalVirtualRows: number;
}

export function TableEditorGrid({
  isBlockingTableLoading,
  scrollRef,
  onGridScroll,
  handleTableKeyDown,
  isAllSelected,
  isSomeSelected,
  toggleSelectAll,
  visibleColumns,
  sort,
  columnMap,
  resolveColumnWidth,
  onSortColumn,
  handleResizeMouseDown,
  topSpacerHeight,
  bottomSpacerHeight,
  visibleDraftInserts,
  editingCell,
  focusedCell,
  beginEditInsertCell,
  setFocusedCell,
  editingValue,
  setEditingValue,
  loadFkOptionsDebounced,
  persistEditing,
  suppressInlineEditorMouseUpRef,
  keepCaretNavigationInsideInlineInput,
  cancelEditing,
  applyExpandedEditToInsert,
  visibleEffectiveRows,
  selectedRowKeys,
  draftUpdates,
  handleRowClick,
  cancelPendingHoverClear,
  showFloatingRowButton,
  scheduleHoverClear,
  onToggleRowSelection,
  findFkForColumn,
  beginEditExistingCell,
  effectiveRowIndexByKey,
  effectiveRowsRef,
  isLoadingFk,
  fkOptions,
  onOpenRelatedTable,
  tableSchema,
  primaryKey,
  applyExpandedEditToRow,
  totalVirtualRows,
}: TableEditorGridProps) {
  if (isBlockingTableLoading) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 text-muted-foreground">
        <UiIcon name="loader" className="h-5 w-5 animate-spin" />
        <span className="text-xs">Loading table data...</span>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="h-full overflow-auto" onScroll={onGridScroll}>
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
                  <Checkbox checked={false} onCheckedChange={toggleSelectAll} />
                )}
              </div>
            </TableHead>
            {visibleColumns.map((columnName) => {
              const sorted = sort[0]?.column === columnName ? sort[0].direction : null;
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
                    onClick={() => onSortColumn(columnName)}
                  >
                    <div className="flex items-center min-w-0 gap-1">
                      <span
                        className="min-w-0 flex-1 basis-0 overflow-hidden text-ellipsis whitespace-nowrap font-semibold text-foreground/90"
                        title={column?.data_type ? `${columnName} (${column.data_type})` : columnName}
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
                  <button
                    type="button"
                    aria-label={`Resize column ${columnName}`}
                    className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors z-20"
                    onMouseDown={(e) => handleResizeMouseDown(columnName, e)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                      }
                    }}
                  />
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody
          className="align-top"
          style={{ contentVisibility: "auto", containIntrinsicSize: "800px" }}
        >
          {topSpacerHeight > 0 && (
            <tr aria-hidden="true" className="border-0">
              <td colSpan={visibleColumns.length + 1} className="border-0 p-0" style={{ height: topSpacerHeight }} />
            </tr>
          )}
          {visibleDraftInserts.map(({ row, insertIndex }) => (
            <TableRow key={`insert:${insertIndex}`} className="bg-emerald-500/5 hover:bg-emerald-500/10">
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
                          value={editingValue}
                          onChange={(event) => {
                            setEditingValue(event.target.value);
                            loadFkOptionsDebounced(columnName, event.target.value);
                          }}
                          onBlur={() => persistEditing()}
                          onFocus={(event) => {
                            if (!suppressInlineEditorMouseUpRef.current) return;
                            event.currentTarget.select();
                          }}
                          onMouseUp={(event) => {
                            if (!suppressInlineEditorMouseUpRef.current) return;
                            event.preventDefault();
                            suppressInlineEditorMouseUpRef.current = false;
                          }}
                          onKeyDown={(event) => {
                            keepCaretNavigationInsideInlineInput(event);
                            if (event.key === "Enter") {
                              event.preventDefault();
                              persistEditing();
                              const colIdx = visibleColumns.indexOf(columnName);
                              if (colIdx >= 0 && colIdx < visibleColumns.length - 1) {
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
                        <span className={`block truncate whitespace-nowrap ${value === null || value === undefined ? "italic text-muted-foreground/60" : ""}`}>
                          {normalizeDisplay(value)}
                        </span>
                        <CellExpandPopover
                          columnName={columnName}
                          column={columnMap[columnName]}
                          initialValue={value}
                          onSave={(rawText) =>
                            applyExpandedEditToInsert(insertIndex, columnName, rawText)
                          }
                          trigger={
                            <button
                              type="button"
                              aria-label={`Expand ${columnName}`}
                              title="Expand (open editor)"
                              onClick={(event) => event.stopPropagation()}
                              onMouseDown={(event) => event.stopPropagation()}
                              className={`absolute right-1 top-1/2 -translate-y-1/2 z-10 flex h-5 w-5 items-center justify-center rounded border bg-background/95 text-muted-foreground shadow-sm opacity-0 transition-opacity group-hover/cell:opacity-100 focus-visible:opacity-100 hover:text-foreground hover:bg-muted data-[popup-open]:opacity-100 ${isFocusedInsert ? "opacity-100" : ""}`}
                            >
                              <UiIcon name="arrows-maximize" className="h-3 w-3" />
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
                : "bg-background";
            return (
              <TableRow
                key={rowKey}
                data-row-selection-scope="row"
                className={`group/row ${isSelected ? "bg-primary/10" : isRowUpdated ? "bg-amber-500/5" : index % 2 === 1 ? "bg-muted/30" : ""}`}
                onClick={(e) => handleRowClick(rowKey, index, e)}
                onMouseEnter={(event) => {
                  cancelPendingHoverClear();
                  const rowRect = event.currentTarget.getBoundingClientRect();
                  showFloatingRowButton({
                    rowKey,
                    row,
                    index,
                    top: rowRect.top + rowRect.height / 2,
                    left: rowRect.left - 12,
                    width: rowRect.width,
                    height: rowRect.height,
                  });
                }}
                onMouseLeave={scheduleHoverClear}
              >
                <TableCell
                  className={`sticky left-0 z-[1] w-12 min-w-12 border-r border-border px-2 relative ${selectionCellBackground}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="relative flex items-center justify-center">
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => onToggleRowSelection(rowKey)}
                    />
                  </div>
                </TableCell>
                {visibleColumns.map((columnName) => {
                  const draftValue = draftUpdates[rowKey]?.changes[columnName];
                  const effectiveValue = draftValue ?? row[columnName];
                  const isEditing =
                    editingCell?.source === "existing" &&
                    editingCell.rowKey === rowKey &&
                    editingCell.column === columnName;
                  const isFocused =
                    focusedCell?.rowKey === rowKey && focusedCell?.column === columnName;
                  const fk = findFkForColumn(columnName);
                  const isNull = effectiveValue === null || effectiveValue === undefined;
                  const width = resolveColumnWidth(columnName);

                  return (
                    <TableCell
                      key={`${rowKey}:${columnName}`}
                      className={`group/cell relative font-mono align-middle truncate border-r border-border last:border-r-0 py-0.5 px-2 h-7 ${isFocused ? "ring-2 ring-primary/40 ring-inset bg-primary/5" : ""}`}
                      style={{ width, minWidth: width, maxWidth: width }}
                      title={getCellTitle(effectiveValue)}
                      onDoubleClick={() => beginEditExistingCell(rowKey, row, columnName)}
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
                            value={editingValue}
                            onChange={(event) => {
                              setEditingValue(event.target.value);
                              loadFkOptionsDebounced(columnName, event.target.value);
                            }}
                            onBlur={() => persistEditing(row)}
                            onFocus={(event) => {
                              if (!suppressInlineEditorMouseUpRef.current) return;
                              event.currentTarget.select();
                            }}
                            onMouseUp={(event) => {
                              if (!suppressInlineEditorMouseUpRef.current) return;
                              event.preventDefault();
                              suppressInlineEditorMouseUpRef.current = false;
                            }}
                            onKeyDown={(event) => {
                              keepCaretNavigationInsideInlineInput(event);
                              if (event.key === "Enter") {
                                event.preventDefault();
                                persistEditing(row);
                                const rowIndex = effectiveRowIndexByKey.get(rowKey);
                                const columnIndex = visibleColumns.indexOf(columnName);
                                const columnsCount = visibleColumns.length;
                                if (
                                  rowIndex !== undefined &&
                                  columnIndex >= 0 &&
                                  columnsCount > 0
                                ) {
                                  const currentCellIndex = getGridCellIndex(
                                    rowIndex,
                                    columnIndex,
                                    columnsCount,
                                  );
                                  const nextCellIndex = Math.min(
                                    currentCellIndex + 1,
                                    effectiveRowsRef.current.length * columnsCount - 1,
                                  );
                                  const nextRowIndex = Math.floor(nextCellIndex / columnsCount);
                                  const nextColumnIndex = nextCellIndex % columnsCount;
                                  const nextRow = effectiveRowsRef.current[nextRowIndex];
                                  const nextColumn = visibleColumns[nextColumnIndex];
                                  if (nextRow && nextColumn) {
                                    setFocusedCell({
                                      rowKey: nextRow.rowKey,
                                      column: nextColumn,
                                    });
                                  }
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
                                      setEditingValue(normalizeDisplay(option.value));
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
                                    fk.referenced_schema ?? tableSchema,
                                    fk.referenced_table,
                                  );
                                }}
                              >
                                ({fk.referenced_table}.{fk.referenced_column})
                              </button>
                            ) : null}
                          </span>
                          <CellExpandPopover
                            columnName={columnName}
                            column={columnMap[columnName]}
                            initialValue={effectiveValue}
                            readOnly={primaryKey.length === 0}
                            onSave={(rawText) =>
                              applyExpandedEditToRow(rowKey, row, columnName, rawText)
                            }
                            trigger={
                              <button
                                type="button"
                                aria-label={`Expand ${columnName}`}
                                title="Expand (open editor)"
                                onClick={(event) => event.stopPropagation()}
                                onMouseDown={(event) => event.stopPropagation()}
                                className={`absolute right-1 top-1/2 -translate-y-1/2 z-10 flex h-5 w-5 items-center justify-center rounded border bg-background/95 text-muted-foreground shadow-sm opacity-0 transition-opacity group-hover/cell:opacity-100 focus-visible:opacity-100 hover:text-foreground hover:bg-muted data-[popup-open]:opacity-100 ${isFocused ? "opacity-100" : ""}`}
                              >
                                <UiIcon name="arrows-maximize" className="h-3 w-3" />
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
  );
}
