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
import { cn } from "@/utils/tailwind";
import type { SchemaTableSummary } from "@/ipc/db/types";

/** Format large row counts compactly (e.g. 1.2K, 3.4M, ~0). */
function formatRowCount(count: number): string {
  if (count < 1_000) return String(count);
  if (count < 1_000_000) return `${(count / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  if (count < 1_000_000_000) return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  return `${(count / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
}

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
}: TablesExplorerSidebarProps) {
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
                return (
                  <ContextMenu key={`${table.schema}.${table.name}`}>
                    <ContextMenuTrigger
                      render={
                        <button
                          type="button"
                          draggable
                          onDragStart={(e) => {
                            const ref = `${table.schema}.${table.name}`;
                            e.dataTransfer.setData("text/sql-table-ref", ref);
                            e.dataTransfer.effectAllowed = "copy";
                          }}
                          onClick={() =>
                            onTableSelect(`${table.schema}.${table.name}`)
                          }
                          onMouseEnter={() =>
                            onPrefetchTable(table.schema, table.name)
                          }
                          onFocus={() =>
                            onPrefetchTable(table.schema, table.name)
                          }
                          className={cn(
                            "group w-full flex items-center gap-2.5 px-2.5 py-[7px] rounded-md text-left transition-colors duration-100",
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
                          {table.estimated_row_count > 0 && (
                            <Badge variant="secondary" className="font-mono text-[9px] h-3.5 px-1 leading-none shrink-0 tabular-nums text-muted-foreground">
                              {formatRowCount(table.estimated_row_count)}
                            </Badge>
                          )}
                          {table.has_rls ? (
                            <Tooltip>
                              <TooltipTrigger className="inline-flex shrink-0">
                                <Icon name="lock" className="size-3 text-cyan-500 shrink-0" />
                              </TooltipTrigger>
                              <TooltipContent side="bottom" sideOffset={4}>RLS enabled</TooltipContent>
                            </Tooltip>
                          ) : (
                            <Tooltip>
                              <TooltipTrigger className="inline-flex shrink-0">
                                <Icon name="lock-open" className="size-3 text-muted-foreground/40 shrink-0" />
                              </TooltipTrigger>
                              <TooltipContent side="bottom" sideOffset={4}>RLS disabled</TooltipContent>
                            </Tooltip>
                          )}
                        </button>
                      }
                    />
                    <ContextMenuContent>
                      <ContextMenuItem
                        onClick={() =>
                          onViewDdl({
                            schema: table.schema,
                            name: table.name,
                          })
                        }
                      >
                        <Icon name="script" className="size-3.5" />
                        View DDL
                      </ContextMenuItem>
                      <ContextMenuItem
                        onClick={() =>
                          onExportSchema({
                            schema: table.schema,
                            name: table.name,
                          })
                        }
                      >
                        <Icon name="file-code-2" className="size-3.5" />
                        Export Schema
                      </ContextMenuItem>
                      <ContextMenuItem
                        onClick={() =>
                          onRenameTable({
                            schema: table.schema,
                            name: table.name,
                          })
                        }
                      >
                        <Icon name="pencil" className="size-3.5" />
                        Rename table
                      </ContextMenuItem>
                      {table.has_rls && (
                        <ContextMenuItem
                          onClick={() =>
                            onViewRlsPolicies({
                              schema: table.schema,
                              name: table.name,
                            })
                          }
                        >
                          <Icon name="lock" className="size-3.5" />
                          View RLS policies
                        </ContextMenuItem>
                      )}
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        variant="destructive"
                        onClick={() =>
                          onDropTable({
                            schema: table.schema,
                            name: table.name,
                          })
                        }
                      >
                        <Icon name="trash" className="size-3.5" />
                        Drop table
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                );
              })}
            </div>
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}
