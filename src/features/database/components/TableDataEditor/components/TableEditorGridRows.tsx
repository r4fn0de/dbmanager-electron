import { Icon as UiIcon } from "@/components/ui/Icon";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { TableBody, TableCell, TableRow } from "@/components/ui/table";
import { CellExpandPopover } from "../../CellExpandPopover";
import { getGridCellIndex } from "../utils/tableDataTransforms";
import { getCellTitle, normalizeDisplay } from "../utils/valueParsers";
import type { TableEditorGridRowsProps } from "./TableEditorGrid.types";

export function TableEditorGridRows({
  topSpacerHeight,
  bottomSpacerHeight,
  visibleColumns,
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
  resolveColumnWidth,
  effectiveRowIndexByKey,
  effectiveRowsRef,
  isLoadingFk,
  fkOptions,
  onOpenRelatedTable,
  tableSchema,
  primaryKey,
  applyExpandedEditToRow,
  columnMap,
  totalVirtualRows,
}: TableEditorGridRowsProps) {
  return (
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
                    <span className={`block truncate whitespace-nowrap select-text ${value === null || value === undefined ? "italic text-muted-foreground/60" : ""}`}>
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
                          className={`absolute right-1 top-1/2 -translate-y-1/2 z-10 flex h-5 w-5 items-center justify-center rounded border bg-background/95 text-muted-foreground shadow-sm opacity-0 transition-opacity group-hover/cell:opacity-100 focus-visible:opacity-100 hover:text-foreground hover:bg-muted data-[popup-open]:opacity-100 select-none ${isFocusedInsert ? "opacity-100" : ""}`}
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
        const selectionCellBackground = isSelected ? "bg-muted" : "bg-background";
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
                left: rowRect.left,
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
                            if (rowIndex !== undefined && columnIndex >= 0 && columnsCount > 0) {
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
                                className="w-full text-left px-2 py-1 text-[10px] hover:bg-muted select-none"
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
                        } select-text`}
                      >
                        {normalizeDisplay(effectiveValue)}
                        {fk ? (
                          <button
                            type="button"
                            className="ml-1 text-[10px] text-muted-foreground/60 underline-offset-2 hover:underline hover:text-muted-foreground select-none"
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
                            className={`absolute right-1 top-1/2 -translate-y-1/2 z-10 flex h-5 w-5 items-center justify-center rounded border bg-background/95 text-muted-foreground shadow-sm opacity-0 transition-opacity group-hover/cell:opacity-100 focus-visible:opacity-100 hover:text-foreground hover:bg-muted data-[popup-open]:opacity-100 select-none ${isFocused ? "opacity-100" : ""}`}
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
  );
}
