import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Icon as UiIcon } from "@/components/ui/Icon";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useReducedMotion } from "@/features/settings";
import type {
  ConstraintInfo,
  DatabaseType,
  IndexInfo,
  SchemaEnum,
  SchemaFunction,
  SchemaTrigger,
} from "@/ipc/db/types";
import { dbQueryOptions } from "@/lib/query-options";
import { cn } from "@/lib/utils";

type DefinitionTab =
  | "constraints"
  | "enums"
  | "functions"
  | "indexes"
  | "triggers";

interface DefinitionsBrowserPanelProps {
  connectionId: string;
  dbType: DatabaseType;
  onSchemaChange: (schema: string) => void;
  schemas: string[];
  selectedSchema: string;
}

// Design tokens (Emil Kowalski principles)
const EASING_OUT = [0.23, 1, 0.32, 1] as [number, number, number, number];
const ENTRY_DURATION = 0.18; // 180ms - crisp UI animations

// Animation variants (GPU-only, never scale(0), ≤300ms)
const containerVariants = {
  hidden: {},
  visible: (reducedMotion: boolean) => ({
    transition: { staggerChildren: reducedMotion ? 0 : 0.03 },
  }),
};

const itemVariants = (reducedMotion: boolean) => ({
  hidden: { opacity: 0, y: reducedMotion ? 0 : 4 },
  visible: {
    opacity: 1,
    transition: {
      duration: reducedMotion ? 0 : ENTRY_DURATION,
      ease: EASING_OUT,
    },
    y: 0,
  },
});

