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
import { useReactFlow, Panel } from "@xyflow/react";
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
import type { SchemaTableDetails, SchemaColumn } from "@/ipc/db/types";

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
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:text-foreground"
          title="Legend"
        >
          <UiIcon name="layers" className="h-3 w-3" />
        </button>
        {isOpen && (
          <div className="rounded-md bg-card/80 backdrop-blur-sm border p-2">
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
              {items.map((item) => (
                <div key={item.label} className="flex items-center gap-1 text-[9px]">
                  <item.icon className={`h-2.5 w-2.5 ${item.color}`} />
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
      <div className="flex flex-wrap items-center gap-1">
        <button
          onClick={() => onChange({ ...filter, showIsolated: !filter.showIsolated })}
          className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-medium transition-colors ${
            filter.showIsolated
              ? "text-primary/80"
              : "text-muted-foreground/40 hover:text-muted-foreground"
          }`}
          title="Isolated (no relations)"
        >
          <span className="h-1 w-1 rounded-full bg-current" />
          Isolated
        </button>
        <button
          onClick={() => onChange({ ...filter, showWithFk: !filter.showWithFk })}
          className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-medium transition-colors ${
            filter.showWithFk
              ? "text-violet-500"
              : "text-muted-foreground/40 hover:text-muted-foreground"
          }`}
          title="With Foreign Keys"
        >
          <span className="h-1 w-1 rounded-full bg-current" />
          FK
        </button>
        <button
          onClick={() => onChange({ ...filter, showWithPk: !filter.showWithPk })}
          className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-medium transition-colors ${
            filter.showWithPk
              ? "text-amber-500"
              : "text-muted-foreground/40 hover:text-muted-foreground"
          }`}
          title="With Primary Keys"
        >
          <span className="h-1 w-1 rounded-full bg-current" />
          PK
        </button>
        <span className="px-1 text-[9px] text-muted-foreground/40">
          {totalCount}
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
        "w-[200px] rounded-md bg-card font-mono border border-border/50 transition-opacity",
        data.searchActive && data.tableSearchMatched && "ring-1 ring-primary/60",
        data.searchActive &&
          !data.tableSearchMatched &&
          !data.columns.some((c) => c.searchMatched) &&
          "opacity-25"
      )}
    >
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-border/40">
        <UiIcon name="table" className="h-3 w-3 shrink-0 text-muted-foreground/40" />
        <span
          className={cn(
            "block truncate text-[11px] font-medium text-foreground/80",
            data.searchActive && data.tableSearchMatched && "text-primary"
          )}
        >
          {data.table}
        </span>
        {data.onTableClick && (
          <button
            type="button"
            className="ml-auto h-4 w-4 shrink-0 flex items-center justify-center rounded text-muted-foreground/30 hover:text-primary transition-colors"
            onClick={() => data.onTableClick?.(data.schema, data.table)}
          >
            <UiIcon name="arrow-right" className="h-2.5 w-2.5" />
          </button>
        )}
      </div>
      <div className="py-1 text-xs">
        {data.columns.map((column) => (
          <div
            key={column.name}
            className={cn(
              "transition-opacity",
              data.searchActive &&
                column.searchMatched &&
                "bg-primary/8",
              data.searchActive &&
                data.columns.some((c) => c.searchMatched) &&
                !column.searchMatched &&
                "opacity-30"
            )}
          >
            <div
              className="flex items-center justify-between gap-1 px-2.5 py-[3px] text-[10px] leading-tight"
            >
              <div className="flex min-w-0 items-center gap-1">
                {column.primaryKey && (
                  <span className="h-1 w-1 rounded-full bg-amber-500 shrink-0" />
                )}
                {column.unique && !column.primaryKey && (
                  <span className="h-1 w-1 rounded-full bg-emerald-500 shrink-0" />
                )}
                {column.foreign && (
                  <span className="h-1 w-1 rounded-full bg-violet-500 shrink-0" />
                )}
                {!column.primaryKey && !column.unique && !column.foreign && (
                  <span className="h-1 w-1 rounded-full bg-transparent shrink-0" />
                )}
                <span className="truncate text-foreground/70">{column.name}</span>
              </div>
              <span className="max-w-[40%] truncate text-muted-foreground/35 text-[9px]">
                {column.data_type}
              </span>
            </div>
            {column.foreign && (
              <Handle
                type="source"
                position={Position.Right}
                id={column.id}
                className="w-1.5! h-1.5! rounded-full! border-none! bg-muted-foreground/30!"
                isConnectable={false}
              />
            )}
            {(column.primaryKey || column.isEdgeTarget) && (
              <Handle
                type="target"
                position={Position.Left}
                id={column.id}
                className="w-1.5! h-1.5! rounded-full! border-none! bg-muted-foreground/30!"
                isConnectable={false}
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
    sourceX,
    sourceY,
    sourcePosition: sourcePosition || Position.Bottom,
    targetPosition: targetPosition || Position.Top,
    targetX,
    targetY,
    borderRadius: 12,
  });

  const animatedStyle = {
    ...style,
    strokeWidth: 1,
    stroke: "var(--muted-foreground)",
    opacity: 0.2,
    strokeDasharray: "4,4",
    animation: "dash 1s linear infinite",
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
  const rowHeight = 18;
  const headerHeight = 28;
  const padding = 8;
  const width = 200;
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
        bgColor="transparent"
        nodeColor="var(--muted-foreground)"
        maskColor="var(--muted)"
        className="rounded border border-border/30 opacity-60 hover:opacity-100 transition-opacity"
        style={{ width: 100, height: 60 }}
      />
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
          <span className="text-[10px] text-muted-foreground/50 tabular-nums">{schemaTableCount}</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="flex items-center">
            <UiIcon name="search" className="mr-1.5 h-3 w-3 text-muted-foreground/40" />
            <Input
              ref={searchRef}
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-6 w-32 border-0 bg-transparent p-0 text-[11px] text-muted-foreground placeholder:text-muted-foreground/40 focus-visible:ring-0"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="mr-1"
              >
                <UiIcon name="x" className="h-2.5 w-2.5 text-muted-foreground/40 hover:text-foreground" />
              </button>
            )}
          </div>
          <Select value={currentSchema} onValueChange={(value) => value && onSchemaChange(value)}>
            <SelectTrigger className="h-6 w-28 border-0 bg-transparent p-0 text-[11px] text-muted-foreground shadow-none">
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
          <button
            onClick={() => setDirection(direction === "LR" ? "TB" : "LR")}
            title={direction === "LR" ? "Vertical Layout" : "Horizontal Layout"}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground/40 transition-colors hover:text-foreground"
          >
            {direction === "LR" ? <UiIcon name="arrows-up-down" className="h-3 w-3" /> : <UiIcon name="arrows-left-right" className="h-3 w-3" />}
          </button>
          <button
            onClick={toggleFullscreen}
            title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground/40 transition-colors hover:text-foreground"
          >
            {isFullscreen ? <UiIcon name="minimize" className="h-3 w-3" /> : <UiIcon name="maximize" className="h-3 w-3" />}
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
