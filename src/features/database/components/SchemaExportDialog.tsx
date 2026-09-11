import { useTheme } from "next-themes";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  CodeBlock,
  CodeBlockCode,
  CodeBlockGroup,
} from "@/components/ui/code-block";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/Icon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DatabaseType, SchemaTableDetails } from "@/ipc/db/types";
import {
  FORMAT_LABELS,
  FORMAT_LANGUAGES,
  GENERATOR_COMPATIBILITY,
  type GeneratorFormat,
  generateSchema,
} from "@/lib/generators";
import { getTableDetails } from "../hooks/db-actions";

interface SchemaExportDialogProps {
  /** Pre-fetched table details from React Query cache, if available. */
  cachedDetails?: SchemaTableDetails | null;
  connectionId: string;
  dbType: DatabaseType;
  isOpen: boolean;
  onClose: () => void;
  schema: string;
  tableName: string;
}

const ALL_FORMATS: GeneratorFormat[] = [
  "sql",
  "ts",
  "zod",
  "kysely",
  "drizzle",
  "prisma",
];

// Injection keyframes for the copy feedback animation
const copyFeedbackAnimationKeyframes = `@keyframes copyFeedbackPulse {
  from {
    opacity: 0;
    transform: scale(0.93);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}`;

function getAvailableFormats(dbType: DatabaseType): GeneratorFormat[] {
  return ALL_FORMATS.filter((f) => {
    const compatible = GENERATOR_COMPATIBILITY[f];
    return compatible?.includes(dbType) ?? false;
  });
}

