import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Eye, EyeOff, Loader2, Shuffle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Stepper, StepperBody, StepperContent, StepperList, StepperTrigger } from "@/components/ui/stepper";
import { PostgreSql } from "@/components/icons/PostgreSql";
import { MySql } from "@/components/icons/MySql";
import { MariaDb } from "@/components/icons/MariaDb";
import { Neon } from "@/components/icons/Neon";
import { Supabase } from "@/components/icons/Supabase";
import type { Connection, ConnectionInput, DatabaseType, SslMode } from "@/ipc/db/types";
import { cn } from "@/utils/tailwind";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DB_TYPE_OPTIONS: {
  value: DatabaseType;
  label: string;
  providers: { label: string; icon: typeof Neon }[];
}[] = [
  {
    value: "postgresql",
    label: "PostgreSQL",
    providers: [
      { label: "Neon", icon: Neon },
      { label: "Supabase", icon: Supabase },
    ],
  },
  {
    value: "mysql",
    label: "MySQL",
    providers: [],
  },
  {
    value: "mariadb",
    label: "MariaDB",
    providers: [],
  },
];

const SSL_MODES: { value: SslMode; label: string; dbTypes: DatabaseType[] }[] = [
  { value: "disable", label: "Disable", dbTypes: ["postgresql", "mysql", "mariadb"] },
  { value: "prefer", label: "Prefer", dbTypes: ["postgresql", "mysql", "mariadb"] },
  { value: "require", label: "Require", dbTypes: ["postgresql", "mysql", "mariadb"] },
  { value: "verify_ca", label: "Verify CA", dbTypes: ["postgresql", "mysql", "mariadb"] },
  { value: "verify_full", label: "Verify Full", dbTypes: ["postgresql", "mysql", "mariadb"] },
];

const DB_DEFAULTS: Record<DatabaseType, { port: number; database: string; username: string }> = {
  postgresql: { port: 5432, database: "postgres", username: "postgres" },
  mysql: { port: 3306, database: "mysql", username: "root" },
  mariadb: { port: 3306, database: "mysql", username: "root" },
};

const COLOR_OPTIONS = [
  "#3B82F6", "#6366F1", "#8B5CF6", "#A855F7",
  "#EC4899", "#F43F5E", "#EF4444", "#F97316",
  "#EAB308", "#84CC16", "#22C55E", "#14B8A6",
  "#06B6D4", "#0EA5E9", "#64748B", "#78716C",
];

const TAG_OPTIONS = ["Development", "Production", "Staging", "Testing", "Personal", "Work"];

const DEFAULT_CONNECTION: ConnectionInput = {
  name: "",
  host: "localhost",
  port: 5432,
  database: "postgres",
  username: "postgres",
  password: "",
  ssl_mode: "prefer",
  db_type: "postgresql",
};

type Step = "type" | "credentials" | "save";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateRandomName(): string {
  const adjectives = ["swift", "silent", "bright", "cosmic", "gentle", "bold", "warm", "crisp"];
  const nouns = ["river", "forest", "meadow", "peak", "valley", "stone", "sky", "lake"];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  return `${adj}-${noun}`;
}

function extractDatabaseNameFromUrl(connectionUrl: string): { database: string | null; dbType: DatabaseType | null } {
  try {
    const parsed = new URL(connectionUrl.trim());
    const protocol = parsed.protocol.toLowerCase();
    let dbType: DatabaseType | null = null;
    if (protocol === "postgres:" || protocol === "postgresql:") dbType = "postgresql";
    else if (protocol === "mysql:") dbType = "mysql";
    else if (protocol === "mariadb:") dbType = "mariadb";
    if (!dbType) return { database: null, dbType: null };
    const database = decodeURIComponent(parsed.pathname).replace(/^\/+/, "") || DB_DEFAULTS[dbType].database;
    return { database, dbType };
  } catch {
    return { database: null, dbType: null };
  }
}

// ---------------------------------------------------------------------------
// Step 1: Database Type
// ---------------------------------------------------------------------------

