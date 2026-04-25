import { Copy, FileCode2, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CodeBlock, CodeBlockCode, CodeBlockGroup } from "@/components/ui/code-block";
import { getTableDetails } from "@/hooks/db-actions";
import {
  generateSchema,
  GENERATOR_COMPATIBILITY,
  FORMAT_LABELS,
  FORMAT_LANGUAGES,
  type GeneratorFormat,
} from "@/lib/generators";
import type { DatabaseType, SchemaTableDetails } from "@/ipc/db/types";

interface SchemaExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
  schema: string;
  tableName: string;
  dbType: DatabaseType;
  /** Pre-fetched table details from React Query cache, if available. */
  cachedDetails?: SchemaTableDetails | null;
}

const ALL_FORMATS: GeneratorFormat[] = ["sql", "ts", "zod", "kysely", "drizzle"];

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
  const availableFormats = useMemo(() => getAvailableFormats(dbType), [dbType]);
  const [selectedFormat, setSelectedFormat] = useState<GeneratorFormat>(availableFormats[0] ?? "sql");
  const [details, setDetails] = useState<SchemaTableDetails | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState(false);

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
        if (!cancelled) setDetails(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load schema");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => { cancelled = true; };
  }, [isOpen, connectionId, schema, tableName, cachedDetails]);

  // Reset format when dbType changes and current format is incompatible
  useEffect(() => {
    if (!availableFormats.includes(selectedFormat)) {
      setSelectedFormat(availableFormats[0] ?? "sql");
    }
  }, [availableFormats, selectedFormat]);

  // Generate code from table details
  const generatedCode = useMemo(() => {
    if (!details) return "";
    try {
      return generateSchema(selectedFormat, {
        table: tableName,
        schema,
        columns: details.columns,
        indexes: details.indexes,
        foreignKeys: details.foreign_keys,
        dialect: dbType,
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
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[720px] max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileCode2 className="size-4 text-muted-foreground" />
            Export Schema
          </DialogTitle>
          <DialogDescription>
            Generate code from{" "}
            <code className="font-mono text-foreground">{schema}.{tableName}</code>
          </DialogDescription>
        </DialogHeader>

        {/* Format selector */}
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-xs text-muted-foreground whitespace-nowrap">Format:</span>
          {availableFormats.length === 0 ? (
            <span className="text-xs text-muted-foreground italic">
              No export formats available for {dbType}
            </span>
          ) : (
          <Select
            value={selectedFormat}
            onValueChange={(v) => setSelectedFormat(v as GeneratorFormat)}
          >
            <SelectTrigger className="w-[180px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {availableFormats.map((format) => (
                <SelectItem key={format} value={format} className="text-xs">
                  {FORMAT_LABELS[format]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          )}
          {details && (
            <span className="text-[10px] text-muted-foreground ml-auto">
              {details.columns.length} columns · {details.indexes.length} indexes · {details.foreign_keys.length} FKs
            </span>
          )}
        </div>

        {/* Generated code */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">Loading schema...</span>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center py-12 text-destructive text-sm">
              {error}
            </div>
          ) : details ? (
            <ScrollArea className="h-full max-h-[55vh]">
              <CodeBlock className="border-0 bg-muted/30 rounded-lg">
                <CodeBlockGroup className="px-4 py-2 border-b border-border/40">
                  <span className="text-xs text-muted-foreground font-mono">
                    {FORMAT_LANGUAGES[selectedFormat]}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs gap-1.5"
                    onClick={() => { void handleCopy(); }}
                  >
                    <Copy className="size-3" />
                    {copyFeedback ? "Copied!" : "Copy"}
                  </Button>
                </CodeBlockGroup>
                <CodeBlockCode
                  code={generatedCode}
                  language={FORMAT_LANGUAGES[selectedFormat]}
                  className="[&>pre]:py-3"
                />
              </CodeBlock>
            </ScrollArea>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 shrink-0">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={() => { void handleCopy(); }} disabled={!generatedCode || isLoading}>
            {copyFeedback ? (
              <span className="text-emerald-500">Copied!</span>
            ) : (
              <>
                <Copy className="size-3.5" />
                Copy code
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
