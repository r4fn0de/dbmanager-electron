import { Database, Loader2, Plus, Trash2, Wand } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
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
import type {
  CreateTableInput,
  DropTableInput,
  AddColumnInput,
  CreateIndexInput,
  CreateSchemaInput,
  DdlResult,
} from "@/ipc/db/types";

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
}

export function CreateTableDialog({
  isOpen,
  onClose,
  connectionId,
  schema,
  createTable,
  onSuccess,
}: CreateTableDialogProps) {
  const [tableName, setTableName] = useState("");
  const [columns, setColumns] = useState<ColumnRow[]>([
    { id: "1", name: "id", dataType: "serial", isNullable: false, isPrimaryKey: true },
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addColumn = () => {
    setColumns((prev) => [
      ...prev,
      {
        id: Math.random().toString(36).slice(2),
        name: "",
        dataType: "text",
        isNullable: true,
        isPrimaryKey: false,
      },
    ]);
  };

  const removeColumn = (id: string) => {
    setColumns((prev) => prev.filter((c) => c.id !== id));
  };

  const updateColumn = (id: string, updates: Partial<ColumnRow>) => {
    setColumns((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...updates } : c))
    );
  };

  const reset = () => {
    setTableName("");
    setColumns([
      { id: "1", name: "id", dataType: "serial", isNullable: false, isPrimaryKey: true },
    ]);
    setError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    if (!tableName.trim()) {
      setError("Table name is required");
      return;
    }
    if (columns.some((c) => !c.name.trim())) {
      setError("All columns must have a name");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const result = await createTable({
        connectionId,
        schema,
        name: tableName.trim(),
        columns: columns.map((c) => ({
          name: c.name.trim(),
          dataType: c.dataType,
          isNullable: c.isNullable,
        })),
      });
      toast.success(`Table created: ${result.sql}`);
      onSuccess();
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create table");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Create Table</DialogTitle>
          <DialogDescription>
            Create a new table in schema "{schema}".
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="text-sm text-destructive bg-destructive/10 p-2 rounded">
            {error}
          </div>
        )}

        <div className="space-y-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="table-name">Table Name</Label>
            <Input
              id="table-name"
              value={tableName}
              onChange={(e) => setTableName(e.target.value)}
              placeholder="my_table"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Columns</Label>
              <Button type="button" variant="outline" size="sm" onClick={addColumn}>
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add Column
              </Button>
            </div>

            <div className="space-y-2 max-h-[300px] overflow-auto pr-1">
              {columns.map((column, index) => (
                <div key={column.id} className="flex items-start gap-2 p-2 border rounded">
                  <div className="flex-1 grid grid-cols-2 gap-2">
                    <Input
                      value={column.name}
                      onChange={(e) => updateColumn(column.id, { name: e.target.value })}
                      placeholder="column_name"
                      className="h-8 text-sm"
                    />
                    <Select
                      value={column.dataType}
                      onValueChange={(v) => v && updateColumn(column.id, { dataType: v })}
                    >
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {COMMON_PG_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>
                            {type}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1">
                      <Switch
                        checked={column.isNullable}
                        onCheckedChange={(v) => updateColumn(column.id, { isNullable: v })}
                        id={`nullable-${column.id}`}
                      />
                      <Label htmlFor={`nullable-${column.id}`} className="text-xs cursor-pointer">
                        Nullable
                      </Label>
                    </div>
                    <div className="flex items-center gap-1">
                      <Switch
                        checked={column.isPrimaryKey}
                        onCheckedChange={(v) => updateColumn(column.id, { isPrimaryKey: v })}
                        id={`pk-${column.id}`}
                      />
                      <Label htmlFor={`pk-${column.id}`} className="text-xs cursor-pointer">
                        PK
                      </Label>
                    </div>
                    {columns.length > 1 && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => removeColumn(column.id)}
                        className="text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Create Table
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setConfirmText("");
    setError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    if (confirmText !== tableName) return;

    setIsSubmitting(true);
    setError(null);
    try {
      const result = await dropTable({
        connectionId,
        schema,
        name: tableName,
        cascade: false,
      });
      toast.success(`Table dropped: ${result.sql}`);
      onSuccess();
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to drop table");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Drop Table</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete the table{" "}
            <code className="font-mono text-sm bg-muted px-1 rounded">
              {schema}.{tableName}
            </code>
            . This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {error && (
          <div className="text-sm text-destructive bg-destructive/10 p-2 rounded">
            {error}
          </div>
        )}

        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Type <strong>{tableName}</strong> to confirm:
          </p>
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={`Type ${tableName} to confirm`}
          />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleClose}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleSubmit}
            disabled={confirmText !== tableName || isSubmitting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            Drop Table
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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
  const [columnName, setColumnName] = useState("");
  const [dataType, setDataType] = useState("text");
  const [isNullable, setIsNullable] = useState(true);
  const [defaultValue, setDefaultValue] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setColumnName("");
    setDataType("text");
    setIsNullable(true);
    setDefaultValue("");
    setError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    if (!columnName.trim()) {
      setError("Column name is required");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const result = await addColumn({
        connectionId,
        schema,
        table: tableName,
        column: {
          name: columnName.trim(),
          dataType,
          isNullable,
        },
      });
      toast.success(`Column added: ${result.sql}`);
      onSuccess();
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add column");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Column</DialogTitle>
          <DialogDescription>
            Add a new column to{" "}
            <code className="font-mono text-sm bg-muted px-1 rounded">
              {schema}.{tableName}
            </code>
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="text-sm text-destructive bg-destructive/10 p-2 rounded">
            {error}
          </div>
        )}

        <div className="space-y-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="col-name">Column Name</Label>
            <Input
              id="col-name"
              value={columnName}
              onChange={(e) => setColumnName(e.target.value)}
              placeholder="new_column"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="col-type">Data Type</Label>
            <Select value={dataType} onValueChange={(v) => v && setDataType(v)}>
              <SelectTrigger id="col-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COMMON_PG_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="col-default">Default Value (optional)</Label>
            <Input
              id="col-default"
              value={defaultValue}
              onChange={(e) => setDefaultValue(e.target.value)}
              placeholder="NULL"
            />
          </div>

          <div className="flex items-center gap-2">
            <Switch
              id="col-nullable"
              checked={isNullable}
              onCheckedChange={setIsNullable}
            />
            <Label htmlFor="col-nullable">Allow NULL values</Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Add Column
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
  tableName: string;
  columns: string[];
  createIndex: (input: CreateIndexInput) => Promise<DdlResult>;
  onSuccess: () => void;
}

export function CreateIndexDialog({
  isOpen,
  onClose,
  connectionId,
  schema,
  tableName,
  columns,
  createIndex,
  onSuccess,
}: CreateIndexDialogProps) {
  const [indexName, setIndexName] = useState(`idx_${tableName}_`);
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [isUnique, setIsUnique] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setIndexName(`idx_${tableName}_`);
    setSelectedColumns([]);
    setIsUnique(false);
    setError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const toggleColumn = (col: string) => {
    setSelectedColumns((prev) =>
      prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]
    );
  };

  const handleSubmit = async () => {
    if (!indexName.trim()) {
      setError("Index name is required");
      return;
    }
    if (selectedColumns.length === 0) {
      setError("Select at least one column");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const result = await createIndex({
        connectionId,
        schema,
        table: tableName,
        name: indexName.trim(),
        columns: selectedColumns,
        unique: isUnique,
      });
      toast.success(`Index created: ${result.sql}`);
      onSuccess();
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create index");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create Index</DialogTitle>
          <DialogDescription>
            Create an index on{" "}
            <code className="font-mono text-sm bg-muted px-1 rounded">
              {schema}.{tableName}
            </code>
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="text-sm text-destructive bg-destructive/10 p-2 rounded">
            {error}
          </div>
        )}

        <div className="space-y-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="idx-name">Index Name</Label>
            <Input
              id="idx-name"
              value={indexName}
              onChange={(e) => setIndexName(e.target.value)}
              placeholder="idx_table_name"
            />
          </div>

          <div className="flex items-center gap-2">
            <Switch id="idx-unique" checked={isUnique} onCheckedChange={setIsUnique} />
            <Label htmlFor="idx-unique">Unique Index</Label>
          </div>

          <div className="space-y-2">
            <Label>Select Columns</Label>
            <div className="flex flex-wrap gap-2">
              {columns.map((col) => (
                <Badge
                  key={col}
                  variant={selectedColumns.includes(col) ? "default" : "outline"}
                  className="cursor-pointer"
                  onClick={() => toggleColumn(col)}
                >
                  {col}
                </Badge>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Create Index
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setSchemaName("");
    setError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    if (!schemaName.trim()) {
      setError("Schema name is required");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const result = await createSchema({
        connectionId,
        name: schemaName.trim(),
      });
      toast.success(`Schema created: ${result.sql}`);
      onSuccess();
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create schema");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create Schema</DialogTitle>
          <DialogDescription>Create a new schema in the database.</DialogDescription>
        </DialogHeader>

        {error && (
          <div className="text-sm text-destructive bg-destructive/10 p-2 rounded">
            {error}
          </div>
        )}

        <div className="space-y-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="schema-name">Schema Name</Label>
            <Input
              id="schema-name"
              value={schemaName}
              onChange={(e) => setSchemaName(e.target.value)}
              placeholder="my_schema"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
            Create Schema
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
