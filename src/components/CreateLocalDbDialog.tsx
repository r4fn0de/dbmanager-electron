import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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
import { PostgreSql } from "@/components/icons/PostgreSql";
import { Sqlite } from "@/components/icons/Sqlite";
import type { LocalDbEngine } from "@/ipc/db/types";
import { cn } from "@/utils/tailwind";

// ── Shared constants ──────────────────────────────────────────────────

function generateRandomName(): string {
  const adjectives = ["swift", "silent", "bright", "cosmic", "gentle", "bold", "warm", "crisp"];
  const nouns = ["river", "forest", "meadow", "peak", "valley", "stone", "sky", "lake"];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  return `${adj}-${noun}`;
}

const COLOR_OPTIONS = [
  "#3B82F6", "#6366F1", "#8B5CF6", "#A855F7",
  "#EC4899", "#F43F5E", "#EF4444", "#F97316",
  "#EAB308", "#84CC16", "#22C55E", "#14B8A6",
  "#06B6D4", "#0EA5E9", "#64748B", "#78716C",
];

const TAG_OPTIONS = ["Development", "Production", "Staging", "Testing", "Personal", "Work"];

const POSTGRES_VERSIONS = [
  { value: "18.3.0", label: "PostgreSQL 18" },
  { value: "17.9.0", label: "PostgreSQL 17" },
  { value: "16.13.0", label: "PostgreSQL 16" },
  { value: "15.17.0", label: "PostgreSQL 15" },
  { value: "14.22.0", label: "PostgreSQL 14" },
];

const ENGINE_OPTIONS: { value: LocalDbEngine; label: string; icon: React.ReactNode; description: string }[] = [
  { value: "postgresql", label: "PostgreSQL", icon: <PostgreSql className="size-4 shrink-0" />, description: "Embedded PostgreSQL server" },
  { value: "sqlite", label: "SQLite", icon: <Sqlite className="h-4 w-auto shrink-0" />, description: "File-based, no server needed" },
];

const DEFAULT_FORM_DATA: CreateLocalDbInput = {
  name: "",
  databaseName: "postgres",
  username: "postgres",
  postgresVersion: "16.13.0",
  password: "",
  port: 5432,
  autoStart: true,
  engine: "postgresql",
};

export interface CreateLocalDbInput {
  name: string;
  databaseName: string;
  username: string;
  postgresVersion: string;
  password: string;
  port: number;
  autoStart: boolean;
  engine: LocalDbEngine;
  tag?: string;
  color?: string;
}

interface CreateLocalDbDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (input: CreateLocalDbInput) => Promise<void>;
  isCreating: boolean;
  editConnection?: {
    id: string;
    name: string;
    databaseName: string;
    username: string;
    postgresVersion: string;
    password: string;
    port: number;
    autoStart: boolean;
    engine?: LocalDbEngine;
    tag?: string;
    color?: string;
  } | null;
  onUpdate?: (id: string, input: CreateLocalDbInput) => Promise<void>;
  isUpdating?: boolean;
}

