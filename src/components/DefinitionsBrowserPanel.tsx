import {
  Braces,
  ChevronRight,
  Code2,
  Copy,
  KeyRound,
  ListOrdered,
  Loader2,
  Power,
  PowerOff,
  Search,
  Zap,
} from "lucide-react";
import { motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import type {
  ConstraintInfo,
  DatabaseType,
  IndexInfo,
  SchemaEnum,
  SchemaFunction,
  SchemaTrigger,
} from "@/ipc/db/types";
import { cn } from "@/utils/tailwind";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { getEnums, getFunctions, getSchemaConstraints, getSchemaIndexes, getTriggers } from "@/hooks/db-actions";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DefinitionTab = "constraints" | "enums" | "functions" | "indexes" | "triggers";

interface DefinitionsBrowserPanelProps {
  connectionId: string;
  dbType: DatabaseType;
  schemas: string[];
  selectedSchema: string;
  onSchemaChange: (schema: string) => void;
}

// ---------------------------------------------------------------------------
// Design tokens (Emil Kowalski principles)
// ---------------------------------------------------------------------------

const EASING_OUT = "cubic-bezier(0.23, 1, 0.32, 1)" as const;
const ENTRY_DURATION = 200; // ms - fast UI animations under 300ms

// ---------------------------------------------------------------------------
// Animation variants (GPU-only, ≤300ms)
// ---------------------------------------------------------------------------

const containerVariants = {
  hidden: {},
  visible: (reducedMotion: boolean) => ({
    transition: { staggerChildren: reducedMotion ? 0 : 0.04 },
  }),
};

const itemVariants = (reducedMotion: boolean) => ({
  hidden: { opacity: 0, y: reducedMotion ? 0 : 6 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: reducedMotion ? 0 : ENTRY_DURATION / 1000, ease: EASING_OUT },
  },
});

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ConstraintCard({
  constraint,
  onCopy,
}: {
  constraint: ConstraintInfo;
  onCopy: (text: string) => void;
}) {
  return (
    <div className="group rounded-lg border border-border/50 bg-muted/10 hover:bg-muted/20 transition-colors duration-150 ease-out">
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <KeyRound className="size-3.5 text-emerald-500/70 shrink-0" />
          <span className="font-mono text-sm font-medium truncate">
            {constraint.name}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Badge variant="outline" className="font-mono text-[10px] h-4 px-1">
            {constraint.type}
          </Badge>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  onClick={() =>
                    onCopy(
                      `${constraint.type} "${constraint.name}" on ${constraint.table}(${constraint.columns.join(", ")})`,
                    )
                  }
                  className="opacity-0 group-hover:opacity-100 transition-all duration-150 ease-out shrink-0 rounded-md p-0.5 hover:bg-foreground/10 active:scale-[0.97]"
                >
                  <Copy className="size-3 text-muted-foreground" />
                </button>
              }
            />
            <TooltipContent>Copy</TooltipContent>
          </Tooltip>
        </div>
      </div>
      <div className="flex items-center gap-2 pb-2 pl-[22px]">
        <span className="text-[11px] text-muted-foreground">
          on{" "}
          <span className="font-mono text-foreground/70">
            {constraint.table}
          </span>
        </span>
        <span className="text-[11px] text-muted-foreground font-mono truncate">
          ({constraint.columns.join(", ")})
        </span>
      </div>
    </div>
  );
}

