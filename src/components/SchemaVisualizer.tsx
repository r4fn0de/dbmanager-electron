import type { Edge, Node, NodeProps } from "@xyflow/react";
import {
  Background,
  BackgroundVariant,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  BaseEdge,
  getSmoothStepPath,
  type EdgeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useReactFlow, Panel, ControlButton } from "@xyflow/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Icon as UiIcon } from "@/components/ui/Icon";
import type { SchemaTableDetails, SchemaForeignKey, SchemaIndex, SchemaColumn } from "@/ipc/db/types";

interface SchemaVisualizerProps {
  tables: SchemaTableDetails[];
  schemas: string[];
  currentSchema: string;
  onSchemaChange: (schema: string) => void;
  onTableClick?: (schema: string, table: string) => void;
  isLoading?: boolean;
  onNavigateToTables?: () => void;
}

interface TableFilter {
  showIsolated: boolean;
  showWithFk: boolean;
  showWithPk: boolean;
}

interface ColumnData extends SchemaColumn {
  id: string;
  primaryKey?: string;
  unique?: string;
  isEdgeTarget?: boolean;
  foreign?: {
    name: string;
    schema: string;
    table: string;
    column: string;
  };
  searchMatched?: boolean;
}

interface TableNodeData extends Record<string, unknown> {
  schema: string;
  table: string;
  columns: ColumnData[];
  searchActive?: boolean;
  tableSearchMatched?: boolean;
  edges: Edge[];
  onTableClick?: (schema: string, table: string) => void;
}

type TableNodeType = Node<TableNodeData, "tableNode">;

type LayoutDirection = "LR" | "TB";

// Toolbar clean e unificado - renderizado dentro do ReactFlow para ter acesso ao contexto
function FlowToolbarInner() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();

  const handleZoomOut = useCallback(() => {
    zoomOut({ duration: 200 });
  }, [zoomOut]);

  const handleFitView = useCallback(() => {
    fitView({ duration: 300, padding: 0.2 });
  }, [fitView]);

  const handleZoomIn = useCallback(() => {
    zoomIn({ duration: 200 });
  }, [zoomIn]);

  return (
    <Panel position="top-left" className="m-3! z-50">
      <div className="flex items-center gap-0.5 rounded-lg bg-card border p-1">
        <button
          onClick={handleZoomOut}
          title="Zoom Out"
          className="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <UiIcon name="zoom-out" className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={handleFitView}
          title="Fit View"
          className="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <UiIcon name="maximize" className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={handleZoomIn}
          title="Zoom In"
          className="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <UiIcon name="zoom-in" className="h-3.5 w-3.5" />
        </button>
      </div>
    </Panel>
  );
}

