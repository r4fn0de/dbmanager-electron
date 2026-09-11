import { Checkbox } from "@/components/ui/checkbox";
import { Icon as UiIcon } from "@/components/ui/Icon";
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
    <TableBody className="align-top">
      {topSpacerHeight > 0 && (
        <tr aria-hidden="true" className="border-0">
          <td
            className="border-0 p-0"
            colSpan={visibleColumns.length + 1}
            style={{ height: topSpacerHeight }}
          />
        </tr>
      )}
      {visibleDraftInserts.map(({ row, insertIndex }) => (
        <TableRow
          className="bg-emerald-500/5 hover:bg-emerald-500/10"
          key={`insert:${insertIndex}`}
        >
          <TableCell className="sticky left-0 z-[1] h-7 w-12 min-w-12 border-border border-r bg-background px-2 py-0.5 text-center text-muted-foreground">
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
                className={`group/cell relative h-7 truncate border-border border-r px-2 py-0.5 align-middle font-mono last:border-r-0 ${isFocusedInsert ? "bg-primary/5 ring-2 ring-primary/40 ring-inset" : ""}`}
                key={`insert:${insertIndex}:${columnName}`}
                onClick={() =>
                  setFocusedCell({
                    column: columnName,
                    rowKey: `insert:${insertIndex}`,
                  })
                }
                onDoubleClick={() =>
                  beginEditInsertCell(insertIndex, columnName)
                }
                style={{ maxWidth: width, minWidth: width, width }}
              >
                {isEditing ? (
                  <div className="relative">
                    <span className="invisible block whitespace-nowrap">
                      {normalizeDisplay(value)}
                    </span>
                    <Input
                      className="!text-xs md:!text-xs absolute inset-0 h-auto min-h-0 w-full rounded-none border-0 bg-transparent px-0 py-0 font-mono leading-4 shadow-none focus-visible:ring-0"
                      onBlur={() => persistEditing()}
                      onChange={(event) => {
                        setEditingValue(event.target.value);
                        loadFkOptionsDebounced(columnName, event.target.value);
                      }}
                      onFocus={(event) => {
                        if (!suppressInlineEditorMouseUpRef.current) {
                          return;
                        }
                        event.currentTarget.select();
                      }}
                      onKeyDown={(event) => {
                        keepCaretNavigationInsideInlineInput(event);
                        if (event.key === "Enter") {
                          event.preventDefault();
                          persistEditing();
                          const colIdx = visibleColumns.indexOf(columnName);
                          if (
                            colIdx >= 0 &&
                            colIdx < visibleColumns.length - 1
                          ) {
                            setFocusedCell({
                              column: visibleColumns[colIdx + 1],
                              rowKey: `insert:${insertIndex}`,
                            });
                          }
                        }
                        if (event.key === "Escape") {
                          cancelEditing();
                        }
                      }}
                      onMouseDown={(event) => event.stopPropagation()}
                      onMouseUp={(event) => {
                        if (!suppressInlineEditorMouseUpRef.current) {
                          return;
                        }
                        event.preventDefault();
                        suppressInlineEditorMouseUpRef.current = false;
                      }}
                      value={editingValue}
                    />
                  </div>
                ) : (
                  <>
                    <span
                      className={`block select-text truncate whitespace-nowrap ${value === null || value === undefined ? "text-muted-foreground/60 italic" : ""}`}
                    >
                      {normalizeDisplay(value)}
                    </span>
                    <CellExpandPopover
                      column={columnMap[columnName]}
                      columnName={columnName}
                      initialValue={value}
                      onSave={(rawText) =>
                        applyExpandedEditToInsert(
                          insertIndex,
                          columnName,
                          rawText
                        )
                      }
                      trigger={
                        <button
                          aria-label={`Expand ${columnName}`}
                          className={`absolute top-1/2 right-1 flex h-5 w-5 -translate-y-1/2 select-none items-center justify-center rounded border bg-background/95 text-muted-foreground opacity-0 shadow-sm transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover/cell:opacity-100 data-[popup-open]:opacity-100 ${isFocusedInsert ? "opacity-100" : ""}`}
                          onClick={(event) => event.stopPropagation()}
                          onMouseDown={(event) => event.stopPropagation()}
                          title="Expand (open editor)"
                          type="button"
                        >
                          <UiIcon className="h-3 w-3" name="arrows-maximize" />
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
          : "bg-background";
        return (
          <TableRow
            className={`group/row ${isSelected ? "bg-primary/10" : isRowUpdated ? "bg-amber-500/5" : index % 2 === 1 ? "bg-muted/30" : ""}`}
            data-row-selection-scope="row"
            key={rowKey}
            onClick={(e) => handleRowClick(rowKey, index, e)}
            onMouseEnter={(event) => {
              cancelPendingHoverClear();
              const rowRect = event.currentTarget.getBoundingClientRect();
              showFloatingRowButton({
                height: rowRect.height,
                index,
                left: rowRect.left,
                row,
                rowKey,
                top: rowRect.top + rowRect.height / 2,
                width: rowRect.width,
              });
            }}
            onMouseLeave={scheduleHoverClear}
          >
            <TableCell
              className={`sticky left-0 z-[1] w-12 min-w-12 border-border border-r px-2 ${selectionCellBackground}`}
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
                focusedCell?.rowKey === rowKey &&
                focusedCell?.column === columnName;
              const fk = findFkForColumn(columnName);
              const isNull =
                effectiveValue === null || effectiveValue === undefined;
              const width = resolveColumnWidth(columnName);

              return (
                <TableCell
                  className={`group/cell relative h-7 truncate border-border border-r px-2 py-0.5 align-middle font-mono last:border-r-0 ${isFocused ? "bg-primary/5 ring-2 ring-primary/40 ring-inset" : ""}`}
                  key={`${rowKey}:${columnName}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setFocusedCell({ column: columnName, rowKey });
                  }}
                  onDoubleClick={() =>
                    beginEditExistingCell(rowKey, row, columnName)
                  }
                  style={{ maxWidth: width, minWidth: width, width }}
                  title={getCellTitle(effectiveValue)}
                >
                  {isEditing ? (
                    <div className="relative">
                      <span className="invisible block whitespace-nowrap">
                        {normalizeDisplay(effectiveValue)}
                      </span>
                      <Input
                        className="!text-xs md:!text-xs absolute inset-0 h-auto min-h-0 w-full rounded-none border-0 bg-transparent px-0 py-0 font-mono leading-4 shadow-none focus-visible:ring-0"
                        onBlur={() => persistEditing(row)}
                        onChange={(event) => {
                          setEditingValue(event.target.value);
                          loadFkOptionsDebounced(
                            columnName,
                            event.target.value
                          );
                        }}
                        onFocus={(event) => {
                          if (!suppressInlineEditorMouseUpRef.current) {
                            return;
                          }
                          event.currentTarget.select();
                        }}
                        onKeyDown={(event) => {
                          keepCaretNavigationInsideInlineInput(event);
                          if (event.key === "Enter") {
                            event.preventDefault();
                            persistEditing(row);
                            const rowIndex = effectiveRowIndexByKey.get(rowKey);
                            const columnIndex =
                              visibleColumns.indexOf(columnName);
                            const columnsCount = visibleColumns.length;
                            if (
                              rowIndex !== undefined &&
                              columnIndex >= 0 &&
                              columnsCount > 0
                            ) {
                              const currentCellIndex = getGridCellIndex(
                                rowIndex,
                                columnIndex,
                                columnsCount
                              );
                              const nextCellIndex = Math.min(
                                currentCellIndex + 1,
                                effectiveRowsRef.current.length * columnsCount -
                                  1
                              );
                              const nextRowIndex = Math.floor(
                                nextCellIndex / columnsCount
                              );
                              const nextColumnIndex =
                                nextCellIndex % columnsCount;
                              const nextRow =
                                effectiveRowsRef.current[nextRowIndex];
                              const nextColumn =
                                visibleColumns[nextColumnIndex];
                              if (nextRow && nextColumn) {
                                setFocusedCell({
                                  column: nextColumn,
                                  rowKey: nextRow.rowKey,
                                });
                              }
                            }
                          }
                          if (event.key === "Escape") {
                            cancelEditing();
                          }
                        }}
                        onMouseDown={(event) => event.stopPropagation()}
                        onMouseUp={(event) => {
                          if (!suppressInlineEditorMouseUpRef.current) {
                            return;
                          }
                          event.preventDefault();
                          suppressInlineEditorMouseUpRef.current = false;
                        }}
                        value={editingValue}
                      />
                      {fk && (
                        <div className="absolute top-full left-0 z-30 mt-1 max-h-24 min-w-[220px] overflow-auto rounded-md border bg-background shadow-lg">
                          {isLoadingFk && (
                            <div className="p-1 text-[10px] text-muted-foreground">
                              Loading...
                            </div>
                          )}
                          {!isLoadingFk &&
                            fkOptions?.options.map((option, idx) => (
                              <button
                                className="w-full select-none px-2 py-1 text-left text-[10px] hover:bg-muted"
                                key={`${idx}:${option.label}`}
                                onMouseDown={(event) => {
                                  event.preventDefault();
                                  setEditingValue(
                                    normalizeDisplay(option.value)
                                  );
                                }}
                                type="button"
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
                          draftValue === undefined
                            ? isNull
                              ? "text-muted-foreground/60 italic"
                              : ""
                            : "text-amber-700 dark:text-amber-400"
                        } select-text`}
                      >
                        {normalizeDisplay(effectiveValue)}
                        {fk ? (
                          <button
                            className="ml-1 select-none text-[10px] text-muted-foreground/60 underline-offset-2 hover:text-muted-foreground hover:underline"
                            onClick={(event) => {
                              event.stopPropagation();
                              onOpenRelatedTable?.(
                                fk.referenced_schema ?? tableSchema,
                                fk.referenced_table
                              );
                            }}
                            type="button"
                          >
                            ({fk.referenced_table}.{fk.referenced_column})
                          </button>
                        ) : null}
                      </span>
                      <CellExpandPopover
                        column={columnMap[columnName]}
                        columnName={columnName}
                        initialValue={effectiveValue}
                        onSave={(rawText) =>
                          applyExpandedEditToRow(
                            rowKey,
                            row,
                            columnName,
                            rawText
                          )
                        }
                        readOnly={primaryKey.length === 0}
                        trigger={
                          <button
                            aria-label={`Expand ${columnName}`}
                            className={`absolute top-1/2 right-1 flex h-5 w-5 -translate-y-1/2 select-none items-center justify-center rounded border bg-background/95 text-muted-foreground opacity-0 shadow-sm transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover/cell:opacity-100 data-[popup-open]:opacity-100 ${isFocused ? "opacity-100" : ""}`}
                            onClick={(event) => event.stopPropagation()}
                            onMouseDown={(event) => event.stopPropagation()}
                            title="Expand (open editor)"
                            type="button"
                          >
                            <UiIcon
                              className="h-3 w-3"
                              name="arrows-maximize"
                            />
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
          <td
            className="border-0 p-0"
            colSpan={visibleColumns.length + 1}
            style={{ height: bottomSpacerHeight }}
          />
        </tr>
      )}
      {totalVirtualRows === 0 && (
        <TableRow className="hover:bg-transparent">
          <TableCell
            className="border-r-0 py-8 text-center text-muted-foreground/70"
            colSpan={Math.max(visibleColumns.length + 1, 1)}
          >
            No rows found on this page.
          </TableCell>
        </TableRow>
      )}
    </TableBody>
  );
}
