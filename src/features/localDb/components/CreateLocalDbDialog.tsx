import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ipc } from "@/ipc/manager";
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
import { cn } from "@/lib/utils";

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

function Stepper({ currentStep, totalSteps }: { currentStep: number; totalSteps: number }) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: totalSteps }, (_, i) => {
        const step = i + 1;
        const isActive = step === currentStep;
        const isCompleted = step < currentStep;
        return (
          <div key={step} className="flex items-center gap-2">
            <div
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold transition-all border",
                isActive && "bg-primary text-primary-foreground border-primary shadow-sm",
                isCompleted && "bg-primary/10 text-primary border-primary/30",
                !isActive && !isCompleted && "bg-muted text-muted-foreground border-border",
              )}
            >
              {isCompleted ? <Icon name="check" className="size-3" /> : step}
            </div>
            <span
              className={cn(
                "text-[11px] font-medium transition-colors",
                isActive ? "text-foreground" : "text-muted-foreground/50",
              )}
            >
              {step === 1 ? "Identity" : "Configuration"}
            </span>
            {step < totalSteps && (
              <div className={cn("h-px w-6 transition-colors", isCompleted ? "bg-primary/30" : "bg-border")} />
            )}
          </div>
        );
      })}
    </div>
  );
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
  const TOTAL_STEPS = 2;

  const [formData, setFormData] = useState<CreateLocalDbInput>(DEFAULT_FORM_DATA);
  const [useCustomTag, setUseCustomTag] = useState(false);
  const [step, setStep] = useState(1);

  // ── Port availability check (only for PostgreSQL on step 2) ─────────
  const { data: availablePort } = useQuery({
    queryKey: ["findAvailablePort", step, formData.engine, editConnection?.id],
    queryFn: async () => {
      return await ipc.client.db.findAvailablePort();
    },
    enabled: step === 2 && formData.engine === "postgresql" && isOpen,
    staleTime: 5_000,
  });

  const portConflict =
    step === 2 &&
    formData.engine === "postgresql" &&
    availablePort !== undefined &&
    availablePort !== formData.port;

  // Sync form when dialog opens or editConnection changes
  useEffect(() => {
    if (!isOpen) return;

    setStep(1);

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
      <DialogContent className="t-resize sm:max-w-[460px] p-0 gap-0 flex flex-col max-h-[90vh]">
        {/* Header — fixed */}
        <div className="p-5 pb-0 shrink-0">
          <DialogHeader className="gap-3">
            <DialogTitle className="flex items-center gap-2">
              <Icon name="hard-drive" className="size-4 text-muted-foreground" />
              {isEditMode ? "Edit Local Database" : "New Local Database"}
            </DialogTitle>
            <Stepper currentStep={step} totalSteps={TOTAL_STEPS} />
          </DialogHeader>
        </div>

        {/* Scrollable body */}
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto">
            <div className="flex flex-col gap-5 p-5">
              {/* ── Step 1: Identity + Engine ─────────────────── */}
              {step === 1 && (
                <div className="flex flex-col gap-5">
                  {/* Name + Random */}
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="local-name" className="text-xs font-medium text-muted-foreground">
                      Name
                    </Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="local-name"
                        placeholder="My Local DB"
                        value={formData.name}
                        onChange={(e) => updateField("name", e.target.value)}
                        required
                        className="h-8"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-xs"
                        className="shrink-0 transition-transform duration-150 ease-out active:scale-[0.97]"
                        onClick={() => updateField("name", generateRandomName())}
                        title="Generate random name"
                      >
                        <Icon name="shuffle" className="size-3" />
                      </Button>
                    </div>
                  </div>

                  {/* Tag */}
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs font-medium text-muted-foreground">
                      Tag <span className="normal-case tracking-normal text-muted-foreground/50">— optional</span>
                    </Label>
                    {!useCustomTag ? (
                      <div className="flex flex-wrap gap-1.5">
                        {TAG_OPTIONS.map((tag) => (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => updateField("tag", formData.tag === tag ? "" : tag)}
                            className={cn(
                              "rounded-full border px-3 py-1 text-[11px] font-medium transition-colors duration-150 active:scale-[0.97]",
                              formData.tag === tag
                                ? "border-primary/40 bg-primary/10 text-primary shadow-sm"
                                : "border-border/60 text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground hover:bg-muted/30",
                            )}
                          >
                            {tag}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => setUseCustomTag(true)}
                          className="rounded-full border border-dashed border-border/60 px-3 py-1 text-[11px] text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground hover:bg-muted/30 transition-colors duration-150 active:scale-[0.97]"
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
                          className="h-8 text-xs"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => { setUseCustomTag(false); updateField("tag", ""); }}
                          className="h-8 shrink-0 px-2 text-xs text-muted-foreground"
                        >
                          <Icon name="x" className="size-3" />
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* Color */}
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs font-medium text-muted-foreground">
                      Color <span className="normal-case tracking-normal text-muted-foreground/50">— optional</span>
                    </Label>
                    <div className="flex flex-wrap gap-2">
                      {COLOR_OPTIONS.map((colorOption) => (
                        <button
                          key={colorOption}
                          type="button"
                          className={cn(
                            "size-5 rounded-full transition-transform duration-200 ease-out hover:scale-110 hover:shadow-md",
                            formData.color === colorOption && "ring-2 ring-offset-2 ring-offset-background ring-primary/50 scale-110",
                          )}
                          style={{ backgroundColor: colorOption }}
                          onClick={() =>
                            updateField("color", formData.color === colorOption ? "" : colorOption)
                          }
                          title={colorOption}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Engine selector */}
                  <div className="flex flex-col gap-2">
                    <Label className="text-xs font-medium text-muted-foreground">
                      Engine
                    </Label>
                    <div className="flex flex-col gap-2">
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
                              "flex items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors duration-150 ease-out active:scale-[0.98]",
                              isActive
                                ? "border-primary/30 bg-primary/5 text-primary shadow-sm"
                                : "border-border bg-transparent text-muted-foreground hover:border-muted-foreground/30 hover:bg-muted/20 hover:text-foreground",
                            )}
                          >
                            <div className={cn(
                              "flex h-9 w-9 items-center justify-center rounded-lg border transition-colors",
                              isActive ? "border-primary/20 bg-primary/10" : "border-border bg-muted/40"
                            )}>
                              {opt.icon}
                            </div>
                            <div className="flex flex-col gap-0.5">
                              <span className="text-xs font-semibold">{opt.label}</span>
                              <span className="text-[10px] text-muted-foreground/70">{opt.description}</span>
                            </div>
                            {isActive && (
                              <Icon name="check" className="ml-auto size-4 text-primary shrink-0" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* ── Step 2: Configuration ─────────────────────── */}
              {step === 2 && (
                <div className="flex flex-col gap-4">
                  {/* Engine summary */}
                  <div className="flex items-center gap-3 rounded-xl border border-border/50 bg-muted/30 px-4 py-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/60 bg-card shadow-sm">
                      {ENGINE_OPTIONS.find((o) => o.value === formData.engine)?.icon}
                    </div>
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="text-xs font-semibold text-foreground truncate">
                        {ENGINE_OPTIONS.find((o) => o.value === formData.engine)?.label}
                      </span>
                      <span className="text-[10px] text-muted-foreground/60 truncate">
                        {ENGINE_OPTIONS.find((o) => o.value === formData.engine)?.description}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setStep(1)}
                      className="ml-auto flex h-7 items-center gap-1 rounded-lg border border-border/60 bg-card px-2.5 text-[10px] font-medium text-muted-foreground hover:border-primary/30 hover:text-primary transition-all active:scale-95 shrink-0"
                    >
                      <Icon name="arrow-left" className="size-3" />
                      Change
                    </button>
                  </div>

                  {/* PostgreSQL-specific fields */}
                  {!isSqlite && (<>
                    {/* ── Connection section ── */}
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center gap-2">
                        <Icon name="plug" className="size-3 text-muted-foreground/40" />
                        <span className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider">
                          Connection
                        </span>
                      </div>

                      {/* Database + Port */}
                      <div className="grid grid-cols-[1fr_110px] gap-3">
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor="local-db" className="text-xs font-medium text-muted-foreground">
                            Database
                          </Label>
                          <Input
                            id="local-db"
                            placeholder="postgres"
                            value={formData.databaseName}
                            onChange={(e) => updateField("databaseName", e.target.value)}
                            required
                            className="h-8 font-mono text-xs"
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor="local-port" className="text-xs font-medium text-muted-foreground">
                            Port
                          </Label>
                          <div className="relative">
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
                              className={cn(
                                "h-8 font-mono text-xs",
                                portConflict && "pr-7 border-destructive/60 text-destructive focus-visible:ring-destructive/30",
                              )}
                            />
                            {portConflict && (
                              <Icon
                                name="alert-circle"
                                className="absolute right-2 top-1/2 -translate-y-1/2 size-3.5 text-destructive"
                              />
                            )}
                          </div>
                          {portConflict && availablePort !== undefined && (
                            <div className="flex items-center gap-1 text-[10px]">
                              <span className="text-destructive">In use.</span>
                              <button
                                type="button"
                                onClick={() => updateField("port", availablePort)}
                                className="font-semibold text-primary underline underline-offset-2 hover:text-primary/80 transition-colors"
                              >
                                Use {availablePort}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Version */}
                      <div className="flex flex-col gap-1.5">
                        <Label className="text-xs font-medium text-muted-foreground">
                          PostgreSQL Version
                        </Label>
                        <Select
                          value={formData.postgresVersion}
                          onValueChange={(value) => updateField("postgresVersion", value || "16.13.0")}
                        >
                          <SelectTrigger className="h-8 text-xs">
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
                    </div>

                    {/* ── Credentials section ── */}
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center gap-2">
                        <Icon name="lock" className="size-3 text-muted-foreground/40" />
                        <span className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider">
                          Credentials
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor="local-user" className="text-xs font-medium text-muted-foreground">
                            Username
                          </Label>
                          <Input
                            id="local-user"
                            placeholder="postgres"
                            value={formData.username}
                            onChange={(e) => updateField("username", e.target.value)}
                            required
                            className="h-8 font-mono text-xs"
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor="local-password" className="text-xs font-medium text-muted-foreground">
                            Password
                          </Label>
                          <Input
                            id="local-password"
                            type="password"
                            placeholder="Default: postgres"
                            value={formData.password}
                            onChange={(e) => updateField("password", e.target.value)}
                            className="h-8 font-mono text-xs"
                          />
                        </div>
                      </div>
                    </div>
                  </>)}

                  {/* SQLite info message */}
                  {isSqlite && (
                    <div className="rounded-xl border border-border/50 bg-blue-500/5 px-4 py-3 flex items-start gap-3">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-500/10">
                        <Icon name="info" className="size-3.5 text-blue-500/70" />
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        SQLite databases are file-based and stored locally. No server process or port configuration needed. The database file will be created automatically.
                      </p>
                    </div>
                  )}

                  {/* Auto-start */}
                  <div className="flex items-center gap-3 rounded-xl border border-border/50 bg-muted/20 p-3.5">
                    <Switch
                      id="local-auto"
                      checked={formData.autoStart}
                      onCheckedChange={(checked) => updateField("autoStart", checked)}
                    />
                    <div className="flex flex-col gap-0.5">
                      <Label htmlFor="local-auto" className="text-xs font-medium text-muted-foreground cursor-pointer">
                        Auto-start {isEditMode ? "" : "on creation"}
                      </Label>
                      <span className="text-[10px] text-muted-foreground/50">Start automatically when the app opens</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Footer — fixed */}
          <div className="flex items-center justify-between gap-2.5 border-t bg-muted/30 px-5 py-3.5 shrink-0">
            {step > 1 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setStep(step - 1)}
                disabled={isBusy}
                className="h-8 px-3 text-xs gap-1.5"
              >
                <Icon name="arrow-left" className="size-3.5" />
                Back
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onClose}
                disabled={isBusy}
                className="h-8 px-3 text-xs"
              >
                Cancel
              </Button>
            )}

            {step < TOTAL_STEPS ? (
              <Button
                type="button"
                size="sm"
                disabled={isBusy || !formData.name.trim()}
                onClick={() => setStep(step + 1)}
                className="h-8 px-5 text-xs gap-1.5 shadow-sm"
              >
                Continue
                <Icon name="arrow-right" className="size-3.5" />
              </Button>
            ) : (
              <Button
                type="submit"
                size="sm"
                disabled={isBusy || portConflict}
                className="h-8 px-5 text-xs gap-1.5 shadow-sm"
              >
                {isBusy ? (
                  <>
                    <Icon name="loader" className="size-3.5 animate-spin" />
                    {isEditMode ? "Saving…" : "Creating…"}
                  </>
                ) : isEditMode ? (
                  <>
                    <Icon name="pencil" className="size-3.5" />
                    Save Changes
                  </>
                ) : (
                  "Create Database"
                )}
              </Button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
