import { Badge } from "@/components/ui/badge";
import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
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
import type { SchemaTableSummary } from "@/ipc/db/types";

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
  /** Search/filter text */
  tableSearch: string;
  /** Whether the schema is currently loading */
  isLoading: boolean;
  /** Whether AI-powered search is enabled */
  aiSearchEnabled: boolean;
  /** Whether AI search is currently in progress */
  isAiSearching: boolean;
  /** Set of table names matched by AI (not fuzzy) */
  aiMatchedNames: Set<string>;
  /** Whether the sidebar is collapsed */
  isCollapsed?: boolean;
  /** Callback to expand the sidebar */
  onExpand?: () => void;

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
  onSeedData: () => void;
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
}

export function TablesExplorerSidebar({
  tablesBySchema,
  filteredTables,
  schemas,
  selectedSchema,
  selectedTableKey,
  selectedTableRef,
  tableSearch,
  isLoading,
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
    getScrollElement: () => tableListParentRef.current,
    estimateSize: () => 30,
    overscan: 6,
  });

  return (
    <aside
      className={cn("h-full min-h-0 bg-sidebar overflow-hidden", isCollapsed ? "relative cursor-pointer" : "flex flex-col")}
      onClick={isCollapsed ? onExpand : undefined}
    >
      <div
        className={cn(
          "h-full min-h-0 flex flex-col",
          isCollapsed && "opacity-0 pointer-events-none select-none",
        )}
      >
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
              <DropdownMenuContent align="end" side="bottom" className="min-w-64">
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
                  Import data (CSV/JSON/Excel)
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={onSeedData}
                  disabled={!selectedTableRef}
                >
                  <Icon name="dice" className="size-3.5" />
                  Seed data
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
            placeholder={aiSearchEnabled ? "Search tables…" : "Filter tables…"}
            value={tableSearch}
            onChange={(e) => onTableSearchChange(e.target.value)}
            className={cn(
              "h-7 pl-7 text-xs bg-muted/50 border-border/40 focus:bg-background focus:border-border",
              aiSearchEnabled && tableSearch && "pr-14",
              aiSearchEnabled && !tableSearch && "pr-8",
              !aiSearchEnabled && tableSearch && "pr-8",
              !aiSearchEnabled && !tableSearch && "pr-6",
            )}
          />
          {/* Right-side controls — minimal, no visual noise */}
          <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
            {isAiSearching && (
              <Icon name="loader" className="size-3 animate-spin text-muted-foreground" />
            )}
            {aiSearchEnabled && !isAiSearching && (
              <Icon name="sparkles" className="size-3 text-muted-foreground/40" />
            )}
            {tableSearch && (
              <button
                type="button"
                className="text-muted-foreground/50 hover:text-muted-foreground transition-colors rounded-sm p-0.5"
                onClick={() => onTableSearchChange("")}
              >
                <Icon name="x" className="size-3" />
              </button>
            )}
          </div>
        </div>
      </div>

      <Separator className="bg-border/30" />

      {/* Table list */}
      <div ref={tableListParentRef} className="flex-1 min-h-0 overflow-auto">
        <div className="px-2 py-1.5">
          {isLoading ? (
            <div className="space-y-2 px-1 py-1">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-2 px-2 py-1">
                  <Skeleton className="size-3 rounded-sm shrink-0" />
                  <Skeleton className="h-2.5 w-20" />
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
            <div
              className="relative w-full"
              style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const table = filteredTables[virtualRow.index];
                if (!table) return null;
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
                  <div
                    key={virtualRow.key}
                    className="absolute left-0 top-0 w-full px-0"
                    style={{ transform: `translateY(${virtualRow.start}px)` }}
                  >
                    <ContextMenu>
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
                              "group w-full flex items-center gap-2 px-2 py-1 rounded-md text-left transition-colors duration-100",
                              isActive
                                ? "bg-accent text-accent-foreground"
                                : "hover:bg-muted/50 text-foreground/80 hover:text-foreground"
                            )}
                          >
                            <Icon
                              name="table"
                              className={cn(
                                "size-3 shrink-0 transition-colors",
                                isActive
                                  ? "text-accent-foreground"
                                  : "text-muted-foreground group-hover:text-foreground/70"
                              )}
                            />
                            <span className="flex-1 truncate text-[12px] font-medium leading-tight">
                              {table.name}
                            </span>
                            {aiMatchedNames.has(table.name) && (
                              <span className="size-1.5 shrink-0 rounded-full bg-primary/40" />
                            )}
                            <DropdownMenu>
                              <DropdownMenuTrigger
                                render={
                                  <button
                                    type="button"
                                    aria-label="Table actions"
                                    onClick={(event) => event.stopPropagation()}
                                    className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground/60 opacity-0 transition hover:bg-muted hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
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
