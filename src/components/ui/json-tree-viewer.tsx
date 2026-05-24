import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/Icon";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface JsonTreeViewerProps {
  /** The raw JSON string or parsed value to display */
  value: unknown;
  /** If true, the tree starts fully collapsed */
  initiallyCollapsed?: boolean;
  /** Maximum depth to auto-expand (default: 2) */
  maxAutoExpandDepth?: number;
  /** Show the toggle between Tree and Text view */
  showViewToggle?: boolean;
  /** Callback when user edits a value in tree mode */
  onEdit?: (path: string, newValue: unknown) => void;
  /** Read-only mode */
  readOnly?: boolean;
  /** Height constraint */
  maxHeight?: string;
}

interface TreeNodeProps {
  keyName: string | null;
  value: unknown;
  path: string;
  depth: number;
  maxAutoExpandDepth: number;
  initiallyCollapsed: boolean;
  readOnly: boolean;
  onEdit?: (path: string, newValue: unknown) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatPrimitive(value: unknown): { text: string; color: string } {
  if (value === null) return { text: "null", color: "text-red-500" };
  if (typeof value === "boolean")
    return { text: value ? "true" : "false", color: "text-blue-500" };
  if (typeof value === "number")
    return { text: String(value), color: "text-emerald-500" };
  if (typeof value === "string") {
    // Truncate very long strings in the tree view
    if (value.length > 200) {
      return { text: `"${value.slice(0, 200)}…"`, color: "text-amber-600" };
    }
    return { text: `"${value}"`, color: "text-amber-600" };
  }
  return { text: String(value), color: "text-foreground" };
}

function getTypeLabel(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `Array(${value.length})`;
  if (typeof value === "object") return `Object(${Object.keys(value).length})`;
  return typeof value;
}

function countKeys(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object") return Object.keys(value).length;
  return 0;
}

function escapePathSegment(segment: string): string {
  if (/^\d+$/.test(segment)) return segment;
  if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(segment)) return segment;
  return JSON.stringify(segment);
}

// ---------------------------------------------------------------------------
// TreeNode Component
// ---------------------------------------------------------------------------