function ConstraintCard({
  constraint,
  onCopy,
}: {
  constraint: ConstraintInfo;
  onCopy: (text: string) => void;
}) {
  return (
    <div className="group flex items-start gap-3 rounded-md px-2.5 py-2 transition-colors duration-150 ease-out hover:bg-muted/40">
      <UiIcon
        className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/50"
        name="key"
      />
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium font-mono text-[13px]">
            {constraint.name}
          </span>
          <Badge
            className="h-4 shrink-0 px-1 font-mono text-[10px]"
            variant="outline"
          >
            {constraint.type}
          </Badge>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span>on</span>
          <span className="font-mono text-foreground/70">
            {constraint.table}
          </span>
          <span className="truncate font-mono">
            ({constraint.columns.join(", ")})
          </span>
        </div>
      </div>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              className="shrink-0 rounded p-1 opacity-0 transition-opacity duration-150 hover:bg-muted active:scale-[0.97] group-hover:opacity-100"
              onClick={() =>
                onCopy(
                  `${constraint.type} "${constraint.name}" on ${constraint.table}(${constraint.columns.join(", ")})`
                )
              }
              type="button"
            >
              <UiIcon className="size-3 text-muted-foreground" name="copy" />
            </button>
          }
        />
        <TooltipContent>Copy</TooltipContent>
      </Tooltip>
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
  const values = Array.isArray(enumDef.values) ? enumDef.values : [];

  return (
    <div className="group rounded-md px-2.5 py-2 transition-colors duration-150 ease-out hover:bg-muted/40">
      <div className="mb-1.5 flex items-center gap-2">
        <UiIcon
          className="size-3.5 shrink-0 text-muted-foreground/50"
          name="braces"
        />
        <span className="truncate font-medium font-mono text-[13px]">
          {enumDef.name}
        </span>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                className="shrink-0 rounded p-1 opacity-0 transition-opacity duration-150 hover:bg-muted active:scale-[0.97] disabled:opacity-30 group-hover:opacity-100"
                disabled={values.length === 0}
                onClick={() => onCopy(values.map((v) => `'${v}'`).join(", "))}
                type="button"
              >
                <UiIcon className="size-3 text-muted-foreground" name="copy" />
              </button>
            }
          />
          <TooltipContent>Copy values</TooltipContent>
        </Tooltip>
      </div>
      <div className="flex flex-wrap gap-1 pl-5.5">
        {values.length === 0 ? (
          <span className="text-[11px] text-muted-foreground italic">
            No values
          </span>
        ) : (
          values.slice(0, 8).map((v) => (
            <Badge
              className="h-4 px-1 font-mono text-[10px]"
              key={v}
              variant="secondary"
            >
              {v}
            </Badge>
          ))
        )}
        {values.length > 8 && (
          <Badge className="h-4 px-1 text-[10px]" variant="outline">
            +{values.length - 8}
          </Badge>
        )}
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
    <div className="group rounded-md transition-colors duration-150 ease-out hover:bg-muted/40">
      <button
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left transition-transform duration-150 ease-out active:scale-[0.99]"
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        <UiIcon
          className={cn(
            "size-3 shrink-0 text-muted-foreground/50 transition-transform duration-150",
            expanded && "rotate-90",
            reducedMotion && "transition-none"
          )}
          name="chevron-right"
        />
        <UiIcon
          className="size-3.5 shrink-0 text-muted-foreground/50"
          name="code"
        />
        <span className="truncate font-medium font-mono text-[13px]">
          {fn.name}
        </span>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
          {isProcedure ? "proc" : "func"}
        </span>
        {fn.language && (
          <Badge
            className="h-3.5 shrink-0 px-1 font-mono text-[9px]"
            variant="outline"
          >
            {fn.language}
          </Badge>
        )}
        <div className="flex-1" />
        {fn.definition && (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  className="shrink-0 rounded p-1 opacity-0 transition-opacity duration-150 hover:bg-muted active:scale-[0.97] group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    fn.definition && onCopy(fn.definition);
                  }}
                  type="button"
                >
                  <UiIcon
                    className="size-3 text-muted-foreground"
                    name="copy"
                  />
                </button>
              }
            />
            <TooltipContent>Copy</TooltipContent>
          </Tooltip>
        )}
      </button>

      {/* Expanded source */}
      {expanded && fn.definition && (
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="overflow-hidden"
          initial={reducedMotion ? { opacity: 1 } : { opacity: 0, y: -4 }}
          transition={{
            duration: reducedMotion ? 0 : ENTRY_DURATION,
            ease: EASING_OUT,
          }}
        >
          <pre className="mx-2.5 mb-2 max-h-40 overflow-x-auto whitespace-pre-wrap break-all rounded bg-muted/30 px-2 py-1.5 font-mono text-[10px] text-muted-foreground/80">
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
    <div className="group flex items-start gap-3 rounded-md px-2.5 py-2 transition-colors duration-150 ease-out hover:bg-muted/40">
      <UiIcon
        className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/50"
        name="list-numbers"
      />
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium font-mono text-[13px]">
            {index.name}
          </span>
          {index.isPrimary && (
            <Badge
              className="h-3.5 shrink-0 px-1 font-mono text-[9px]"
              variant="outline"
            >
              PK
            </Badge>
          )}
          {index.isUnique && !index.isPrimary && (
            <Badge
              className="h-3.5 shrink-0 px-1 font-mono text-[9px]"
              variant="outline"
            >
              UQ
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span>on</span>
          <span className="font-mono text-foreground/70">{index.table}</span>
          <span className="truncate font-mono">
            ({index.columns.join(", ")})
          </span>
        </div>
      </div>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              className="shrink-0 rounded p-1 opacity-0 transition-opacity duration-150 hover:bg-muted active:scale-[0.97] group-hover:opacity-100"
              onClick={() =>
                onCopy(
                  `${index.isUnique ? "UNIQUE " : ""}INDEX "${index.name}" ON ${index.table}(${index.columns.join(", ")})`
                )
              }
              type="button"
            >
              <UiIcon className="size-3 text-muted-foreground" name="copy" />
            </button>
          }
        />
        <TooltipContent>Copy</TooltipContent>
      </Tooltip>
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
    <div className="group rounded-md px-2.5 py-2 transition-colors duration-150 ease-out hover:bg-muted/40">
      <div className="flex items-start gap-2">
        <UiIcon
          className={cn(
            "mt-0.5 size-3.5 shrink-0",
            trigger.enabled
              ? "text-muted-foreground/50"
              : "text-muted-foreground/30"
          )}
          name="zap"
        />
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium font-mono text-[13px]">
              {trigger.name}
            </span>
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
              {trigger.timing} {trigger.event}
            </span>
            {!trigger.enabled && (
              <span className="text-[10px] text-muted-foreground/60 italic">
                disabled
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span>on</span>
            <span className="font-mono text-foreground/70">
              {trigger.table}
            </span>
            {trigger.function_name && (
              <>
                <span>→</span>
                <span className="font-mono">{trigger.function_name}</span>
              </>
            )}
          </div>
        </div>
        {trigger.definition && (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  className="shrink-0 rounded p-1 opacity-0 transition-opacity duration-150 hover:bg-muted active:scale-[0.97] group-hover:opacity-100"
                  onClick={() =>
                    trigger.definition && onCopy(trigger.definition)
                  }
                  type="button"
                >
                  <UiIcon
                    className="size-3 text-muted-foreground"
                    name="copy"
                  />
                </button>
              }
            />
            <TooltipContent>Copy</TooltipContent>
          </Tooltip>
        )}
      </div>
      {trigger.definition && (
        <pre className="mt-1.5 ml-5.5 max-h-24 overflow-x-auto whitespace-pre-wrap break-all rounded bg-muted/30 px-2 py-1.5 font-mono text-[10px] text-muted-foreground/80">
          {trigger.definition}
        </pre>
      )}
    </div>
  );
}

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
      desc: "This schema doesn't contain any constraints",
      icon: (props) => <UiIcon name="key" {...props} />,
      title: "No constraints found",
    },
    enums: {
      desc: isUnsupported
        ? "SQLite does not have native enum types"
        : "This schema doesn't contain any enum types",
      icon: (props) => <UiIcon name="braces" {...props} />,
      title: isUnsupported ? "Not supported" : "No enums found",
    },
    functions: {
      desc: isUnsupported
        ? "SQLite user-defined functions are not introspectable"
        : "This schema doesn't contain any functions or procedures",
      icon: (props) => <UiIcon name="code" {...props} />,
      title: isUnsupported ? "Not supported" : "No functions found",
    },
    indexes: {
      desc: "This schema doesn't contain any indexes",
      icon: (props) => <UiIcon name="list-numbers" {...props} />,
      title: "No indexes found",
    },
    triggers: {
      desc: "This schema doesn't contain any triggers",
      icon: (props) => <UiIcon name="zap" {...props} />,
      title: "No triggers found",
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
  const constraintsQuery = useQuery(
    dbQueryOptions.schemaConstraints(
      connectionId,
      selectedSchema,
      activeTab === "constraints"
    )
  );

  const enumsQuery = useQuery(
    dbQueryOptions.schemaEnums(
      connectionId,
      selectedSchema,
      activeTab === "enums"
    )
  );

  const functionsQuery = useQuery(
    dbQueryOptions.schemaFunctions(
      connectionId,
      selectedSchema,
      activeTab === "functions"
    )
  );

  const indexesQuery = useQuery(
    dbQueryOptions.schemaIndexes(
      connectionId,
      selectedSchema,
      activeTab === "indexes"
    )
  );

  const triggersQuery = useQuery(
    dbQueryOptions.schemaTriggers(
      connectionId,
      selectedSchema,
      activeTab === "triggers"
    )
  );

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
    if (!needle) {
      return constraints;
    }
    return constraints.filter(
      (c) =>
        c.name.toLowerCase().includes(needle) ||
        c.table.toLowerCase().includes(needle) ||
        c.columns.some((col) => col.toLowerCase().includes(needle))
    );
  }, [constraints, needle]);

  const filteredEnums = useMemo(() => {
    if (!needle) {
      return enums;
    }
    return enums.filter(
      (e) =>
        e.name.toLowerCase().includes(needle) ||
        e.values.some((v) => v.toLowerCase().includes(needle))
    );
  }, [enums, needle]);

  const filteredFunctions = useMemo(() => {
    if (!needle) {
      return functions;
    }
    return functions.filter(
      (f) =>
        f.name.toLowerCase().includes(needle) ||
        (f.arguments?.toLowerCase().includes(needle) ?? false)
    );
  }, [functions, needle]);

  const filteredIndexes = useMemo(() => {
    if (!needle) {
      return indexes;
    }
    return indexes.filter(
      (i) =>
        i.name.toLowerCase().includes(needle) ||
        i.table.toLowerCase().includes(needle) ||
        i.columns.some((c) => c.toLowerCase().includes(needle))
    );
  }, [indexes, needle]);

  const filteredTriggers = useMemo(() => {
    if (!needle) {
      return triggers;
    }
    return triggers.filter(
      (t) =>
        t.name.toLowerCase().includes(needle) ||
        t.table.toLowerCase().includes(needle)
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
        !["INPUT", "TEXTAREA"].includes((e.target as HTMLElement)?.tagName)
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
      animate="visible"
      className="flex h-full flex-col overflow-hidden"
      custom={reducedMotion}
      initial="hidden"
      variants={containerVariants}
    >
      {/* ── Header ──────────────────────────────────────────── */}
      <motion.div
        className="shrink-0 space-y-3 px-5 pt-4 pb-3"
        variants={itemVariants(reducedMotion)}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <UiIcon className="size-4 text-muted-foreground" name="braces" />
            <h2 className="font-semibold text-sm">Definitions</h2>
          </div>
          <div className="flex items-center gap-2">
            {/* Schema selector */}
            {schemas.length > 1 && (
              <Select
                onValueChange={(v) => {
                  if (v) {
                    onSchemaChange(v);
                  }
                }}
                value={selectedSchema}
              >
                <SelectTrigger className="h-7 w-auto min-w-25 font-mono text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {schemas.map((s) => (
                    <SelectItem className="font-mono text-xs" key={s} value={s}>
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
          <UiIcon
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground/50"
            name="search"
          />
          <Input
            className="h-7 pl-8 text-xs"
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search definitions..."
            ref={searchInputRef}
            value={search}
          />
        </div>
      </motion.div>

      {/* ── Tabs ─────────────────────────────────────────────── */}
      <motion.div
        className="flex min-h-0 flex-1 flex-col px-5"
        variants={itemVariants(reducedMotion)}
      >
        <Tabs
          className="flex min-h-0 flex-1 flex-col"
          onValueChange={(v) => setActiveTab(v as DefinitionTab)}
          value={activeTab}
        >
          <TabsList className="w-full justify-start gap-0" variant="line">
            <TabsTrigger className="gap-1" value="constraints">
              <UiIcon className="size-3" name="key" />
              Constraints
              {constraints.length > 0 && (
                <Badge
                  className="h-4 min-w-4.5 px-1 font-mono text-[9px]"
                  variant="secondary"
                >
                  {constraints.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger className="gap-1" value="enums">
              <UiIcon className="size-3" name="braces" />
              Enums
              {enums.length > 0 && (
                <Badge
                  className="h-4 min-w-4.5 px-1 font-mono text-[9px]"
                  variant="secondary"
                >
                  {enums.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger className="gap-1" value="functions">
              <UiIcon className="size-3" name="code" />
              Functions
              {functions.length > 0 && (
                <Badge
                  className="h-4 min-w-4.5 px-1 font-mono text-[9px]"
                  variant="secondary"
                >
                  {functions.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger className="gap-1" value="indexes">
              <UiIcon className="size-3" name="list-numbers" />
              Indexes
              {indexes.length > 0 && (
                <Badge
                  className="h-4 min-w-4.5 px-1 font-mono text-[9px]"
                  variant="secondary"
                >
                  {indexes.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger className="gap-1" value="triggers">
              <UiIcon className="size-3" name="zap" />
              Triggers
              {triggers.length > 0 && (
                <Badge
                  className="h-4 min-w-4.5 px-1 font-mono text-[9px]"
                  variant="secondary"
                >
                  {triggers.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <div className="mt-2 min-h-0 flex-1 rounded-lg border border-border/50 bg-muted/10">
            {/* Constraints tab */}
            <TabsContent className="h-full" value="constraints">
              <ScrollArea className="h-full px-1 py-1">
                {isLoading ? (
                  <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
                    <UiIcon className="size-4 animate-spin" name="loader" />
                    <span className="text-sm">Loading constraints…</span>
                  </div>
                ) : filteredConstraints.length > 0 ? (
                  <div className="space-y-0.5 pb-4">
                    {filteredConstraints.map((c, i) => (
                      <ConstraintCard
                        constraint={c}
                        key={`${c.name}-${c.table}-${i}`}
                        onCopy={handleCopy}
                      />
                    ))}
                  </div>
                ) : (
                  <DefinitionEmptyState dbType={dbType} type="constraints" />
                )}
              </ScrollArea>
            </TabsContent>

            {/* Enums tab */}
            <TabsContent className="h-full" value="enums">
              <ScrollArea className="h-full px-1 py-1">
                {isLoading ? (
                  <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
                    <UiIcon className="size-4 animate-spin" name="loader" />
                    <span className="text-sm">Loading enums…</span>
                  </div>
                ) : filteredEnums.length > 0 ? (
                  <div className="space-y-0.5 pb-4">
                    {filteredEnums.map((e) => (
                      <EnumCard enumDef={e} key={e.name} onCopy={handleCopy} />
                    ))}
                  </div>
                ) : (
                  <DefinitionEmptyState dbType={dbType} type="enums" />
                )}
              </ScrollArea>
            </TabsContent>

            {/* Functions tab */}
            <TabsContent className="h-full" value="functions">
              <ScrollArea className="h-full px-1 py-1">
                {isLoading ? (
                  <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
                    <UiIcon className="size-4 animate-spin" name="loader" />
                    <span className="text-sm">Loading functions…</span>
                  </div>
                ) : filteredFunctions.length > 0 ? (
                  <div className="space-y-0.5 pb-4">
                    {filteredFunctions.map((fn, i) => (
                      <FunctionCard
                        fn={fn}
                        key={`${fn.name}-${fn.type}-${i}`}
                        onCopy={handleCopy}
                        reducedMotion={reducedMotion}
                      />
                    ))}
                  </div>
                ) : (
                  <DefinitionEmptyState dbType={dbType} type="functions" />
                )}
              </ScrollArea>
            </TabsContent>

            {/* Indexes tab */}
            <TabsContent className="h-full" value="indexes">
              <ScrollArea className="h-full px-1 py-1">
                {isLoading ? (
                  <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
                    <UiIcon className="size-4 animate-spin" name="loader" />
                    <span className="text-sm">Loading indexes…</span>
                  </div>
                ) : filteredIndexes.length > 0 ? (
                  <div className="space-y-0.5 pb-4">
                    {filteredIndexes.map((idx, i) => (
                      <IndexCard
                        index={idx}
                        key={`${idx.name}-${idx.table}-${i}`}
                        onCopy={handleCopy}
                      />
                    ))}
                  </div>
                ) : (
                  <DefinitionEmptyState dbType={dbType} type="indexes" />
                )}
              </ScrollArea>
            </TabsContent>

            {/* Triggers tab */}
            <TabsContent className="h-full" value="triggers">
              <ScrollArea className="h-full px-1 py-1">
                {isLoading ? (
                  <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
                    <UiIcon className="size-4 animate-spin" name="loader" />
                    <span className="text-sm">Loading triggers…</span>
                  </div>
                ) : filteredTriggers.length > 0 ? (
                  <div className="space-y-0.5 pb-4">
                    {filteredTriggers.map((t) => (
                      <TriggerCard
                        key={t.name}
                        onCopy={handleCopy}
                        trigger={t}
                      />
                    ))}
                  </div>
                ) : (
                  <DefinitionEmptyState dbType={dbType} type="triggers" />
                )}
              </ScrollArea>
            </TabsContent>
          </div>
        </Tabs>
      </motion.div>
    </motion.div>
  );
}