export function CreateLocalDbDialog({
  isOpen,
  onClose,
  onCreate,
  isCreating,
  editConnection,
  onUpdate,
  isUpdating,
}: CreateLocalDbDialogProps) {
  const isEditMode = !!editConnection;
  const isBusy = isCreating || isUpdating;

  const [formData, setFormData] = useState<CreateLocalDbInput>(DEFAULT_FORM_DATA);
  const [useCustomTag, setUseCustomTag] = useState(false);

  // Sync form when dialog opens or editConnection changes
  useEffect(() => {
    if (!isOpen) return;

    if (editConnection) {
      setFormData({
        name: editConnection.name,
        databaseName: editConnection.databaseName,
        username: editConnection.username,
        postgresVersion: editConnection.postgresVersion,
        password: editConnection.password,
        port: editConnection.port,
        autoStart: editConnection.autoStart,
        engine: editConnection.engine ?? "postgresql",
        tag: editConnection.tag,
        color: editConnection.color,
      });
      setUseCustomTag(!!editConnection.tag && !TAG_OPTIONS.includes(editConnection.tag));
    } else {
      setFormData(DEFAULT_FORM_DATA);
      setUseCustomTag(false);
    }
  }, [isOpen, editConnection]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isEditMode && editConnection && onUpdate) {
      try {
        await onUpdate(editConnection.id, formData);
      } catch {
        return;
      }
    } else {
      try {
        await onCreate(formData);
      } catch {
        return;
      }
    }

    setFormData(DEFAULT_FORM_DATA);
    setUseCustomTag(false);
  };

  const updateField = <K extends keyof CreateLocalDbInput>(
    field: K,
    value: CreateLocalDbInput[K],
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const isSqlite = formData.engine === "sqlite";

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[460px] p-0 gap-0 flex flex-col max-h-[90vh]">
        {/* Header — fixed */}
        <div className="p-5 pb-0 shrink-0">
          <DialogHeader className="gap-1">
            <DialogTitle className="flex items-center gap-2">
              <Icon name="hard-drive" className="size-4 text-muted-foreground" />
              {isEditMode ? "Edit Local Database" : "New Local Database"}
            </DialogTitle>
          </DialogHeader>
        </div>

        {/* Scrollable body */}
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto">
            <div className="flex flex-col gap-5 p-5">
              {/* ── Identity ────────────────────────────────────── */}
              <div className="flex flex-col gap-3.5">
                <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                  Identity
                </span>

                {/* Name + Random */}
                <div className="flex flex-col gap-1">
                  <Label htmlFor="local-name" className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                    Name
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="local-name"
                      placeholder="My Local DB"
                      value={formData.name}
                      onChange={(e) => updateField("name", e.target.value)}
                      required
                      className="h-7"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-xs"
                      className="shrink-0"
                      onClick={() => updateField("name", generateRandomName())}
                      title="Generate random name"
                    >
                      <Icon name="shuffle" className="size-3" />
                    </Button>
                  </div>
                </div>

                {/* Tag */}
                <div className="flex flex-col gap-1.5">
                  <Label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                    Tag <span className="normal-case tracking-normal text-muted-foreground/50">— optional</span>
                  </Label>
                  {!useCustomTag ? (
                    <div className="flex flex-wrap gap-1">
                      {TAG_OPTIONS.map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => updateField("tag", formData.tag === tag ? "" : tag)}
                          className={cn(
                            "rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors",
                            formData.tag === tag
                              ? "border-primary/30 bg-primary/5 text-primary"
                              : "border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground",
                          )}
                        >
                          {tag}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => setUseCustomTag(true)}
                        className="rounded-md border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground transition-colors"
                      >
                        + custom
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Input
                        placeholder="Custom tag"
                        value={formData.tag ?? ""}
                        onChange={(e) => updateField("tag", e.target.value)}
                        className="h-7 text-xs"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => { setUseCustomTag(false); updateField("tag", ""); }}
                        className="h-7 shrink-0 px-2 text-xs text-muted-foreground"
                      >
                        <Icon name="x" className="size-3" />
                      </Button>
                    </div>
                  )}
                </div>

                {/* Color */}
                <div className="flex flex-col gap-1.5">
                  <Label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                    Color <span className="normal-case tracking-normal text-muted-foreground/50">— optional</span>
                  </Label>
                  <div className="flex flex-wrap gap-1.5">
                    {COLOR_OPTIONS.map((colorOption) => (
                      <button
                        key={colorOption}
                        type="button"
                        className={cn(
                          "size-4 rounded-full transition-transform hover:scale-110",
                          formData.color === colorOption && "ring-2 ring-offset-1 ring-offset-background ring-primary/40",
                        )}
                        style={{ backgroundColor: colorOption }}
                        onClick={() =>
                          updateField("color", formData.color === colorOption ? "" : colorOption)
                        }
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* ── Configuration ─────────────────────────────── */}
              <div className="flex flex-col gap-3.5">
                <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                  Configuration
                </span>

                {/* Engine selector */}
                <div className="flex flex-col gap-1.5">
                  <Label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                    Engine
                  </Label>
                  <div className="flex flex-wrap gap-1.5">
                    {ENGINE_OPTIONS.map((opt) => {
                      const isActive = formData.engine === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => {
                            const switchToSqlite = opt.value === "sqlite";
                            updateField("engine", opt.value);
                            if (switchToSqlite) {
                              updateField("databaseName", "main");
                              updateField("username", "");
                              updateField("password", "");
                              updateField("port", 0);
                            } else {
                              updateField("databaseName", "postgres");
                              updateField("username", "postgres");
                              updateField("password", "");
                              updateField("port", 5432);
                            }
                          }}
                          className={cn(
                            "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-all active:scale-[0.97]",
                            isActive
                              ? "border-primary/30 bg-primary/5 text-primary"
                              : "border-border bg-transparent text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground",
                          )}
                        >
                          {opt.icon}
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* PostgreSQL-specific fields */}
                {!isSqlite && (<>
                  {/* Database + Port */}
                  <div className="grid grid-cols-[1fr_80px] gap-2.5">
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="local-db" className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                        Database
                      </Label>
                      <Input
                        id="local-db"
                        placeholder="postgres"
                        value={formData.databaseName}
                        onChange={(e) => updateField("databaseName", e.target.value)}
                        required
                        className="h-7 font-mono text-xs"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="local-port" className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                        Port
                      </Label>
                      <Input
                        id="local-port"
                        type="number"
                        min={1024}
                        max={65535}
                        value={formData.port}
                        onChange={(e) =>
                          updateField("port", Number.parseInt(e.target.value, 10) || 5432)
                        }
                        required
                        className="h-7 font-mono text-xs"
                      />
                    </div>
                  </div>

                  {/* Version */}
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                      Version
                    </Label>
                    <Select
                      value={formData.postgresVersion}
                      onValueChange={(value) => updateField("postgresVersion", value || "16.13.0")}
                    >
                      <SelectTrigger className="h-7 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {POSTGRES_VERSIONS.map((v) => (
                          <SelectItem key={v.value} value={v.value || "16.13.0"}>
                            {v.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Username + Password */}
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="local-user" className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                        Username
                      </Label>
                      <Input
                        id="local-user"
                        placeholder="postgres"
                        value={formData.username}
                        onChange={(e) => updateField("username", e.target.value)}
                        required
                        className="h-7 font-mono text-xs"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="local-password" className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                        Password
                      </Label>
                      <Input
                        id="local-password"
                        type="password"
                        placeholder="Default: postgres"
                        value={formData.password}
                        onChange={(e) => updateField("password", e.target.value)}
                        className="h-7 font-mono text-xs"
                      />
                    </div>
                  </div>
                </>)}

                {/* SQLite info message */}
                {isSqlite && (
                  <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
                    SQLite databases are file-based and stored locally. No server process or port configuration needed. The database file will be created automatically.
                  </div>
                )}

                {/* Auto-start */}
                <div className="flex items-center gap-2.5">
                  <Switch
                    id="local-auto"
                    checked={formData.autoStart}
                    onCheckedChange={(checked) => updateField("autoStart", checked)}
                  />
                  <Label htmlFor="local-auto" className="text-xs cursor-pointer">
                    Auto-start {isEditMode ? "" : "on creation"}
                  </Label>
                </div>
              </div>
            </div>
          </div>

          {/* Footer — fixed */}
          <div className="flex items-center justify-end gap-2 border-t bg-muted/50 px-5 py-3 shrink-0">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              disabled={isBusy}
              className="h-7 px-2 text-xs"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={isBusy}
              className="h-7 text-xs gap-1"
            >
              {isBusy ? (
                <>
                  <Icon name="loader" className="size-3 animate-spin" />
                  {isEditMode ? "Saving…" : "Creating…"}
                </>
              ) : isEditMode ? (
                <>
                  <Icon name="pencil" className="size-3" />
                  Save Changes
                </>
              ) : (
                "Create Database"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
