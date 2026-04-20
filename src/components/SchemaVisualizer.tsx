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
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table2,
  Key,
  Eraser,
  Fingerprint,
  BookOpen,
  Link,
  Search,
  X,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { SchemaTableDetails, SchemaForeignKey, SchemaIndex, SchemaColumn } from "@/ipc/db/types";

interface SchemaVisualizerProps {
  tables: SchemaTableDetails[];
  schemas: string[];
  currentSchema: string;
  onSchemaChange: (schema: string) => void;
  onTableClick?: (schema: string, table: string) => void;
}

interface ColumnData extends SchemaColumn {
  id: string;
  primaryKey?: string;
  unique?: string;
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

function TableNode({ data }: NodeProps<TableNodeType>) {
  return (
    <div
      className={cn(
        "w-[264px] rounded-xl bg-card font-mono shadow-lg border border-border transition-opacity",
        data.searchActive && data.tableSearchMatched && "ring-2 ring-primary",
        data.searchActive &&
          !data.tableSearchMatched &&
          !data.columns.some((c) => c.searchMatched) &&
          "opacity-40"
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/50 px-3 py-2.5 rounded-t-xl">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <Table2 className="h-4 w-4 shrink-0 text-muted-foreground" />
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
            className="h-6 w-6"
            onClick={() => data.onTableClick?.(data.schema, data.table)}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      <div className="py-1 text-xs">
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
            <div className="flex items-center justify-between gap-2 py-1.5 border-b border-dashed border-border/50 last:border-0">
              <div className="flex items-center gap-1.5 truncate">
                {column.primaryKey && (
                  <Key className="h-3 w-3 shrink-0 text-amber-500" />
                )}
                {column.is_nullable && (
                  <Eraser className="h-3 w-3 shrink-0 text-muted-foreground/60" />
                )}
                {column.unique && !column.primaryKey && (
                  <Fingerprint className="h-3 w-3 shrink-0 text-blue-500" />
                )}
                {column.column_default !== null && !column.primaryKey && (
                  <BookOpen className="h-3 w-3 shrink-0 text-muted-foreground/60" />
                )}
                {column.foreign && (
                  <Link className="h-3 w-3 shrink-0 text-green-500" />
                )}
                <span className="truncate font-medium">{column.name}</span>
              </div>
              <span className="max-w-[50%] truncate text-muted-foreground/60 text-[10px]">
                {column.data_type}
              </span>
              {column.foreign && (
                <Handle
                  type="source"
                  position={Position.Right}
                  id={column.name}
                  className="w-2.5! h-2.5! rounded-full! border-2! border-background! bg-foreground!"
                  isConnectable={false}
                />
              )}
              {column.primaryKey && (
                <Handle
                  type="target"
                  position={Position.Left}
                  id={column.id}
                  className="w-2.5! h-2.5! rounded-full! border-2! border-background! bg-foreground!"
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
    targetX,
    targetY,
    targetPosition: targetPosition || Position.Top,
    borderRadius: 15,
  });

  const animatedStyle = {
    ...style,
    opacity: 0.3,
    strokeDasharray: "5,5",
    strokeDashoffset: 0,
    animation: "dash 1s linear infinite",
  };

  return (
    <>
      <defs>
        <style>{`
          @keyframes dash {
            to {
              stroke-dashoffset: -10;
            }
          }
        `}</style>
      </defs>
      <BaseEdge
        type="smoothstep"
        path={edgePath}
        style={animatedStyle}
        markerEnd={markerEnd}
      />
    </>
  );
}

const nodeTypes = {
  tableNode: TableNode,
};

const edgeTypes = {
  custom: CustomEdge,
};

const dagreGraph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));

const nodeWidth = 264;

function getNodeSize(columns: ColumnData[]) {
  return {
    width: nodeWidth,
    height: columns.length * 33 + 16 + 45,
  };
}

function getLayoutElements(
  nodes: TableNodeType[],
  edges: Edge[],
  direction = "LR"
): { nodes: Node[]; edges: Edge[] } {
  const isHorizontal = direction === "LR";
  dagreGraph.setGraph({ rankdir: direction });

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

  return { nodes: newNodes, edges };
}

function getEdgesFromForeignKeys(
  tables: SchemaTableDetails[],
  schema: string
): Edge[] {
  const edges: Edge[] = [];

  for (const table of tables) {
    if (table.schema !== schema) continue;

    for (const fk of table.foreign_keys) {
      const targetSchema = fk.referenced_schema || table.schema;
      if (targetSchema !== schema) continue;

      edges.push({
        id: `${table.name}_${fk.column_name}_${fk.referenced_table}_${fk.referenced_column}`,
        type: "custom",
        source: table.name,
        target: fk.referenced_table,
        sourceHandle: fk.column_name,
        targetHandle: fk.referenced_column,
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
}: {
  tables: SchemaTableDetails[];
  schema: string;
  onTableClick?: (schema: string, table: string) => void;
  searchQuery: string;
}) {
  const edges = useMemo(
    () => getEdgesFromForeignKeys(tables, schema),
    [tables, schema]
  );

  const initialNodes = useMemo(
    () => getNodesFromTables(tables, schema, edges, onTableClick),
    [tables, schema, edges, onTableClick]
  );

  const { nodes: layoutNodes, edges: layoutEdges } = useMemo(
    () => getLayoutElements(initialNodes, edges),
    [initialNodes, edges]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutNodes);
  const [reactEdges, setEdges, onEdgesChange] = useEdgesState(layoutEdges);

  useEffect(() => {
    setNodes(applySearchHighlight(layoutNodes, searchQuery, tables, schema));
  }, [searchQuery, layoutNodes, tables, schema, setNodes]);

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
      minZoom={0.3}
      maxZoom={4}
      panOnScroll
      selectionOnDrag
      defaultEdgeOptions={{ type: "custom" }}
      style={{
        ["--xy-background-pattern-dots-color-default" as string]:
          "var(--border)",
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
        gap={20}
        size={2}
      />
      <MiniMap
        pannable
        zoomable
        bgColor="var(--background)"
        nodeColor="var(--muted)"
        className="border border-border rounded-lg"
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
}: SchemaVisualizerProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const filteredTables = useMemo(
    () => tables.filter((t) => t.schema === currentSchema),
    [tables, currentSchema]
  );

  if (filteredTables.length === 0) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border bg-background">
        <p className="text-muted-foreground">No tables to visualize</p>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg border bg-background">
      <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
        <div className="relative w-56">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              ref={searchRef}
              placeholder="Search tables or columns..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 pl-9 pr-9 text-sm"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2"
              >
                <X className="h-4 w-4 text-muted-foreground hover:text-foreground" />
              </button>
            )}
          </div>
        </div>
        <Select value={currentSchema} onValueChange={(value) => value && onSchemaChange(value)}>
          <SelectTrigger className="w-[180px] h-9">
            <div className="flex flex-1 items-center gap-2 overflow-hidden">
              <span className="shrink-0 text-muted-foreground text-xs">schema</span>
              <span className="truncate text-sm">
                <SelectValue />
              </span>
            </div>
          </SelectTrigger>
          <SelectContent>
            {schemas.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <ReactFlowProvider key={currentSchema}>
        <VisualizerFlow
          tables={tables}
          schema={currentSchema}
          onTableClick={onTableClick}
          searchQuery={searchQuery}
        />
      </ReactFlowProvider>
    </div>
  );
}
