import type { Edge, Node, NodeProps } from "@xyflow/react";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  type EdgeProps,
  getSmoothStepPath,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import "@/styles/xyflow.css";
import dagre from "@dagrejs/dagre";
import { Panel, useReactFlow } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon as UiIcon } from "@/components/ui/Icon";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SchemaColumn, SchemaTableDetails } from "@/ipc/db/types";
import { cn } from "@/lib/utils";

interface SchemaVisualizerProps {
  currentSchema: string;
  isLoading?: boolean;
  onNavigateToTables?: () => void;
  onSchemaChange: (schema: string) => void;
  onTableClick?: (schema: string, table: string) => void;
  schemas: string[];
  tables: SchemaTableDetails[];
}

interface TableFilter {
  showIsolated: boolean;
  showWithFk: boolean;
  showWithPk: boolean;
}

interface ColumnData extends SchemaColumn {
  foreign?: {
    name: string;
    schema: string;
    table: string;
    column: string;
  };
  id: string;
  isEdgeTarget?: boolean;
  primaryKey?: string;
  searchMatched?: boolean;
  unique?: string;
}

interface TableNodeData extends Record<string, unknown> {
  columns: ColumnData[];
  edges: Edge[];
  onTableClick?: (schema: string, table: string) => void;
  schema: string;
  searchActive?: boolean;
  table: string;
  tableSearchMatched?: boolean;
}

type TableNodeType = Node<TableNodeData, "tableNode">;

type LayoutDirection = "LR" | "TB";

