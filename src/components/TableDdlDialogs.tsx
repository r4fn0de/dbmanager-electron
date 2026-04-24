import {
  AlertTriangle,
  Copy,
  Database,
  Loader2,
  Plus,
  ScrollText,
  Trash2,
  Upload,
  Wand,
} from "lucide-react";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { CodeBlock, CodeBlockCode, CodeBlockGroup } from "@/components/ui/code-block";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getTableDetails } from "@/hooks/db-actions";
import { qi, qt } from "@/ipc/db/ddl-sql";
import type { DatabaseType } from "@/ipc/db/types";
import type {
  AddColumnInput,
  AlterColumnTypeInput,
  ColumnDefinition,
  CreateIndexInput,
  CreateSchemaInput,
  CreateTableInput,
  DdlResult,
  DropColumnInput,
  DropTableInput,
  RenameColumnInput,
  RenameTableInput,
  SaveChangesInput,
  SaveChangesResponse,
  SetColumnDefaultInput,
  SetColumnNullableInput,
  SchemaTableDetails,
} from "@/ipc/db/types";

// ============================================================
// Common types used by quick "add column" row
// ============================================================

const COMMON_PG_TYPES = [
  "text",
  "integer",
  "bigint",
  "serial",
  "bigserial",
  "boolean",
  "uuid",
  "timestamp",
  "timestamptz",
  "date",
  "jsonb",
  "varchar(255)",
  "numeric(10,2)",
  "real",
  "bytea",
];

// ============================================================
// Create Table Dialog
// ============================================================

interface CreateTableDialogProps {
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
  schema: string;
  createTable: (input: CreateTableInput) => Promise<DdlResult>;
  onSuccess: () => void;
}

interface ColumnRow {
  id: string;
  name: string;
  dataType: string;
  isNullable: boolean;
  isPrimaryKey: boolean;
  isUnique: boolean;
  defaultExpr: string;
}

function emptyColumn(id: string): ColumnRow {
  return {
    id,
    name: "",
    dataType: "text",
    isNullable: true,
    isPrimaryKey: false,
    isUnique: false,
    defaultExpr: "",
  };
}