function EnumCard({
  enumDef,
  onCopy,
}: {
  enumDef: SchemaEnum;
  onCopy: (text: string) => void;
}) {
  return (
    <div className="group rounded-lg border border-border/50 bg-muted/10 hover:bg-muted/20 transition-colors duration-150 ease-out">
      <div className="flex items-center justify-between gap-2 px-3 pt-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <Braces className="size-3.5 text-violet-500/70 shrink-0" />
          <span className="font-mono text-sm font-medium truncate">
            {enumDef.name}
          </span>
          <Badge
            variant="outline"
            className="font-mono text-[10px] h-4 px-1 shrink-0"
          >
            {enumDef.schema}
          </Badge>
        </div>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={() =>
                  onCopy(enumDef.values.map((v) => `'${v}'`).join(", "))
                }
                className="opacity-0 group-hover:opacity-100 transition-all duration-150 ease-out shrink-0 rounded-md p-0.5 hover:bg-foreground/10 active:scale-[0.97]"
              >
                <Copy className="size-3 text-muted-foreground" />
              </button>
            }
          />
          <TooltipContent>Copy values</TooltipContent>
        </Tooltip>
      </div>
      <div className="flex flex-wrap gap-1 px-3 pb-2.5 pt-2">
        {enumDef.values.map((v) => (
          <Badge
            key={v}
            variant="secondary"
            className="font-mono text-[10px] h-5 px-1.5"
          >
            {v}
          </Badge>
        ))}
      </div>
    </div>
  );
}

function FunctionCard({
  fn,
  onCopy,
  reducedMotion,
}: {
  fn: SchemaFunction;
  onCopy: (text: string) => void;
  reducedMotion?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const isProcedure = fn.type === "procedure";

  return (
    <div className="group rounded-lg border border-border/50 bg-muted/10 hover:bg-muted/20 transition-colors duration-150 ease-out">
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 min-w-0 text-left flex-1 active:scale-[0.97] transition-transform duration-150 ease-out"
        >
          <ChevronRight
            className={cn(
              "size-3 text-muted-foreground/50 shrink-0 transition-transform duration-150 ease-out",
              expanded && "rotate-90",
              reducedMotion && "transition-none"
            )}
          />
          <Code2
            className={cn(
              "size-3.5 shrink-0",
              isProcedure ? "text-amber-500/70" : "text-blue-500/70",
            )}
          />
          <span className="font-mono text-sm font-medium truncate">
            {fn.name}
          </span>
          {fn.argument_count > 0 && (
            <Badge
              variant="outline"
              className="font-mono text-[10px] h-4 px-1 shrink-0"
            >
              {fn.argument_count} arg{fn.argument_count > 1 ? "s" : ""}
            </Badge>
          )}
        </button>
        <div className="flex items-center gap-1.5 shrink-0">
          <Badge
            variant="outline"
            className={cn(
              "font-mono text-[10px] h-4 px-1",
              isProcedure
                ? "border-amber-500/30 text-amber-600"
                : "border-blue-500/30 text-blue-600",
            )}
          >
            {isProcedure ? "PROC" : "FUNC"}
          </Badge>
          {fn.language && (
            <Badge
              variant="secondary"
              className="font-mono text-[10px] h-4 px-1"
            >
              {fn.language}
            </Badge>
          )}
          {fn.definition && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    onClick={() => fn.definition && onCopy(fn.definition)}
                    className="opacity-0 group-hover:opacity-100 transition-all duration-[160ms] ease-out rounded-md p-0.5 
                      @media (hover: hover) and (pointer: fine):hover:bg-foreground/10
                      active:scale-[0.97]"
                  >
                    <Copy className="size-3 text-muted-foreground" />
                  </button>
                }
              />
              <TooltipContent>Copy definition</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Meta row */}
      <div className="flex items-center gap-2 pb-2 pl-[22px]">
        {fn.return_type && (
          <span className="text-[11px] text-muted-foreground">
            returns{" "}
            <span className="font-mono text-foreground/70">
              {fn.return_type}
            </span>
          </span>
        )}
        {fn.arguments && (
          <span className="text-[11px] text-muted-foreground font-mono truncate">
            {fn.arguments}
          </span>
        )}
      </div>

      {/* Expanded source - GPU-only transform animation */}
      {expanded && fn.definition && (
        <motion.div
          initial={reducedMotion ? { opacity: 1 } : { opacity: 0, scaleY: 0.95 }}
          animate={{ opacity: 1, scaleY: 1 }}
          transition={{
            duration: reducedMotion ? 0 : ENTRY_DURATION / 1000,
            ease: EASING_OUT,
          }}
          style={{ transformOrigin: "top" }}
          className="overflow-hidden"
        >
          <pre className="ml-[22px] mr-3 mb-2.5 text-[11px] font-mono text-muted-foreground bg-muted/30 rounded-md p-2 overflow-x-auto whitespace-pre-wrap break-all">
            {fn.definition}
          </pre>
        </motion.div>
      )}
    </div>
  );
}