// Legend panel with improved visual hierarchy
function Legend() {
  const [isOpen, setIsOpen] = useState(false);

  const items = [
    {
      bg: "bg-amber-500/10",
      color: "text-amber-500",
      label: "Primary Key",
      name: "key" as const,
      shortLabel: "PK",
    },
    {
      bg: "bg-slate-400/10",
      color: "text-slate-400",
      label: "Nullable",
      name: "x" as const,
      shortLabel: "Null",
    },
    {
      bg: "bg-emerald-500/10",
      color: "text-emerald-500",
      label: "Unique",
      name: "fingerprint" as const,
      shortLabel: "UQ",
    },
    {
      bg: "bg-blue-500/10",
      color: "text-blue-500",
      label: "Default",
      name: "book" as const,
      shortLabel: "Def",
    },
    {
      bg: "bg-violet-500/10",
      color: "text-violet-500",
      label: "Foreign Key",
      name: "link" as const,
      shortLabel: "FK",
    },
  ];

  return (
    <Panel className="m-3!" position="bottom-right">
      <div className="flex flex-col items-end gap-1.5">
        <button
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-xl border shadow-sm transition-colors duration-150 ease-out active:scale-[0.97]",
            isOpen
              ? "border-border bg-card/95 text-foreground"
              : "border-transparent bg-card/80 text-muted-foreground/50 backdrop-blur-md hover:border-border/60 hover:text-foreground"
          )}
          onClick={() => setIsOpen(!isOpen)}
          title="Toggle Legend"
        >
          <UiIcon className="h-3.5 w-3.5" name="layers" />
        </button>
        {isOpen && (
          <div className="min-w-[150px] rounded-xl border bg-card/95 p-3 shadow-xl backdrop-blur-xl">
            <div className="mb-2.5 px-0.5 font-semibold text-[10px] text-muted-foreground uppercase tracking-wider">
              Legend
            </div>
            <div className="grid grid-cols-1 gap-2">
              {items.map((item) => (
                <div className="flex items-center gap-2.5" key={item.label}>
                  <div
                    className={cn(
                      "flex h-6 w-6 items-center justify-center rounded-lg",
                      item.bg
                    )}
                  >
                    <UiIcon
                      className={cn("h-3 w-3", item.color)}
                      name={item.name}
                    />
                  </div>
                  <div className="flex flex-col">
                    <span className="font-medium text-[11px] text-foreground">
                      {item.label}
                    </span>
                    <span className="text-[9px] text-muted-foreground/60">
                      {item.shortLabel}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

// Floating filter panel with improved visual design
function TableFilters({
  filter,
  onChange,
  totalCount,
}: {
  filter: TableFilter;
  onChange: (f: TableFilter) => void;
  totalCount: number;
}) {
  const filters = [
    {
      activeBg: "bg-primary/10",
      activeColor: "text-primary",
      desc: "Tables without relations",
      key: "showIsolated" as const,
      label: "Isolated",
    },
    {
      activeBg: "bg-violet-500/10",
      activeColor: "text-violet-500",
      desc: "Tables with foreign keys",
      key: "showWithFk" as const,
      label: "FK",
    },
    {
      activeBg: "bg-amber-500/10",
      activeColor: "text-amber-500",
      desc: "Tables with primary keys",
      key: "showWithPk" as const,
      label: "PK",
    },
  ];

  return (
    <Panel className="m-3!" position="bottom-left">
      <div className="min-w-[180px] rounded-xl border bg-card/95 p-3 shadow-xl backdrop-blur-xl">
        <div className="mb-2.5 flex items-center justify-between">
          <span className="font-semibold text-[10px] text-muted-foreground uppercase tracking-wider">
            Filters
          </span>
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-muted/80 px-1.5 font-semibold text-[10px] text-muted-foreground tabular-nums">
            {totalCount}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {filters.map((item) => {
            const active = filter[item.key];
            return (
              <button
                className={cn(
                  "flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-medium text-[10px] transition-colors duration-150 ease-out active:scale-[0.97]",
                  active
                    ? cn(item.activeColor, item.activeBg, "border-transparent")
                    : "border-border/40 bg-transparent text-muted-foreground/50 hover:border-border hover:text-muted-foreground"
                )}
                key={item.key}
                onClick={() => onChange({ ...filter, [item.key]: !active })}
                title={item.desc}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full transition-colors",
                    active ? "bg-current" : "bg-muted-foreground/30"
                  )}
                />
                {item.label}
              </button>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}

// Skeleton para carregamento
function TableNodeSkeleton() {
  return (
    <div className="w-60 animate-pulse rounded-xl border border-border bg-card font-mono shadow-lg">
      <div className="flex items-center gap-2 rounded-t-xl border-border border-b bg-muted/50 px-3 py-2.5">
        <div className="h-4 w-4 rounded bg-muted" />
        <div className="h-4 w-32 rounded bg-muted" />
      </div>
      <div className="space-y-1.5 p-2">
        {[1, 2, 3, 4].map((i) => (
          <div className="flex items-center justify-between px-2 py-1" key={i}>
            <div className="h-3 w-20 rounded bg-muted" />
            <div className="h-3 w-12 rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}

// Empty state melhorado
function EmptyState({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-background">
      <div className="rounded-2xl bg-muted/50 p-6">
        <UiIcon className="h-12 w-12 text-muted-foreground" name="zap" />
      </div>
      <div className="text-center">
        <p className="font-medium text-foreground text-sm">
          No tables to visualize
        </p>
        <p className="mt-1 text-muted-foreground text-xs">
          Select a schema with tables to see the diagram
        </p>
      </div>
      {onNavigate && (
        <Button
          className="gap-2"
          onClick={onNavigate}
          size="sm"
          variant="outline"
        >
          <UiIcon className="h-4 w-4" name="layout-grid" />
          Go to Tables
        </Button>
      )}
    </div>
  );
}

// Skeleton loading state
function SkeletonFlow() {
  return (
    <div className="relative h-full w-full bg-background">
      <div className="absolute inset-0 flex flex-wrap content-start justify-start gap-8 overflow-hidden p-8">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div
            className="opacity-50"
            key={i}
            style={{ transform: `translate(${i * 20}px, ${i * 10}px)` }}
          >
            <TableNodeSkeleton />
          </div>
        ))}
      </div>
      <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 text-muted-foreground text-sm">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
        <span>Loading schema...</span>
      </div>
    </div>
  );
}

function TableNode({ data }: NodeProps<TableNodeType>) {
  return (
    <div
      className={cn(
        "w-50 rounded-md border border-border/50 bg-card font-mono transition-opacity",
        data.searchActive &&
          data.tableSearchMatched &&
          "ring-1 ring-primary/60",
        data.searchActive &&
          !data.tableSearchMatched &&
          !data.columns.some((c) => c.searchMatched) &&
          "opacity-25"
      )}
    >
      <div className="flex items-center gap-1.5 border-border/40 border-b px-2.5 py-1.5">
        <UiIcon
          className="h-3 w-3 shrink-0 text-muted-foreground/40"
          name="table"
        />
        <span
          className={cn(
            "block truncate font-medium text-[11px] text-foreground/80",
            data.searchActive && data.tableSearchMatched && "text-primary"
          )}
        >
          {data.table}
        </span>
        {data.onTableClick && (
          <button
            className="ml-auto flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground/30 transition-colors hover:text-primary"
            onClick={() => data.onTableClick?.(data.schema, data.table)}
            type="button"
          >
            <UiIcon className="h-2.5 w-2.5" name="arrow-right" />
          </button>
        )}
      </div>
      <div className="py-1 text-xs">
        {data.columns.map((column) => (
          <div
            className={cn(
              "transition-opacity",
              data.searchActive && column.searchMatched && "bg-primary/8",
              data.searchActive &&
                data.columns.some((c) => c.searchMatched) &&
                !column.searchMatched &&
                "opacity-30"
            )}
            key={column.name}
          >
            <div className="flex items-center justify-between gap-1 px-2.5 py-0.75 text-[10px] leading-tight">
              <div className="flex min-w-0 items-center gap-1">
                {column.primaryKey && (
                  <span className="h-1 w-1 shrink-0 rounded-full bg-amber-500" />
                )}
                {column.unique && !column.primaryKey && (
                  <span className="h-1 w-1 shrink-0 rounded-full bg-emerald-500" />
                )}
                {column.foreign && (
                  <span className="h-1 w-1 shrink-0 rounded-full bg-violet-500" />
                )}
                {!(column.primaryKey || column.unique || column.foreign) && (
                  <span className="h-1 w-1 shrink-0 rounded-full bg-transparent" />
                )}
                <span className="truncate text-foreground/70">
                  {column.name}
                </span>
              </div>
              <span className="max-w-[40%] truncate text-[9px] text-muted-foreground/35">
                {column.data_type}
              </span>
            </div>
            {column.foreign && (
              <Handle
                className="h-1.5! w-1.5! rounded-full! border-none! bg-muted-foreground/30!"
                id={column.id}
                isConnectable={false}
                position={Position.Right}
                type="source"
              />
            )}
            {(column.primaryKey || column.isEdgeTarget) && (
              <Handle
                className="h-1.5! w-1.5! rounded-full! border-none! bg-muted-foreground/30!"
                id={column.id}
                isConnectable={false}
                position={Position.Left}
                type="target"
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function CustomEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
}: EdgeProps) {
  const [edgePath] = getSmoothStepPath({
    borderRadius: 12,
    sourcePosition: sourcePosition || Position.Bottom,
    sourceX,
    sourceY,
    targetPosition: targetPosition || Position.Top,
    targetX,
    targetY,
  });

  const animatedStyle = {
    ...style,
    animation: "dash 1s linear infinite",
    opacity: 0.2,
    stroke: "var(--muted-foreground)",
    strokeDasharray: "4,4",
    strokeWidth: 1,
  };

  return (
    <>
      <defs>
        <style>
          {`
            @keyframes dash {
              to {
                stroke-dashoffset: -8;
              }
            }
          `}
        </style>
      </defs>
      <BaseEdge markerEnd={markerEnd} path={edgePath} style={animatedStyle} />
    </>
  );
}

const edgeTypes = {
  custom: CustomEdge,
};

const nodeTypes = {
  tableNode: TableNode,
};

function getNodeSize(columns: ColumnData[]): { width: number; height: number } {
  const rowHeight = 18;
  const headerHeight = 28;
  const padding = 8;
  const width = 200;
  const height = headerHeight + columns.length * rowHeight + padding;
  return { height, width };
}

function getLayoutElements(
  nodes: TableNodeType[],
  edges: Edge[],
  direction: LayoutDirection = "LR"
): { nodes: Node[]; edges: Edge[] } {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  const isHorizontal = direction === "LR";
  dagreGraph.setGraph({ nodesep: 40, rankdir: direction, ranksep: 80 });

  nodes.forEach((node) => {
    const { width, height } = getNodeSize(node.data.columns);
    dagreGraph.setNode(node.id, { height, width });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const newNodes: Node[] = nodes.map((node) => {
    const { width, height } = getNodeSize(node.data.columns);
    const nodeWithPosition = dagreGraph.node(node.id);
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - width / 2,
        y: nodeWithPosition.y - height / 2,
      },
      sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
      targetPosition: isHorizontal ? Position.Left : Position.Top,
    };
  });

  return { edges, nodes: newNodes as Node[] };
}

function getEdgesFromForeignKeys(
  tables: SchemaTableDetails[],
  schema: string
): Edge[] {
  const edges: Edge[] = [];
  const seen = new Set<string>();

  for (const table of tables) {
    if (table.schema !== schema) {
      continue;
    }

    for (const fk of table.foreign_keys) {
      const targetSchema = fk.referenced_schema || table.schema;
      if (targetSchema !== schema) {
        continue;
      }

      const edgeId = `${table.name}_${fk.column_name}_${fk.referenced_table}_${fk.referenced_column}`;
      if (seen.has(edgeId)) {
        continue;
      }
      seen.add(edgeId);

      edges.push({
        data: { isFk: true },
        id: edgeId,
        source: table.name,
        sourceHandle: fk.column_name,
        target: fk.referenced_table,
        targetHandle: fk.referenced_column,
        type: "custom",
      });
    }
  }

  return edges;
}

function getNodesFromTables(
  tables: SchemaTableDetails[],
  schema: string,
  edges: Edge[],
  onTableClick?: (schema: string, table: string) => void
): TableNodeType[] {
  return tables
    .filter((t) => t.schema === schema)
    .map((table) => {
      const tableForeignKeys = table.foreign_keys.filter(
        (fk) => (fk.referenced_schema || table.schema) === schema
      );
      const incomingTargetColumns = new Set(
        edges
          .filter(
            (e) => e.target === table.name && typeof e.targetHandle === "string"
          )
          .map((e) => e.targetHandle as string)
      );

      const columns: ColumnData[] = table.columns.map((col) => {
        const fk = tableForeignKeys.find((f) => f.column_name === col.name);
        const pk = table.indexes
          .find((i) => i.is_primary)
          ?.column_names.includes(col.name);
        const unique = table.indexes
          .find((i) => i.is_unique && !i.is_primary)
          ?.column_names.includes(col.name);

        return {
          ...col,
          foreign: fk
            ? {
                column: fk.referenced_column,
                name: fk.name,
                schema: fk.referenced_schema || table.schema,
                table: fk.referenced_table,
              }
            : undefined,
          id: col.name,
          isEdgeTarget: incomingTargetColumns.has(col.name),
          primaryKey: pk
            ? table.indexes.find((i) => i.is_primary)?.name
            : undefined,
          unique: unique
            ? table.indexes.find((i) => i.is_unique && !i.is_primary)?.name
            : undefined,
        };
      });

      return {
        data: {
          columns,
          edges,
          onTableClick,
          schema,
          table: table.name,
        },
        id: table.name,
        position: { x: 0, y: 0 },
        type: "tableNode",
      };
    });
}

function applySearchHighlight(
  nodes: Node[],
  searchQuery: string,
  tables: SchemaTableDetails[],
  schema: string
): Node[] {
  const needle = searchQuery.toLowerCase().trim();
  const nodeData = (n: Node) => n.data as TableNodeData;

  if (!needle) {
    return nodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        columns: nodeData(node).columns.map((col: ColumnData) => ({
          ...col,
          searchMatched: false,
        })),
        searchActive: false,
        tableSearchMatched: false,
      },
    }));
  }

  const matchedTables = tables
    .filter((t) => t.schema === schema && t.name.toLowerCase().includes(needle))
    .map((t) => t.name);
  const matchedTableSet = new Set(matchedTables);

  const matchedColumns = new Set<string>();
  for (const table of tables) {
    if (table.schema !== schema) {
      continue;
    }
    for (const col of table.columns) {
      if (col.name.toLowerCase().includes(needle)) {
        matchedColumns.add(col.name);
      }
    }
  }

  return nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      columns: nodeData(node).columns.map((col: ColumnData) => ({
        ...col,
        searchMatched: matchedColumns.has(col.name),
      })),
      searchActive: true,
      tableSearchMatched: matchedTableSet.has(nodeData(node).table),
    },
  }));
}

function VisualizerFlow({
  tables,
  schema,
  onTableClick,
  searchQuery,
  direction,
  filter,
  onFilterChange,
}: {
  tables: SchemaTableDetails[];
  schema: string;
  onTableClick?: (schema: string, table: string) => void;
  searchQuery: string;
  direction: LayoutDirection;
  filter: TableFilter;
  onFilterChange: (f: TableFilter) => void;
}) {
  const { fitView } = useReactFlow();
  const prevDirectionRef = useRef(direction);

  const filteredTables = useMemo(
    () =>
      tables.filter((t) => {
        if (t.schema !== schema) {
          return false;
        }
        const hasFk = t.foreign_keys.length > 0;
        const hasPk = t.indexes.some((i) => i.is_primary);
        const isIsolated = !(hasFk || hasPk);

        if (!filter.showIsolated && isIsolated) {
          return false;
        }
        if (!filter.showWithFk && hasFk) {
          return false;
        }
        if (!filter.showWithPk && hasPk) {
          return false;
        }
        return true;
      }),
    [tables, schema, filter]
  );

  const edges = useMemo(
    () => getEdgesFromForeignKeys(filteredTables, schema),
    [filteredTables, schema]
  );

  const initialNodes = useMemo(
    () => getNodesFromTables(filteredTables, schema, edges, onTableClick),
    [filteredTables, schema, edges, onTableClick]
  );

  const { nodes: layoutNodes, edges: layoutEdges } = useMemo(
    () => getLayoutElements(initialNodes, edges, direction),
    [initialNodes, edges, direction]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutNodes);
  const [reactEdges, setEdges, onEdgesChange] = useEdgesState(layoutEdges);

  // Refit view when direction changes
  useEffect(() => {
    if (prevDirectionRef.current !== direction) {
      prevDirectionRef.current = direction;
      setTimeout(() => {
        fitView({ duration: 500, padding: 0.2 });
      }, 50);
    }
  }, [direction, fitView]);

  useEffect(() => {
    setNodes(
      applySearchHighlight(layoutNodes, searchQuery, filteredTables, schema)
    );
  }, [searchQuery, layoutNodes, filteredTables, schema, setNodes]);

  useEffect(() => {
    setEdges(layoutEdges);
  }, [layoutEdges, setEdges]);

  return (
    <ReactFlow
      attributionPosition="bottom-left"
      defaultEdgeOptions={{ type: "custom" }}
      edges={reactEdges}
      edgeTypes={edgeTypes}
      fitView
      fitViewOptions={{ duration: 500, padding: 0.2 }}
      maxZoom={4}
      minZoom={0.2}
      nodes={nodes}
      nodeTypes={nodeTypes}
      onEdgesChange={onEdgesChange}
      onNodesChange={onNodesChange}
      panOnScroll
      selectionOnDrag
      style={{
        ["--xy-background-pattern-dots-color-default" as string]:
          "var(--border)",
        ["--xy-edge-stroke-width-default" as string]: 1.5,
        ["--xy-edge-stroke-default" as string]: "var(--foreground)",
        ["--xy-edge-stroke-selected-default" as string]: "var(--foreground)",
        ["--xy-attribution-background-color-default" as string]: "transparent",
      }}
    >
      <Background
        bgColor="var(--background)"
        gap={16}
        size={1.5}
        variant={BackgroundVariant.Dots}
      />
      <MiniMap
        bgColor="transparent"
        className="rounded border border-border/30 opacity-60 transition-opacity hover:opacity-100"
        maskColor="var(--muted)"
        nodeColor="var(--muted-foreground)"
        pannable
        style={{ height: 60, width: 100 }}
        zoomable
      />
      <Legend />
      <TableFilters
        filter={filter}
        onChange={onFilterChange}
        totalCount={tables.length}
      />
    </ReactFlow>
  );
}

export function SchemaVisualizer({
  tables,
  schemas,
  currentSchema,
  onSchemaChange,
  onTableClick,
  isLoading,
  onNavigateToTables,
}: SchemaVisualizerProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [direction, setDirection] = useState<LayoutDirection>("LR");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [filter, setFilter] = useState<TableFilter>({
    showIsolated: true,
    showWithFk: true,
    showWithPk: true,
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const schemaTableCount = useMemo(
    () => tables.filter((t) => t.schema === currentSchema).length,
    [tables, currentSchema]
  );

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
      setIsFullscreen(false);
    } else {
      containerRef.current?.requestFullscreen();
      setIsFullscreen(true);
    }
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  if (isLoading) {
    return <SkeletonFlow />;
  }

  if (schemaTableCount === 0) {
    return <EmptyState onNavigate={onNavigateToTables} />;
  }

  return (
    <div
      className="relative flex h-full w-full flex-col overflow-hidden bg-background"
      ref={containerRef}
    >
      {/* Floating control bar */}
      <div className="absolute top-4 left-1/2 z-20 w-auto max-w-[90%] -translate-x-1/2">
        <div className="flex items-center gap-1.5 rounded-2xl border bg-card/95 px-2 py-1.5 shadow-xl backdrop-blur-xl">
          {/* Schema selector */}
          <div className="flex items-center gap-2 pr-2 pl-1">
            <div className="flex h-7 items-center gap-1.5 rounded-lg bg-muted/60 px-2.5">
              <UiIcon
                className="h-3 w-3 text-muted-foreground/50"
                name="database"
              />
              <Select
                onValueChange={(value) => value && onSchemaChange(value)}
                value={currentSchema}
              >
                <SelectTrigger className="h-6 w-28 border-0 bg-transparent p-0 font-medium text-foreground text-xs shadow-none focus:ring-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {schemas.map((s) => (
                    <SelectItem className="text-xs" key={s} value={s}>
                      <div className="flex w-full items-center justify-between gap-3">
                        <span>{s}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {tables.filter((t) => t.schema === s).length}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-muted/80 px-1.5 font-semibold text-[10px] text-muted-foreground tabular-nums">
              {schemaTableCount}
            </span>
          </div>

          <div className="h-4 w-px bg-border/60" />

          {/* Search */}
          <div className="flex items-center px-2">
            <UiIcon
              className="h-3 w-3 shrink-0 text-muted-foreground/40"
              name="search"
            />
            <Input
              className="h-7 w-40 border-0 bg-transparent p-0 pl-1.5 text-foreground text-xs placeholder:text-muted-foreground/40 focus-visible:ring-0"
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search tables & columns..."
              ref={searchRef}
              value={searchQuery}
            />
            {searchQuery && (
              <button
                className="ml-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-muted"
                onClick={() => setSearchQuery("")}
                type="button"
              >
                <UiIcon
                  className="h-2.5 w-2.5 text-muted-foreground/50"
                  name="x"
                />
              </button>
            )}
          </div>

          <div className="h-4 w-px bg-border/60" />

          {/* View controls */}
          <div className="flex items-center gap-0.5 pr-0.5">
            <button
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground/50 transition-all hover:bg-muted hover:text-foreground"
              onClick={() => setDirection(direction === "LR" ? "TB" : "LR")}
              title={
                direction === "LR"
                  ? "Switch to Vertical Layout"
                  : "Switch to Horizontal Layout"
              }
            >
              {direction === "LR" ? (
                <UiIcon className="h-3.5 w-3.5" name="arrows-up-down" />
              ) : (
                <UiIcon className="h-3.5 w-3.5" name="arrows-left-right" />
              )}
            </button>
            <button
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground/50 transition-all hover:bg-muted hover:text-foreground"
              onClick={toggleFullscreen}
              title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
            >
              {isFullscreen ? (
                <UiIcon className="h-3.5 w-3.5" name="minimize" />
              ) : (
                <UiIcon className="h-3.5 w-3.5" name="maximize" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Flow Container - ocupa espaço completo */}
      <div className="relative flex-1">
        <ReactFlowProvider key={currentSchema}>
          <VisualizerFlow
            direction={direction}
            filter={filter}
            onFilterChange={setFilter}
            onTableClick={onTableClick}
            schema={currentSchema}
            searchQuery={searchQuery}
            tables={tables}
          />
        </ReactFlowProvider>
      </div>
    </div>
  );
}