function StepType({
  selectedType,
  onSelect,
}: {
  selectedType: DatabaseType | null;
  onSelect: (type: DatabaseType) => void;
}) {
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Type of connection</CardTitle>
        <CardDescription>Choose the type of database you want to connect to.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          {DB_TYPE_OPTIONS.map((opt) => {
            const isActive = selectedType === opt.value;
            return (
              <Button
                key={opt.value}
                variant={isActive ? "default" : "outline"}
                onClick={() => onSelect(opt.value)}
                className={cn(
                  "flex items-center gap-2.5 px-4 py-2.5 h-auto transition-[transform,colors,box-shadow] duration-150 active:scale-[0.97]",
                  isActive && "ring-2 ring-primary/20",
                )}
              >
                {opt.value === "postgresql" && <PostgreSql className="size-4 shrink-0" />}
                {opt.value === "mysql" && <MySql className="size-4 shrink-0" />}
                {opt.value === "mariadb" && <MariaDb className="size-4 shrink-0" />}
                <span className="font-medium">{opt.label}</span>
              </Button>
            );
          })}
        </div>
        {selectedType === "postgresql" && (
          <div className="mt-4 pt-4 border-t">
            <p className="text-xs text-muted-foreground mb-3">Compatible providers</p>
            <div className="flex gap-2">
              {DB_TYPE_OPTIONS.find((o) => o.value === "postgresql")?.providers.map((provider) => (
                <div
                  key={provider.label}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-border bg-muted/30 text-xs text-muted-foreground"
                >
                  <provider.icon className="size-3.5" />
                  {provider.label}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Step 2: Credentials
// ---------------------------------------------------------------------------

type InputMode = "fields" | "url";

function StepCredentials({
  formData,
  dbType,
  inputMode,
  urlValue,
  testStatus,
  onUpdateField,
  onDbTypeChange,
  onInputModeChange,
  onUrlChange,
}: {
  formData: ConnectionInput;
  dbType: DatabaseType;
  inputMode: InputMode;
  urlValue: string;
  testStatus: { success: boolean; message: string } | null;
  onUpdateField: <K extends keyof ConnectionInput>(field: K, value: ConnectionInput[K]) => void;
  onDbTypeChange: (type: DatabaseType) => void;
  onInputModeChange: (mode: InputMode) => void;
  onUrlChange: (value: string) => void;
}) {
  const detected = extractDatabaseNameFromUrl(urlValue);
  const [showPassword, setShowPassword] = useState(false);

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Credentials</CardTitle>
        <CardDescription>Enter the connection details for your database.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4">
          {/* Database type (editable in case they want to change) */}
          <div className="flex flex-col gap-2">
            <Label className="text-xs text-muted-foreground">Database type</Label>
            <div className="flex gap-2">
              {DB_TYPE_OPTIONS.map((opt) => {
                const isActive = dbType === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => onDbTypeChange(opt.value)}
                    className={cn(
                      "flex items-center gap-2 px-3 py-1.5 rounded-md border text-xs font-medium transition-colors",
                      isActive
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-border text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground",
                    )}
                  >
                    {opt.value === "postgresql" && <PostgreSql className="size-3" />}
                    {opt.value === "mysql" && <MySql className="size-3" />}
                    {opt.value === "mariadb" && <MariaDb className="size-3" />}
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Input mode toggle */}
          <div className="flex gap-1 rounded-lg border border-border p-1">
            <button
              type="button"
              onClick={() => onInputModeChange("fields")}
              className={cn(
                "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                inputMode === "fields"
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Connection Details
            </button>
            <button
              type="button"
              onClick={() => onInputModeChange("url")}
              className={cn(
                "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                inputMode === "url"
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Connection URL
            </button>
          </div>

          {inputMode === "url" ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="connection-url" className="text-xs text-muted-foreground">
                Connection string
              </Label>
              <Textarea
                id="connection-url"
                className="font-mono text-xs min-h-[80px] resize-none"
                placeholder={`${dbType === "mysql" ? "mysql" : dbType === "mariadb" ? "mariadb" : "postgresql"}://user:password@host:port/database?sslmode=require`}
                value={urlValue}
                onChange={(e) => onUrlChange(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">
                Paste your connection string (Neon, Supabase, PlanetScale, etc.)
              </p>
              {detected.database && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CheckCircle2 className="size-3 text-green-500" />
                  Database detected: <span className="font-medium text-foreground">{detected.database}</span>
                  {detected.dbType && (
                    <span className="text-primary">({detected.dbType})</span>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2 flex flex-col gap-2">
                  <Label htmlFor="conn-host" className="text-xs text-muted-foreground">Host</Label>
                  <Input
                    id="conn-host"
                    placeholder="localhost"
                    value={formData.host}
                    onChange={(e) => onUpdateField("host", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="conn-port" className="text-xs text-muted-foreground">Port</Label>
                  <Input
                    id="conn-port"
                    type="number"
                    min={1}
                    max={65535}
                    value={formData.port}
                    onChange={(e) =>
                      onUpdateField("port", Number.parseInt(e.target.value, 10) || DB_DEFAULTS[dbType].port)
                    }
                  />
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="conn-database" className="text-xs text-muted-foreground">Database</Label>
                <Input
                  id="conn-database"
                  placeholder={DB_DEFAULTS[dbType].database}
                  value={formData.database}
                  onChange={(e) => onUpdateField("database", e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="conn-username" className="text-xs text-muted-foreground">Username</Label>
                  <Input
                    id="conn-username"
                    placeholder={DB_DEFAULTS[dbType].username}
                    value={formData.username}
                    onChange={(e) => onUpdateField("username", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="conn-password" className="text-xs text-muted-foreground">Password</Label>
                  <div className="relative">
                    <Input
                      id="conn-password"
                      type={showPassword ? "text" : "password"}
                      placeholder="••••••••"
                      value={formData.password}
                      onChange={(e) => onUpdateField("password", e.target.value)}
                      className="pr-9"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showPassword ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <Label className="text-xs text-muted-foreground">SSL Mode</Label>
                <Select
                  value={formData.ssl_mode}
                  onValueChange={(value) => onUpdateField("ssl_mode", value as SslMode)}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SSL_MODES.filter((mode) => mode.dbTypes.includes(dbType)).map((mode) => (
                      <SelectItem key={mode.value} value={mode.value}>
                        {mode.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* Test result feedback */}
          {testStatus && (
            <div
              className={cn(
                "flex items-center gap-2 text-xs p-2.5 rounded-md border",
                testStatus.success
                  ? "bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800"
                  : "bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800",
              )}
            >
              {testStatus.success ? (
                <CheckCircle2 className="size-3.5 shrink-0" />
              ) : (
                <AlertCircle className="size-3.5 shrink-0" />
              )}
              {testStatus.message}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Step 3: Save
// ---------------------------------------------------------------------------

function StepSave({
  formData,
  dbType,
  connectionString,
  onUpdateField,
}: {
  formData: ConnectionInput;
  dbType: DatabaseType;
  connectionString: string;
  onUpdateField: <K extends keyof ConnectionInput>(field: K, value: ConnectionInput[K]) => void;
}) {
  const [useCustomTag, setUseCustomTag] = useState(!!formData.tag && !TAG_OPTIONS.includes(formData.tag ?? ""));

  // Parse connection string for display
  let parsedDisplay: { host: string; port: string; database: string; username: string } | null = null;
  try {
    if (connectionString) {
      const url = new URL(connectionString);
      parsedDisplay = {
        host: url.hostname,
        port: url.port || String(DB_DEFAULTS[dbType].port),
        database: decodeURIComponent(url.pathname.replace(/^\//, "")),
        username: url.username,
      };
    }
  } catch {
    // Not a valid URL — use formData instead
  }

  const displayInfo = parsedDisplay ?? {
    host: formData.host,
    port: String(formData.port),
    database: formData.database,
    username: formData.username,
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Save connection</CardTitle>
        <CardDescription>Give your connection a name and optionally organize it.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-5">
          {/* Connection preview */}
          <div className="rounded-lg border border-border bg-muted/20 p-3">
            <table className="w-full border-collapse font-mono text-xs">
              <tbody>
                <tr>
                  <td className="py-1 pr-4 text-muted-foreground">Type</td>
                  <td className="capitalize">{dbType === "postgresql" ? "PostgreSQL" : dbType === "mysql" ? "MySQL" : "MariaDB"}</td>
                </tr>
                <tr>
                  <td className="py-1 pr-4 text-muted-foreground">Host</td>
                  <td>{displayInfo.host}</td>
                </tr>
                <tr>
                  <td className="py-1 pr-4 text-muted-foreground">Port</td>
                  <td>{displayInfo.port}</td>
                </tr>
                <tr>
                  <td className="py-1 pr-4 text-muted-foreground">Database</td>
                  <td>{displayInfo.database}</td>
                </tr>
                <tr>
                  <td className="py-1 pr-4 text-muted-foreground">User</td>
                  <td>{displayInfo.username}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Name */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="conn-name" className="text-xs text-muted-foreground">Name</Label>
            <div className="flex items-center gap-2">
              <Input
                id="conn-name"
                placeholder="My database"
                autoFocus
                value={formData.name}
                onChange={(e) => onUpdateField("name", e.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="shrink-0"
                onClick={() => onUpdateField("name", generateRandomName())}
                title="Generate a random name"
              >
                <Shuffle className="size-3.5" />
              </Button>
            </div>
          </div>

          {/* Tag */}
          <div className="flex flex-col gap-2">
            <Label className="text-xs text-muted-foreground">
              Tag <span className="text-muted-foreground/50">(optional)</span>
            </Label>
            <div className="flex flex-col gap-2">
              {!useCustomTag ? (
                <>
                  <div className="flex flex-wrap gap-1.5">
                    {TAG_OPTIONS.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => onUpdateField("tag", formData.tag === tag ? "" : tag)}
                        className={cn(
                          "px-2.5 py-1 rounded-md border text-xs font-medium transition-colors",
                          formData.tag === tag
                            ? "border-primary bg-primary/5 text-primary"
                            : "border-border text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground",
                        )}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setUseCustomTag(true)}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors text-left"
                  >
                    + Custom tag
                  </button>
                </>
              ) : (
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="Custom tag"
                    value={formData.tag ?? ""}
                    onChange={(e) => onUpdateField("tag", e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => { setUseCustomTag(false); onUpdateField("tag", ""); }}
                    className="shrink-0 text-xs text-muted-foreground"
                  >
                    Reset
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Color */}
          <div className="flex flex-col gap-2">
            <Label className="text-xs text-muted-foreground">
              Color <span className="text-muted-foreground/50">(optional)</span>
            </Label>
            <div className="flex flex-wrap gap-2">
              {COLOR_OPTIONS.map((colorOption) => (
                <button
                  key={colorOption}
                  type="button"
                  className={cn(
                    "size-6 cursor-pointer rounded-full transition-all",
                    formData.color === colorOption
                      ? `ring-2 ring-offset-2 ring-offset-background`
                      : "",
                  )}
                  style={{
                    backgroundColor: colorOption,
                    outlineColor: formData.color === colorOption ? colorOption : undefined,
                    boxShadow: formData.color === colorOption ? `0 0 0 2px var(--background), 0 0 0 4px ${colorOption}` : undefined,
                  }}
                  onClick={() => onUpdateField("color", formData.color === colorOption ? "" : colorOption)}
                />
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main ConnectionForm
// ---------------------------------------------------------------------------

interface ConnectionFormProps {
  connection: Connection | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (connection: ConnectionInput) => Promise<void>;
  onTest: (connection: ConnectionInput) => Promise<boolean>;
  isSaving: boolean;
  isTesting: boolean;
}

export function ConnectionForm({
  connection,
  isOpen,
  onClose,
  onSave,
  onTest,
  isSaving,
  isTesting,
}: ConnectionFormProps) {
  const [step, setStep] = useState<Step>("type");
  const [formData, setFormData] = useState<ConnectionInput>(DEFAULT_CONNECTION);
  const [inputMode, setInputMode] = useState<InputMode>("fields");
  const [urlValue, setUrlValue] = useState("");
  const [testStatus, setTestStatus] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  const dbType = (formData.db_type || "postgresql") as DatabaseType;

  useEffect(() => {
    if (!isOpen) return;
    if (connection) {
      setFormData({
        id: connection.id,
        name: connection.name,
        db_type: connection.db_type || "postgresql",
        host: connection.host,
        port: connection.port,
        database: connection.database,
        username: connection.username,
        password: connection.password,
        ssl_mode: connection.ssl_mode,
        is_local: connection.is_local,
        connection_string: connection.connection_string,
        engine_version: connection.engine_version,
        postgres_version: connection.postgres_version,
        tag: connection.tag,
        color: connection.color,
        local_auto_start: connection.local_auto_start,
      });
      if (connection.url) {
        setInputMode("url");
        setUrlValue(connection.url);
      } else {
        setInputMode("fields");
        setUrlValue("");
      }
      // Editing — skip to credentials step since type is already known
      setStep("credentials");
    } else {
      setFormData(DEFAULT_CONNECTION);
      setInputMode("fields");
      setUrlValue("");
      setStep("type");
    }
    setTestStatus(null);
  }, [connection, isOpen]);

  const updateField = <K extends keyof ConnectionInput>(
    field: K,
    value: ConnectionInput[K],
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setTestStatus(null);
  };

  const handleDbTypeChange = (newType: DatabaseType) => {
    const defaults = DB_DEFAULTS[newType];
    setFormData((prev) => ({
      ...prev,
      db_type: newType,
      port: prev.host === "localhost" && (prev.port === 5432 || prev.port === 3306) ? defaults.port : prev.port,
      database: ["postgres", "mysql", "mariadb"].includes(prev.database) ? defaults.database : prev.database,
      username: ["postgres", "root"].includes(prev.username) ? defaults.username : prev.username,
    }));
    setTestStatus(null);
  };

  const handleUrlChange = (value: string) => {
    setUrlValue(value);
    setTestStatus(null);
    const { database: parsedDatabase, dbType: parsedDbType } = extractDatabaseNameFromUrl(value);
    if (!parsedDatabase) return;
    setFormData((prev) => ({
      ...prev,
      ...(parsedDbType ? { db_type: parsedDbType } : {}),
      database: parsedDatabase,
      name: !connection && !prev.name.trim() ? parsedDatabase : prev.name,
    }));
  };

  const handleTest = async () => {
    setTestStatus(null);
    try {
      const dataToTest: ConnectionInput =
        inputMode === "url" && urlValue
          ? { ...formData, url: urlValue }
          : { ...formData, url: undefined };
      const success = await onTest(dataToTest);
      setTestStatus({
        success,
        message: success ? "Connection successful!" : "Connection failed",
      });
      // Auto-advance to save step on success
      if (success && step === "credentials") {
        setStep("save");
      }
    } catch (err) {
      setTestStatus({
        success: false,
        message: err instanceof Error ? err.message : "Connection test failed",
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const dataToSave: ConnectionInput =
      inputMode === "url" && urlValue
        ? { ...formData, url: urlValue }
        : { ...formData, url: undefined };
    await onSave(dataToSave);
  };

  const getConnectionDisplayString = () => {
    if (inputMode === "url" && urlValue) return urlValue;
    return `${dbType === "postgresql" ? "postgresql" : dbType}://${formData.username}:***@${formData.host}:${formData.port}/${formData.database}`;
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{connection ? "Edit Connection" : "New Connection"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <Stepper active={step} steps={["type", "credentials", "save"]}>
            <StepperList>
              <StepperTrigger value="type" number={1}>Type</StepperTrigger>
              <StepperTrigger value="credentials" number={2}>Credentials</StepperTrigger>
              <StepperTrigger value="save" number={3}>Save</StepperTrigger>
            </StepperList>

            <StepperBody>
              {/* Step 1: Type */}
              <StepperContent value="type">
                <StepType
                  selectedType={formData.db_type ?? null}
                  onSelect={(type) => {
                    handleDbTypeChange(type);
                    setStep("credentials");
                  }}
                />
              </StepperContent>

              {/* Step 2: Credentials */}
              <StepperContent value="credentials">
                <StepCredentials
                  formData={formData}
                  dbType={dbType}
                  inputMode={inputMode}
                  urlValue={urlValue}
                  testStatus={testStatus}
                  onUpdateField={updateField}
                  onDbTypeChange={handleDbTypeChange}
                  onInputModeChange={setInputMode}
                  onUrlChange={handleUrlChange}
                />
                <div className="flex justify-end gap-2 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setStep("type")}
                  >
                    Back
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={isTesting}
                    onClick={handleTest}
                  >
                    {isTesting ? (
                      <>
                        <Loader2 className="size-3.5 animate-spin" />
                        Testing...
                      </>
                    ) : testStatus?.success ? (
                      "Continue"
                    ) : (
                      "Test connection"
                    )}
                  </Button>
                </div>
              </StepperContent>

              {/* Step 3: Save */}
              <StepperContent value="save">
                <StepSave
                  formData={formData}
                  dbType={dbType}
                  connectionString={getConnectionDisplayString()}
                  onUpdateField={updateField}
                />
                <div className="flex justify-end gap-2 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setStep("credentials")}
                  >
                    Back
                  </Button>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={isSaving || !formData.name.trim()}
                  >
                    {isSaving ? (
                      <>
                        <Loader2 className="size-3.5 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      "Save connection"
                    )}
                  </Button>
                </div>
              </StepperContent>
            </StepperBody>
          </Stepper>
        </form>
      </DialogContent>
    </Dialog>
  );
}
