import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/Icon";
import {
  createTableFromImport,
  exportSchemaIndexes,
  getSchemaSummary,
  importDryRun,
  importTableColumns,
  tableSaveChanges,
} from "@/features/database/hooks/db-actions";
import { applyColumnMapping, buildColumnMapping, getPreviewRows, inferColumnsFromRows, parseImportFile } from "@/features/database/utils/data-import";
import { buildExportFileName, serializeExport, serializeExportToXlsx, type ExportFormat } from "@/features/database/utils/data-export";
import {
  autoDetectGenerator,
  BASE_GENERATORS,
  chooseSeedStrategy,
  ColumnMeta,
  ColumnSeedConfig,
  generateRows,
  getGeneratorGroups,
  REFERENCE_GENERATOR,
  type GeneratorGroup,
} from "@/features/database/utils/data-seed";
import { ipc } from "@/ipc/manager";
import type { SchemaColumn, SchemaForeignKey, SchemaIndex } from "@/ipc/db/types";

interface BaseDialogProps {
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
  schema: string;
  defaultTableName: string;
  onSuccess: () => void;
}

export function ImportDataDialog({ isOpen, onClose, connectionId, schema, defaultTableName, onSuccess }: BaseDialogProps) {
  const [tableName, setTableName] = useState(defaultTableName);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [targetColumns, setTargetColumns] = useState<Array<{ name: string; dataType: string; isNullable: boolean }>>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createTableIfMissing, setCreateTableIfMissing] = useState(false);

  const mappedRows = useMemo(() => applyColumnMapping(rows, mapping), [rows, mapping]);
  const previewRows = useMemo(() => getPreviewRows(mappedRows), [mappedRows]);

  const loadTableColumns = async (nextTableName: string) => {
    try {
      const columns = await importTableColumns({ connectionId, schema, table: nextTableName });
      setTargetColumns(columns);
      const nextMapping = buildColumnMapping(headers, columns).mapping;
      setMapping(nextMapping);
    } catch {
      setTargetColumns([]);
      setMapping({});
    }
  };

  const handleFile = async (file: File | null) => {
    if (!file) return;
    const parsed = await parseImportFile(file);
    setFileName(file.name);
    setRows(parsed.rows);
    setHeaders(parsed.headers);

    try {
      const columns = await importTableColumns({ connectionId, schema, table: tableName.trim() });
      setTargetColumns(columns);
      setMapping(buildColumnMapping(parsed.headers, columns).mapping);
    } catch {
      const inferredColumns = inferColumnsFromRows(parsed.rows);
      setTargetColumns(inferredColumns);
      setMapping(
        Object.fromEntries(parsed.headers.map((header) => [header, header])) as Record<string, string | null>,
      );
      setCreateTableIfMissing(true);
    }
  };

  const handleImport = async () => {
    if (mappedRows.length === 0) return;
    const targetTable = tableName.trim();
    if (!targetTable) return;

    setIsSubmitting(true);
    const toastId = toast.loading("Validating import...");

    try {
      if (createTableIfMissing) {
        const inferredColumns = inferColumnsFromRows(mappedRows);
        await createTableFromImport({
          connectionId,
          schema,
          table: targetTable,
          columns: inferredColumns,
          ifNotExists: true,
        });
      }

      const selectedColumns = Object.values(mapping).filter((column): column is string => Boolean(column));
      const dryRun = await importDryRun({
        connectionId,
        schema,
        table: targetTable,
        columns: selectedColumns,
        rows: mappedRows,
      });

      if (dryRun.invalidRows > 0) {
        throw new Error(`Dry run blocked ${dryRun.invalidRows} rows. First error: ${dryRun.issues[0]?.message ?? "invalid row"}`);
      }

      const chunkSize = 500;
      for (let index = 0; index < mappedRows.length; index += chunkSize) {
        const chunk = mappedRows.slice(index, index + chunkSize);
        await tableSaveChanges({
          tableRef: { connectionId, schema, table: targetTable },
          inserts: chunk,
          updates: [],
          deletes: [],
        });
      }

      toast.success(`Import completed (${mappedRows.length} rows)`, { id: toastId });
      onSuccess();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Import failed", { id: toastId });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[840px]">
        <DialogHeader>
          <DialogTitle>Import Data (CSV/JSON/Excel)</DialogTitle>
          <DialogDescription>Map columns, validate with dry run, and import in batches.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Target table</Label>
              <Input
                value={tableName}
                onChange={(event) => {
                  const next = event.target.value;
                  setTableName(next);
                  if (next.trim()) void loadTableColumns(next.trim());
                }}
              />
            </div>
            <div className="space-y-1">
              <Label>Source file</Label>
              <Input
                type="file"
                accept=".csv,.json,.xlsx,.xls"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  void handleFile(file);
                }}
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded border p-2 text-xs">
            <span>{fileName || "No file selected"}</span>
            <span>{rows.length} rows</span>
          </div>

          <div className="space-y-2">
            <Label>Column mapping</Label>
            <div className="max-h-56 overflow-auto rounded border p-2 space-y-2">
              {headers.map((header) => (
                <div key={header} className="grid grid-cols-2 items-center gap-2 text-sm">
                  <span className="font-mono">{header}</span>
                  <Select
                    value={mapping[header] ?? "__none__"}
                    onValueChange={(value) => setMapping((current) => ({ ...current, [header]: value === "__none__" ? null : value }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Ignore column" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Ignore</SelectItem>
                      {targetColumns.map((column) => (
                        <SelectItem key={column.name} value={column.name}>
                          {column.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Preview ({previewRows.length})</Label>
            <pre className="max-h-48 overflow-auto rounded border bg-muted/50 p-2 text-xs">{JSON.stringify(previewRows, null, 2)}</pre>
          </div>

          <div className="flex items-center gap-2">
            <Switch checked={createTableIfMissing} onCheckedChange={setCreateTableIfMissing} />
            <span className="text-sm">Create table automatically if it does not exist</span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>Cancel</Button>
          <Button onClick={handleImport} disabled={isSubmitting || rows.length === 0}>
            {isSubmitting && <Icon name="loader" className="size-3.5 animate-spin" />}
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ExportDataDialog({ isOpen, onClose, connectionId, schema, defaultTableName }: Omit<BaseDialogProps, "onSuccess">) {
  const [scope, setScope] = useState<"table" | "schema">("table");
  const [tableName, setTableName] = useState(defaultTableName);
  const [format, setFormat] = useState<ExportFormat>("sql");
  const [includeSchema, setIncludeSchema] = useState(true);
  const [includeData, setIncludeData] = useState(true);
  const [includeIndexes, setIncludeIndexes] = useState(true);
  const [output, setOutput] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleExport = async () => {
    setIsLoading(true);
    const toastId = toast.loading("Generating export artifact...");

    try {
      const exportSchema = await ipc.client.db.exportSchemaDdl({ id: connectionId });
      const indexes = await exportSchemaIndexes({
        connectionId,
        schema,
        table: scope === "table" ? tableName : undefined,
      });

      const summary = await getSchemaSummary(connectionId);
      const scopedTables = summary.tables.filter((table) => table.schema === schema && (scope === "schema" || table.name === tableName));
      const data: Array<{ schema: string; table: string; columns: string[]; rows: Record<string, unknown>[] }> = [];

      if (includeData) {
        for (const table of scopedTables) {
          let offset = 0;
          const rows: Record<string, unknown>[] = [];
          let columns: string[] = [];
          let hasMore = true;

          while (hasMore) {
            const page = await ipc.client.db.exportTableData({
              connectionId,
              schema: table.schema,
              table: table.name,
              batchSize: 500,
              offset,
            });
            rows.push(...page.rows);
            columns = page.columns;
            hasMore = page.hasMore;
            offset += page.rows.length;
          }

          data.push({ schema: table.schema, table: table.name, columns, rows });
        }
      }

      const payload = {
        metadata: {
          scope,
          schema,
          table: scope === "table" ? tableName : undefined,
          generatedAt: new Date().toISOString(),
        },
        layers: {
          schema: includeSchema ? exportSchema.scripts.filter((script) => script.schema === schema) : [],
          indexes: includeIndexes ? indexes.scripts : [],
          data,
        },
      };

      const result = serializeExport(payload, format);
      setOutput(format === "xlsx" ? "[Binary XLSX output]" : result);
      const mimeType = format === "xlsx"
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : "text/plain;charset=utf-8";
      const blob = format === "xlsx"
        ? new Blob([serializeExportToXlsx(payload)], { type: mimeType })
        : new Blob([result], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = buildExportFileName(payload, format);
      anchor.click();
      URL.revokeObjectURL(url);
      toast.success("Export completed", { id: toastId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Export failed", { id: toastId });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[840px] max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Export data bundle</DialogTitle>
          <DialogDescription>Export schema, data, and indexes in a single operation.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 overflow-y-auto flex-1 min-h-0">
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label>Scope</Label>
              <Select value={scope} onValueChange={(value) => setScope(value as "table" | "schema")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="table">Table</SelectItem>
                  <SelectItem value="schema">Schema</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Table</Label>
              <Input value={tableName} onChange={(event) => setTableName(event.target.value)} disabled={scope === "schema"} />
            </div>
            <div className="space-y-1">
              <Label>Format</Label>
              <Select value={format} onValueChange={(value) => setFormat(value as ExportFormat)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sql">SQL</SelectItem>
                  <SelectItem value="csv">CSV</SelectItem>
                  <SelectItem value="json">JSON</SelectItem>
                  <SelectItem value="markdown">Markdown</SelectItem>
                  <SelectItem value="xlsx">Excel (XLSX)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 text-sm">
            <label className="flex items-center gap-2"><Switch checked={includeSchema} onCheckedChange={setIncludeSchema} /> Schema</label>
            <label className="flex items-center gap-2"><Switch checked={includeData} onCheckedChange={setIncludeData} /> Data</label>
            <label className="flex items-center gap-2"><Switch checked={includeIndexes} onCheckedChange={setIncludeIndexes} /> Indexes</label>
          </div>

          {output && <pre className="max-h-48 overflow-auto rounded border bg-muted/50 p-2 text-xs">{output.slice(0, 10000)}</pre>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={handleExport} disabled={isLoading}>
            {isLoading && <Icon name="loader" className="size-3.5 animate-spin" />}
            Export
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface SeedDataDialogExtraProps {
  tableColumns?: SchemaColumn[];
  tableForeignKeys?: SchemaForeignKey[];
  tableIndexes?: SchemaIndex[];
}

export function SeedDataDialog({
  isOpen,
  onClose,
  connectionId,
  schema,
  defaultTableName,
  onSuccess,
  tableColumns,
  tableForeignKeys,
  tableIndexes,
}: BaseDialogProps & SeedDataDialogExtraProps) {
  const [tableName, setTableName] = useState(defaultTableName);
  const [rowCount, setRowCount] = useState(100);
  const [seed, setSeed] = useState(42);
  const [preview, setPreview] = useState<Record<string, unknown>[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [columnConfigs, setColumnConfigs] = useState<Record<string, ColumnSeedConfig>>({});
  const [columns, setColumns] = useState<ColumnMeta[]>([]);

  const generatorGroups = useMemo(() => getGeneratorGroups(), []);
  const strategy = useMemo(() => chooseSeedStrategy(rowCount), [rowCount]);

  // Build ColumnMeta[] and auto-detect generators when table details change
  useEffect(() => {
    if (!isOpen || !tableColumns || tableColumns.length === 0) {
      setColumns([]);
      setColumnConfigs({});
      return;
    }

    const pkCols = new Set(
      (tableIndexes ?? []).filter((i) => i.is_primary).flatMap((i) => i.column_names),
    );
    const uniqueCols = new Set(
      (tableIndexes ?? []).filter((i) => i.is_unique && !i.is_primary).flatMap((i) => i.column_names),
    );

    const fkMap = new Map<string, SchemaForeignKey>();
    for (const fk of tableForeignKeys ?? []) {
      fkMap.set(fk.column_name, fk);
    }

    const metas: ColumnMeta[] = tableColumns.map((col) => {
      const fk = fkMap.get(col.name);
      return {
        name: col.name,
        dataType: col.data_type,
        udtName: col.udt_name,
        isNullable: col.is_nullable,
        columnDefault: col.column_default,
        isPrimaryKey: pkCols.has(col.name),
        isUnique: uniqueCols.has(col.name),
        foreignKey: fk
          ? {
              referencedSchema: fk.referenced_schema || schema,
              referencedTable: fk.referenced_table,
              referencedColumn: fk.referenced_column,
            }
          : undefined,
      };
    });

    setColumns(metas);

    // Auto-detect generator for each column
    const configs: Record<string, ColumnSeedConfig> = {};
    for (const meta of metas) {
      const generatorId = autoDetectGenerator(meta);
      configs[meta.name] = {
        generatorId,
        nullable: meta.isNullable && generatorId !== "__skip__" && generatorId !== "__null__",
      };
    }
    setColumnConfigs(configs);
  }, [isOpen, tableColumns, tableForeignKeys, tableIndexes, schema]);

  // Reset table name when dialog opens
  useEffect(() => {
    if (isOpen) {
      setTableName(defaultTableName);
      setPreview([]);
    }
  }, [isOpen, defaultTableName]);

  const handlePreview = async () => {
    // Fetch FK reference data for preview
    const referenceData = await fetchReferenceData();
    const rows = generateRows({
      columns,
      configs: columnConfigs,
      count: Math.min(rowCount, 20),
      referenceData,
      seed,
    });
    setPreview(rows);
  };

  const fetchReferenceData = async (): Promise<Record<string, unknown[]>> => {
    const data: Record<string, unknown[]> = {};
    for (const col of columns) {
      if (col.foreignKey && columnConfigs[col.name]?.generatorId === REFERENCE_GENERATOR) {
        try {
          const result = await ipc.client.db.tableFkLookup({
            tableRef: { connectionId, schema, table: tableName },
            column: col.name,
            query: "",
            page: 0,
            pageSize: 1000,
          });
          data[col.name] = result.options.map((opt) => opt.value);
        } catch {
          // If FK lookup fails, skip this column
        }
      }
    }
    return data;
  };

  const handleInsert = async () => {
    setIsSubmitting(true);
    const toastId = toast.loading(`Generating ${rowCount} rows...`);

    try {
      const referenceData = await fetchReferenceData();
      const generatedRows = generateRows({
        columns,
        configs: columnConfigs,
        count: rowCount,
        referenceData,
        seed,
      });

      toast.loading(`Inserting ${rowCount} rows (${strategy})...`, { id: toastId });
      const chunkSize = strategy === "client" ? 500 : 2000;
      for (let index = 0; index < generatedRows.length; index += chunkSize) {
        const chunk = generatedRows.slice(index, index + chunkSize);
        await tableSaveChanges({
          tableRef: { connectionId, schema, table: tableName },
          inserts: chunk,
          updates: [],
          deletes: [],
        });
      }
      toast.success("Seed completed", { id: toastId });
      onSuccess();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Seed failed", { id: toastId });
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateConfig = (columnName: string, patch: Partial<ColumnSeedConfig>) => {
    setColumnConfigs((prev) => ({
      ...prev,
      [columnName]: { ...prev[columnName], ...patch } as ColumnSeedConfig,
    }));
  };

  const hasColumns = columns.length > 0;

  if (!isOpen) return null;

  return (
    <div className="absolute top-0 right-0 bottom-0 w-[400px] border-l border-border bg-background flex flex-col z-30 shadow-lg">
      <div className="flex items-center justify-between p-3 border-b border-border">
        <div>
          <h3 className="text-sm font-medium">Seed data generator</h3>
          <p className="text-xs text-muted-foreground">
            {hasColumns
              ? `${columns.length} columns in ${tableName}`
              : "Faker rules per column"}
          </p>
        </div>
        <Button variant="ghost" size="icon-xs" onClick={onClose}>
          <Icon name="x" className="size-3.5" />
        </Button>
      </div>

      <div className="space-y-4 overflow-y-auto flex-1 min-h-0 p-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Table</Label>
            <Input value={tableName} onChange={(event) => setTableName(event.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Rows</Label>
            <Input type="number" value={rowCount} onChange={(event) => setRowCount(Number(event.target.value) || 0)} />
          </div>
        </div>
        <div className="space-y-1">
          <Label>Seed</Label>
          <Input type="number" value={seed} onChange={(event) => setSeed(Number(event.target.value) || 0)} />
        </div>

          {hasColumns ? (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label>Columns</Label>
                <span className="text-xs text-muted-foreground">{strategy} strategy</span>
              </div>
              <div className="space-y-2 overflow-y-auto pr-1">
                {columns.map((col) => {
                  const config = columnConfigs[col.name];
                  if (!config) return null;
                  return (
                    <SeedColumnRow
                      key={col.name}
                      column={col}
                      config={config}
                      generatorGroups={generatorGroups}
                      onChange={(patch) => updateConfig(col.name, patch)}
                    />
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Label>Manual rules</Label>
              {Object.entries(columnConfigs).map(([colName, config]) => (
                <div key={colName} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                  <Input
                    value={colName}
                    onChange={(event) => {
                      const newName = event.target.value;
                      setColumnConfigs((prev) => {
                        const next = { ...prev };
                        const old = next[colName];
                        delete next[colName];
                        if (newName && old) next[newName] = old;
                        return next;
                      });
                    }}
                    placeholder="column"
                  />
                  <Select
                    value={config.generatorId}
                    onValueChange={(value) => value && updateConfig(colName, { generatorId: value })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {generatorGroups.map((group) => (
                        <div key={group.value}>
                          <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">{group.value}</div>
                          {group.items.map((id) => (
                            <SelectItem key={id} value={id}>{BASE_GENERATORS[id]?.label ?? id}</SelectItem>
                          ))}
                        </div>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setColumnConfigs((prev) => {
                      const next = { ...prev };
                      delete next[colName];
                      return next;
                    })}
                  >
                    <Icon name="x" className="size-3.5" />
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                onClick={() => setColumnConfigs((prev) => ({
                  ...prev,
                  [""]: { generatorId: "lorem.sentence", nullable: false },
                }))}
              >
                Add rule
              </Button>
            </div>
          )}

          {preview.length > 0 && (
            <pre className="max-h-48 overflow-auto rounded border bg-muted/50 p-2 text-xs">
              {JSON.stringify(preview, null, 2)}
            </pre>
          )}
        </div>

      <div className="flex gap-2 p-3 border-t border-border">
        <Button variant="outline" className="flex-1" onClick={() => void handlePreview()}>Preview</Button>
        <Button className="flex-1" onClick={() => void handleInsert()} disabled={isSubmitting}>
          {isSubmitting && <Icon name="loader" className="size-3.5 animate-spin" />}
          Insert
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SeedColumnRow — per-column generator picker
// ---------------------------------------------------------------------------

function SeedColumnRow({
  column,
  config,
  generatorGroups,
  onChange,
}: {
  column: ColumnMeta;
  config: ColumnSeedConfig;
  generatorGroups: GeneratorGroup[];
  onChange: (patch: Partial<ColumnSeedConfig>) => void;
}) {
  const currentLabel = BASE_GENERATORS[config.generatorId]?.label ?? config.generatorId;

  return (
    <div className="rounded border p-2 space-y-2">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-sm font-medium truncate">{column.name}</span>
        <Badge variant="outline" className="text-[10px] px-1 py-0">{column.dataType}</Badge>
        {column.isPrimaryKey && <Badge variant="default" className="text-[10px] px-1 py-0">PK</Badge>}
        {column.isUnique && <Badge variant="secondary" className="text-[10px] px-1 py-0">UQ</Badge>}
        {column.foreignKey && (
          <Badge variant="secondary" className="text-[10px] px-1 py-0">
            FK → {column.foreignKey.referencedTable}.{column.foreignKey.referencedColumn}
          </Badge>
        )}
        {column.isNullable && <Badge variant="outline" className="text-[10px] px-1 py-0">NULL</Badge>}
        {column.columnDefault && (
          <Badge variant="outline" className="text-[10px] px-1 py-0 font-mono">
            = {column.columnDefault.slice(0, 30)}
          </Badge>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Select value={config.generatorId} onValueChange={(value) => value && onChange({ generatorId: value })}>
          <SelectTrigger className="flex-1">
            <SelectValue>{currentLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {generatorGroups.map((group) => (
              <div key={group.value}>
                <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">{group.value}</div>
                {group.items.map((id) => (
                  <SelectItem key={id} value={id}>{BASE_GENERATORS[id]?.label ?? id}</SelectItem>
                ))}
              </div>
            ))}
          </SelectContent>
        </Select>

        {column.isNullable && (
          <div className="flex items-center gap-1.5 shrink-0">
            <Label htmlFor={`nullable-${column.name}`} className="text-xs text-muted-foreground">NULL</Label>
            <Switch
              id={`nullable-${column.name}`}
              checked={config.nullable}
              onCheckedChange={(checked) => onChange({ nullable: checked })}
            />
          </div>
        )}
      </div>
    </div>
  );
}