function TreeNode({
  keyName,
  value,
  path,
  depth,
  maxAutoExpandDepth,
  initiallyCollapsed,
  readOnly,
  onEdit,
}: TreeNodeProps) {
  const isObject = value !== null && typeof value === "object";
  const isArray = Array.isArray(value);
  const isExpandable = isObject;

  const shouldAutoExpand = depth < maxAutoExpandDepth && !initiallyCollapsed;
  const [collapsed, setCollapsed] = useState(!shouldAutoExpand);

  const toggle = useCallback(() => setCollapsed((c) => !c), []);

  const entries = useMemo(() => {
    if (!isObject) return [];
    if (isArray) {
      return (value as unknown[]).map((item, index) => [String(index), item] as const);
    }
    return Object.entries(value as Record<string, unknown>);
  }, [value, isObject, isArray]);

  // Copy value to clipboard
  const handleCopy = useCallback(() => {
    const text = isObject ? JSON.stringify(value, null, 2) : String(value);
    navigator.clipboard.writeText(text).catch(() => {});
  }, [value, isObject]);

  // Copy path to clipboard
  const handleCopyPath = useCallback(() => {
    navigator.clipboard.writeText(path).catch(() => {});
  }, [path]);

  if (!isExpandable) {
    const { text, color } = formatPrimitive(value);
    return (
      <div className="group flex items-start gap-0.5 py-[1px]">
        <span className="mr-1 shrink-0 w-4" />
        {keyName !== null && (
          <span className="shrink-0 text-[11px] text-violet-600 dark:text-violet-400">
            {escapePathSegment(keyName)}
            <span className="text-muted-foreground">: </span>
          </span>
        )}
        <span className={`break-all font-mono text-[11px] leading-4 ${color}`}>
          {text}
        </span>
        <button
          type="button"
          onClick={handleCopyPath}
          className="ml-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
          title="Copy path"
        >
          <Icon name="copy" className="h-3 w-3 text-muted-foreground" />
        </button>
      </div>
    );
  }

  const label = isArray ? "Array" : "Object";
  const count = countKeys(value);
  const isEmpty = count === 0;

  return (
    <div>
      <div className="group flex items-center gap-0.5 py-[1px]">
        <button
          type="button"
          onClick={toggle}
          className="shrink-0 w-4 h-4 flex items-center justify-center rounded hover:bg-muted transition-colors"
          aria-label={collapsed ? "Expand" : "Collapse"}
        >
          <Icon
            name="chevron-right"
            className={`h-3 w-3 transition-transform ${collapsed ? "" : "rotate-90"}`}
          />
        </button>
        {keyName !== null && (
          <span className="shrink-0 text-[11px] text-violet-600 dark:text-violet-400">
            {escapePathSegment(keyName)}
            <span className="text-muted-foreground">: </span>
          </span>
        )}
        {isEmpty ? (
          <span className="font-mono text-[11px] text-muted-foreground italic">
            {label} (empty)
          </span>
        ) : collapsed ? (
          <span className="font-mono text-[11px] text-muted-foreground">
            {label}({count})
          </span>
        ) : (
          <span className="font-mono text-[11px] text-muted-foreground">{label}</span>
        )}
        {!isEmpty && collapsed && (
          <span className="ml-1 text-[10px] text-muted-foreground/50">
            {isArray ? "[" : "{"}…{isArray ? "]" : "}"}
          </span>
        )}
        <button
          type="button"
          onClick={handleCopy}
          className="ml-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
          title="Copy value"
        >
          <Icon name="copy" className="h-3 w-3 text-muted-foreground" />
        </button>
      </div>
      {!collapsed && !isEmpty && (
        <div className="ml-3 border-l border-border/40 pl-2">
          {entries.map(([key, val]) => (
            <TreeNode
              key={key}
              keyName={key}
              value={val}
              path={path ? `${path}.${escapePathSegment(key)}` : escapePathSegment(key)}
              depth={depth + 1}
              maxAutoExpandDepth={maxAutoExpandDepth}
              initiallyCollapsed={initiallyCollapsed}
              readOnly={readOnly}
              onEdit={onEdit}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root Component
// ---------------------------------------------------------------------------

export function JsonTreeViewer({
  value,
  initiallyCollapsed = false,
  maxAutoExpandDepth = 2,
  showViewToggle = true,
  onEdit,
  readOnly = false,
  maxHeight = "400px",
}: JsonTreeViewerProps) {
  const [viewMode, setViewMode] = useState<"tree" | "text">("tree");
  const [expandedAll, setExpandedAll] = useState(false);

  // Parse the value if it's a string
  const parsed = useMemo(() => {
    if (typeof value === "string") {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
    return value;
  }, [value]);

  const isExpandable = parsed !== null && typeof parsed === "object";

  // Formatted text view
  const textContent = useMemo(() => {
    if (typeof parsed === "string") return parsed;
    try {
      return JSON.stringify(parsed, null, 2);
    } catch {
      return String(parsed);
    }
  }, [parsed]);

  const handleCopyAll = useCallback(() => {
    navigator.clipboard.writeText(textContent).catch(() => {});
  }, [textContent]);

  const handleExpandAll = useCallback(() => {
    setExpandedAll((e) => !e);
  }, []);

  return (
    <div className="flex flex-col overflow-hidden rounded-md border bg-background">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-2 py-1.5">
        <div className="flex items-center gap-1">
          {showViewToggle && (
            <div className="flex rounded-md border bg-background p-0.5">
              <button
                type="button"
                onClick={() => setViewMode("tree")}
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                  viewMode === "tree"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Tree
              </button>
              <button
                type="button"
                onClick={() => setViewMode("text")}
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                  viewMode === "text"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Text
              </button>
            </div>
          )}
          {viewMode === "tree" && isExpandable && (
            <button
              type="button"
              onClick={handleExpandAll}
              className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <Icon
                name={expandedAll ? "minimize" : "maximize"}
                className="mr-1 inline-block h-3 w-3 align-text-bottom"
              />
              {expandedAll ? "Collapse all" : "Expand all"}
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleCopyAll}
            className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Copy all"
          >
            <Icon name="copy" className="mr-1 inline-block h-3 w-3 align-text-bottom" />
            Copy
          </button>
        </div>
      </div>

      {/* Content */}
      <div
        className="overflow-auto p-2"
        style={{ maxHeight }}
      >
        {viewMode === "tree" && isExpandable ? (
          <TreeNode
            keyName={null}
            value={parsed}
            path=""
            depth={0}
            maxAutoExpandDepth={expandedAll ? Infinity : maxAutoExpandDepth}
            initiallyCollapsed={initiallyCollapsed}
            readOnly={readOnly}
            onEdit={onEdit}
          />
        ) : (
          <pre className="m-0 font-mono text-[11px] leading-5 whitespace-pre-wrap break-all">
            {textContent}
          </pre>
        )}
      </div>

      {/* Footer summary */}
      {viewMode === "text" && (
        <div className="border-t bg-muted/20 px-2 py-1 text-[10px] text-muted-foreground">
          {isExpandable
            ? `${Array.isArray(parsed) ? "Array" : "Object"} — ${countKeys(parsed)} keys`
            : typeof parsed}
        </div>
      )}
    </div>
  );
}
