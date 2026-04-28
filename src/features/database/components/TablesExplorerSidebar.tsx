import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils";
import type { SchemaColumn, SchemaTableSummary } from "@/ipc/db/types";

/** Parsed table reference (schema.name) */
interface TableRef {
  schema: string;
  name: string;
}

export interface TablesExplorerSidebarProps {
  /** Tables grouped by schema, sorted alphabetically */
  tablesBySchema: [string, SchemaTableSummary[]][];
  /** Filtered tables for the currently selected schema */
  filteredTables: SchemaTableSummary[];
  /** All available schema names */
  schemas: string[];
  /** Currently selected schema name */
  selectedSchema: string;
  /** Currently selected table key (schema.name format) */
  selectedTableKey: string | null;
  /** Parsed reference for the selected table (for disabled-state checks) */
  selectedTableRef: TableRef | null;
  /** Loaded details for selected table (columns/actions) */
  selectedTableColumns?: SchemaColumn[];
  /** Search/filter text */
  tableSearch: string;
  /** Whether the schema is currently loading */
  isLoading: boolean;

  // ── Callbacks ──────────────────────────────────────────
  onSchemaChange: (schema: string) => void;
  onTableSelect: (tableKey: string | null) => void;
  onTableSearchChange: (search: string) => void;
  onPrefetchTable: (schema: string, name: string) => void;

  // ── DDL dialog triggers ────────────────────────────────
  onCreateSchema: () => void;
  onCreateTable: () => void;
  onCreateIndex: () => void;
  onImportCsv: () => void;
  onRenameTable: (target: { schema: string; name: string }) => void;
  onDropTable: (target: { schema: string; name: string }) => void;
  onViewRlsPolicies: (target: { schema: string; name: string }) => void;
  onViewDdl: (target: { schema: string; name: string }) => void;
  onExportSchema: (target: { schema: string; name: string }) => void;
  onBrowseTableData: (target: { schema: string; name: string }) => void;
  onTruncateTable: (target: { schema: string; name: string }) => void | Promise<void>;
  onToggleTableRls: (target: { schema: string; name: string; enable: boolean }) => void | Promise<void>;
  dbType?: string;
  onCopyTableName: (target: { schema: string; name: string }) => void;
  onCopyTableRef: (target: { schema: string; name: string }) => void;
  onInsertTableSelect: (target: { schema: string; name: string }) => void;
  onInsertTableInsertTemplate: (target: { schema: string; name: string }) => void;
  onInsertTableUpdateTemplate: (target: { schema: string; name: string }) => void;
  onCopyColumnName: (target: { schema: string; table: string; column: string }) => void;
  onCopyColumnRef: (target: { schema: string; table: string; column: string }) => void;
  onInsertColumnRef: (target: { schema: string; table: string; column: string }) => void;
  onInsertAliasedColumnRef: (target: { schema: string; table: string; column: string }) => void;
  onCopySelectedColumnRefs: (target: { schema: string; table: string; columns: string[] }) => void;
  onInsertSelectedColumns: (target: { schema: string; table: string; columns: string[] }) => void;
}