// Legenda minimal flutuante
function Legend() {
  const [isOpen, setIsOpen] = useState(false);

  const items = [
    { icon: (props: { className?: string }) => <UiIcon name="key" {...props} />, label: "PK", color: "text-amber-500" },
    { icon: (props: { className?: string }) => <UiIcon name="x" {...props} />, label: "Null", color: "text-slate-400" },
    { icon: (props: { className?: string }) => <UiIcon name="fingerprint" {...props} />, label: "UQ", color: "text-emerald-500" },
    { icon: (props: { className?: string }) => <UiIcon name="book" {...props} />, label: "Def", color: "text-blue-500" },
    { icon: (props: { className?: string }) => <UiIcon name="link" {...props} />, label: "FK", color: "text-violet-500" },
  ];

  return (
    <Panel position="bottom-right" className="m-3!">
      <div className="flex flex-col items-end gap-1">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex h-8 w-8 items-center justify-center rounded-md bg-card border transition-colors hover:bg-muted"
          title="Legend"
        >
          <UiIcon name="layers" className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
        {isOpen && (
          <div className="rounded-lg bg-card border p-2">
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              {items.map((item) => (
                <div key={item.label} className="flex items-center gap-1.5 text-[10px]">
                  <item.icon className={`h-3 w-3 ${item.color}`} />
                  <span className="text-muted-foreground">{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

// Filtros como chips flutuantes
function TableFilters({
  filter,
  onChange,
  totalCount,
}: {
  filter: TableFilter;
  onChange: (f: TableFilter) => void;
  totalCount: number;
}) {
  return (
    <Panel position="bottom-left" className="m-3!">
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-card border p-1.5">
        <button
          onClick={() => onChange({ ...filter, showIsolated: !filter.showIsolated })}
          className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-medium transition-all ${
            filter.showIsolated
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground hover:bg-muted/50"
          }`}
          title="Isolated (no relations)"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
          Isolated
        </button>
        <button
          onClick={() => onChange({ ...filter, showWithFk: !filter.showWithFk })}
          className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-medium transition-all ${
            filter.showWithFk
              ? "bg-violet-500/15 text-violet-600"
              : "text-muted-foreground hover:bg-muted/50"
          }`}
          title="With Foreign Keys"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-violet-500" />
          FK
        </button>
        <button
          onClick={() => onChange({ ...filter, showWithPk: !filter.showWithPk })}
          className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-medium transition-all ${
            filter.showWithPk
              ? "bg-amber-500/15 text-amber-600"
              : "text-muted-foreground hover:bg-muted/50"
          }`}
          title="With Primary Keys"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          PK
        </button>
        <div className="mx-1 h-4 w-px bg-border/50" />
        <span className="px-1 text-[10px] text-muted-foreground">
          {totalCount} tables
        </span>
      </div>
    </Panel>
  );
}

// Skeleton para carregamento
function TableNodeSkeleton() {
  return (
    <div className="w-[240px] rounded-xl bg-card font-mono shadow-lg border border-border animate-pulse">
      <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-3 py-2.5 rounded-t-xl">
        <div className="h-4 w-4 rounded bg-muted" />
        <div className="h-4 w-32 rounded bg-muted" />
      </div>
      <div className="p-2 space-y-1.5">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center justify-between px-2 py-1">
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
        <UiIcon name="zap" className="h-12 w-12 text-muted-foreground" />
      </div>
      <div className="text-center">
        <p className="text-sm font-medium text-foreground">No tables to visualize</p>
        <p className="text-xs text-muted-foreground mt-1">
          Select a schema with tables to see the diagram
        </p>
      </div>
      {onNavigate && (
        <Button variant="outline" size="sm" onClick={onNavigate} className="gap-2">
          <UiIcon name="layout-grid" className="h-4 w-4" />
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
      <div className="absolute inset-0 flex flex-wrap content-start justify-start gap-8 p-8 overflow-hidden">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="opacity-50" style={{ transform: `translate(${i * 20}px, ${i * 10}px)` }}>
            <TableNodeSkeleton />
          </div>
        ))}
      </div>
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 text-sm text-muted-foreground">
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
        "w-[220px] rounded-lg bg-card font-mono shadow-md border border-border transition-all hover:shadow-lg",
        data.searchActive && data.tableSearchMatched && "ring-2 ring-primary shadow-lg",
        data.searchActive &&
          !data.tableSearchMatched &&
          !data.columns.some((c) => c.searchMatched) &&
          "opacity-30"
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/50 px-2.5 py-1.5 rounded-t-lg">
        <div className="flex min-w-0 items-center gap-1.5 text-xs">
          <UiIcon name="table" className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span
            className={cn(
              "block truncate font-medium",
              data.searchActive && data.tableSearchMatched && "text-primary"
            )}
          >
            {data.table}
          </span>
        </div>
        {data.onTableClick && (
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100 hover:opacity-100 -mr-1"
            onClick={() => data.onTableClick?.(data.schema, data.table)}
          >
            <UiIcon name="external-link" className="h-3 w-3" />
          </Button>
        )}
      </div>
      <div className="p-1.5 text-xs">
        {data.columns.map((column) => (
          <div
            key={column.name}
            className={cn(
              "group relative px-3 transition-all",
              data.searchActive &&
                column.searchMatched &&
                "bg-primary/10 text-primary rounded-sm mx-1",
              data.searchActive &&
                data.columns.some((c) => c.searchMatched) &&
                !column.searchMatched &&
                "opacity-40"
            )}
          >
            <div
              key={column.id}
              className={cn(
                "group flex items-center justify-between gap-1.5 rounded px-1.5 py-0.5 transition-colors text-[11px] leading-tight",
                column.searchMatched && "bg-primary/10",
                !column.searchMatched && "hover:bg-muted/50"
              )}
            >
              <div className="flex min-w-0 items-center gap-1">
                {column.primaryKey && (
                  <UiIcon name="key" className="h-3 w-3 shrink-0 text-amber-500" />
                )}
                {column.unique && !column.primaryKey && (
                  <UiIcon name="fingerprint" className="h-3 w-3 shrink-0 text-emerald-500" />
                )}
                {column.column_default && !column.primaryKey && !column.unique && (
                  <UiIcon name="book" className="h-3 w-3 shrink-0 text-blue-500" />
                )}
                {column.is_nullable && (
                  <UiIcon name="x" className="h-3 w-3 shrink-0 text-slate-400" />
                )}
                <span className="truncate font-medium">{column.name}</span>
              </div>
              <span className="max-w-[40%] truncate text-muted-foreground/60 text-[9px]">
                {column.data_type}
              </span>
              {/* Connection handles - always visible for FK/PK */}
              {column.foreign && (
                <Handle
                  type="source"
                  position={Position.Right}
                  id={column.id}
                  className="w-2! h-2! rounded-full! border-2! border-background! bg-foreground! opacity-100!"
                  isConnectable={false}
                />
              )}
              {(column.primaryKey || column.isEdgeTarget) && (
                <Handle
                  type="target"
                  position={Position.Left}
                  id={column.id}
                  className="w-2! h-2! rounded-full! border-2! border-background! bg-foreground! opacity-100!"
                  isConnectable={false}
                />
              )}
            </div>
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
    sourceX,
    sourceY,
    sourcePosition: sourcePosition || Position.Bottom,
    targetPosition: targetPosition || Position.Top,
    targetX,
    targetY,
    borderRadius: 15,
  });

  const animatedStyle = {
    ...style,
    strokeWidth: 1.2,
    stroke: "var(--foreground)",
    opacity: 0.28,
    strokeDasharray: "5,5",
    strokeDashoffset: "0",
    animation: "dash 1s linear infinite",
  };

  return (
    <>
      <defs>
        <style>
          {`
            @keyframes dash {
              to {
                stroke-dashoffset: -10;
              }
            }
          `}
        </style>
      </defs>
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={animatedStyle} />
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
  const rowHeight = 22;
  const headerHeight = 32;
  const padding = 12;
  const width = 220;
  const height = headerHeight + columns.length * rowHeight + padding;
  return { width, height };
}

function getLayoutElements(
  nodes: TableNodeType[],
  edges: Edge[],
  direction: LayoutDirection = "LR"
): { nodes: Node[]; edges: Edge[] } {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  const isHorizontal = direction === "LR";
  dagreGraph.setGraph({ rankdir: direction, ranksep: 80, nodesep: 40 });

  nodes.forEach((node) => {
    const { width, height } = getNodeSize(node.data.columns);
    dagreGraph.setNode(node.id, { width, height });
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
      targetPosition: isHorizontal ? Position.Left : Position.Top,
      sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
      position: {
        x: nodeWithPosition.x - width / 2,
        y: nodeWithPosition.y - height / 2,
      },
    };
  });

  return { nodes: newNodes as Node[], edges };
}

function getEdgesFromForeignKeys(
  tables: SchemaTableDetails[],
  schema: string
): Edge[] {
  const edges: Edge[] = [];
  const seen = new Set<string>();

  for (const table of tables) {
    if (table.schema !== schema) continue;

    for (const fk of table.foreign_keys) {
      const targetSchema = fk.referenced_schema || table.schema;
      if (targetSchema !== schema) continue;

      const edgeId = `${table.name}_${fk.column_name}_${fk.referenced_table}_${fk.referenced_column}`;
      if (seen.has(edgeId)) continue;
      seen.add(edgeId);

      edges.push({
        id: edgeId,
        type: "custom",
        source: table.name,
        target: fk.referenced_table,
        sourceHandle: fk.column_name,
        targetHandle: fk.referenced_column,
        data: { isFk: true },
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
          .filter((e) => e.target === table.name && typeof e.targetHandle === "string")
          .map((e) => e.targetHandle as string)
      );

      const columns: ColumnData[] = table.columns.map((col) => {
        const fk = tableForeignKeys.find((f) => f.column_name === col.name);
        const pk = table.indexes.find((i) => i.is_primary)?.column_names.includes(col.name);
        const unique = table.indexes.find(
          (i) => i.is_unique && !i.is_primary
        )?.column_names.includes(col.name);

        return {
          ...col,
          id: col.name,
          primaryKey: pk ? table.indexes.find((i) => i.is_primary)?.name : undefined,
          unique: unique
            ? table.indexes.find((i) => i.is_unique && !i.is_primary)?.name
            : undefined,
          isEdgeTarget: incomingTargetColumns.has(col.name),
          foreign: fk
            ? {
                name: fk.name,
                schema: fk.referenced_schema || table.schema,
                table: fk.referenced_table,
                column: fk.referenced_column,
              }
            : undefined,
        };
      });

      return {
        id: table.name,
        type: "tableNode",
        position: { x: 0, y: 0 },
        data: {
          schema,
          table: table.name,
          columns,
          edges,
          onTableClick,
        },
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
        searchActive: false,
        tableSearchMatched: false,
        columns: nodeData(node).columns.map((col: ColumnData) => ({
          ...col,
          searchMatched: false,
        })),
      },
    }));
  }

  const matchedTables = tables
    .filter(
      (t) =>
        t.schema === schema && t.name.toLowerCase().includes(needle)
    )
    .map((t) => t.name);

  const matchedColumns = new Set<string>();
  for (const table of tables) {
    if (table.schema !== schema) continue;
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
      searchActive: true,
      tableSearchMatched: matchedTables.includes(nodeData(node).table),
      columns: nodeData(node).columns.map((col: ColumnData) => ({
        ...col,
        searchMatched: matchedColumns.has(col.name),
      })),
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

  const filteredTables = useMemo(() => {
    return tables.filter((t) => {
      if (t.schema !== schema) return false;
      const hasFk = t.foreign_keys.length > 0;
      const hasPk = t.indexes.some((i) => i.is_primary);
      const isIsolated = !hasFk && !hasPk;

      if (!filter.showIsolated && isIsolated) return false;
      if (!filter.showWithFk && hasFk) return false;
      if (!filter.showWithPk && hasPk) return false;
      return true;
    });
  }, [tables, schema, filter]);

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
        fitView({ padding: 0.2, duration: 500 });
      }, 50);
    }
  }, [direction, fitView]);

  useEffect(() => {
    setNodes(applySearchHighlight(layoutNodes, searchQuery, filteredTables, schema));
  }, [searchQuery, layoutNodes, filteredTables, schema, setNodes]);

  useEffect(() => {
    setEdges(layoutEdges);
  }, [layoutEdges, setEdges]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={reactEdges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      fitView
      fitViewOptions={{ padding: 0.2, duration: 500 }}
      minZoom={0.2}
      maxZoom={4}
      panOnScroll
      selectionOnDrag
      defaultEdgeOptions={{ type: "custom" }}
      style={{
        ["--xy-background-pattern-dots-color-default" as string]: "var(--border)",
        ["--xy-edge-stroke-width-default" as string]: 1.5,
        ["--xy-edge-stroke-default" as string]: "var(--foreground)",
        ["--xy-edge-stroke-selected-default" as string]: "var(--foreground)",
        ["--xy-attribution-background-color-default" as string]: "transparent",
      }}
      attributionPosition="bottom-left"
    >
      <Background
        bgColor="var(--background)"
        variant={BackgroundVariant.Dots}
        gap={16}
        size={1.5}
      />
      <MiniMap
        pannable
        zoomable
        bgColor="var(--background)"
        nodeColor="var(--muted)"
        maskColor="var(--muted)"
        className="border border-border rounded-lg shadow-lg"
        style={{ width: 120, height: 80 }}
      />
      <FlowToolbarInner />
      <Legend />
      <TableFilters filter={filter} onChange={onFilterChange} totalCount={tables.length} />
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

  const schemaTableCount = useMemo(() => {
    return tables.filter((t) => t.schema === currentSchema).length;
  }, [tables, currentSchema]);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  if (isLoading) {
    return <SkeletonFlow />;
  }

  if (schemaTableCount === 0) {
    return <EmptyState onNavigate={onNavigateToTables} />;
  }

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-background flex flex-col">
      {/* Header flutuante clean */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="flex h-8 items-center gap-2 rounded-md bg-card border px-3">
            <UiIcon name="zap" className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-medium">{schemaTableCount} tables</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <div className="relative">
            <div className="flex items-center rounded-md bg-card border">
              <UiIcon name="search" className="ml-3 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                ref={searchRef}
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 w-44 border-0 bg-transparent pl-2 pr-8 text-xs focus-visible:ring-0"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="mr-2"
                >
                  <UiIcon name="x" className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                </button>
              )}
            </div>
          </div>
          <Select value={currentSchema} onValueChange={(value) => value && onSchemaChange(value)}>
            <SelectTrigger className="h-8 w-32 rounded-md bg-card border text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {schemas.map((s) => (
                <SelectItem key={s} value={s} className="text-xs">
                  <div className="flex items-center justify-between gap-3 w-full">
                    <span>{s}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {tables.filter((t) => t.schema === s).length}
                    </span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="h-6 w-px bg-border mx-1" />
          <button
            onClick={() => setDirection(direction === "LR" ? "TB" : "LR")}
            title={direction === "LR" ? "Vertical Layout" : "Horizontal Layout"}
            className="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {direction === "LR" ? <UiIcon name="arrows-up-down" className="h-3.5 w-3.5" /> : <UiIcon name="arrows-left-right" className="h-3.5 w-3.5" />}
          </button>
          <button
            onClick={toggleFullscreen}
            title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
            className="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {isFullscreen ? <UiIcon name="minimize" className="h-3.5 w-3.5" /> : <UiIcon name="maximize" className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* Flow Container - ocupa espaço completo */}
      <div className="flex-1 relative">
        <ReactFlowProvider key={currentSchema}>
          <VisualizerFlow
            tables={tables}
            schema={currentSchema}
            onTableClick={onTableClick}
            searchQuery={searchQuery}
            direction={direction}
            filter={filter}
            onFilterChange={setFilter}
          />
        </ReactFlowProvider>
      </div>
    </div>
  );
}