export function SchemaExportDialog({
  isOpen,
  onClose,
  connectionId,
  schema,
  tableName,
  dbType,
  cachedDetails,
}: SchemaExportDialogProps) {
  const { resolvedTheme } = useTheme();
  const codeTheme = resolvedTheme === "dark" ? "github-dark" : "github-light";
  const availableFormats = useMemo(() => getAvailableFormats(dbType), [dbType]);
  const [selectedFormat, setSelectedFormat] = useState<GeneratorFormat>(
    availableFormats[0] ?? "sql"
  );
  const [details, setDetails] = useState<SchemaTableDetails | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState(false);

  // Inject keyframes for copy feedback animation
  useEffect(() => {
    const styleId = "copy-feedback-anim";
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = copyFeedbackAnimationKeyframes;
      document.head.appendChild(style);
    }
    return () => {
      const style = document.getElementById(styleId);
      if (style) {
        style.remove();
      }
    };
  }, []);

  // Fetch table details when dialog opens
  useEffect(() => {
    if (!isOpen) {
      setDetails(null);
      setError(null);
      setIsLoading(false);
      return;
    }
    if (cachedDetails) {
      setDetails(cachedDetails);
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    getTableDetails(connectionId, schema, tableName)
      .then((result) => {
        if (!cancelled) {
          setDetails(result);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load schema"
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, connectionId, schema, tableName, cachedDetails]);

  // Reset format when dbType changes and current format is incompatible
  useEffect(() => {
    if (!availableFormats.includes(selectedFormat)) {
      setSelectedFormat(availableFormats[0] ?? "sql");
    }
  }, [availableFormats, selectedFormat]);

  // Generate code from table details
  const generatedCode = useMemo(() => {
    if (!details) {
      return "";
    }
    try {
      return generateSchema(selectedFormat, {
        columns: details.columns,
        dialect: dbType,
        foreignKeys: details.foreign_keys,
        indexes: details.indexes,
        schema,
        table: tableName,
      });
    } catch (err) {
      return `// Error generating schema: ${err instanceof Error ? err.message : "Unknown error"}`;
    }
  }, [details, selectedFormat, tableName, schema, dbType]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(generatedCode);
      setCopyFeedback(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopyFeedback(false), 2000);
    } catch {
      toast.error("Failed to copy");
    }
  };

  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open={isOpen}>
      <DialogContent className="t-resize flex max-h-[80vh] flex-col overflow-hidden sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="size-4 text-muted-foreground" name="file-code" />
            Export Schema
          </DialogTitle>
          <DialogDescription>
            Generate code from{" "}
            <code className="font-mono text-foreground">
              {schema}.{tableName}
            </code>
          </DialogDescription>
        </DialogHeader>

        {/* Format selector */}
        <div className="flex shrink-0 items-center gap-3">
          <span className="whitespace-nowrap text-muted-foreground text-xs">
            Format:
          </span>
          {availableFormats.length === 0 ? (
            <span className="text-muted-foreground text-xs italic">
              No export formats available for {dbType}
            </span>
          ) : (
            <Select
              onValueChange={(v) => setSelectedFormat(v as GeneratorFormat)}
              value={selectedFormat}
            >
              <SelectTrigger className="h-8 w-[180px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableFormats.map((format) => (
                  <SelectItem className="text-xs" key={format} value={format}>
                    {FORMAT_LABELS[format]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {details && (
            <span className="ml-auto text-[10px] text-muted-foreground">
              {details.columns.length} columns · {details.indexes.length}{" "}
              indexes · {details.foreign_keys.length} FKs
            </span>
          )}
        </div>

        {/* Generated code */}
        <div className="min-h-0 flex-1 overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Icon
                className="size-5 animate-spin text-muted-foreground"
                name="loader"
              />
              <span className="ml-2 text-muted-foreground text-sm">
                Loading schema...
              </span>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center py-12 text-destructive text-sm">
              {error}
            </div>
          ) : details ? (
            <div className="h-[55vh] max-h-[55vh] min-h-0 overflow-hidden pr-1">
              <CodeBlock className="flex h-full min-h-0 flex-col rounded-lg border-0 bg-muted/30">
                <CodeBlockGroup className="shrink-0 border-border/40 border-b bg-muted/30 px-4 py-2">
                  <span className="font-mono text-muted-foreground text-xs">
                    {FORMAT_LANGUAGES[selectedFormat]}
                  </span>
                  <Button
                    className={`h-6 gap-1.5 px-2 text-xs transition-[background-color,color] duration-200 ease-out ${
                      copyFeedback
                        ? "bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/10 hover:text-emerald-500"
                        : ""
                    }`}
                    onClick={() => {
                      void handleCopy();
                    }}
                    size="sm"
                    variant="ghost"
                  >
                    {copyFeedback ? (
                      <span
                        className="flex items-center gap-1"
                        style={{
                          animation:
                            "copyFeedbackPulse 200ms cubic-bezier(0.23, 1, 0.32, 1)",
                        }}
                      >
                        <Icon className="size-3" name="check" />
                        Copied!
                      </span>
                    ) : (
                      <>
                        <Icon className="size-3" name="copy" />
                        Copy
                      </>
                    )}
                  </Button>
                </CodeBlockGroup>
                <div className="min-h-0 flex-1 overflow-auto">
                  <CodeBlockCode
                    className="[&>pre]:py-3"
                    code={generatedCode}
                    language={FORMAT_LANGUAGES[selectedFormat]}
                    theme={codeTheme}
                  />
                </div>
              </CodeBlock>
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 pt-2">
          <Button onClick={onClose} variant="outline">
            Close
          </Button>
          <Button
            className={`transition-[background-color,color,box-shadow] duration-200 ease-out ${
              copyFeedback
                ? "bg-emerald-500 text-white shadow-sm hover:bg-emerald-500/90 hover:text-white"
                : ""
            }`}
            disabled={!generatedCode || isLoading}
            onClick={() => {
              void handleCopy();
            }}
          >
            {copyFeedback ? (
              <span
                className="flex items-center gap-1.5"
                style={{
                  animation:
                    "copyFeedbackPulse 200ms cubic-bezier(0.23, 1, 0.32, 1)",
                }}
              >
                <Icon className="size-3.5" name="check" />
                Copied!
              </span>
            ) : (
              <>
                <Icon className="size-3.5" name="copy" />
                Copy code
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
