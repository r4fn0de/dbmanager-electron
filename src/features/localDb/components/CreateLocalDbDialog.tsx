import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { PostgreSql } from "@/components/icons/PostgreSql";
import { Sqlite } from "@/components/icons/Sqlite";
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
import type { LocalDbEngine } from "@/ipc/db/types";
import { ipc } from "@/ipc/manager";
import { cn } from "@/lib/utils";

// ── Shared constants ──────────────────────────────────────────────────

function generateRandomName(): string {
  const adjectives = [
    "swift",
    "silent",
    "bright",
    "cosmic",
    "gentle",
    "bold",
    "warm",
    "crisp",
  ];
  const nouns = [
    "river",
    "forest",
    "meadow",
    "peak",
    "valley",
    "stone",
    "sky",
    "lake",
  ];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  return `${adj}-${noun}`;
}

const COLOR_OPTIONS = [
  "#3B82F6",
  "#6366F1",
  "#8B5CF6",
  "#A855F7",
  "#EC4899",
  "#F43F5E",
  "#EF4444",
  "#F97316",
  "#EAB308",
  "#84CC16",
  "#22C55E",
  "#14B8A6",
  "#06B6D4",
  "#0EA5E9",
  "#64748B",
  "#78716C",
];

const TAG_OPTIONS = [
  "Development",
  "Production",
  "Staging",
  "Testing",
  "Personal",
  "Work",
];

const POSTGRES_VERSIONS = [
  { label: "PostgreSQL 18", value: "18.3.0" },
  { label: "PostgreSQL 17", value: "17.9.0" },
  { label: "PostgreSQL 16", value: "16.13.0" },
  { label: "PostgreSQL 15", value: "15.17.0" },
  { label: "PostgreSQL 14", value: "14.22.0" },
];

const ENGINE_OPTIONS: {
  value: LocalDbEngine;
  label: string;
  icon: React.ReactNode;
  description: string;
}[] = [
  {
    description: "Embedded PostgreSQL server",
    icon: <PostgreSql className="size-4 shrink-0" />,
    label: "PostgreSQL",
    value: "postgresql",
  },
  {
    description: "File-based, no server needed",
    icon: <Sqlite className="h-4 w-auto shrink-0" />,
    label: "SQLite",
    value: "sqlite",
  },
];

const DEFAULT_FORM_DATA: CreateLocalDbInput = {
  autoStart: true,
  databaseName: "postgres",
  engine: "postgresql",
  name: "",
  password: "",
  port: 5432,
  postgresVersion: "16.13.0",
  username: "postgres",
};

export interface CreateLocalDbInput {
  autoStart: boolean;
  color?: string;
  databaseName: string;
  engine: LocalDbEngine;
  name: string;
  password: string;
  port: number;
  postgresVersion: string;
  tag?: string;
  username: string;
}

interface CreateLocalDbDialogProps {
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
  isCreating: boolean;
  isOpen: boolean;
  isUpdating?: boolean;
  onClose: () => void;
  onCreate: (input: CreateLocalDbInput) => Promise<void>;
  onUpdate?: (id: string, input: CreateLocalDbInput) => Promise<void>;
}