export function TablesExplorerSidebar({
  tablesBySchema,
  filteredTables,
  schemas,
  selectedSchema,
  selectedTableKey,
  selectedTableRef,
  selectedTableColumns = [],
  tableSearch,
  isLoading,
  onSchemaChange,
  onTableSelect,
  onTableSearchChange,
  onPrefetchTable,
  onCreateSchema,
  onCreateTable,
  onCreateIndex,
  onImportCsv,
  onRenameTable,
  onDropTable,
  onViewRlsPolicies,
  onViewDdl,
  onExportSchema,
  onBrowseTableData,
  onTruncateTable,
  onToggleTableRls,
  dbType,
  onCopyTableName,
  onCopyTableRef,
  onInsertTableSelect,
  onInsertTableInsertTemplate,
  onInsertTableUpdateTemplate,
  onCopyColumnName,
  onCopyColumnRef,
  onInsertColumnRef,
  onInsertAliasedColumnRef,
  onCopySelectedColumnRefs,
  onInsertSelectedColumns,
}: TablesExplorerSidebarProps) {
  const tableMenuClassName = "min-w-52";
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [lastSelectedColumn, setLastSelectedColumn] = useState<string | null>(null);

  useEffect(() => {
    setSelectedColumns([]);
    setLastSelectedColumn(null);
  }, [selectedTableRef?.schema, selectedTableRef?.name]);

  const columnNames = useMemo(
    () => selectedTableColumns.map((column) => column.name),
    [selectedTableColumns],
  );

  const toggleColumnSelection = useCallback((
    event: MouseEvent<HTMLButtonElement>,
    columnName: string,
  ) => {
    const isMeta = event.metaKey || event.ctrlKey;
    const isShift = event.shiftKey;
    if (isShift && lastSelectedColumn) {
      const start = columnNames.indexOf(lastSelectedColumn);
      const end = columnNames.indexOf(columnName);
      if (start >= 0 && end >= 0) {
        const [from, to] = start < end ? [start, end] : [end, start];
        const range = columnNames.slice(from, to + 1);
        setSelectedColumns((prev) => {
          const next = [...prev];
          for (const col of range) {
            if (!next.includes(col)) next.push(col);
          }
          return next;
        });
        return;
      }
    }
    if (isMeta) {
      setSelectedColumns((prev) => (
        prev.includes(columnName)
          ? prev.filter((col) => col !== columnName)
          : [...prev, columnName]
      ));
      setLastSelectedColumn(columnName);
      return;
    }
    setSelectedColumns([columnName]);
    setLastSelectedColumn(columnName);
  }, [columnNames, lastSelectedColumn]);

  const getColumnSelection = useCallback((column: string) => {
    return selectedColumns.includes(column)
      ? selectedColumns
      : [column];
  }, [selectedColumns]);

  return (
    <aside className="h-full min-h-0 flex flex-col bg-sidebar">
      {/* Sidebar Header */}
      <div className="px-3 pt-3 pb-1 shrink-0">
        {/* Title Row */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold tracking-tight text-foreground">Explorer</span>
            {isLoading ? (
              <Icon name="loader" className="size-3 animate-spin text-muted-foreground" />
            ) : !isLoading && filteredTables.length > 0 ? (
              <Badge variant="secondary" className="font-mono text-[10px] h-4 px-1.5 leading-none">
                {filteredTables.length}
              </Badge>
            ) : null}
          </div>
          <div className="flex items-center gap-0.5">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                    disabled={!selectedSchema}
                  />
                }
              >
                <Icon name="plus" className="size-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="bottom">
                <DropdownMenuItem onClick={onCreateSchema}>
                  <Icon name="database" className="size-3.5" />
                  Create schema
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onCreateTable}>
                  <Icon name="table" className="size-3.5" />
                  Create table
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={onCreateIndex}
                  disabled={!selectedTableRef}
                >
                  <Icon name="pencil" className="size-3.5" />
                  Create index
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={onImportCsv}
                  disabled={!selectedTableRef}
                >
                  <Icon name="terminal" className="size-3.5" />
                  Import CSV
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Schema Selector */}
        {schemas.length > 0 && (
          <Select
            value={selectedSchema}
            onValueChange={(value) => {
              if (value) {
                onSchemaChange(value);
                const firstTable = tablesBySchema.find(([s]) => s === value)?.[1][0];
                onTableSelect(firstTable ? `${firstTable.schema}.${firstTable.name}` : null);
              }
            }}
          >
            <SelectTrigger size="sm" className="w-full font-mono text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {schemas.map((s) => {
                const count = tablesBySchema.find(([schema]) => schema === s)?.[1].length ?? 0;
                return (
                  <SelectItem key={s} value={s} className="text-xs">
                    <div className="flex items-center gap-2">
                      <Icon name="database" className="size-3 text-muted-foreground" />
                      <span className="font-mono">{s}</span>
                      <Badge variant="secondary" className="ml-auto font-mono text-[10px] h-4 px-1">
                        {count}
                      </Badge>
                    </div>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Search + Filter Bar */}
      <div className="px-3 pb-2 shrink-0">
        <div className="relative">
          <Icon name="search" className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground pointer-events-none" />
          <Input
            type="text"
            placeholder="Filter tables..."
            value={tableSearch}
            onChange={(e) => onTableSearchChange(e.target.value)}
            className="h-7 pl-7 pr-7 text-xs bg-muted/40 border-dashed focus:bg-background focus:border-solid"
          />
          {tableSearch && (
            <button
              type="button"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => onTableSearchChange("")}
            >
              <Icon name="x" className="size-3" />
            </button>
          )}
        </div>
      </div>

      <Separator className="bg-border/30" />

      {/* Table list */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="px-2 py-1.5">
          {isLoading ? (
            <div className="space-y-2 px-1 py-1">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-2.5 px-2 py-2">
                  <Skeleton className="size-3.5 rounded-sm shrink-0" />
                  <Skeleton className="h-3 w-24" />
                </div>
              ))}
            </div>
          ) : filteredTables.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
              <Icon name="file-search" className="size-4 text-muted-foreground/50 mb-2" />
              <p className="text-xs text-muted-foreground">
                {tableSearch ? "No matches found" : "No tables"}
              </p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {filteredTables.map((table) => {
                const isActive = selectedTableKey === `${table.schema}.${table.name}`;
                const tableTarget = { schema: table.schema, name: table.name };
                const tableActions = (
                  <>
                    <DropdownMenuItem onClick={() => onBrowseTableData(tableTarget)}>
                      <Icon name="table" className="size-3.5" />
                      Browse data
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onInsertTableSelect(tableTarget)}>
                      <Icon name="terminal" className="size-3.5" />
                      Insert SELECT *
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => onCopyTableName(tableTarget)}>
                      <Icon name="copy" className="size-3.5" />
                      Copy table name
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onCopyTableRef(tableTarget)}>
                      <Icon name="copy" className="size-3.5" />
                      Copy table ref
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onInsertTableInsertTemplate(tableTarget)}>
                      <Icon name="plus" className="size-3.5" />
                      Insert INSERT template
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onInsertTableUpdateTemplate(tableTarget)}>
                      <Icon name="pencil" className="size-3.5" />
                      Insert UPDATE template
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => onViewDdl(tableTarget)}>
                      <Icon name="script" className="size-3.5" />
                      View DDL
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onExportSchema(tableTarget)}>
                      <Icon name="file-code-2" className="size-3.5" />
                      Export schema
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onRenameTable(tableTarget)}>
                      <Icon name="pencil" className="size-3.5" />
                      Rename table
                    </DropdownMenuItem>
                    {dbType === "postgresql" && (
                      <DropdownMenuItem
                        onClick={() => onToggleTableRls({
                          schema: table.schema,
                          name: table.name,
                          enable: !table.has_rls,
                        })}
                      >
                        <Icon name="lock" className="size-3.5" />
                        {table.has_rls ? "Disable RLS" : "Enable RLS"}
                      </DropdownMenuItem>
                    )}
                    {table.has_rls && (
                      <DropdownMenuItem onClick={() => onViewRlsPolicies(tableTarget)}>
                        <Icon name="lock" className="size-3.5" />
                        View RLS policies
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => onTruncateTable(tableTarget)}
                    >
                      <Icon name="minus" className="size-3.5" />
                      Truncate
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => onDropTable(tableTarget)}
                    >
                      <Icon name="trash" className="size-3.5" />
                      Drop table
                    </DropdownMenuItem>
                  </>
                );
                const tableContextActions = (
                  <>
                    <ContextMenuItem onClick={() => onBrowseTableData(tableTarget)}>
                      <Icon name="table" className="size-3.5" />
                      Browse data
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => onInsertTableSelect(tableTarget)}>
                      <Icon name="terminal" className="size-3.5" />
                      Insert SELECT *
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onClick={() => onCopyTableName(tableTarget)}>
                      <Icon name="copy" className="size-3.5" />
                      Copy table name
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => onCopyTableRef(tableTarget)}>
                      <Icon name="copy" className="size-3.5" />
                      Copy table ref
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => onInsertTableInsertTemplate(tableTarget)}>
                      <Icon name="plus" className="size-3.5" />
                      Insert INSERT template
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => onInsertTableUpdateTemplate(tableTarget)}>
                      <Icon name="pencil" className="size-3.5" />
                      Insert UPDATE template
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onClick={() => onViewDdl(tableTarget)}>
                      <Icon name="script" className="size-3.5" />
                      View DDL
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => onExportSchema(tableTarget)}>
                      <Icon name="file-code-2" className="size-3.5" />
                      Export Schema
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => onRenameTable(tableTarget)}>
                      <Icon name="pencil" className="size-3.5" />
                      Rename table
                    </ContextMenuItem>
                    {dbType === "postgresql" && (
                      <ContextMenuItem
                        onClick={() => onToggleTableRls({
                          schema: table.schema,
                          name: table.name,
                          enable: !table.has_rls,
                        })}
                      >
                        <Icon name="lock" className="size-3.5" />
                        {table.has_rls ? "Disable RLS" : "Enable RLS"}
                      </ContextMenuItem>
                    )}
                    {table.has_rls && (
                      <ContextMenuItem onClick={() => onViewRlsPolicies(tableTarget)}>
                        <Icon name="lock" className="size-3.5" />
                        View RLS policies
                      </ContextMenuItem>
                    )}
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      variant="destructive"
                      onClick={() => onTruncateTable(tableTarget)}
                    >
                      <Icon name="minus" className="size-3.5" />
                      Truncate
                    </ContextMenuItem>
                    <ContextMenuItem
                      variant="destructive"
                      onClick={() => onDropTable(tableTarget)}
                    >
                      <Icon name="trash" className="size-3.5" />
                      Drop table
                    </ContextMenuItem>
                  </>
                );
                return (
                  <ContextMenu key={`${table.schema}.${table.name}`}>
                    <ContextMenuTrigger
                      render={
                        <div
                          role="button"
                          tabIndex={0}
                          draggable
                          onDragStart={(e) => {
                            const ref = `${table.schema}.${table.name}`;
                            e.dataTransfer.setData("text/sql-table-ref", ref);
                            e.dataTransfer.effectAllowed = "copy";
                          }}
                          onClick={() =>
                            onTableSelect(`${table.schema}.${table.name}`)
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              onTableSelect(`${table.schema}.${table.name}`);
                            }
                          }}
                          onMouseEnter={() =>
                            onPrefetchTable(table.schema, table.name)
                          }
                          onFocus={() =>
                            onPrefetchTable(table.schema, table.name)
                          }
                          className={cn(
                            "group w-full flex items-center gap-2.5 px-2.5 py-1.75 rounded-md text-left transition-colors duration-100",
                            isActive
                              ? "bg-accent text-accent-foreground"
                              : "hover:bg-muted/50 text-foreground/80 hover:text-foreground"
                          )}
                        >
                          <Icon
                            name="table"
                            className={cn(
                              "size-3.5 shrink-0 transition-colors",
                              isActive
                                ? "text-accent-foreground"
                                : "text-muted-foreground group-hover:text-foreground/70"
                            )}
                          />
                          <span className="flex-1 truncate text-[13px] font-medium leading-tight">
                            {table.name}
                          </span>
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              render={
                                <button
                                  type="button"
                                  aria-label="Table actions"
                                  onClick={(event) => event.stopPropagation()}
                                  className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground/60 opacity-0 transition hover:bg-muted hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
                                />
                              }
                            >
                              <Icon name="more-horizontal" className="size-3" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                              className={tableMenuClassName}
                              align="end"
                              side="bottom"
                              onClick={(event) => event.stopPropagation()}
                            >
                              {tableActions}
                            </DropdownMenuContent>
                          </DropdownMenu>
                          {table.has_rls ? (
                            <Tooltip>
                              <TooltipTrigger
                                render={<span className="inline-flex shrink-0" />}
                              >
                                <Icon name="lock" className="size-3 text-cyan-500 shrink-0" />
                              </TooltipTrigger>
                              <TooltipContent side="bottom" sideOffset={4}>RLS enabled</TooltipContent>
                            </Tooltip>
                          ) : (
                            <Tooltip>
                              <TooltipTrigger
                                render={<span className="inline-flex shrink-0" />}
                              >
                                <Icon name="lock-open" className="size-3 text-muted-foreground/40 shrink-0" />
                              </TooltipTrigger>
                              <TooltipContent side="bottom" sideOffset={4}>RLS disabled</TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      }
                    />
                    <ContextMenuContent className={tableMenuClassName}>
                      {tableContextActions}
                    </ContextMenuContent>
                  </ContextMenu>
                );
              })}

              {selectedTableRef && selectedTableColumns.length > 0 && (
                <div className="mt-2 space-y-0.5 border-t border-border/40 pt-2">
                  <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground/70">
                    Columns ({selectedTableColumns.length})
                  </div>
                  {selectedTableColumns.map((column) => {
                    const selectedForColumn = getColumnSelection(column.name);
                    const columnTarget = {
                      schema: selectedTableRef.schema,
                      table: selectedTableRef.name,
                      column: column.name,
                    };
                    const isSelected = selectedColumns.includes(column.name);
                    return (
                      <ContextMenu key={`${selectedTableRef.schema}.${selectedTableRef.name}.${column.name}`}>
                        <ContextMenuTrigger
                          render={
                            <button
                              type="button"
                              onClick={(event) => toggleColumnSelection(event, column.name)}
                              className={cn(
                                "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                                isSelected
                                  ? "bg-accent/70 text-accent-foreground"
                                  : "text-foreground/75 hover:bg-muted/50 hover:text-foreground",
                              )}
                            >
                              <Icon name="key" className="size-3 text-muted-foreground" />
                              <span className="flex-1 truncate text-xs font-mono">{column.name}</span>
                              <span className="truncate text-[10px] text-muted-foreground/70">
                                {column.data_type}
                              </span>
                            </button>
                          }
                        />
                        <ContextMenuContent>
                          <ContextMenuItem onClick={() => onCopyColumnName(columnTarget)}>
                            <Icon name="copy" className="size-3.5" />
                            Copy column name
                          </ContextMenuItem>
                          <ContextMenuItem onClick={() => onCopyColumnRef(columnTarget)}>
                            <Icon name="copy" className="size-3.5" />
                            Copy qualified ref
                          </ContextMenuItem>
                          <ContextMenuSeparator />
                          <ContextMenuItem onClick={() => onInsertColumnRef(columnTarget)}>
                            <Icon name="terminal" className="size-3.5" />
                            Insert column ref
                          </ContextMenuItem>
                          <ContextMenuItem onClick={() => onInsertAliasedColumnRef(columnTarget)}>
                            <Icon name="code" className="size-3.5" />
                            Insert aliased ref
                          </ContextMenuItem>
                          <ContextMenuSeparator />
                          <ContextMenuItem
                            disabled={selectedForColumn.length <= 1}
                            onClick={() => onCopySelectedColumnRefs({
                              schema: selectedTableRef.schema,
                              table: selectedTableRef.name,
                              columns: selectedForColumn,
                            })}
                          >
                            <Icon name="copy" className="size-3.5" />
                            Copy selected refs
                          </ContextMenuItem>
                          <ContextMenuItem
                            disabled={selectedForColumn.length <= 1}
                            onClick={() => onInsertSelectedColumns({
                              schema: selectedTableRef.schema,
                              table: selectedTableRef.name,
                              columns: selectedForColumn,
                            })}
                          >
                            <Icon name="code" className="size-3.5" />
                            Insert selected refs
                          </ContextMenuItem>
                        </ContextMenuContent>
                      </ContextMenu>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}