function IndexCard({
  index,
  onCopy,
}: {
  index: IndexInfo;
  onCopy: (text: string) => void;
}) {
  return (
    <div className="group rounded-lg border border-border/50 bg-muted/10 hover:bg-muted/20 transition-colors duration-150 ease-out">
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <ListOrdered className="size-3.5 text-sky-500/70 shrink-0" />
          <span className="font-mono text-sm font-medium truncate">
            {index.name}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {index.isUnique && (
            <Badge variant="outline" className="font-mono text-[10px] h-4 px-1 border-violet-500/30 text-violet-600">
              UNIQUE
            </Badge>
          )}
          {index.isPrimary && (
            <Badge variant="outline" className="font-mono text-[10px] h-4 px-1 border-emerald-500/30 text-emerald-600">
              PK
            </Badge>
          )}
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  onClick={() =>
                    onCopy(
                      `${index.isUnique ? "UNIQUE " : ""}INDEX "${index.name}" ON ${index.table}(${index.columns.join(", ")})`,
                    )
                  }
                  className="opacity-0 group-hover:opacity-100 transition-all duration-150 ease-out shrink-0 rounded-md p-0.5 hover:bg-foreground/10 active:scale-[0.97]"
                >
                  <Copy className="size-3 text-muted-foreground" />
                </button>
              }
            />
            <TooltipContent>Copy</TooltipContent>
          </Tooltip>
        </div>
      </div>
      <div className="flex items-center gap-2 pb-2 pl-[22px]">
        <span className="text-[11px] text-muted-foreground">
          on{" "}
          <span className="font-mono text-foreground/70">{index.table}</span>
        </span>
        <span className="text-[11px] text-muted-foreground font-mono truncate">
          ({index.columns.join(", ")})
        </span>
      </div>
    </div>
  );
}

