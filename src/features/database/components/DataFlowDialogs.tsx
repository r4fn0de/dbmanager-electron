import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/Icon";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  createTableFromImport,
  exportSchemaIndexes,
  getSchemaSummary,
  importDryRun,
  importTableColumns,
  tableSaveChanges,
} from "@/features/database/hooks/db-actions";
import {
  buildExportFileName,
  type ExportFormat,
  serializeExport,
  serializeExportToXlsx,
} from "@/features/database/utils/data-export";
import {
  applyColumnMapping,
  buildColumnMapping,
  getPreviewRows,
  inferColumnsFromRows,
  parseImportFile,
} from "@/features/database/utils/data-import";
import {
  autoDetectGenerator,
  BASE_GENERATORS,
  type ColumnMeta,
  type ColumnSeedConfig,
  chooseSeedStrategy,
  type GeneratorGroup,
  generateRows,
  getGeneratorGroups,
  REFERENCE_GENERATOR,
} from "@/features/database/utils/data-seed";
import type {
  SchemaColumn,
  SchemaForeignKey,
  SchemaIndex,
} from "@/ipc/db/types";
import { ipc } from "@/ipc/manager";

interface BaseDialogProps {
  connectionId: string;
  defaultTableName: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  schema: string;
}

export function ImportDataDialog({
  isOpen,
  onClose,
  connectionId,
  schema,
  defaultTableName,
  onSuccess,
}: BaseDialogProps) {
  const [tableName, setTableName] = useState(defaultTableName);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [targetColumns, setTargetColumns] = useState<
    Array<{ name: string; dataType: string; isNullable: boolean }>
  >([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createTableIfMissing, setCreateTableIfMissing] = useState(false);

  const mappedRows = useMemo(
    () => applyColumnMapping(rows, mapping),
    [rows, mapping]
  );
  const previewRows = useMemo(() => getPreviewRows(mappedRows), [mappedRows]);

  const loadTableColumns = async (nextTableName: string) => {
    try {
      const columns = await importTableColumns({
        connectionId,
        schema,
        table: nextTableName,
      });
      setTargetColumns(columns);
      const nextMapping = buildColumnMapping(headers, columns).mapping;
      setMapping(nextMapping);
    } catch {
      setTargetColumns([]);
      setMapping({});
    }
  };

  const handleFile = async (file: File | null) => {
    if (!file) {
      return;
    }
    const parsed = await parseImportFile(file);
    setFileName(file.name);
    setRows(parsed.rows);
    setHeaders(parsed.headers);

    try {
      const columns = await importTableColumns({
        connectionId,
        schema,
        table: tableName.trim(),
      });
      setTargetColumns(columns);
      setMapping(buildColumnMapping(parsed.headers, columns).mapping);
    } catch {
      const inferredColumns = inferColumnsFromRows(parsed.rows);
      setTargetColumns(inferredColumns);
      setMapping(
        Object.fromEntries(
          parsed.headers.map((header) => [header, header])
        ) as Record<string, string | null>
      );
      setCreateTableIfMissing(true);
    }
  };

  const handleImport = async () => {
    if (mappedRows.length === 0) {
      return;
    }
    const targetTable = tableName.trim();
    if (!targetTable) {
      return;
    }

    setIsSubmitting(true);
    const toastId = toast.loading("Validating import...");

    try {
      if (createTableIfMissing) {
        const inferredColumns = inferColumnsFromRows(mappedRows);
        await createTableFromImport({
          columns: inferredColumns,
          connectionId,
          ifNotExists: true,
          schema,
          table: targetTable,
        });
      }

      const selectedColumns = Object.values(mapping).filter(
        (column): column is string => Boolean(column)
      );
      const dryRun = await importDryRun({
        columns: selectedColumns,
        connectionId,
        rows: mappedRows,
        schema,
        table: targetTable,
      });

      if (dryRun.invalidRows > 0) {
        throw new Error(
          `Dry run blocked ${dryRun.invalidRows} rows. First error: ${dryRun.issues[0]?.message ?? "invalid row"}`
        );
      }

      const chunkSize = 500;
      for (let index = 0; index < mappedRows.length; index += chunkSize) {
        const chunk = mappedRows.slice(index, index + chunkSize);
        await tableSaveChanges({
          deletes: [],
          inserts: chunk,
          tableRef: { connectionId, schema, table: targetTable },
          updates: [],
        });
      }

      toast.success(`Import completed (${mappedRows.length} rows)`, {
        id: toastId,
      });
      onSuccess();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Import failed", {
        id: toastId,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open={isOpen}>
      <DialogContent className="sm:max-w-[840px]">
        <DialogHeader>
          <DialogTitle>Import Data (CSV/JSON/Excel)</DialogTitle>
          <DialogDescription>
            Map columns, validate with dry run, and import in batches.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Target table</Label>
              <Input
                onChange={(event) => {
                  const next = event.target.value;
                  setTableName(next);
                  if (next.trim()) {
                    void loadTableColumns(next.trim());
                  }
                }}
                value={tableName}
              />
            </div>
            <div className="space-y-1">
              <Label>Source file</Label>
              <Input
                accept=".csv,.json,.xlsx,.xls"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  void handleFile(file);
                }}
                type="file"
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded border p-2 text-xs">
            <span>{fileName || "No file selected"}</span>
            <span>{rows.length} rows</span>
          </div>

          <div className="space-y-2">
            <Label>Column mapping</Label>
            <div className="max-h-56 space-y-2 overflow-auto rounded border p-2">
              {headers.map((header) => (
                <div
                  className="grid grid-cols-2 items-center gap-2 text-sm"
                  key={header}
                >
                  <span className="font-mono">{header}</span>
                  <Select
                    onValueChange={(value) =>
                      setMapping((current) => ({
                        ...current,
                        [header]: value === "__none__" ? null : value,
                      }))
                    }
                    value={mapping[header] ?? "__none__"}
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
            <pre className="max-h-48 overflow-auto rounded border bg-muted/50 p-2 text-xs">
              {JSON.stringify(previewRows, null, 2)}
            </pre>
          </div>

          <div className="flex items-center gap-2">
            <Switch
              checked={createTableIfMissing}
              onCheckedChange={setCreateTableIfMissing}
            />
            <span className="text-sm">
              Create table automatically if it does not exist
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button disabled={isSubmitting} onClick={onClose} variant="outline">
            Cancel
          </Button>
          <Button
            disabled={isSubmitting || rows.length === 0}
            onClick={handleImport}
          >
            {isSubmitting && (
              <Icon className="size-3.5 animate-spin" name="loader" />
            )}
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ExportDataDialog({
  isOpen,
  onClose,
  connectionId,
  schema,
  defaultTableName,
}: Omit<BaseDialogProps, "onSuccess">) {
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
      const exportSchema = await ipc.client.db.exportSchemaDdl({
        id: connectionId,
      });
      const indexes = await exportSchemaIndexes({
        connectionId,
        schema,
        table: scope === "table" ? tableName : undefined,
      });

      const summary = await getSchemaSummary(connectionId);
      const scopedTables = summary.tables.filter(
        (table) =>
          table.schema === schema &&
          (scope === "schema" || table.name === tableName)
      );
      const data: Array<{
        schema: string;
        table: string;
        columns: string[];
        rows: Record<string, unknown>[];
      }> = [];

      if (includeData) {
        for (const table of scopedTables) {
          let offset = 0;
          const rows: Record<string, unknown>[] = [];
          let columns: string[] = [];
          let hasMore = true;

          while (hasMore) {
            const page = await ipc.client.db.exportTableData({
              batchSize: 500,
              connectionId,
              offset,
              schema: table.schema,
              table: table.name,
            });
            rows.push(...page.rows);
            columns = page.columns;
            hasMore = page.hasMore;
            offset += page.rows.length;
          }

          data.push({ columns, rows, schema: table.schema, table: table.name });
        }
      }

      const payload = {
        layers: {
          data,
          indexes: includeIndexes ? indexes.scripts : [],
          schema: includeSchema
            ? exportSchema.scripts.filter((script) => script.schema === schema)
            : [],
        },
        metadata: {
          generatedAt: new Date().toISOString(),
          schema,
          scope,
          table: scope === "table" ? tableName : undefined,
        },
      };

      const result = serializeExport(payload, format);
      setOutput(format === "xlsx" ? "[Binary XLSX output]" : result);
      const mimeType =
        format === "xlsx"
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : "text/plain;charset=utf-8";
      const blob =
        format === "xlsx"
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
      toast.error(error instanceof Error ? error.message : "Export failed", {
        id: toastId,
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open={isOpen}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-[840px]">
        <DialogHeader>
          <DialogTitle>Export data bundle</DialogTitle>
          <DialogDescription>
            Export schema, data, and indexes in a single operation.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label>Scope</Label>
              <Select
                onValueChange={(value) => setScope(value as "table" | "schema")}
                value={scope}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="table">Table</SelectItem>
                  <SelectItem value="schema">Schema</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Table</Label>
              <Input
                disabled={scope === "schema"}
                onChange={(event) => setTableName(event.target.value)}
                value={tableName}
              />
            </div>
            <div className="space-y-1">
              <Label>Format</Label>
              <Select
                onValueChange={(value) => setFormat(value as ExportFormat)}
                value={format}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
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
            <label className="flex items-center gap-2">
              <Switch
                checked={includeSchema}
                onCheckedChange={setIncludeSchema}
              />{" "}
              Schema
            </label>
            <label className="flex items-center gap-2">
              <Switch checked={includeData} onCheckedChange={setIncludeData} />{" "}
              Data
            </label>
            <label className="flex items-center gap-2">
              <Switch
                checked={includeIndexes}
                onCheckedChange={setIncludeIndexes}
              />{" "}
              Indexes
            </label>
          </div>

          {output && (
            <pre className="max-h-48 overflow-auto rounded border bg-muted/50 p-2 text-xs">
              {output.slice(0, 10_000)}
            </pre>
          )}
        </div>
        <DialogFooter>
          <Button onClick={onClose} variant="outline">
            Close
          </Button>
          <Button disabled={isLoading} onClick={handleExport}>
            {isLoading && (
              <Icon className="size-3.5 animate-spin" name="loader" />
            )}
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
  const [columnConfigs, setColumnConfigs] = useState<
    Record<string, ColumnSeedConfig>
  >({});
  const [columns, setColumns] = useState<ColumnMeta[]>([]);

  const generatorGroups = useMemo(() => getGeneratorGroups(), []);
  const strategy = useMemo(() => chooseSeedStrategy(rowCount), [rowCount]);

  // Build ColumnMeta[] and auto-detect generators when table details change
  useEffect(() => {
    if (!(isOpen && tableColumns) || tableColumns.length === 0) {
      setColumns([]);
      setColumnConfigs({});
      return;
    }

    const pkCols = new Set(
      (tableIndexes ?? [])
        .filter((i) => i.is_primary)
        .flatMap((i) => i.column_names)
    );
    const uniqueCols = new Set(
      (tableIndexes ?? [])
        .filter((i) => i.is_unique && !i.is_primary)
        .flatMap((i) => i.column_names)
    );

    const fkMap = new Map<string, SchemaForeignKey>();
    for (const fk of tableForeignKeys ?? []) {
      fkMap.set(fk.column_name, fk);
    }

    const metas: ColumnMeta[] = tableColumns.map((col) => {
      const fk = fkMap.get(col.name);
      return {
        columnDefault: col.column_default,
        dataType: col.data_type,
        foreignKey: fk
          ? {
              referencedColumn: fk.referenced_column,
              referencedSchema: fk.referenced_schema || schema,
              referencedTable: fk.referenced_table,
            }
          : undefined,
        isNullable: col.is_nullable,
        isPrimaryKey: pkCols.has(col.name),
        isUnique: uniqueCols.has(col.name),
        name: col.name,
        udtName: col.udt_name,
      };
    });

    setColumns(metas);

    // Auto-detect generator for each column
    const configs: Record<string, ColumnSeedConfig> = {};
    for (const meta of metas) {
      const generatorId = autoDetectGenerator(meta);
      configs[meta.name] = {
        generatorId,
        nullable:
          meta.isNullable &&
          generatorId !== "__skip__" &&
          generatorId !== "__null__",
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
      if (
        col.foreignKey &&
        columnConfigs[col.name]?.generatorId === REFERENCE_GENERATOR
      ) {
        try {
          const result = await ipc.client.db.tableFkLookup({
            column: col.name,
            page: 0,
            pageSize: 1000,
            query: "",
            tableRef: { connectionId, schema, table: tableName },
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

      toast.loading(`Inserting ${rowCount} rows (${strategy})...`, {
        id: toastId,
      });
      const chunkSize = strategy === "client" ? 500 : 2000;
      for (let index = 0; index < generatedRows.length; index += chunkSize) {
        const chunk = generatedRows.slice(index, index + chunkSize);
        await tableSaveChanges({
          deletes: [],
          inserts: chunk,
          tableRef: { connectionId, schema, table: tableName },
          updates: [],
        });
      }
      toast.success("Seed completed", { id: toastId });
      onSuccess();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Seed failed", {
        id: toastId,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateConfig = (
    columnName: string,
    patch: Partial<ColumnSeedConfig>
  ) => {
    setColumnConfigs((prev) => ({
      ...prev,
      [columnName]: { ...prev[columnName], ...patch } as ColumnSeedConfig,
    }));
  };

  const hasColumns = columns.length > 0;

  if (!isOpen) {
    return null;
  }

  return (
    <div className="absolute top-0 right-0 bottom-0 z-30 flex w-[400px] flex-col border-border border-l bg-background shadow-lg">
      <div className="flex items-center justify-between border-border border-b p-3">
        <div>
          <h3 className="font-medium text-sm">Seed data generator</h3>
          <p className="text-muted-foreground text-xs">
            {hasColumns
              ? `${columns.length} columns in ${tableName}`
              : "Faker rules per column"}
          </p>
        </div>
        <Button onClick={onClose} size="icon-xs" variant="ghost">
          <Icon className="size-3.5" name="x" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Table</Label>
            <Input
              onChange={(event) => setTableName(event.target.value)}
              value={tableName}
            />
          </div>
          <div className="space-y-1">
            <Label>Rows</Label>
            <Input
              onChange={(event) => setRowCount(Number(event.target.value) || 0)}
              type="number"
              value={rowCount}
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label>Seed</Label>
          <Input
            onChange={(event) => setSeed(Number(event.target.value) || 0)}
            type="number"
            value={seed}
          />
        </div>

        {hasColumns ? (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label>Columns</Label>
              <span className="text-muted-foreground text-xs">
                {strategy} strategy
              </span>
            </div>
            <div className="space-y-2 overflow-y-auto pr-1">
              {columns.map((col) => {
                const config = columnConfigs[col.name];
                if (!config) {
                  return null;
                }
                return (
                  <SeedColumnRow
                    column={col}
                    config={config}
                    generatorGroups={generatorGroups}
                    key={col.name}
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
              <div
                className="grid grid-cols-[1fr_1fr_auto] items-center gap-2"
                key={colName}
              >
                <Input
                  onChange={(event) => {
                    const newName = event.target.value;
                    setColumnConfigs((prev) => {
                      const next = { ...prev };
                      const old = next[colName];
                      delete next[colName];
                      if (newName && old) {
                        next[newName] = old;
                      }
                      return next;
                    });
                  }}
                  placeholder="column"
                  value={colName}
                />
                <Select
                  onValueChange={(value) =>
                    value && updateConfig(colName, { generatorId: value })
                  }
                  value={config.generatorId}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {generatorGroups.map((group) => (
                      <div key={group.value}>
                        <div className="px-2 py-1.5 font-semibold text-muted-foreground text-xs">
                          {group.value}
                        </div>
                        {group.items.map((id) => (
                          <SelectItem key={id} value={id}>
                            {BASE_GENERATORS[id]?.label ?? id}
                          </SelectItem>
                        ))}
                      </div>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  onClick={() =>
                    setColumnConfigs((prev) => {
                      const next = { ...prev };
                      delete next[colName];
                      return next;
                    })
                  }
                  size="icon"
                  variant="outline"
                >
                  <Icon className="size-3.5" name="x" />
                </Button>
              </div>
            ))}
            <Button
              onClick={() =>
                setColumnConfigs((prev) => ({
                  ...prev,
                  "": { generatorId: "lorem.sentence", nullable: false },
                }))
              }
              variant="outline"
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

      <div className="flex gap-2 border-border border-t p-3">
        <Button
          className="flex-1"
          onClick={() => void handlePreview()}
          variant="outline"
        >
          Preview
        </Button>
        <Button
          className="flex-1"
          disabled={isSubmitting}
          onClick={() => void handleInsert()}
        >
          {isSubmitting && (
            <Icon className="size-3.5 animate-spin" name="loader" />
          )}
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
  const currentLabel =
    BASE_GENERATORS[config.generatorId]?.label ?? config.generatorId;

  return (
    <div className="space-y-2 rounded border p-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="truncate font-medium text-sm">{column.name}</span>
        <Badge className="px-1 py-0 text-[10px]" variant="outline">
          {column.dataType}
        </Badge>
        {column.isPrimaryKey && (
          <Badge className="px-1 py-0 text-[10px]" variant="default">
            PK
          </Badge>
        )}
        {column.isUnique && (
          <Badge className="px-1 py-0 text-[10px]" variant="secondary">
            UQ
          </Badge>
        )}
        {column.foreignKey && (
          <Badge className="px-1 py-0 text-[10px]" variant="secondary">
            FK → {column.foreignKey.referencedTable}.
            {column.foreignKey.referencedColumn}
          </Badge>
        )}
        {column.isNullable && (
          <Badge className="px-1 py-0 text-[10px]" variant="outline">
            NULL
          </Badge>
        )}
        {column.columnDefault && (
          <Badge className="px-1 py-0 font-mono text-[10px]" variant="outline">
            = {column.columnDefault.slice(0, 30)}
          </Badge>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Select
          onValueChange={(value) => value && onChange({ generatorId: value })}
          value={config.generatorId}
        >
          <SelectTrigger className="flex-1">
            <SelectValue>{currentLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {generatorGroups.map((group) => (
              <div key={group.value}>
                <div className="px-2 py-1.5 font-semibold text-muted-foreground text-xs">
                  {group.value}
                </div>
                {group.items.map((id) => (
                  <SelectItem key={id} value={id}>
                    {BASE_GENERATORS[id]?.label ?? id}
                  </SelectItem>
                ))}
              </div>
            ))}
          </SelectContent>
        </Select>

        {column.isNullable && (
          <div className="flex shrink-0 items-center gap-1.5">
            <Label
              className="text-muted-foreground text-xs"
              htmlFor={`nullable-${column.name}`}
            >
              NULL
            </Label>
            <Switch
              checked={config.nullable}
              id={`nullable-${column.name}`}
              onCheckedChange={(checked) => onChange({ nullable: checked })}
            />
          </div>
        )}
      </div>
    </div>
  );
}
