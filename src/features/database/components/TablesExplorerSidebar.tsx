import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useRef } from "react";
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
import { Icon } from "@/components/ui/Icon";
import { Input } from "@/components/ui/input";
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
import type { SchemaTableSummary } from "@/ipc/db/types";
import { cn } from "@/lib/utils";

/** Parsed table reference (schema.name) */
interface TableRef {
  name: string;
  schema: string;
}

export interface TablesExplorerSidebarProps {
  /** Set of table names matched by AI (not fuzzy) */
  aiMatchedNames: Set<string>;
  /** Whether AI-powered search is enabled */
  aiSearchEnabled: boolean;
  dbType?: string;
  /** Error message for schema loading */
  errorMessage?: string;
  /** Filtered tables for the currently selected schema */
  filteredTables: SchemaTableSummary[];
  /** Whether AI search is currently in progress */
  isAiSearching: boolean;
  /** Whether the sidebar is collapsed */
  isCollapsed?: boolean;
  /** Whether schema loading failed */
  isError?: boolean;
  /** Whether the schema is currently loading */
  isLoading: boolean;
  onBrowseTableData: (target: { schema: string; name: string }) => void;
  onCopyTableName: (target: { schema: string; name: string }) => void;
  onCopyTableRef: (target: { schema: string; name: string }) => void;
  onCreateIndex: () => void;

  // ── DDL dialog triggers ────────────────────────────────
  onCreateSchema: () => void;
  onCreateTable: () => void;
  onDropTable: (target: { schema: string; name: string }) => void;
  /** Callback to expand the sidebar */
  onExpand?: () => void;
  onExportSchema: (target: { schema: string; name: string }) => void;
  onImportCsv: () => void;
  onInsertTableInsertTemplate: (target: {
    schema: string;
    name: string;
  }) => void;
  onInsertTableSelect: (target: { schema: string; name: string }) => void;
  onInsertTableUpdateTemplate: (target: {
    schema: string;
    name: string;
  }) => void;
  onPrefetchTable: (schema: string, name: string) => void;
  onRenameTable: (target: { schema: string; name: string }) => void;
  /** Retry callback for schema loading */
  onRetry?: () => void;

  // ── Callbacks ──────────────────────────────────────────
  onSchemaChange: (schema: string) => void;
  onSeedData: () => void;
  onTableSearchChange: (search: string) => void;
  onTableSelect: (tableKey: string | null) => void;
  onToggleTableRls: (target: {
    schema: string;
    name: string;
    enable: boolean;
  }) => void | Promise<void>;
  onTruncateTable: (target: {
    schema: string;
    name: string;
  }) => void | Promise<void>;
  onViewDdl: (target: { schema: string; name: string }) => void;
  onViewRlsPolicies: (target: { schema: string; name: string }) => void;
  /** All available schema names */
  schemas: string[];
  /** Currently selected schema name */
  selectedSchema: string;
  /** Currently selected table key (schema.name format) */
  selectedTableKey: string | null;
  /** Parsed reference for the selected table (for disabled-state checks) */
  selectedTableRef: TableRef | null;
  /** Search/filter text */
  tableSearch: string;
  /** Tables grouped by schema, sorted alphabetically */
  tablesBySchema: [string, SchemaTableSummary[]][];
}

/** Row height: py-1 (8px) plus the tallest inline control (a size-4 button, 16px). */
const TABLE_ROW_ESTIMATE = 24;

/** How long the pointer has to rest on a row before that row's queries are prefetched. */
const PREFETCH_HOVER_DELAY_MS = 150;