function TriggerCard({
  trigger,
  onCopy,
}: {
  trigger: SchemaTrigger;
  onCopy: (text: string) => void;
}) {
  return (
    <div className="group rounded-lg border border-border/50 bg-muted/10 hover:bg-muted/20 transition-colors duration-150 ease-out">
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <Zap className="size-3.5 text-orange-500/70 shrink-0" />
          <span className="font-mono text-sm font-medium truncate">
            {trigger.name}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Badge variant="outline" className="font-mono text-[10px] h-4 px-1">
            {trigger.timing}
          </Badge>
          <Badge variant="outline" className="font-mono text-[10px] h-4 px-1">
            {trigger.event}
          </Badge>
          {trigger.enabled ? (
            <Power className="size-3 text-emerald-500/70" />
          ) : (
            <PowerOff className="size-3 text-destructive/50" />
          )}
          {trigger.definition && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    onClick={() => trigger.definition && onCopy(trigger.definition)}
                    className="opacity-0 group-hover:opacity-100 transition-all duration-150 ease-out rounded-md p-0.5 hover:bg-foreground/10 active:scale-[0.97]"
                  >
                    <Copy className="size-3 text-muted-foreground" />
                  </button>
                }
              />
              <TooltipContent>Copy definition</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 pb-2 pl-[22px]">
        <span className="text-[11px] text-muted-foreground">
          on{" "}
          <span className="font-mono text-foreground/70">{trigger.table}</span>
        </span>
        {trigger.function_name && (
          <span className="text-[11px] text-muted-foreground">
            calls{" "}
            <span className="font-mono text-foreground/70">
              {trigger.function_name}
            </span>
          </span>
        )}
      </div>
      {trigger.definition && (
        <pre className="mx-3 mb-2.5 text-[11px] font-mono text-muted-foreground bg-muted/30 rounded-md p-2 overflow-x-auto whitespace-pre-wrap break-all max-h-32">
          {trigger.definition}
        </pre>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty states
// ---------------------------------------------------------------------------

function DefinitionEmptyState({
  type,
  dbType,
}: {
  type: DefinitionTab;
  dbType: DatabaseType;
}) {
  const isUnsupported =
    (type === "enums" && dbType === "sqlite") ||
    (type === "functions" && dbType === "sqlite");

  const labels: Record<
    DefinitionTab,
    {
      title: string;
      desc: string;
      icon: React.ComponentType<{ className?: string }>;
    }
  > = {
    constraints: {
      title: "No constraints found",
      desc: "This schema doesn't contain any constraints",
      icon: KeyRound,
    },
    enums: {
      title: isUnsupported ? "Not supported" : "No enums found",
      desc: isUnsupported
        ? "SQLite does not have native enum types"
        : "This schema doesn't contain any enum types",
      icon: Braces,
    },
    functions: {
      title: isUnsupported ? "Not supported" : "No functions found",
      desc: isUnsupported
        ? "SQLite user-defined functions are not introspectable"
        : "This schema doesn't contain any functions or procedures",
      icon: Code2,
    },
    indexes: {
      title: "No indexes found",
      desc: "This schema doesn't contain any indexes",
      icon: ListOrdered,
    },
    triggers: {
      title: "No triggers found",
      desc: "This schema doesn't contain any triggers",
      icon: Zap,
    },
  };

  const { title, desc, icon: Icon } = labels[type];

  return (
    <Empty className="py-8">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{desc}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function DefinitionsBrowserPanel({
  connectionId,
  dbType,
  schemas,
  selectedSchema,
  onSchemaChange,
}: DefinitionsBrowserPanelProps) {
  const [activeTab, setActiveTab] = useState<DefinitionTab>("enums");
  const [search, setSearch] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const reducedMotion = useReducedMotion();

  // Fetch all definition data via React Query
  const constraintsQuery = useQuery({
    queryKey: ["schema-constraints", connectionId, selectedSchema],
    queryFn: () => getSchemaConstraints(connectionId, selectedSchema),
    enabled: activeTab === "constraints",
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });

  const enumsQuery = useQuery({
    queryKey: ["schema-enums", connectionId, selectedSchema],
    queryFn: () => getEnums(connectionId, selectedSchema),
    enabled: activeTab === "enums",
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });

  const functionsQuery = useQuery({
    queryKey: ["schema-functions", connectionId, selectedSchema],
    queryFn: () => getFunctions(connectionId, selectedSchema),
    enabled: activeTab === "functions",
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });

  const indexesQuery = useQuery({
    queryKey: ["schema-indexes", connectionId, selectedSchema],
    queryFn: () => getSchemaIndexes(connectionId, selectedSchema),
    enabled: activeTab === "indexes",
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });

  const triggersQuery = useQuery({
    queryKey: ["schema-triggers", connectionId, selectedSchema],
    queryFn: () => getTriggers(connectionId, selectedSchema),
    enabled: activeTab === "triggers",
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });

  const constraints = constraintsQuery.data ?? [];
  const enums = enumsQuery.data ?? [];
  const functions = functionsQuery.data ?? [];
  const indexes = indexesQuery.data ?? [];
  const triggers = triggersQuery.data ?? [];

  const queryMap: Record<DefinitionTab, { isLoading: boolean }> = {
    constraints: constraintsQuery,
    enums: enumsQuery,
    functions: functionsQuery,
    indexes: indexesQuery,
    triggers: triggersQuery,
  };
  const isLoading = queryMap[activeTab]?.isLoading ?? false;

  // Search filter
  const needle = search.trim().toLowerCase();

  const filteredConstraints = useMemo(() => {
    if (!needle) return constraints;
    return constraints.filter(
      (c) =>
        c.name.toLowerCase().includes(needle) ||
        c.table.toLowerCase().includes(needle) ||
        c.columns.some((col) => col.toLowerCase().includes(needle)),
    );
  }, [constraints, needle]);

  const filteredEnums = useMemo(() => {
    if (!needle) return enums;
    return enums.filter(
      (e) =>
        e.name.toLowerCase().includes(needle) ||
        e.values.some((v) => v.toLowerCase().includes(needle)),
    );
  }, [enums, needle]);

  const filteredFunctions = useMemo(() => {
    if (!needle) return functions;
    return functions.filter(
      (f) =>
        f.name.toLowerCase().includes(needle) ||
        (f.arguments?.toLowerCase().includes(needle) ?? false),
    );
  }, [functions, needle]);

  const filteredIndexes = useMemo(() => {
    if (!needle) return indexes;
    return indexes.filter(
      (i) =>
        i.name.toLowerCase().includes(needle) ||
        i.table.toLowerCase().includes(needle) ||
        i.columns.some((c) => c.toLowerCase().includes(needle)),
    );
  }, [indexes, needle]);

  const filteredTriggers = useMemo(() => {
    if (!needle) return triggers;
    return triggers.filter(
      (t) =>
        t.name.toLowerCase().includes(needle) ||
        t.table.toLowerCase().includes(needle),
    );
  }, [triggers, needle]);

  const handleCopy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // silently fail
    }
  }, []);

  // Keyboard shortcut: / to focus search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === "/" &&
        !["INPUT", "TEXTAREA"].includes(
          (e.target as HTMLElement)?.tagName,
        )
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);



  return (
    <motion.div
      className="h-full flex flex-col overflow-hidden"
      initial="hidden"
      animate="visible"
      variants={containerVariants}
      custom={reducedMotion}
    >
      {/* ── Header ──────────────────────────────────────────── */}
      <motion.div
        variants={itemVariants(reducedMotion)}
        className="shrink-0 px-5 pt-4 pb-3 space-y-3"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Braces className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Definitions</h2>
          </div>
          <div className="flex items-center gap-2">
            {/* Schema selector */}
            {schemas.length > 1 && (
              <Select
                value={selectedSchema}
                onValueChange={(v) => { if (v) onSchemaChange(v); }}
              >
                <SelectTrigger className="h-7 w-auto min-w-[100px] text-xs font-mono">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {schemas.map((s) => (
                    <SelectItem
                      key={s}
                      value={s}
                      className="font-mono text-xs"
                    >
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/50 pointer-events-none" />
          <Input
            ref={searchInputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search definitions..."
            className="h-7 pl-8 text-xs"
          />
        </div>
      </motion.div>

      {/* ── Tabs ─────────────────────────────────────────────── */}
      <motion.div
        variants={itemVariants(reducedMotion)}
        className="flex-1 min-h-0 flex flex-col px-5"
      >
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as DefinitionTab)}
          className="flex-1 min-h-0 flex flex-col"
        >
          <TabsList variant="line" className="w-full justify-start gap-0">
            <TabsTrigger value="constraints" className="gap-1">
              <KeyRound className="size-3" />
              Constraints
              {constraints.length > 0 && (
                <Badge
                  variant="secondary"
                  className="font-mono text-[9px] h-4 min-w-[18px] px-1"
                >
                  {constraints.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="enums" className="gap-1">
              <Braces className="size-3" />
              Enums
              {enums.length > 0 && (
                <Badge
                  variant="secondary"
                  className="font-mono text-[9px] h-4 min-w-[18px] px-1"
                >
                  {enums.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="functions" className="gap-1">
              <Code2 className="size-3" />
              Functions
              {functions.length > 0 && (
                <Badge
                  variant="secondary"
                  className="font-mono text-[9px] h-4 min-w-[18px] px-1"
                >
                  {functions.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="indexes" className="gap-1">
              <ListOrdered className="size-3" />
              Indexes
              {indexes.length > 0 && (
                <Badge
                  variant="secondary"
                  className="font-mono text-[9px] h-4 min-w-[18px] px-1"
                >
                  {indexes.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="triggers" className="gap-1">
              <Zap className="size-3" />
              Triggers
              {triggers.length > 0 && (
                <Badge
                  variant="secondary"
                  className="font-mono text-[9px] h-4 min-w-[18px] px-1"
                >
                  {triggers.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <div className="flex-1 min-h-0 mt-2">
            {/* Constraints tab */}
            <TabsContent value="constraints" className="h-full">
              <ScrollArea className="h-full">
                {isLoading ? (
                  <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    <span className="text-sm">Loading constraints…</span>
                  </div>
                ) : filteredConstraints.length > 0 ? (
                  <div className="space-y-2 pb-4">
                    {filteredConstraints.map((c, i) => (
                      <ConstraintCard
                        key={`${c.name}-${c.table}-${i}`}
                        constraint={c}
                        onCopy={handleCopy}
                      />
                    ))}
                  </div>
                ) : (
                  <DefinitionEmptyState type="constraints" dbType={dbType} />
                )}
              </ScrollArea>
            </TabsContent>

            {/* Enums tab */}
            <TabsContent value="enums" className="h-full">
              <ScrollArea className="h-full">
                {isLoading ? (
                  <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    <span className="text-sm">Loading enums…</span>
                  </div>
                ) : filteredEnums.length > 0 ? (
                  <div className="space-y-2 pb-4">
                    {filteredEnums.map((e) => (
                      <EnumCard
                        key={e.name}
                        enumDef={e}
                        onCopy={handleCopy}
                      />
                    ))}
                  </div>
                ) : (
                  <DefinitionEmptyState type="enums" dbType={dbType} />
                )}
              </ScrollArea>
            </TabsContent>

            {/* Functions tab */}
            <TabsContent value="functions" className="h-full">
              <ScrollArea className="h-full">
                {isLoading ? (
                  <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    <span className="text-sm">Loading functions…</span>
                  </div>
                ) : filteredFunctions.length > 0 ? (
                  <div className="space-y-2 pb-4">
                    {filteredFunctions.map((fn, i) => (
                      <FunctionCard
                        key={`${fn.name}-${fn.type}-${i}`}
                        fn={fn}
                        onCopy={handleCopy}
                        reducedMotion={reducedMotion}
                      />
                    ))}
                  </div>
                ) : (
                  <DefinitionEmptyState type="functions" dbType={dbType} />
                )}
              </ScrollArea>
            </TabsContent>

            {/* Indexes tab */}
            <TabsContent value="indexes" className="h-full">
              <ScrollArea className="h-full">
                {isLoading ? (
                  <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    <span className="text-sm">Loading indexes…</span>
                  </div>
                ) : filteredIndexes.length > 0 ? (
                  <div className="space-y-2 pb-4">
                    {filteredIndexes.map((idx, i) => (
                      <IndexCard
                        key={`${idx.name}-${idx.table}-${i}`}
                        index={idx}
                        onCopy={handleCopy}
                      />
                    ))}
                  </div>
                ) : (
                  <DefinitionEmptyState type="indexes" dbType={dbType} />
                )}
              </ScrollArea>
            </TabsContent>

            {/* Triggers tab */}
            <TabsContent value="triggers" className="h-full">
              <ScrollArea className="h-full">
                {isLoading ? (
                  <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    <span className="text-sm">Loading triggers…</span>
                  </div>
                ) : filteredTriggers.length > 0 ? (
                  <div className="space-y-2 pb-4">
                    {filteredTriggers.map((t) => (
                      <TriggerCard
                        key={t.name}
                        trigger={t}
                        onCopy={handleCopy}
                      />
                    ))}
                  </div>
                ) : (
                  <DefinitionEmptyState type="triggers" dbType={dbType} />
                )}
              </ScrollArea>
            </TabsContent>
          </div>
        </Tabs>
      </motion.div>
    </motion.div>
  );
}