export function CreateTableDialog({
  isOpen,
  onClose,
  connectionId,
  schema,
  createTable,
  onSuccess,
}: CreateTableDialogProps) {
  const baseId = useId();
  const [tableName, setTableName] = useState("");
  const [columns, setColumns] = useState<ColumnRow[]>(() => [
    {
      id: `${baseId}-0`,
      name: "id",
      dataType: "uuid",
      isNullable: false,
      isPrimaryKey: true,
      isUnique: false,
      defaultExpr: "gen_random_uuid()",
    },
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isValid = useMemo(() => {
    if (!tableName.trim()) return false;
    if (columns.length === 0) return false;
    return columns.every((c) => c.name.trim() && c.dataType.trim());
  }, [tableName, columns]);

  const addColumn = () => {
    setColumns((prev) => [...prev, emptyColumn(`${baseId}-${prev.length}`)]);
  };

  const updateColumn = (id: string, patch: Partial<ColumnRow>) => {
    setColumns((prev) =>
      prev.map((col) => (col.id === id ? { ...col, ...patch } : col)),
    );
  };

  const removeColumn = (id: string) => {
    setColumns((prev) => prev.filter((col) => col.id !== id));
  };

  const handleSubmit = async () => {
    if (!isValid) return;
    setIsSubmitting(true);
    const toastId = toast.loading("Creating table...");
    try {
      const columnDefs: ColumnDefinition[] = columns.map((c) => ({
        name: c.name.trim(),
        dataType: c.dataType.trim(),
        isNullable: c.isNullable,
        isPrimaryKey: c.isPrimaryKey,
        isUnique: c.isUnique,
        defaultExpr: c.defaultExpr.trim() || undefined,
      }));
      const result = await createTable({
        connectionId,
        schema,
        name: tableName.trim(),
        columns: columnDefs,
      });
      toast.success("Table created", {
        id: toastId,
        description: result.sql,
      });
      onSuccess();
      onClose();
      // Reset
      setTableName("");
      setColumns([
        {
          id: `${baseId}-0`,
          name: "id",
          dataType: "uuid",
          isNullable: false,
          isPrimaryKey: true,
          isUnique: false,
          defaultExpr: "gen_random_uuid()",
        },
      ]);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to create table",
        { id: toastId },
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[680px] max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Create table</DialogTitle>
          <DialogDescription>
            Creates a new table in{" "}
            <code className="font-mono text-foreground">{schema}</code>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 flex-1 overflow-auto px-0.5">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Table name</Label>
            <Input
              value={tableName}
              onChange={(e) => setTableName(e.target.value)}
              placeholder="users"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Columns</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addColumn}
              >
                <Plus className="h-3 w-3" />
                Add column
              </Button>
            </div>

            {/* Column header */}
            <div className="grid grid-cols-[1fr_1fr_60px_50px_50px_auto_32px] gap-1.5 items-center text-[10px] text-muted-foreground px-0.5">
              <span>Name</span>
              <span>Type</span>
              <span className="text-center">Null</span>
              <span className="text-center">PK</span>
              <span className="text-center">UQ</span>
              <span>Default</span>
              <span />
            </div>

            {columns.map((col) => (
              <div
                key={col.id}
                className="grid grid-cols-[1fr_1fr_60px_50px_50px_auto_32px] gap-1.5 items-center"
              >
                <Input
                  value={col.name}
                  onChange={(e) =>
                    updateColumn(col.id, { name: e.target.value })
                  }
                  placeholder="column_name"
                  className="text-xs h-8"
                />
                <Select
                  value={col.dataType}
                  onValueChange={(v) =>
                    updateColumn(col.id, { dataType: v ?? col.dataType })
                  }
                >
                  <SelectTrigger className="text-xs h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COMMON_PG_TYPES.map((t) => (
                      <SelectItem key={t} value={t} className="text-xs">
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
                    checked={col.isPrimaryKey}
                    onCheckedChange={(v) =>
                      updateColumn(col.id, {
                        isPrimaryKey: v,
                        // PK implies NOT NULL.
                        ...(v ? { isNullable: false } : {}),
                      })
                    }
                    size="sm"
                  />
                </div>
                <div className="flex justify-center">
                  <Switch
                    checked={col.isUnique}
                    onCheckedChange={(v) =>
                      updateColumn(col.id, { isUnique: v })
                    }
                    size="sm"
                  />
                </div>
                <Input
                  value={col.defaultExpr}
                  onChange={(e) =>
                    updateColumn(col.id, { defaultExpr: e.target.value })
                  }
                  placeholder="DEFAULT"
                  className="text-xs h-8 font-mono"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => removeColumn(col.id)}
                  disabled={columns.length <= 1}
                >
                  <Trash2 className="h-3 w-3 text-muted-foreground" />
                </Button>
              </div>
            ))}
          </div>
        </div>

        <DialogFooter className="gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!isValid || isSubmitting}>
            {isSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
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
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
  schema: string;
  tableName: string;
  dropTable: (input: DropTableInput) => Promise<DdlResult>;
  onSuccess: () => void;
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
        connectionId,
        schema,
        name: tableName,
        cascade,
      });
      toast.success("Table dropped", {
        id: toastId,
        description: result.sql,
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
      open={isOpen}
      onOpenChange={(open) => !isSubmitting && !open && onClose()}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-destructive/10 text-destructive">
            <AlertTriangle />
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

        <label className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={cascade}
            onChange={(e) => setCascade(e.target.checked)}
            className="mt-0.5"
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
            variant="destructive"
            onClick={handleDrop}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
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
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
  schema: string;
  currentName: string;
  renameTable: (input: RenameTableInput) => Promise<DdlResult>;
  onSuccess: () => void;
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
    if (!isValid) return;
    setIsSubmitting(true);
    const toastId = toast.loading("Renaming table...");
    try {
      const result = await renameTable({
        connectionId,
        schema,
        oldName: currentName,
        newName: newName.trim(),
      });
      toast.success("Table renamed", {
        id: toastId,
        description: result.sql,
      });
      onSuccess();
      onClose();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to rename table",
        { id: toastId },
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[400px]">
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
          <Label className="text-xs text-muted-foreground">New name</Label>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            autoFocus
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          />
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!isValid || isSubmitting}>
            {isSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
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
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
  schema: string;
  tableName: string;
  addColumn: (input: AddColumnInput) => Promise<DdlResult>;
  onSuccess: () => void;
}

export function AddColumnDialog({
  isOpen,
  onClose,
  connectionId,
  schema,
  tableName,
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
    if (!isValid) return;
    setIsSubmitting(true);
    const toastId = toast.loading("Adding column...");
    try {
      const result = await addColumn({
        connectionId,
        schema,
        table: tableName,
        column: {
          name: name.trim(),
          dataType: dataType.trim(),
          isNullable,
          isUnique,
          defaultExpr: defaultExpr.trim() || undefined,
        },
      });
      toast.success("Column added", {
        id: toastId,
        description: result.sql,
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
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[440px]">
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
            <Label className="text-xs text-muted-foreground">Column name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="column_name"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Data type</Label>
            <Select value={dataType} onValueChange={(v) => v && setDataType(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COMMON_PG_TYPES.map((t) => (
                  <SelectItem key={t} value={t} className="text-xs">
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
            <Label className="text-xs text-muted-foreground">
              Default expression{" "}
              <Badge variant="secondary" className="text-[9px] ml-1">
                optional
              </Badge>
            </Label>
            <Input
              value={defaultExpr}
              onChange={(e) => setDefaultExpr(e.target.value)}
              placeholder="now(), 0, 'default'"
              className="font-mono text-xs"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!isValid || isSubmitting}>
            {isSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
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
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
  schema: string;
  tableName: string;
  columnName: string;
  dropColumn: (input: DropColumnInput) => Promise<DdlResult>;
  onSuccess: () => void;
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
        connectionId,
        schema,
        table: tableName,
        column: columnName,
        cascade,
      });
      toast.success("Column dropped", {
        id: toastId,
        description: result.sql,
      });
      onSuccess();
      onClose();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to drop column",
        { id: toastId },
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AlertDialog
      open={isOpen}
      onOpenChange={(open) => !isSubmitting && !open && onClose()}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-destructive/10 text-destructive">
            <AlertTriangle />
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

        <label className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={cascade}
            onChange={(e) => setCascade(e.target.checked)}
            className="mt-0.5"
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
            variant="destructive"
            onClick={handleDrop}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
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
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
  createSchema: (input: CreateSchemaInput) => Promise<DdlResult>;
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
    if (!isValid) return;
    setIsSubmitting(true);
    const toastId = toast.loading("Creating schema...");
    try {
      const result = await createSchema({
        connectionId,
        name: schemaName.trim(),
        ifNotExists: true,
      });
      toast.success("Schema created", { id: toastId, description: result.sql });
      onSuccess();
      onClose();
      setSchemaName("");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to create schema",
        {
          id: toastId,
        },
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Create schema</DialogTitle>
          <DialogDescription>
            Creates a new PostgreSQL schema in this connection.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5 py-2">
          <Label className="text-xs text-muted-foreground">Schema name</Label>
          <Input
            autoFocus
            value={schemaName}
            onChange={(e) => setSchemaName(e.target.value)}
            placeholder="analytics"
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          />
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!isValid || isSubmitting}>
            {isSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            <Database className="h-3.5 w-3.5" />
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
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
  schema: string;
  defaultTableName: string;
  createIndex: (input: CreateIndexInput) => Promise<DdlResult>;
  onSuccess: () => void;
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
    [columnsRaw],
  );
  const isValid = tableName.trim().length > 0 && columns.length > 0;

  const handleSubmit = async () => {
    if (!isValid) return;
    setIsSubmitting(true);
    const toastId = toast.loading("Creating index...");
    try {
      const result = await createIndex({
        connectionId,
        schema,
        table: tableName.trim(),
        name: indexName.trim() || undefined,
        columns,
        unique: isUnique,
        ifNotExists: true,
      });
      toast.success("Index created", { id: toastId, description: result.sql });
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
        },
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Create index</DialogTitle>
          <DialogDescription>
            Creates an index in{" "}
            <code className="font-mono text-foreground">{schema}</code>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Table</Label>
            <Input
              value={tableName}
              onChange={(e) => setTableName(e.target.value)}
              placeholder="users"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              Index name (optional)
            </Label>
            <Input
              value={indexName}
              onChange={(e) => setIndexName(e.target.value)}
              placeholder="users_email_idx"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              Columns (comma separated)
            </Label>
            <Input
              value={columnsRaw}
              onChange={(e) => setColumnsRaw(e.target.value)}
              placeholder="email, created_at"
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
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!isValid || isSubmitting}>
            {isSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            <Wand className="h-3.5 w-3.5" />
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
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
  schema: string;
  defaultTableName: string;
  tableSaveChanges: (input: SaveChangesInput) => Promise<SaveChangesResponse>;
  onSuccess: () => void;
}

type CsvParseResult = {
  headers: string[];
  rows: Record<string, unknown>[];
};

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
      if (ch === "\r" && next === "\n") i += 1;
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
    if (!file) return;
    const text = await file.text();
    const parsedCsv = parseCsvText(text);
    setFileName(file.name);
    setParsed(parsedCsv);
  };

  const isValid =
    tableName.trim().length > 0 && parsed && parsed.rows.length > 0;

  const handleImport = async () => {
    if (!isValid || !parsed) return;
    setIsSubmitting(true);
    const toastId = toast.loading("Importing CSV...");
    try {
      const chunkSize = 500;
      for (let i = 0; i < parsed.rows.length; i += chunkSize) {
        const chunk = parsed.rows.slice(i, i + chunkSize);
        await tableSaveChanges({
          tableRef: {
            connectionId,
            schema,
            table: tableName.trim(),
          },
          inserts: chunk,
          updates: [],
          deletes: [],
        });
      }

      toast.success(`Imported ${parsed.rows.length} rows`, {
        id: toastId,
        description: `${fileName} → ${schema}.${tableName.trim()}`,
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
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Import CSV</DialogTitle>
          <DialogDescription>
            Imports rows into{" "}
            <code className="font-mono text-foreground">{schema}</code>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              Target table
            </Label>
            <Input
              value={tableName}
              onChange={(e) => setTableName(e.target.value)}
              placeholder="users"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">CSV file</Label>
            <Input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                void handleFile(file);
              }}
            />
          </div>

          {parsed && (
            <div className="rounded-md border p-2.5 text-xs space-y-1">
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
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleImport} disabled={!isValid || isSubmitting}>
            {isSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            <Upload className="h-3.5 w-3.5" />
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
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
  schema: string;
  tableName: string;
  currentName: string;
  renameColumn: (input: RenameColumnInput) => Promise<DdlResult>;
  onSuccess: () => void;
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
    if (!isValid) return;
    setIsSubmitting(true);
    const toastId = toast.loading("Renaming column...");
    try {
      const result = await renameColumn({
        connectionId,
        schema,
        table: tableName,
        oldName: currentName,
        newName: newName.trim(),
      });
      toast.success("Column renamed", { id: toastId, description: result.sql });
      onSuccess();
      onClose();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to rename column",
        {
          id: toastId,
        },
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[420px]">
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
          <Label className="text-xs text-muted-foreground">
            New column name
          </Label>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            autoFocus
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!isValid || isSubmitting}>
            {isSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
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
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
  schema: string;
  tableName: string;
  columnName: string;
  currentType: string;
  alterColumnType: (input: AlterColumnTypeInput) => Promise<DdlResult>;
  onSuccess: () => void;
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
    if (!isValid) return;
    setIsSubmitting(true);
    const toastId = toast.loading("Altering column type...");
    try {
      const result = await alterColumnType({
        connectionId,
        schema,
        table: tableName,
        column: columnName,
        newType: newType.trim(),
        usingExpr: usingExpr.trim() || undefined,
      });
      toast.success("Column type updated", {
        id: toastId,
        description: result.sql,
      });
      onSuccess();
      onClose();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to alter column type",
        { id: toastId },
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[460px]">
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
            <Label className="text-xs text-muted-foreground">New type</Label>
            <Input
              value={newType}
              onChange={(e) => setNewType(e.target.value)}
              placeholder="text, integer, varchar(255), jsonb..."
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              USING expression (optional)
            </Label>
            <Input
              value={usingExpr}
              onChange={(e) => setUsingExpr(e.target.value)}
              placeholder='"column_name"::text'
              className="font-mono text-xs"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!isValid || isSubmitting}>
            {isSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
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
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
  schema: string;
  tableName: string;
  columnName: string;
  currentDefault: string | null;
  setColumnDefault: (input: SetColumnDefaultInput) => Promise<DdlResult>;
  onSuccess: () => void;
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
      clear ? "Dropping default..." : "Setting default...",
    );
    try {
      const result = await setColumnDefault({
        connectionId,
        schema,
        table: tableName,
        column: columnName,
        defaultExpr: clear ? undefined : defaultExpr.trim() || undefined,
      });
      toast.success(clear ? "Default removed" : "Default updated", {
        id: toastId,
        description: result.sql,
      });
      onSuccess();
      onClose();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update default",
        {
          id: toastId,
        },
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[500px]">
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
          <Label className="text-xs text-muted-foreground">
            Default expression
          </Label>
          <Input
            value={defaultExpr}
            onChange={(e) => setDefaultExpr(e.target.value)}
            placeholder="now(), gen_random_uuid(), 'active', 0"
            className="font-mono text-xs"
          />
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              void handleSave(true);
            }}
            disabled={isSubmitting}
          >
            Clear default
          </Button>
          <Button
            onClick={() => {
              void handleSave(false);
            }}
            disabled={isSubmitting || defaultExpr.trim().length === 0}
          >
            {isSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
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
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
  schema: string;
  tableName: string;
  columnName: string;
  isCurrentlyNullable: boolean;
  setColumnNullable: (input: SetColumnNullableInput) => Promise<DdlResult>;
  onSuccess: () => void;
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
        connectionId,
        schema,
        table: tableName,
        column: columnName,
        isNullable,
      });
      toast.success("Nullable constraint updated", {
        id: toastId,
        description: result.sql,
      });
      onSuccess();
      onClose();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to set nullable",
        {
          id: toastId,
        },
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[440px]">
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
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
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
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
  schema: string;
  tableName: string;
  dbType: DatabaseType;
  /** Pre-fetched table details from React Query cache, if available. */
  cachedDetails?: SchemaTableDetails | null;
}

/** Build a CREATE TABLE DDL script from SchemaTableDetails with engine-correct quoting. */
function buildDdlFromDetails(details: SchemaTableDetails, dbType: DatabaseType): string {
  const lines: string[] = [];
  const colLines: string[] = [];
  const qTable = qt(dbType, details.schema, details.name);

  for (const col of details.columns) {
    let line = `  ${qi(dbType, col.name)} ${col.data_type}`;
    if (!col.is_nullable) line += " NOT NULL";
    if (col.column_default) line += ` DEFAULT ${col.column_default}`;
    colLines.push(line);
  }

  // Primary key from indexes
  const pk = details.indexes.find((idx) => idx.is_primary);
  if (pk) {
    colLines.push(
      `  PRIMARY KEY (${pk.column_names.map((c) => qi(dbType, c)).join(", ")})`,
    );
  }

  // Unique constraints (non-primary)
  for (const idx of details.indexes.filter((i) => i.is_unique && !i.is_primary)) {
    colLines.push(
      `  UNIQUE (${idx.column_names.map((c) => qi(dbType, c)).join(", ")})`,
    );
  }

  // Foreign keys
  for (const fk of details.foreign_keys) {
    const ref = fk.referenced_schema
      ? qt(dbType, fk.referenced_schema, fk.referenced_table)
      : qi(dbType, fk.referenced_table);
    colLines.push(
      `  FOREIGN KEY (${qi(dbType, fk.column_name)}) REFERENCES ${ref}(${qi(dbType, fk.referenced_column)})`,
    );
  }

  lines.push(
    `CREATE TABLE ${qTable} (`,
    colLines.join(",\n"),
    ");",
  );

  // Non-unique indexes
  const nonUnique = details.indexes.filter((i) => !i.is_unique && !i.is_primary);
  for (const idx of nonUnique) {
    lines.push(
      `CREATE INDEX ${qi(dbType, idx.name)} ON ${qTable} (${idx.column_names.map((c) => qi(dbType, c)).join(", ")});`,
    );
  }

  // RLS policies (PostgreSQL only)
  if (details.has_rls && dbType === "postgresql") {
    lines.push("");
    lines.push(`ALTER TABLE ${qTable} ENABLE ROW LEVEL SECURITY;`);
    for (const policy of details.rls_policies) {
      const roles = policy.roles.join(", ");
      const usingPart = policy.using_expr ? ` WITH (${policy.using_expr})` : "";
      const checkPart = policy.with_check_expr ? ` WITH CHECK (${policy.with_check_expr})` : "";
      lines.push(
        `CREATE POLICY ${qi(dbType, policy.name)} ON ${qTable} AS ${policy.kind} FOR ${roles}${usingPart}${checkPart};`,
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
        if (!cancelled) setDetails(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load DDL");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => { cancelled = true; };
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
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[680px] max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScrollText className="size-4 text-muted-foreground" />
            DDL Script
          </DialogTitle>
          <DialogDescription>
            <code className="font-mono text-foreground">{schema}.{tableName}</code>
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">Loading DDL...</span>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center py-12 text-destructive text-sm">
              {error}
            </div>
          ) : details ? (
            <ScrollArea className="h-full max-h-[55vh]">
              <CodeBlock className="border-0 bg-muted/30 rounded-lg">
                <CodeBlockGroup className="px-4 py-2 border-b border-border/40">
                  <span className="text-xs text-muted-foreground font-mono">sql</span>
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
                  code={ddl}
                  language="sql"
                  className="[&>pre]:py-3"
                />
              </CodeBlock>
            </ScrollArea>
          ) : null}
        </div>

        <DialogFooter className="pt-2">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
