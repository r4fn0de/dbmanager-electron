import { useEffect, useId, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/Icon";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { buildCreateTableSql, qi, qt } from "@/ipc/db/ddl-sql";
import type {
  AddColumnInput,
  AlterColumnTypeInput,
  ColumnDefinition,
  CreateIndexInput,
  CreateSchemaInput,
  CreateTableInput,
  DatabaseType,
  DdlResult,
  DropColumnInput,
  DropTableInput,
  RenameColumnInput,
  RenameTableInput,
  SaveChangesInput,
  SaveChangesResponse,
  SchemaTableDetails,
  SetColumnDefaultInput,
  SetColumnNullableInput,
} from "@/ipc/db/types";
import { getTableDetails } from "../hooks/db-actions";

// ============================================================
// Data types per database engine
// ============================================================

const TYPES_BY_ENGINE: Record<string, string[]> = {
  clickhouse: [
    "String",
    "FixedString(16)",
    "UInt8",
    "UInt16",
    "UInt32",
    "UInt64",
    "Int8",
    "Int16",
    "Int32",
    "Int64",
    "Float32",
    "Float64",
    "Boolean",
    "Date",
    "DateTime",
    "DateTime64(3)",
    "UUID",
    "Nullable(String)",
    "Array(String)",
    "Map(String, UInt64)",
  ],
  mariadb: [
    "varchar(255)",
    "char(1)",
    "text",
    "mediumtext",
    "longtext",
    "int",
    "bigint",
    "smallint",
    "tinyint",
    "boolean",
    "datetime",
    "timestamp",
    "date",
    "time",
    "json",
    "decimal(10,2)",
    "float",
    "double",
    "blob",
    "binary(16)",
    "enum('a','b')",
  ],
  mysql: [
    "varchar(255)",
    "char(1)",
    "text",
    "mediumtext",
    "longtext",
    "int",
    "bigint",
    "smallint",
    "tinyint",
    "boolean",
    "datetime",
    "timestamp",
    "date",
    "time",
    "json",
    "decimal(10,2)",
    "float",
    "double",
    "blob",
    "binary(16)",
    "enum('a','b')",
  ],
  postgresql: [
    "text",
    "varchar(255)",
    "char(1)",
    "integer",
    "bigint",
    "smallint",
    "serial",
    "bigserial",
    "boolean",
    "uuid",
    "timestamp",
    "timestamptz",
    "date",
    "time",
    "jsonb",
    "json",
    "numeric(10,2)",
    "real",
    "double precision",
    "bytea",
    "inet",
    "cidr",
    "macaddr",
    "point",
  ],
  sqlite: [
    "TEXT",
    "INTEGER",
    "REAL",
    "BLOB",
    "NUMERIC",
    "BOOLEAN",
    "VARCHAR(255)",
    "DATETIME",
    "DATE",
  ],
};

function getTypesForEngine(dbType: string): string[] {
  return TYPES_BY_ENGINE[dbType] ?? TYPES_BY_ENGINE.postgresql;
}

function getDefaultIdColumn(dbType: string): ColumnRow {
  if (dbType === "mysql" || dbType === "mariadb") {
    return {
      dataType: "int",
      defaultExpr: "AUTO_INCREMENT",
      id: "init-0",
      isNullable: false,
      isUnique: false,
      name: "id",
      references: "",
    };
  }
  if (dbType === "clickhouse") {
    return {
      dataType: "UUID",
      defaultExpr: "generateUUIDv4()",
      id: "init-0",
      isNullable: false,
      isUnique: false,
      name: "id",
      references: "",
    };
  }
  if (dbType === "sqlite") {
    return {
      dataType: "INTEGER",
      defaultExpr: "",
      id: "init-0",
      isNullable: false,
      isUnique: false,
      name: "id",
      references: "",
    };
  }
  return {
    dataType: "uuid",
    defaultExpr: "gen_random_uuid()",
    id: "init-0",
    isNullable: false,
    isUnique: false,
    name: "id",
    references: "",
  };
}

// ============================================================
// Create Table Dialog
// ============================================================

interface SchemaTableSummary {
  columns: Array<{ name: string; type: string }>;
  name: string;
  schema: string;
}

interface CreateTableDialogProps {
  connectionId: string;
  createTable: (input: CreateTableInput) => Promise<DdlResult>;
  dbType: DatabaseType;
  existingTables: SchemaTableSummary[];
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  schema: string;
}

interface ColumnRow {
  dataType: string;
  defaultExpr: string;
  id: string;
  isNullable: boolean;
  isUnique: boolean;
  name: string;
  references: string;
}

function emptyColumn(id: string, dbType: string): ColumnRow {
  const defaultType = getTypesForEngine(dbType)[0] ?? "text";
  return {
    dataType: defaultType,
    defaultExpr: "",
    id,
    isNullable: true,
    isUnique: false,
    name: "",
    references: "",
  };
}

export function CreateTableDialog({
  isOpen,
  onClose,
  connectionId,
  schema,
  dbType,
  existingTables,
  createTable,
  onSuccess,
}: CreateTableDialogProps) {
  const baseId = useId();
  const [tableName, setTableName] = useState("");
  const [ifNotExists, setIfNotExists] = useState(false);
  const [primaryKeyColumns, setPrimaryKeyColumns] = useState<string[]>(["id"]);
  const [columns, setColumns] = useState<ColumnRow[]>(() => [
    getDefaultIdColumn(dbType),
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const engineTypes = useMemo(() => getTypesForEngine(dbType), [dbType]);

  // Build FK reference options from existing tables
  const fkOptions = useMemo(() => {
    const options: Array<{ value: string; label: string }> = [];
    for (const table of existingTables) {
      for (const col of table.columns) {
        const ref = `${qi(dbType, table.schema)}.${qi(dbType, table.name)}(${qi(dbType, col.name)})`;
        options.push({
          label: `${table.schema}.${table.name}(${col.name})`,
          value: ref,
        });
      }
    }
    return options;
  }, [existingTables, dbType]);

  const isValid = useMemo(() => {
    if (!tableName.trim()) {
      return false;
    }
    if (columns.length === 0) {
      return false;
    }
    if (primaryKeyColumns.length === 0) {
      return false;
    }
    const names = columns.map((c) => c.name.trim());
    const hasEmpty = names.some((n) => !n);
    const hasDupes = new Set(names).size !== names.length;
    if (hasEmpty || hasDupes) {
      return false;
    }
    return columns.every((c) => c.dataType.trim());
  }, [tableName, columns, primaryKeyColumns]);

  // SQL Preview
  const sqlPreview = useMemo(() => {
    if (!tableName.trim() || columns.length === 0) {
      return "";
    }
    const validCols = columns.filter((c) => c.name.trim() && c.dataType.trim());
    if (validCols.length === 0) {
      return "";
    }
    return buildCreateTableSql(
      dbType,
      schema,
      tableName.trim(),
      validCols.map((c) => ({
        dataType: c.dataType.trim(),
        defaultExpr: c.defaultExpr.trim() || undefined,
        isNullable: c.isNullable,
        isUnique: c.isUnique,
        name: c.name.trim(),
        references: c.references.trim() || undefined,
      })),
      primaryKeyColumns,
      ifNotExists
    );
  }, [dbType, schema, tableName, columns, primaryKeyColumns, ifNotExists]);

  const addColumn = () => {
    setColumns((prev) => [
      ...prev,
      emptyColumn(`${baseId}-${prev.length}`, dbType),
    ]);
  };

  const updateColumn = (id: string, patch: Partial<ColumnRow>) => {
    setColumns((prev) =>
      prev.map((col) => (col.id === id ? { ...col, ...patch } : col))
    );
  };

  const removeColumn = (id: string) => {
    setColumns((prev) => {
      const removed = prev.find((c) => c.id === id);
      const next = prev.filter((col) => col.id !== id);
      // Also remove from PK if present
      if (removed) {
        setPrimaryKeyColumns((pk) =>
          pk.filter((c) => c !== removed.name.trim())
        );
      }
      return next;
    });
  };

  const togglePk = (colName: string) => {
    setPrimaryKeyColumns((prev) => {
      if (prev.includes(colName)) {
        return prev.filter((c) => c !== colName);
      }
      return [...prev, colName];
    });
  };

  const handleSubmit = async () => {
    if (!isValid) {
      return;
    }
    setIsSubmitting(true);
    const toastId = toast.loading("Creating table...");
    try {
      const columnDefs: ColumnDefinition[] = columns.map((c) => ({
        dataType: c.dataType.trim(),
        defaultExpr: c.defaultExpr.trim() || undefined,
        isNullable: c.isNullable,
        isPrimaryKey: primaryKeyColumns.includes(c.name.trim()),
        isUnique: c.isUnique,
        name: c.name.trim(),
        references: c.references.trim() || undefined,
      }));
      const result = await createTable({
        columns: columnDefs,
        connectionId,
        ifNotExists,
        name: tableName.trim(),
        primaryKeyColumns,
        schema,
      });
      toast.success("Table created", {
        description: result.sql,
        id: toastId,
      });
      onSuccess();
      onClose();
      // Reset
      setTableName("");
      setIfNotExists(false);
      setPrimaryKeyColumns(["id"]);
      setColumns([getDefaultIdColumn(dbType)]);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to create table",
        { id: toastId }
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen) {
      setTableName("");
      setIfNotExists(false);
      setPrimaryKeyColumns(["id"]);
      setColumns([getDefaultIdColumn(dbType)]);
    }
  }, [isOpen, dbType]);

  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open={isOpen}>
      <DialogContent className="t-resize flex max-h-[85vh] flex-col overflow-hidden sm:max-w-[820px]">
        <DialogHeader>
          <DialogTitle>Create table</DialogTitle>
          <DialogDescription>
            Creates a new table in{" "}
            <code className="font-mono text-foreground">{schema}</code>.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-auto px-0.5">
          <div className="space-y-1.5">
            <Label className="text-muted-foreground text-xs">Table name</Label>
            <div className="flex items-center gap-3">
              <Input
                className="flex-1"
                onChange={(e) => setTableName(e.target.value)}
                placeholder="users"
                value={tableName}
              />
              <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-muted-foreground text-xs">
                <Switch
                  checked={ifNotExists}
                  onCheckedChange={setIfNotExists}
                  size="sm"
                />
                IF NOT EXISTS
              </label>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-muted-foreground text-xs">Columns</Label>
              <Button
                onClick={addColumn}
                size="sm"
                type="button"
                variant="outline"
              >
                <Icon className="h-3 w-3" name="plus" />
                Add column
              </Button>
            </div>

            {/* Column header */}
            <div className="grid grid-cols-[1fr_1fr_50px_50px_1fr_1fr_32px] items-center gap-1.5 px-0.5 text-[10px] text-muted-foreground">
              <span>Name</span>
              <span>Type</span>
              <span className="text-center">Null</span>
              <span className="text-center">PK</span>
              <span>Default</span>
              <span>References</span>
              <span />
            </div>

            {columns.map((col) => {
              const isPk = primaryKeyColumns.includes(col.name.trim());
              return (
                <div
                  className="grid grid-cols-[1fr_1fr_50px_50px_1fr_1fr_32px] items-center gap-1.5"
                  key={col.id}
                >
                  <Input
                    className="h-8 text-xs"
                    onChange={(e) =>
                      updateColumn(col.id, { name: e.target.value })
                    }
                    placeholder="column_name"
                    value={col.name}
                  />
                  <Select
                    onValueChange={(v) =>
                      updateColumn(col.id, { dataType: v ?? col.dataType })
                    }
                    value={col.dataType}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {engineTypes.map((t) => (
                        <SelectItem className="text-xs" key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex justify-center">
                    <Switch
                      checked={col.isNullable}
                      onCheckedChange={(v) =>
                        updateColumn(col.id, { isNullable: v })
                      }
                      size="sm"
                    />
                  </div>
                  <div className="flex justify-center">
                    <Switch
                      checked={isPk}
                      onCheckedChange={() => {
                        const name = col.name.trim();
                        if (!name) {
                          return;
                        }
                        togglePk(name);
                        // PK implies NOT NULL
                        if (!isPk) {
                          updateColumn(col.id, { isNullable: false });
                        }
                      }}
                      size="sm"
                    />
                  </div>
                  <Input
                    className="h-8 font-mono text-xs"
                    onChange={(e) =>
                      updateColumn(col.id, { defaultExpr: e.target.value })
                    }
                    placeholder="DEFAULT"
                    value={col.defaultExpr}
                  />
                  <Select
                    onValueChange={(v) =>
                      updateColumn(col.id, {
                        references: v === "__none__" ? "" : (v ?? ""),
                      })
                    }
                    value={col.references || "__none__"}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="—" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem
                        className="text-muted-foreground text-xs"
                        value="__none__"
                      >
                        — none —
                      </SelectItem>
                      {fkOptions.map((opt) => (
                        <SelectItem
                          className="text-xs"
                          key={opt.value}
                          value={opt.value}
                        >
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    className="h-8 w-8"
                    disabled={columns.length <= 1}
                    onClick={() => removeColumn(col.id)}
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <Icon
                      className="h-3 w-3 text-muted-foreground"
                      name="trash"
                    />
                  </Button>
                </div>
              );
            })}
          </div>

          {/* Composite PK indicator */}
          {primaryKeyColumns.length > 1 && (
            <div className="flex items-center gap-1.5 rounded bg-muted/50 px-2 py-1 text-muted-foreground text-xs">
              <Icon className="h-3 w-3" name="key" />
              Composite PK:{" "}
              {primaryKeyColumns.map((c) => (
                <Badge
                  className="px-1 py-0 text-[10px]"
                  key={c}
                  variant="secondary"
                >
                  {c}
                </Badge>
              ))}
            </div>
          )}

          {/* SQL Preview */}
          {sqlPreview && (
            <div className="space-y-1.5">
              <Label className="text-muted-foreground text-xs">
                SQL Preview
              </Label>
              <CodeBlock className="max-h-40 overflow-auto">
                <CodeBlockCode code={sqlPreview} />
              </CodeBlock>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 pt-2">
          <Button disabled={isSubmitting} onClick={onClose} variant="outline">
            Cancel
          </Button>
          <Button disabled={!isValid || isSubmitting} onClick={handleSubmit}>
            {isSubmitting && (
              <Icon className="h-3.5 w-3.5 animate-spin" name="loader" />
            )}
            Create table
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Drop Table Dialog
// ============================================================

interface DropTableDialogProps {
  connectionId: string;
  dropTable: (input: DropTableInput) => Promise<DdlResult>;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  schema: string;
  tableName: string;
}

export function DropTableDialog({
  isOpen,
  onClose,
  connectionId,
  schema,
  tableName,
  dropTable,
  onSuccess,
}: DropTableDialogProps) {
  const [cascade, setCascade] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleDrop = async () => {
    setIsSubmitting(true);
    const toastId = toast.loading("Dropping table...");
    try {
      const result = await dropTable({
        cascade,
        connectionId,
        name: tableName,
        schema,
      });
      toast.success("Table dropped", {
        description: result.sql,
        id: toastId,
      });
      onSuccess();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to drop table", {
        id: toastId,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AlertDialog
      onOpenChange={(open) => !(isSubmitting || open) && onClose()}
      open={isOpen}
    >
      <AlertDialogContent className="t-resize">
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-destructive/10 text-destructive">
            <Icon name="alert-triangle" />
          </AlertDialogMedia>
          <AlertDialogTitle>
            Drop table{" "}
            <code className="font-mono">
              {schema}.{tableName}
            </code>
            ?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete the table and all its data. This action
            cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <label className="flex cursor-pointer items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs">
          <input
            checked={cascade}
            className="mt-0.5"
            onChange={(e) => setCascade(e.target.checked)}
            type="checkbox"
          />
          <span>
            <span className="font-medium text-foreground">CASCADE</span>
            <span className="block text-muted-foreground">
              Also drop objects that depend on this table (views, foreign keys,
              etc.).
            </span>
          </span>
        </label>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isSubmitting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={isSubmitting}
            onClick={handleDrop}
            variant="destructive"
          >
            {isSubmitting ? (
              <Icon className="h-3.5 w-3.5 animate-spin" name="loader" />
            ) : (
              <Icon className="h-3.5 w-3.5" name="trash" />
            )}
            Drop table
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ============================================================
// Rename Table Dialog
// ============================================================

interface RenameTableDialogProps {
  connectionId: string;
  currentName: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  renameTable: (input: RenameTableInput) => Promise<DdlResult>;
  schema: string;
}

export function RenameTableDialog({
  isOpen,
  onClose,
  connectionId,
  schema,
  currentName,
  renameTable,
  onSuccess,
}: RenameTableDialogProps) {
  const [newName, setNewName] = useState(currentName);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isValid = newName.trim() && newName.trim() !== currentName;

  const handleSubmit = async () => {
    if (!isValid) {
      return;
    }
    setIsSubmitting(true);
    const toastId = toast.loading("Renaming table...");
    try {
      const result = await renameTable({
        connectionId,
        newName: newName.trim(),
        oldName: currentName,
        schema,
      });
      toast.success("Table renamed", {
        description: result.sql,
        id: toastId,
      });
      onSuccess();
      onClose();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to rename table",
        { id: toastId }
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open={isOpen}>
      <DialogContent className="t-resize sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Rename table</DialogTitle>
          <DialogDescription>
            Rename{" "}
            <code className="font-mono text-foreground">
              {schema}.{currentName}
            </code>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5 py-2">
          <Label className="text-muted-foreground text-xs">New name</Label>
          <Input
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            value={newName}
          />
        </div>

        <DialogFooter className="gap-2">
          <Button disabled={isSubmitting} onClick={onClose} variant="outline">
            Cancel
          </Button>
          <Button disabled={!isValid || isSubmitting} onClick={handleSubmit}>
            {isSubmitting && (
              <Icon className="h-3.5 w-3.5 animate-spin" name="loader" />
            )}
            Rename
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Add Column Dialog
// ============================================================

interface AddColumnDialogProps {
  addColumn: (input: AddColumnInput) => Promise<DdlResult>;
  connectionId: string;
  dbType: DatabaseType;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  schema: string;
  tableName: string;
}

export function AddColumnDialog({
  isOpen,
  onClose,
  connectionId,
  schema,
  tableName,
  dbType,
  addColumn,
  onSuccess,
}: AddColumnDialogProps) {
  const [name, setName] = useState("");
  const [dataType, setDataType] = useState("text");
  const [isNullable, setIsNullable] = useState(true);
  const [isUnique, setIsUnique] = useState(false);
  const [defaultExpr, setDefaultExpr] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isValid = name.trim() && dataType.trim();

  const handleSubmit = async () => {
    if (!isValid) {
      return;
    }
    setIsSubmitting(true);
    const toastId = toast.loading("Adding column...");
    try {
      const result = await addColumn({
        column: {
          dataType: dataType.trim(),
          defaultExpr: defaultExpr.trim() || undefined,
          isNullable,
          isUnique,
          name: name.trim(),
        },
        connectionId,
        schema,
        table: tableName,
      });
      toast.success("Column added", {
        description: result.sql,
        id: toastId,
      });
      onSuccess();
      onClose();
      // Reset
      setName("");
      setDataType("text");
      setIsNullable(true);
      setIsUnique(false);
      setDefaultExpr("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add column", {
        id: toastId,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open={isOpen}>
      <DialogContent className="t-resize sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Add column</DialogTitle>
          <DialogDescription>
            Add a new column to{" "}
            <code className="font-mono text-foreground">
              {schema}.{tableName}
            </code>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label className="text-muted-foreground text-xs">Column name</Label>
            <Input
              onChange={(e) => setName(e.target.value)}
              placeholder="column_name"
              value={name}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-muted-foreground text-xs">Data type</Label>
            <Select onValueChange={(v) => v && setDataType(v)} value={dataType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {getTypesForEngine(dbType).map((t: string) => (
                  <SelectItem className="text-xs" key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between rounded-md border p-2.5">
            <span className="text-xs">Nullable</span>
            <Switch
              checked={isNullable}
              onCheckedChange={setIsNullable}
              size="sm"
            />
          </div>

          <div className="flex items-center justify-between rounded-md border p-2.5">
            <span className="text-xs">Unique</span>
            <Switch
              checked={isUnique}
              onCheckedChange={setIsUnique}
              size="sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-muted-foreground text-xs">
              Default expression{" "}
              <Badge className="ml-1 text-[9px]" variant="secondary">
                optional
              </Badge>
            </Label>
            <Input
              className="font-mono text-xs"
              onChange={(e) => setDefaultExpr(e.target.value)}
              placeholder="now(), 0, 'default'"
              value={defaultExpr}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button disabled={isSubmitting} onClick={onClose} variant="outline">
            Cancel
          </Button>
          <Button disabled={!isValid || isSubmitting} onClick={handleSubmit}>
            {isSubmitting && (
              <Icon className="h-3.5 w-3.5 animate-spin" name="loader" />
            )}
            Add column
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Drop Column Dialog
// ============================================================

interface DropColumnDialogProps {
  columnName: string;
  connectionId: string;
  dropColumn: (input: DropColumnInput) => Promise<DdlResult>;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  schema: string;
  tableName: string;
}

export function DropColumnDialog({
  isOpen,
  onClose,
  connectionId,
  schema,
  tableName,
  columnName,
  dropColumn,
  onSuccess,
}: DropColumnDialogProps) {
  const [cascade, setCascade] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleDrop = async () => {
    setIsSubmitting(true);
    const toastId = toast.loading("Dropping column...");
    try {
      const result = await dropColumn({
        cascade,
        column: columnName,
        connectionId,
        schema,
        table: tableName,
      });
      toast.success("Column dropped", {
        description: result.sql,
        id: toastId,
      });
      onSuccess();
      onClose();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to drop column",
        { id: toastId }
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AlertDialog
      onOpenChange={(open) => !(isSubmitting || open) && onClose()}
      open={isOpen}
    >
      <AlertDialogContent className="t-resize">
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-destructive/10 text-destructive">
            <Icon name="alert-triangle" />
          </AlertDialogMedia>
          <AlertDialogTitle>
            Drop column <code className="font-mono">{columnName}</code>?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently remove the column from{" "}
            <code className="font-mono">
              {schema}.{tableName}
            </code>
            . All data in this column will be lost.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <label className="flex cursor-pointer items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs">
          <input
            checked={cascade}
            className="mt-0.5"
            onChange={(e) => setCascade(e.target.checked)}
            type="checkbox"
          />
          <span>
            <span className="font-medium text-foreground">CASCADE</span>
            <span className="block text-muted-foreground">
              Also drop objects that depend on this column.
            </span>
          </span>
        </label>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isSubmitting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={isSubmitting}
            onClick={handleDrop}
            variant="destructive"
          >
            {isSubmitting ? (
              <Icon className="h-3.5 w-3.5 animate-spin" name="loader" />
            ) : (
              <Icon className="h-3.5 w-3.5" name="trash" />
            )}
            Drop column
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ============================================================
// Create Schema Dialog
// ============================================================

interface CreateSchemaDialogProps {
  connectionId: string;
  createSchema: (input: CreateSchemaInput) => Promise<DdlResult>;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function CreateSchemaDialog({
  isOpen,
  onClose,
  connectionId,
  createSchema,
  onSuccess,
}: CreateSchemaDialogProps) {
  const [schemaName, setSchemaName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isValid = schemaName.trim().length > 0;

  const handleSubmit = async () => {
    if (!isValid) {
      return;
    }
    setIsSubmitting(true);
    const toastId = toast.loading("Creating schema...");
    try {
      const result = await createSchema({
        connectionId,
        ifNotExists: true,
        name: schemaName.trim(),
      });
      toast.success("Schema created", { description: result.sql, id: toastId });
      onSuccess();
      onClose();
      setSchemaName("");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to create schema",
        {
          id: toastId,
        }
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open={isOpen}>
      <DialogContent className="t-resize sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Create schema</DialogTitle>
          <DialogDescription>
            Creates a new PostgreSQL schema in this connection.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5 py-2">
          <Label className="text-muted-foreground text-xs">Schema name</Label>
          <Input
            onChange={(e) => setSchemaName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            placeholder="analytics"
            value={schemaName}
          />
        </div>

        <DialogFooter className="gap-2">
          <Button disabled={isSubmitting} onClick={onClose} variant="outline">
            Cancel
          </Button>
          <Button disabled={!isValid || isSubmitting} onClick={handleSubmit}>
            {isSubmitting && (
              <Icon className="h-3.5 w-3.5 animate-spin" name="loader" />
            )}
            <Icon className="h-3.5 w-3.5" name="database" />
            Create schema
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Create Index Dialog
// ============================================================

interface CreateIndexDialogProps {
  connectionId: string;
  createIndex: (input: CreateIndexInput) => Promise<DdlResult>;
  defaultTableName: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  schema: string;
}

export function CreateIndexDialog({
  isOpen,
  onClose,
  connectionId,
  schema,
  defaultTableName,
  createIndex,
  onSuccess,
}: CreateIndexDialogProps) {
  const [tableName, setTableName] = useState(defaultTableName);
  const [indexName, setIndexName] = useState("");
  const [columnsRaw, setColumnsRaw] = useState("");
  const [isUnique, setIsUnique] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const columns = useMemo(
    () =>
      columnsRaw
        .split(",")
        .map((col) => col.trim())
        .filter(Boolean),
    [columnsRaw]
  );
  const isValid = tableName.trim().length > 0 && columns.length > 0;

  const handleSubmit = async () => {
    if (!isValid) {
      return;
    }
    setIsSubmitting(true);
    const toastId = toast.loading("Creating index...");
    try {
      const result = await createIndex({
        columns,
        connectionId,
        ifNotExists: true,
        name: indexName.trim() || undefined,
        schema,
        table: tableName.trim(),
        unique: isUnique,
      });
      toast.success("Index created", { description: result.sql, id: toastId });
      onSuccess();
      onClose();
      setIndexName("");
      setColumnsRaw("");
      setIsUnique(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to create index",
        {
          id: toastId,
        }
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open={isOpen}>
      <DialogContent className="t-resize sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Create index</DialogTitle>
          <DialogDescription>
            Creates an index in{" "}
            <code className="font-mono text-foreground">{schema}</code>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label className="text-muted-foreground text-xs">Table</Label>
            <Input
              onChange={(e) => setTableName(e.target.value)}
              placeholder="users"
              value={tableName}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-muted-foreground text-xs">
              Index name (optional)
            </Label>
            <Input
              onChange={(e) => setIndexName(e.target.value)}
              placeholder="users_email_idx"
              value={indexName}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-muted-foreground text-xs">
              Columns (comma separated)
            </Label>
            <Input
              onChange={(e) => setColumnsRaw(e.target.value)}
              placeholder="email, created_at"
              value={columnsRaw}
            />
          </div>
          <div className="flex items-center justify-between rounded-md border p-2.5">
            <span className="text-xs">Unique index</span>
            <Switch
              checked={isUnique}
              onCheckedChange={setIsUnique}
              size="sm"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button disabled={isSubmitting} onClick={onClose} variant="outline">
            Cancel
          </Button>
          <Button disabled={!isValid || isSubmitting} onClick={handleSubmit}>
            {isSubmitting && (
              <Icon className="h-3.5 w-3.5 animate-spin" name="loader" />
            )}
            <Icon className="h-3.5 w-3.5" name="wand" />
            Create index
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Import CSV Dialog
// ============================================================

interface ImportCsvDialogProps {
  connectionId: string;
  defaultTableName: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  schema: string;
  tableSaveChanges: (input: SaveChangesInput) => Promise<SaveChangesResponse>;
}

interface CsvParseResult {
  headers: string[];
  rows: Record<string, unknown>[];
}

function parseCsvText(input: string): CsvParseResult {
  const rows: string[][] = [];
  let current = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    const next = input[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && ch === ",") {
      row.push(current);
      current = "";
      continue;
    }

    if (!inQuotes && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && next === "\n") {
        i += 1;
      }
      row.push(current);
      current = "";
      if (row.some((value) => value.length > 0)) {
        rows.push(row);
      }
      row = [];
      continue;
    }

    current += ch;
  }

  if (current.length > 0 || row.length > 0) {
    row.push(current);
    if (row.some((value) => value.length > 0)) {
      rows.push(row);
    }
  }

  if (rows.length === 0) {
    throw new Error("CSV is empty");
  }

  const headers = rows[0].map((h) => h.trim());
  if (headers.some((h) => h.length === 0)) {
    throw new Error("CSV header contains empty column names");
  }

  const objects: Record<string, unknown>[] = [];
  for (let r = 1; r < rows.length; r += 1) {
    const dataRow = rows[r];
    const obj: Record<string, unknown> = {};
    for (let c = 0; c < headers.length; c += 1) {
      const raw = dataRow[c] ?? "";
      obj[headers[c]] = raw === "" ? null : raw;
    }
    objects.push(obj);
  }

  return { headers, rows: objects };
}

export function ImportCsvDialog({
  isOpen,
  onClose,
  connectionId,
  schema,
  defaultTableName,
  tableSaveChanges,
  onSuccess,
}: ImportCsvDialogProps) {
  const [tableName, setTableName] = useState(defaultTableName);
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<CsvParseResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleFile = async (file: File | null) => {
    if (!file) {
      return;
    }
    const text = await file.text();
    const parsedCsv = parseCsvText(text);
    setFileName(file.name);
    setParsed(parsedCsv);
  };

  const isValid =
    tableName.trim().length > 0 && parsed && parsed.rows.length > 0;

  const handleImport = async () => {
    if (!(isValid && parsed)) {
      return;
    }
    setIsSubmitting(true);
    const toastId = toast.loading("Importing CSV...");
    try {
      const chunkSize = 500;
      for (let i = 0; i < parsed.rows.length; i += chunkSize) {
        const chunk = parsed.rows.slice(i, i + chunkSize);
        await tableSaveChanges({
          deletes: [],
          inserts: chunk,
          tableRef: {
            connectionId,
            schema,
            table: tableName.trim(),
          },
          updates: [],
        });
      }

      toast.success(`Imported ${parsed.rows.length} rows`, {
        description: `${fileName} → ${schema}.${tableName.trim()}`,
        id: toastId,
      });
      onSuccess();
      onClose();
      setFileName("");
      setParsed(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "CSV import failed", {
        id: toastId,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open={isOpen}>
      <DialogContent className="t-resize sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Import CSV</DialogTitle>
          <DialogDescription>
            Imports rows into{" "}
            <code className="font-mono text-foreground">{schema}</code>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label className="text-muted-foreground text-xs">
              Target table
            </Label>
            <Input
              onChange={(e) => setTableName(e.target.value)}
              placeholder="users"
              value={tableName}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-muted-foreground text-xs">CSV file</Label>
            <Input
              accept=".csv,text/csv"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                void handleFile(file);
              }}
              type="file"
            />
          </div>

          {parsed && (
            <div className="space-y-1 rounded-md border p-2.5 text-xs">
              <p>
                <strong>File:</strong> {fileName}
              </p>
              <p>
                <strong>Columns:</strong> {parsed.headers.join(", ")}
              </p>
              <p>
                <strong>Rows:</strong> {parsed.rows.length}
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button disabled={isSubmitting} onClick={onClose} variant="outline">
            Cancel
          </Button>
          <Button disabled={!isValid || isSubmitting} onClick={handleImport}>
            {isSubmitting && (
              <Icon className="h-3.5 w-3.5 animate-spin" name="loader" />
            )}
            <Icon className="h-3.5 w-3.5" name="upload" />
            Import CSV
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Rename Column Dialog
// ============================================================

interface RenameColumnDialogProps {
  connectionId: string;
  currentName: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  renameColumn: (input: RenameColumnInput) => Promise<DdlResult>;
  schema: string;
  tableName: string;
}

export function RenameColumnDialog({
  isOpen,
  onClose,
  connectionId,
  schema,
  tableName,
  currentName,
  renameColumn,
  onSuccess,
}: RenameColumnDialogProps) {
  const [newName, setNewName] = useState(currentName);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isValid = newName.trim().length > 0 && newName.trim() !== currentName;

  const handleSubmit = async () => {
    if (!isValid) {
      return;
    }
    setIsSubmitting(true);
    const toastId = toast.loading("Renaming column...");
    try {
      const result = await renameColumn({
        connectionId,
        newName: newName.trim(),
        oldName: currentName,
        schema,
        table: tableName,
      });
      toast.success("Column renamed", { description: result.sql, id: toastId });
      onSuccess();
      onClose();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to rename column",
        {
          id: toastId,
        }
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open={isOpen}>
      <DialogContent className="t-resize sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Rename column</DialogTitle>
          <DialogDescription>
            Rename{" "}
            <code className="font-mono text-foreground">{currentName}</code> in
            <code className="font-mono text-foreground">
              {" "}
              {schema}.{tableName}
            </code>
            .
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5 py-2">
          <Label className="text-muted-foreground text-xs">
            New column name
          </Label>
          <Input
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            value={newName}
          />
        </div>
        <DialogFooter className="gap-2">
          <Button disabled={isSubmitting} onClick={onClose} variant="outline">
            Cancel
          </Button>
          <Button disabled={!isValid || isSubmitting} onClick={handleSubmit}>
            {isSubmitting && (
              <Icon className="h-3.5 w-3.5 animate-spin" name="loader" />
            )}
            Rename column
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Alter Column Type Dialog
// ============================================================

interface AlterColumnTypeDialogProps {
  alterColumnType: (input: AlterColumnTypeInput) => Promise<DdlResult>;
  columnName: string;
  connectionId: string;
  currentType: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  schema: string;
  tableName: string;
}

export function AlterColumnTypeDialog({
  isOpen,
  onClose,
  connectionId,
  schema,
  tableName,
  columnName,
  currentType,
  alterColumnType,
  onSuccess,
}: AlterColumnTypeDialogProps) {
  const [newType, setNewType] = useState(currentType);
  const [usingExpr, setUsingExpr] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isValid = newType.trim().length > 0 && newType.trim() !== currentType;

  const handleSubmit = async () => {
    if (!isValid) {
      return;
    }
    setIsSubmitting(true);
    const toastId = toast.loading("Altering column type...");
    try {
      const result = await alterColumnType({
        column: columnName,
        connectionId,
        newType: newType.trim(),
        schema,
        table: tableName,
        usingExpr: usingExpr.trim() || undefined,
      });
      toast.success("Column type updated", {
        description: result.sql,
        id: toastId,
      });
      onSuccess();
      onClose();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to alter column type",
        { id: toastId }
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open={isOpen}>
      <DialogContent className="t-resize sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Alter column type</DialogTitle>
          <DialogDescription>
            Change type of{" "}
            <code className="font-mono text-foreground">{columnName}</code>
            in{" "}
            <code className="font-mono text-foreground">
              {" "}
              {schema}.{tableName}
            </code>
            .
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label className="text-muted-foreground text-xs">New type</Label>
            <Input
              onChange={(e) => setNewType(e.target.value)}
              placeholder="text, integer, varchar(255), jsonb..."
              value={newType}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-muted-foreground text-xs">
              USING expression (optional)
            </Label>
            <Input
              className="font-mono text-xs"
              onChange={(e) => setUsingExpr(e.target.value)}
              placeholder='"column_name"::text'
              value={usingExpr}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button disabled={isSubmitting} onClick={onClose} variant="outline">
            Cancel
          </Button>
          <Button disabled={!isValid || isSubmitting} onClick={handleSubmit}>
            {isSubmitting && (
              <Icon className="h-3.5 w-3.5 animate-spin" name="loader" />
            )}
            Save type
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Set Column Default Dialog
// ============================================================

interface SetColumnDefaultDialogProps {
  columnName: string;
  connectionId: string;
  currentDefault: string | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  schema: string;
  setColumnDefault: (input: SetColumnDefaultInput) => Promise<DdlResult>;
  tableName: string;
}

export function SetColumnDefaultDialog({
  isOpen,
  onClose,
  connectionId,
  schema,
  tableName,
  columnName,
  currentDefault,
  setColumnDefault,
  onSuccess,
}: SetColumnDefaultDialogProps) {
  const [defaultExpr, setDefaultExpr] = useState(currentDefault ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSave = async (clear: boolean) => {
    setIsSubmitting(true);
    const toastId = toast.loading(
      clear ? "Dropping default..." : "Setting default..."
    );
    try {
      const result = await setColumnDefault({
        column: columnName,
        connectionId,
        defaultExpr: clear ? undefined : defaultExpr.trim() || undefined,
        schema,
        table: tableName,
      });
      toast.success(clear ? "Default removed" : "Default updated", {
        description: result.sql,
        id: toastId,
      });
      onSuccess();
      onClose();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update default",
        {
          id: toastId,
        }
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open={isOpen}>
      <DialogContent className="t-resize sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Set column default</DialogTitle>
          <DialogDescription>
            Configure default for{" "}
            <code className="font-mono text-foreground">{columnName}</code>
            in{" "}
            <code className="font-mono text-foreground">
              {" "}
              {schema}.{tableName}
            </code>
            .
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5 py-2">
          <Label className="text-muted-foreground text-xs">
            Default expression
          </Label>
          <Input
            className="font-mono text-xs"
            onChange={(e) => setDefaultExpr(e.target.value)}
            placeholder="now(), gen_random_uuid(), 'active', 0"
            value={defaultExpr}
          />
        </div>

        <DialogFooter className="gap-2">
          <Button disabled={isSubmitting} onClick={onClose} variant="outline">
            Cancel
          </Button>
          <Button
            disabled={isSubmitting}
            onClick={() => {
              void handleSave(true);
            }}
            variant="outline"
          >
            Clear default
          </Button>
          <Button
            disabled={isSubmitting || defaultExpr.trim().length === 0}
            onClick={() => {
              void handleSave(false);
            }}
          >
            {isSubmitting && (
              <Icon className="h-3.5 w-3.5 animate-spin" name="loader" />
            )}
            Save default
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Set Column Nullable Dialog
// ============================================================

interface SetColumnNullableDialogProps {
  columnName: string;
  connectionId: string;
  isCurrentlyNullable: boolean;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  schema: string;
  setColumnNullable: (input: SetColumnNullableInput) => Promise<DdlResult>;
  tableName: string;
}

export function SetColumnNullableDialog({
  isOpen,
  onClose,
  connectionId,
  schema,
  tableName,
  columnName,
  isCurrentlyNullable,
  setColumnNullable,
  onSuccess,
}: SetColumnNullableDialogProps) {
  const [isNullable, setIsNullable] = useState(isCurrentlyNullable);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    setIsSubmitting(true);
    const toastId = toast.loading("Updating nullable constraint...");
    try {
      const result = await setColumnNullable({
        column: columnName,
        connectionId,
        isNullable,
        schema,
        table: tableName,
      });
      toast.success("Nullable constraint updated", {
        description: result.sql,
        id: toastId,
      });
      onSuccess();
      onClose();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to set nullable",
        {
          id: toastId,
        }
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open={isOpen}>
      <DialogContent className="t-resize sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Set nullable</DialogTitle>
          <DialogDescription>
            Toggle NULL/NOT NULL for{" "}
            <code className="font-mono text-foreground">{columnName}</code> in
            <code className="font-mono text-foreground">
              {" "}
              {schema}.{tableName}
            </code>
            .
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <div className="flex items-center justify-between rounded-md border p-3">
            <span className="text-sm">Allow NULL values</span>
            <Switch checked={isNullable} onCheckedChange={setIsNullable} />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button disabled={isSubmitting} onClick={onClose} variant="outline">
            Cancel
          </Button>
          <Button disabled={isSubmitting} onClick={handleSubmit}>
            {isSubmitting && (
              <Icon className="h-3.5 w-3.5 animate-spin" name="loader" />
            )}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// View DDL Dialog
// ============================================================

interface ViewDdlDialogProps {
  /** Pre-fetched table details from React Query cache, if available. */
  cachedDetails?: SchemaTableDetails | null;
  connectionId: string;
  dbType: DatabaseType;
  isOpen: boolean;
  onClose: () => void;
  schema: string;
  tableName: string;
}

/** Build a CREATE TABLE DDL script from SchemaTableDetails with engine-correct quoting. */
function buildDdlFromDetails(
  details: SchemaTableDetails,
  dbType: DatabaseType
): string {
  const lines: string[] = [];
  const colLines: string[] = [];
  const qTable = qt(dbType, details.schema, details.name);

  for (const col of details.columns) {
    let line = `  ${qi(dbType, col.name)} ${col.data_type}`;
    if (!col.is_nullable) {
      line += " NOT NULL";
    }
    if (col.column_default) {
      line += ` DEFAULT ${col.column_default}`;
    }
    colLines.push(line);
  }

  // Primary key from indexes
  const pk = details.indexes.find((idx) => idx.is_primary);
  if (pk) {
    colLines.push(
      `  PRIMARY KEY (${pk.column_names.map((c) => qi(dbType, c)).join(", ")})`
    );
  }

  // Unique constraints (non-primary)
  for (const idx of details.indexes.filter(
    (i) => i.is_unique && !i.is_primary
  )) {
    colLines.push(
      `  UNIQUE (${idx.column_names.map((c) => qi(dbType, c)).join(", ")})`
    );
  }

  // Foreign keys
  for (const fk of details.foreign_keys) {
    const ref = fk.referenced_schema
      ? qt(dbType, fk.referenced_schema, fk.referenced_table)
      : qi(dbType, fk.referenced_table);
    colLines.push(
      `  FOREIGN KEY (${qi(dbType, fk.column_name)}) REFERENCES ${ref}(${qi(dbType, fk.referenced_column)})`
    );
  }

  lines.push(`CREATE TABLE ${qTable} (`, colLines.join(",\n"), ");");

  // Non-unique indexes
  const nonUnique = details.indexes.filter(
    (i) => !(i.is_unique || i.is_primary)
  );
  for (const idx of nonUnique) {
    lines.push(
      `CREATE INDEX ${qi(dbType, idx.name)} ON ${qTable} (${idx.column_names.map((c) => qi(dbType, c)).join(", ")});`
    );
  }

  // RLS policies (PostgreSQL only)
  if (details.has_rls && dbType === "postgresql") {
    lines.push("");
    lines.push(`ALTER TABLE ${qTable} ENABLE ROW LEVEL SECURITY;`);
    for (const policy of details.rls_policies) {
      const roles = policy.roles.join(", ");
      const usingPart = policy.using_expr ? ` WITH (${policy.using_expr})` : "";
      const checkPart = policy.with_check_expr
        ? ` WITH CHECK (${policy.with_check_expr})`
        : "";
      lines.push(
        `CREATE POLICY ${qi(dbType, policy.name)} ON ${qTable} AS ${policy.kind} FOR ${roles}${usingPart}${checkPart};`
      );
    }
  }

  return lines.join("\n");
}

export function ViewDdlDialog({
  isOpen,
  onClose,
  connectionId,
  schema,
  tableName,
  dbType,
  cachedDetails,
}: ViewDdlDialogProps) {
  const [details, setDetails] = useState<SchemaTableDetails | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState(false);

  const ddl = details ? buildDdlFromDetails(details, dbType) : "";

  // Use cached details when available (same table, same connection),
  // otherwise fetch from IPC.
  useEffect(() => {
    if (!isOpen) {
      setDetails(null);
      setError(null);
      setIsLoading(false);
      return;
    }
    // Use cached details when available for instant display
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
          setError(err instanceof Error ? err.message : "Failed to load DDL");
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

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(ddl);
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    } catch {
      // Clipboard API not available
    }
  };

  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open={isOpen}>
      <DialogContent className="t-resize flex max-h-[80vh] flex-col overflow-hidden sm:max-w-[680px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="size-4 text-muted-foreground" name="script" />
            DDL Script
          </DialogTitle>
          <DialogDescription>
            <code className="font-mono text-foreground">
              {schema}.{tableName}
            </code>
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Icon
                className="size-5 animate-spin text-muted-foreground"
                name="loader"
              />
              <span className="ml-2 text-muted-foreground text-sm">
                Loading DDL...
              </span>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center py-12 text-destructive text-sm">
              {error}
            </div>
          ) : details ? (
            <ScrollArea className="h-full max-h-[55vh]">
              <CodeBlock className="rounded-lg border-0 bg-muted/30">
                <CodeBlockGroup className="border-border/40 border-b px-4 py-2">
                  <span className="font-mono text-muted-foreground text-xs">
                    sql
                  </span>
                  <Button
                    className="h-6 gap-1.5 px-2 text-xs"
                    onClick={() => {
                      void handleCopy();
                    }}
                    size="sm"
                    variant="ghost"
                  >
                    <Icon className="size-3" name="copy" />
                    {copyFeedback ? "Copied!" : "Copy"}
                  </Button>
                </CodeBlockGroup>
                <CodeBlockCode
                  className="[&>pre]:py-3"
                  code={ddl}
                  language="sql"
                />
              </CodeBlock>
            </ScrollArea>
          ) : null}
        </div>

        <DialogFooter className="pt-2">
          <Button onClick={onClose} variant="outline">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