function Stepper({
  currentStep,
  totalSteps,
}: {
  currentStep: number;
  totalSteps: number;
}) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: totalSteps }, (_, i) => {
        const step = i + 1;
        const isActive = step === currentStep;
        const isCompleted = step < currentStep;
        return (
          <div className="flex items-center gap-2" key={step}>
            <div
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-full border font-semibold text-[10px] transition-all",
                isActive &&
                  "border-primary bg-primary text-primary-foreground shadow-sm",
                isCompleted && "border-primary/30 bg-primary/10 text-primary",
                !(isActive || isCompleted) &&
                  "border-border bg-muted text-muted-foreground"
              )}
            >
              {isCompleted ? <Icon className="size-3" name="check" /> : step}
            </div>
            <span
              className={cn(
                "font-medium text-[11px] transition-colors",
                isActive ? "text-foreground" : "text-muted-foreground/50"
              )}
            >
              {step === 1 ? "Identity" : "Configuration"}
            </span>
            {step < totalSteps && (
              <div
                className={cn(
                  "h-px w-6 transition-colors",
                  isCompleted ? "bg-primary/30" : "bg-border"
                )}
              />
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

  const [formData, setFormData] =
    useState<CreateLocalDbInput>(DEFAULT_FORM_DATA);
  const [useCustomTag, setUseCustomTag] = useState(false);
  const [step, setStep] = useState(1);

  // ── Port availability check (only for PostgreSQL on step 2) ─────────
  const { data: availablePort } = useQuery({
    enabled: step === 2 && formData.engine === "postgresql" && isOpen,
    queryFn: async () => await ipc.client.db.findAvailablePort(),
    queryKey: ["findAvailablePort", step, formData.engine, editConnection?.id],
    staleTime: 5000,
  });

  const portConflict =
    step === 2 &&
    formData.engine === "postgresql" &&
    availablePort !== undefined &&
    availablePort !== formData.port;

  // Sync form when dialog opens or editConnection changes
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setStep(1);

    if (editConnection) {
      setFormData({
        autoStart: editConnection.autoStart,
        color: editConnection.color,
        databaseName: editConnection.databaseName,
        engine: editConnection.engine ?? "postgresql",
        name: editConnection.name,
        password: editConnection.password,
        port: editConnection.port,
        postgresVersion: editConnection.postgresVersion,
        tag: editConnection.tag,
        username: editConnection.username,
      });
      setUseCustomTag(
        !!editConnection.tag && !TAG_OPTIONS.includes(editConnection.tag)
      );
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
    value: CreateLocalDbInput[K]
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const isSqlite = formData.engine === "sqlite";

  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open={isOpen}>
      <DialogContent className="t-resize flex max-h-[90vh] flex-col gap-0 p-0 sm:max-w-[460px]">
        {/* Header — fixed */}
        <div className="shrink-0 p-5 pb-0">
          <DialogHeader className="gap-3">
            <DialogTitle className="flex items-center gap-2">
              <Icon
                className="size-4 text-muted-foreground"
                name="hard-drive"
              />
              {isEditMode ? "Edit Local Database" : "New Local Database"}
            </DialogTitle>
            <Stepper currentStep={step} totalSteps={TOTAL_STEPS} />
          </DialogHeader>
        </div>

        {/* Scrollable body */}
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
          <div className="flex-1 overflow-y-auto">
            <div className="flex flex-col gap-5 p-5">
              {/* ── Step 1: Identity + Engine ─────────────────── */}
              {step === 1 && (
                <div className="flex flex-col gap-5">
                  {/* Name + Random */}
                  <div className="flex flex-col gap-1.5">
                    <Label
                      className="font-medium text-muted-foreground text-xs"
                      htmlFor="local-name"
                    >
                      Name
                    </Label>
                    <div className="flex items-center gap-2">
                      <Input
                        className="h-8"
                        id="local-name"
                        onChange={(e) => updateField("name", e.target.value)}
                        placeholder="My Local DB"
                        required
                        value={formData.name}
                      />
                      <Button
                        className="shrink-0 transition-transform duration-150 ease-out active:scale-[0.97]"
                        onClick={() =>
                          updateField("name", generateRandomName())
                        }
                        size="icon-xs"
                        title="Generate random name"
                        type="button"
                        variant="outline"
                      >
                        <Icon className="size-3" name="shuffle" />
                      </Button>
                    </div>
                  </div>

                  {/* Tag */}
                  <div className="flex flex-col gap-1.5">
                    <Label className="font-medium text-muted-foreground text-xs">
                      Tag{" "}
                      <span className="text-muted-foreground/50 normal-case tracking-normal">
                        — optional
                      </span>
                    </Label>
                    {useCustomTag ? (
                      <div className="flex items-center gap-2">
                        <Input
                          className="h-8 text-xs"
                          onChange={(e) => updateField("tag", e.target.value)}
                          placeholder="Custom tag"
                          value={formData.tag ?? ""}
                        />
                        <Button
                          className="h-8 shrink-0 px-2 text-muted-foreground text-xs"
                          onClick={() => {
                            setUseCustomTag(false);
                            updateField("tag", "");
                          }}
                          size="sm"
                          type="button"
                          variant="ghost"
                        >
                          <Icon className="size-3" name="x" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {TAG_OPTIONS.map((tag) => (
                          <button
                            className={cn(
                              "rounded-full border px-3 py-1 font-medium text-[11px] transition-colors duration-150 active:scale-[0.97]",
                              formData.tag === tag
                                ? "border-primary/40 bg-primary/10 text-primary shadow-sm"
                                : "border-border/60 text-muted-foreground hover:border-muted-foreground/40 hover:bg-muted/30 hover:text-foreground"
                            )}
                            key={tag}
                            onClick={() =>
                              updateField(
                                "tag",
                                formData.tag === tag ? "" : tag
                              )
                            }
                            type="button"
                          >
                            {tag}
                          </button>
                        ))}
                        <button
                          className="rounded-full border border-border/60 border-dashed px-3 py-1 text-[11px] text-muted-foreground transition-colors duration-150 hover:border-muted-foreground/40 hover:bg-muted/30 hover:text-foreground active:scale-[0.97]"
                          onClick={() => setUseCustomTag(true)}
                          type="button"
                        >
                          + custom
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Color */}
                  <div className="flex flex-col gap-1.5">
                    <Label className="font-medium text-muted-foreground text-xs">
                      Color{" "}
                      <span className="text-muted-foreground/50 normal-case tracking-normal">
                        — optional
                      </span>
                    </Label>
                    <div className="flex flex-wrap gap-2">
                      {COLOR_OPTIONS.map((colorOption) => (
                        <button
                          className={cn(
                            "size-5 rounded-full transition-transform duration-200 ease-out hover:scale-110 hover:shadow-md",
                            formData.color === colorOption &&
                              "scale-110 ring-2 ring-primary/50 ring-offset-2 ring-offset-background"
                          )}
                          key={colorOption}
                          onClick={() =>
                            updateField(
                              "color",
                              formData.color === colorOption ? "" : colorOption
                            )
                          }
                          style={{ backgroundColor: colorOption }}
                          title={colorOption}
                          type="button"
                        />
                      ))}
                    </div>
                  </div>

                  {/* Engine selector */}
                  <div className="flex flex-col gap-2">
                    <Label className="font-medium text-muted-foreground text-xs">
                      Engine
                    </Label>
                    <div className="flex flex-col gap-2">
                      {ENGINE_OPTIONS.map((opt) => {
                        const isActive = formData.engine === opt.value;
                        return (
                          <button
                            className={cn(
                              "flex items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors duration-150 ease-out active:scale-[0.98]",
                              isActive
                                ? "border-primary/30 bg-primary/5 text-primary shadow-sm"
                                : "border-border bg-transparent text-muted-foreground hover:border-muted-foreground/30 hover:bg-muted/20 hover:text-foreground"
                            )}
                            key={opt.value}
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
                            type="button"
                          >
                            <div
                              className={cn(
                                "flex h-9 w-9 items-center justify-center rounded-lg border transition-colors",
                                isActive
                                  ? "border-primary/20 bg-primary/10"
                                  : "border-border bg-muted/40"
                              )}
                            >
                              {opt.icon}
                            </div>
                            <div className="flex flex-col gap-0.5">
                              <span className="font-semibold text-xs">
                                {opt.label}
                              </span>
                              <span className="text-[10px] text-muted-foreground/70">
                                {opt.description}
                              </span>
                            </div>
                            {isActive && (
                              <Icon
                                className="ml-auto size-4 shrink-0 text-primary"
                                name="check"
                              />
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
                      {
                        ENGINE_OPTIONS.find((o) => o.value === formData.engine)
                          ?.icon
                      }
                    </div>
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate font-semibold text-foreground text-xs">
                        {
                          ENGINE_OPTIONS.find(
                            (o) => o.value === formData.engine
                          )?.label
                        }
                      </span>
                      <span className="truncate text-[10px] text-muted-foreground/60">
                        {
                          ENGINE_OPTIONS.find(
                            (o) => o.value === formData.engine
                          )?.description
                        }
                      </span>
                    </div>
                    <button
                      className="ml-auto flex h-7 shrink-0 items-center gap-1 rounded-lg border border-border/60 bg-card px-2.5 font-medium text-[10px] text-muted-foreground transition-all hover:border-primary/30 hover:text-primary active:scale-95"
                      onClick={() => setStep(1)}
                      type="button"
                    >
                      <Icon className="size-3" name="chevron-left" />
                      Change
                    </button>
                  </div>

                  {/* PostgreSQL-specific fields */}
                  {!isSqlite && (
                    <>
                      {/* ── Connection section ── */}
                      <div className="flex flex-col gap-3">
                        <div className="flex items-center gap-2">
                          <Icon
                            className="size-3 text-muted-foreground/40"
                            name="plug-connected"
                          />
                          <span className="font-semibold text-[10px] text-muted-foreground/60 uppercase tracking-wider">
                            Connection
                          </span>
                        </div>

                        {/* Database + Port */}
                        <div className="grid grid-cols-[1fr_110px] gap-3">
                          <div className="flex flex-col gap-1.5">
                            <Label
                              className="font-medium text-muted-foreground text-xs"
                              htmlFor="local-db"
                            >
                              Database
                            </Label>
                            <Input
                              className="h-8 font-mono text-xs"
                              id="local-db"
                              onChange={(e) =>
                                updateField("databaseName", e.target.value)
                              }
                              placeholder="postgres"
                              required
                              value={formData.databaseName}
                            />
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <Label
                              className="font-medium text-muted-foreground text-xs"
                              htmlFor="local-port"
                            >
                              Port
                            </Label>
                            <div className="relative">
                              <Input
                                className={cn(
                                  "h-8 font-mono text-xs",
                                  portConflict &&
                                    "border-destructive/60 pr-7 text-destructive focus-visible:ring-destructive/30"
                                )}
                                id="local-port"
                                max={65_535}
                                min={1024}
                                onChange={(e) =>
                                  updateField(
                                    "port",
                                    Number.parseInt(e.target.value, 10) || 5432
                                  )
                                }
                                required
                                type="number"
                                value={formData.port}
                              />
                              {portConflict && (
                                <Icon
                                  className="absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-destructive"
                                  name="alert-circle"
                                />
                              )}
                            </div>
                            {portConflict && availablePort !== undefined && (
                              <div className="flex items-center gap-1 text-[10px]">
                                <span className="text-destructive">
                                  In use.
                                </span>
                                <button
                                  className="font-semibold text-primary underline underline-offset-2 transition-colors hover:text-primary/80"
                                  onClick={() =>
                                    updateField("port", availablePort)
                                  }
                                  type="button"
                                >
                                  Use {availablePort}
                                </button>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Version */}
                        <div className="flex flex-col gap-1.5">
                          <Label className="font-medium text-muted-foreground text-xs">
                            PostgreSQL Version
                          </Label>
                          <Select
                            onValueChange={(value) =>
                              updateField("postgresVersion", value || "16.13.0")
                            }
                            value={formData.postgresVersion}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {POSTGRES_VERSIONS.map((v) => (
                                <SelectItem
                                  key={v.value}
                                  value={v.value || "16.13.0"}
                                >
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
                          <Icon
                            className="size-3 text-muted-foreground/40"
                            name="lock"
                          />
                          <span className="font-semibold text-[10px] text-muted-foreground/60 uppercase tracking-wider">
                            Credentials
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="flex flex-col gap-1.5">
                            <Label
                              className="font-medium text-muted-foreground text-xs"
                              htmlFor="local-user"
                            >
                              Username
                            </Label>
                            <Input
                              className="h-8 font-mono text-xs"
                              id="local-user"
                              onChange={(e) =>
                                updateField("username", e.target.value)
                              }
                              placeholder="postgres"
                              required
                              value={formData.username}
                            />
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <Label
                              className="font-medium text-muted-foreground text-xs"
                              htmlFor="local-password"
                            >
                              Password
                            </Label>
                            <Input
                              className="h-8 font-mono text-xs"
                              id="local-password"
                              onChange={(e) =>
                                updateField("password", e.target.value)
                              }
                              placeholder="Default: postgres"
                              type="password"
                              value={formData.password}
                            />
                          </div>
                        </div>
                      </div>
                    </>
                  )}

                  {/* SQLite info message */}
                  {isSqlite && (
                    <div className="flex items-start gap-3 rounded-xl border border-border/50 bg-blue-500/5 px-4 py-3">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-500/10">
                        <Icon
                          className="size-3.5 text-blue-500/70"
                          name="info"
                        />
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        SQLite databases are file-based and stored locally. No
                        server process or port configuration needed. The
                        database file will be created automatically.
                      </p>
                    </div>
                  )}

                  {/* Auto-start */}
                  <div className="flex items-center gap-3 rounded-xl border border-border/50 bg-muted/20 p-3.5">
                    <Switch
                      checked={formData.autoStart}
                      id="local-auto"
                      onCheckedChange={(checked) =>
                        updateField("autoStart", checked)
                      }
                    />
                    <div className="flex flex-col gap-0.5">
                      <Label
                        className="cursor-pointer font-medium text-muted-foreground text-xs"
                        htmlFor="local-auto"
                      >
                        Auto-start {isEditMode ? "" : "on creation"}
                      </Label>
                      <span className="text-[10px] text-muted-foreground/50">
                        Start automatically when the app opens
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Footer — fixed */}
          <div className="flex shrink-0 items-center justify-between gap-2.5 border-t bg-muted/30 px-5 py-3.5">
            {step > 1 ? (
              <Button
                className="h-8 gap-1.5 px-3 text-xs"
                disabled={isBusy}
                onClick={() => setStep(step - 1)}
                size="sm"
                type="button"
                variant="ghost"
              >
                <Icon className="size-3.5" name="chevron-left" />
                Back
              </Button>
            ) : (
              <Button
                className="h-8 px-3 text-xs"
                disabled={isBusy}
                onClick={onClose}
                size="sm"
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>
            )}

            {step < TOTAL_STEPS ? (
              <Button
                className="h-8 gap-1.5 px-5 text-xs shadow-sm"
                disabled={isBusy || !formData.name.trim()}
                onClick={() => setStep(step + 1)}
                size="sm"
                type="button"
              >
                Continue
                <Icon className="size-3.5" name="arrow-right" />
              </Button>
            ) : (
              <Button
                className="h-8 gap-1.5 px-5 text-xs shadow-sm"
                disabled={isBusy || portConflict}
                size="sm"
                type="submit"
              >
                {isBusy ? (
                  <>
                    <Icon className="size-3.5 animate-spin" name="loader" />
                    {isEditMode ? "Saving…" : "Creating…"}
                  </>
                ) : isEditMode ? (
                  <>
                    <Icon className="size-3.5" name="pencil" />
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