export function TablesExplorerSidebar({
  tablesBySchema,
  filteredTables,
  schemas,
  selectedSchema,
  selectedTableKey,
  selectedTableRef,
  tableSearch,
  isLoading,
  isError,
  errorMessage,
  onRetry,
  aiSearchEnabled,
  isAiSearching,
  aiMatchedNames,
  isCollapsed,
  onExpand,
  onSchemaChange,
  onTableSelect,
  onTableSearchChange,
  onPrefetchTable,
  onCreateSchema,
  onCreateTable,
  onCreateIndex,
  onImportCsv,
  onSeedData,
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
}: TablesExplorerSidebarProps) {
  const tableMenuClassName = "min-w-52";
  const tableListParentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: filteredTables.length,
    estimateSize: () => TABLE_ROW_ESTIMATE,
    getScrollElement: () => tableListParentRef.current,
    overscan: 6,
  });

  // Prefetching on hover fires two queries per row. Scrolling the list drags the
  // pointer across every row, so doing it on mouseenter alone storms the connection.
  // Wait for the pointer to settle, and drop the pending one as soon as it moves on.
  const prefetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelPrefetch = useCallback(() => {
    if (prefetchTimeoutRef.current !== null) {
      clearTimeout(prefetchTimeoutRef.current);
      prefetchTimeoutRef.current = null;
    }
  }, []);

  const schedulePrefetch = useCallback(
    (schema: string, name: string) => {
      cancelPrefetch();
      prefetchTimeoutRef.current = setTimeout(() => {
        prefetchTimeoutRef.current = null;
        onPrefetchTable(schema, name);
      }, PREFETCH_HOVER_DELAY_MS);
    },
    [cancelPrefetch, onPrefetchTable]
  );

  useEffect(() => cancelPrefetch, [cancelPrefetch]);

  return (
    <aside
      className={cn(
        "h-full min-h-0 overflow-hidden bg-sidebar",
        isCollapsed ? "relative cursor-pointer" : "flex flex-col"
      )}
      onClick={isCollapsed ? onExpand : undefined}
    >
      <div
        className={cn(
          "flex h-full min-h-0 flex-col",
          isCollapsed && "pointer-events-none select-none opacity-0"
        )}
      >
        {/* Sidebar Header */}
        <div className="shrink-0 px-3 pt-3 pb-1">
          {/* Title Row */}
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground text-xs tracking-tight">
                Explorer
              </span>
              {isLoading ? (
                <Icon
                  className="size-3 animate-spin text-muted-foreground"
                  name="loader"
                />
              ) : !isLoading && filteredTables.length > 0 ? (
                <Badge
                  className="h-4 px-1.5 font-mono text-[10px] leading-none"
                  variant="secondary"
                >
                  {filteredTables.length}
                </Badge>
              ) : null}
            </div>
            <div className="flex items-center gap-0.5">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      className="h-6 w-6 text-muted-foreground hover:text-foreground"
                      disabled={!selectedSchema}
                      size="icon"
                      variant="ghost"
                    />
                  }
                >
                  <Icon className="size-3.5" name="plus" />
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="min-w-64"
                  side="bottom"
                >
                  <DropdownMenuItem onClick={onCreateSchema}>
                    <Icon className="size-3.5" name="database" />
                    Create schema
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={onCreateTable}>
                    <Icon className="size-3.5" name="table" />
                    Create table
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!selectedTableRef}
                    onClick={onCreateIndex}
                  >
                    <Icon className="size-3.5" name="pencil" />
                    Create index
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={!selectedTableRef}
                    onClick={onImportCsv}
                  >
                    <Icon className="size-3.5" name="terminal" />
                    Import data (CSV/JSON/Excel)
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!selectedTableRef}
                    onClick={onSeedData}
                  >
                    <Icon className="size-3.5" name="dice" />
                    Seed data
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Schema Selector */}
          {schemas.length > 0 && (
            <Select
              onValueChange={(value) => {
                if (value) {
                  onSchemaChange(value);
                  const firstTable = tablesBySchema.find(
                    ([s]) => s === value
                  )?.[1][0];
                  onTableSelect(
                    firstTable
                      ? `${firstTable.schema}.${firstTable.name}`
                      : null
                  );
                }
              }}
              value={selectedSchema}
            >
              <SelectTrigger className="w-full font-mono text-xs" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {schemas.map((s) => {
                  const count =
                    tablesBySchema.find(([schema]) => schema === s)?.[1]
                      .length ?? 0;
                  return (
                    <SelectItem className="text-xs" key={s} value={s}>
                      <div className="flex items-center gap-2">
                        <Icon
                          className="size-3 text-muted-foreground"
                          name="database"
                        />
                        <span className="font-mono">{s}</span>
                        <Badge
                          className="ml-auto h-4 px-1 font-mono text-[10px]"
                          variant="secondary"
                        >
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
        <div className="shrink-0 px-3 pb-2">
          <div className="relative">
            <Icon
              className="pointer-events-none absolute top-1/2 left-2 size-3 -translate-y-1/2 text-muted-foreground"
              name="search"
            />
            <Input
              className={cn(
                "h-7 border-border/40 bg-muted/50 pl-7 text-xs focus:border-border focus:bg-background",
                aiSearchEnabled && tableSearch && "pr-14",
                aiSearchEnabled && !tableSearch && "pr-8",
                !aiSearchEnabled && tableSearch && "pr-8",
                !(aiSearchEnabled || tableSearch) && "pr-6"
              )}
              onChange={(e) => onTableSearchChange(e.target.value)}
              placeholder={
                aiSearchEnabled ? "Search tables…" : "Filter tables…"
              }
              type="text"
              value={tableSearch}
            />
            {/* Right-side controls — minimal, no visual noise */}
            <div className="absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center gap-0.5">
              {isAiSearching && (
                <Icon
                  className="size-3 animate-spin text-muted-foreground"
                  name="loader"
                />
              )}
              {aiSearchEnabled && !isAiSearching && (
                <Icon
                  className="size-3 text-muted-foreground/40"
                  name="sparkles"
                />
              )}
              {tableSearch && (
                <button
                  className="rounded-sm p-0.5 text-muted-foreground/50 transition-colors hover:text-muted-foreground"
                  onClick={() => onTableSearchChange("")}
                  type="button"
                >
                  <Icon className="size-3" name="x" />
                </button>
              )}
            </div>
          </div>
        </div>

        <Separator className="bg-border/30" />

        {/* Table list */}
        <div className="min-h-0 flex-1 overflow-auto" ref={tableListParentRef}>
          <div className="px-2 py-1.5">
            {isLoading ? (
              <div className="space-y-2 px-1 py-1">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div className="flex items-center gap-2 px-2 py-1" key={i}>
                    <Skeleton className="size-3 shrink-0 rounded-sm" />
                    <Skeleton className="h-2.5 w-20" />
                  </div>
                ))}
              </div>
            ) : isError ? (
              <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
                <Icon
                  className="size-4 text-destructive/70"
                  name="alert-circle"
                />
                <p className="text-muted-foreground text-xs">
                  {errorMessage || "Failed to load tables"}
                </p>
                {onRetry && (
                  <Button
                    className="h-6 px-2 text-[11px]"
                    onClick={onRetry}
                    size="sm"
                    variant="outline"
                  >
                    Retry
                  </Button>
                )}
              </div>
            ) : filteredTables.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
                <Icon
                  className="mb-2 size-4 text-muted-foreground/50"
                  name="file-search"
                />
                <p className="text-muted-foreground text-xs">
                  {tableSearch ? "No matches found" : "No tables"}
                </p>
              </div>
            ) : (
              <div
                className="relative w-full"
                style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
              >
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const table = filteredTables[virtualRow.index];
                  if (!table) {
                    return null;
                  }
                  const isActive =
                    selectedTableKey === `${table.schema}.${table.name}`;
                  const tableTarget = {
                    name: table.name,
                    schema: table.schema,
                  };
                  // Single click only selects the table; the editor opens on
                  // double click, matching the usual DB-client affordance.
                  const handleRowDoubleClick = () =>
                    onBrowseTableData(tableTarget);
                  const tableActions = (
                    <>
                      <DropdownMenuItem
                        onClick={() => onBrowseTableData(tableTarget)}
                      >
                        <Icon className="size-3.5" name="table" />
                        Browse data
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => onInsertTableSelect(tableTarget)}
                      >
                        <Icon className="size-3.5" name="terminal" />
                        Insert SELECT *
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => onCopyTableName(tableTarget)}
                      >
                        <Icon className="size-3.5" name="copy" />
                        Copy table name
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => onCopyTableRef(tableTarget)}
                      >
                        Copy table ref
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => onInsertTableInsertTemplate(tableTarget)}
                      >
                        <Icon className="size-3.5" name="plus" />
                        Insert INSERT template
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => onInsertTableUpdateTemplate(tableTarget)}
                      >
                        <Icon className="size-3.5" name="pencil" />
                        Insert UPDATE template
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => onViewDdl(tableTarget)}>
                        <Icon className="size-3.5" name="script" />
                        View DDL
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => onExportSchema(tableTarget)}
                      >
                        <Icon className="size-3.5" name="file-code-2" />
                        Export schema
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => onRenameTable(tableTarget)}
                      >
                        <Icon className="size-3.5" name="pencil" />
                        Rename table
                      </DropdownMenuItem>
                      {dbType === "postgresql" && (
                        <DropdownMenuItem
                          onClick={() =>
                            onToggleTableRls({
                              enable: !table.has_rls,
                              name: table.name,
                              schema: table.schema,
                            })
                          }
                        >
                          <Icon className="size-3.5" name="lock" />
                          {table.has_rls ? "Disable RLS" : "Enable RLS"}
                        </DropdownMenuItem>
                      )}
                      {table.has_rls && (
                        <DropdownMenuItem
                          onClick={() => onViewRlsPolicies(tableTarget)}
                        >
                          <Icon className="size-3.5" name="lock" />
                          View RLS policies
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => onTruncateTable(tableTarget)}
                        variant="destructive"
                      >
                        <Icon className="size-3.5" name="minus" />
                        Truncate
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => onDropTable(tableTarget)}
                        variant="destructive"
                      >
                        <Icon className="size-3.5" name="trash" />
                        Drop table
                      </DropdownMenuItem>
                    </>
                  );
                  const tableContextActions = (
                    <>
                      <ContextMenuItem
                        onClick={() => onBrowseTableData(tableTarget)}
                      >
                        <Icon className="size-3.5" name="table" />
                        Browse data
                      </ContextMenuItem>
                      <ContextMenuItem
                        onClick={() => onInsertTableSelect(tableTarget)}
                      >
                        <Icon className="size-3.5" name="terminal" />
                        Insert SELECT *
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        onClick={() => onCopyTableName(tableTarget)}
                      >
                        <Icon className="size-3.5" name="copy" />
                        Copy table name
                      </ContextMenuItem>
                      <ContextMenuItem
                        onClick={() => onCopyTableRef(tableTarget)}
                      >
                        Copy table ref
                      </ContextMenuItem>
                      <ContextMenuItem
                        onClick={() => onInsertTableInsertTemplate(tableTarget)}
                      >
                        <Icon className="size-3.5" name="plus" />
                        Insert INSERT template
                      </ContextMenuItem>
                      <ContextMenuItem
                        onClick={() => onInsertTableUpdateTemplate(tableTarget)}
                      >
                        <Icon className="size-3.5" name="pencil" />
                        Insert UPDATE template
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem onClick={() => onViewDdl(tableTarget)}>
                        <Icon className="size-3.5" name="script" />
                        View DDL
                      </ContextMenuItem>
                      <ContextMenuItem
                        onClick={() => onExportSchema(tableTarget)}
                      >
                        <Icon className="size-3.5" name="file-code-2" />
                        Export Schema
                      </ContextMenuItem>
                      <ContextMenuItem
                        onClick={() => onRenameTable(tableTarget)}
                      >
                        <Icon className="size-3.5" name="pencil" />
                        Rename table
                      </ContextMenuItem>
                      {dbType === "postgresql" && (
                        <ContextMenuItem
                          onClick={() =>
                            onToggleTableRls({
                              enable: !table.has_rls,
                              name: table.name,
                              schema: table.schema,
                            })
                          }
                        >
                          <Icon className="size-3.5" name="lock" />
                          {table.has_rls ? "Disable RLS" : "Enable RLS"}
                        </ContextMenuItem>
                      )}
                      {table.has_rls && (
                        <ContextMenuItem
                          onClick={() => onViewRlsPolicies(tableTarget)}
                        >
                          <Icon className="size-3.5" name="lock" />
                          View RLS policies
                        </ContextMenuItem>
                      )}
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        onClick={() => onTruncateTable(tableTarget)}
                        variant="destructive"
                      >
                        <Icon className="size-3.5" name="minus" />
                        Truncate
                      </ContextMenuItem>
                      <ContextMenuItem
                        onClick={() => onDropTable(tableTarget)}
                        variant="destructive"
                      >
                        <Icon className="size-3.5" name="trash" />
                        Drop table
                      </ContextMenuItem>
                    </>
                  );
                  return (
                    <div
                      className="absolute top-0 left-0 w-full px-0"
                      data-index={virtualRow.index}
                      key={virtualRow.key}
                      ref={rowVirtualizer.measureElement}
                      style={{ transform: `translateY(${virtualRow.start}px)` }}
                    >
                      <ContextMenu>
                        <ContextMenuTrigger
                          render={
                            <div
                              className={cn(
                                "group flex w-full items-center gap-2 rounded-md px-2 py-1 text-left transition-colors duration-100",
                                isActive
                                  ? "bg-accent text-accent-foreground"
                                  : "text-foreground/80 hover:bg-muted/50 hover:text-foreground"
                              )}
                              draggable
                              onBlur={cancelPrefetch}
                              onClick={() =>
                                onTableSelect(`${table.schema}.${table.name}`)
                              }
                              onDoubleClick={handleRowDoubleClick}
                              onDragStart={(e) => {
                                const ref = `${table.schema}.${table.name}`;
                                e.dataTransfer.setData(
                                  "text/sql-table-ref",
                                  ref
                                );
                                e.dataTransfer.effectAllowed = "copy";
                              }}
                              onFocus={() =>
                                schedulePrefetch(table.schema, table.name)
                              }
                              onKeyDown={(event) => {
                                if (
                                  event.key === "Enter" ||
                                  event.key === " "
                                ) {
                                  event.preventDefault();
                                  onTableSelect(
                                    `${table.schema}.${table.name}`
                                  );
                                }
                              }}
                              onMouseEnter={() =>
                                schedulePrefetch(table.schema, table.name)
                              }
                              onMouseLeave={cancelPrefetch}
                              role="button"
                              tabIndex={0}
                            >
                              <Icon
                                className={cn(
                                  "size-3 shrink-0 transition-colors",
                                  isActive
                                    ? "text-accent-foreground"
                                    : "text-muted-foreground group-hover:text-foreground/70"
                                )}
                                name="table"
                              />
                              <span className="flex-1 truncate font-medium text-[12px] leading-tight">
                                {table.name}
                              </span>
                              {aiMatchedNames.has(table.name) && (
                                <span className="size-1.5 shrink-0 rounded-full bg-primary/40" />
                              )}
                              <DropdownMenu>
                                <DropdownMenuTrigger
                                  render={
                                    <button
                                      aria-label="Table actions"
                                      className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground/60 opacity-0 transition hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                                      onClick={(event) =>
                                        event.stopPropagation()
                                      }
                                      type="button"
                                    />
                                  }
                                >
                                  <Icon
                                    className="size-3"
                                    name="more-horizontal"
                                  />
                                </DropdownMenuTrigger>
                                <DropdownMenuContent
                                  align="end"
                                  className={tableMenuClassName}
                                  onClick={(event) => event.stopPropagation()}
                                  side="bottom"
                                >
                                  {tableActions}
                                </DropdownMenuContent>
                              </DropdownMenu>
                              {table.has_rls ? (
                                <Tooltip>
                                  <TooltipTrigger
                                    render={
                                      <span className="inline-flex shrink-0" />
                                    }
                                  >
                                    <Icon
                                      className="size-3 shrink-0 text-cyan-500"
                                      name="lock"
                                    />
                                  </TooltipTrigger>
                                  <TooltipContent side="bottom" sideOffset={4}>
                                    RLS enabled
                                  </TooltipContent>
                                </Tooltip>
                              ) : (
                                <Tooltip>
                                  <TooltipTrigger
                                    render={
                                      <span className="inline-flex shrink-0" />
                                    }
                                  >
                                    <Icon
                                      className="size-3 shrink-0 text-muted-foreground/40"
                                      name="lock-open"
                                    />
                                  </TooltipTrigger>
                                  <TooltipContent side="bottom" sideOffset={4}>
                                    RLS disabled
                                  </TooltipContent>
                                </Tooltip>
                              )}
                            </div>
                          }
                        />
                        <ContextMenuContent className={tableMenuClassName}>
                          {tableContextActions}
                        </ContextMenuContent>
                      </ContextMenu>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
