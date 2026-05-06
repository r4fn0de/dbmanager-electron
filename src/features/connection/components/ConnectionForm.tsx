import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon as UiIcon } from "@/components/ui/Icon";
import {
  Dialog,
  DialogContent,
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
import { Textarea } from "@/components/ui/textarea";
import { PostgreSql } from "@/components/icons/PostgreSql";
import { MySql } from "@/components/icons/MySql";
import { MariaDb } from "@/components/icons/MariaDb";
import { ClickHouse } from "@/components/icons/ClickHouse";
import { Sqlite } from "@/components/icons/Sqlite";
import type { Connection, ConnectionInput, DatabaseType, SslMode } from "@/ipc/db/types";
import { getClickhouseEffectivePort } from "@/ipc/db/types";
import { cn } from "@/lib/utils";

const DB_TYPE_OPTIONS: {
  value: DatabaseType;
  label: string;
  icon: React.ReactNode;
}[] = [
  { value: "postgresql", label: "PostgreSQL", icon: <PostgreSql className="size-3 shrink-0" /> },
  { value: "mysql", label: "MySQL", icon: <MySql className="size-3 shrink-0" /> },
  { value: "mariadb", label: "MariaDB", icon: <MariaDb className="size-3 shrink-0" /> },
  { value: "clickhouse", label: "ClickHouse", icon: <ClickHouse className="size-3 shrink-0" /> },
  { value: "sqlite", label: "SQLite", icon: <Sqlite className="size-3 shrink-0" /> },
];

const SSL_MODES: { value: SslMode; label: string; dbTypes: DatabaseType[] }[] = [
  { value: "disable", label: "Disable", dbTypes: ["postgresql", "mysql", "mariadb", "clickhouse", "sqlite"] },
  { value: "prefer", label: "Prefer", dbTypes: ["postgresql", "mysql", "mariadb"] },
  { value: "require", label: "Require", dbTypes: ["postgresql", "mysql", "mariadb", "clickhouse"] },
  { value: "verify_ca", label: "Verify CA", dbTypes: ["postgresql", "mysql", "mariadb"] },
  { value: "verify_full", label: "Verify Full", dbTypes: ["postgresql", "mysql", "mariadb"] },
];

const DB_DEFAULTS: Record<DatabaseType, { port: number; database: string; username: string }> = {
  postgresql: { port: 5432, database: "postgres", username: "postgres" },
  mysql: { port: 3306, database: "mysql", username: "root" },
  mariadb: { port: 3306, database: "mysql", username: "root" },
  clickhouse: { port: 8123, database: "default", username: "default" },
  sqlite: { port: 0, database: "main", username: "" },
  redis: {
    port: 0,
    database: "",
    username: ""
  }
};

const COLOR_OPTIONS = [
  "#3B82F6", "#6366F1", "#8B5CF6", "#A855F7",
  "#EC4899", "#F43F5E", "#EF4444", "#F97316",
  "#EAB308", "#84CC16", "#22C55E", "#14B8A6",
  "#06B6D4", "#0EA5E9", "#64748B", "#78716C",
];

const TAG_OPTIONS = ["Development", "Production", "Staging", "Testing", "Personal", "Work"];

const DEFAULT_CONNECTION = {
  name: "",
  host: "localhost",
  port: 5432,
  database: "postgres",
  username: "postgres",
  password: "",
  ssl_mode: "prefer" as SslMode,
} as ConnectionInput;

function generateRandomName(): string {
  const adjectives = ["swift", "silent", "bright", "cosmic", "gentle", "bold", "warm", "crisp"];
  const nouns = ["river", "forest", "meadow", "peak", "valley", "stone", "sky", "lake"];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  return `${adj}-${noun}`;
}

function extractFromUrl(connectionUrl: string): {
  dbType: DatabaseType | null;
  host: string | null;
  port: number | null;
  database: string | null;
  username: string | null;
  password: string | null;
  sslMode: SslMode | null;
} {
  try {
    const url = new URL(connectionUrl.trim());
    const protocol = url.protocol.toLowerCase();
    let dbType: DatabaseType | null = null;
    if (protocol === "postgres:" || protocol === "postgresql:") dbType = "postgresql";
    else if (protocol === "mysql:") dbType = "mysql";
    else if (protocol === "mariadb:") dbType = "mariadb";
    else if (protocol === "clickhouse:" || protocol === "clickhouses:") dbType = "clickhouse";
    else if (protocol === "sqlite:") dbType = "sqlite";
    if (!dbType) return { dbType: null, host: null, port: null, database: null, username: null, password: null, sslMode: null };

    const host = url.hostname || null;
    const port = url.port ? Number.parseInt(url.port, 10) : null;
    const database = decodeURIComponent(url.pathname).replace(/^\/+/, "") || null;
    const username = url.username || null;
    const password = url.password || null;

    let sslMode: SslMode | null = null;
    const sslParam = url.searchParams.get("sslmode") || url.searchParams.get("ssl");
    if (sslParam) {
      const valid = SSL_MODES.map((m) => m.value);
      if (valid.includes(sslParam as SslMode)) sslMode = sslParam as SslMode;
    }

    return { dbType, host, port, database, username, password, sslMode };
  } catch {
    return { dbType: null, host: null, port: null, database: null, username: null, password: null, sslMode: null };
  }
}

function getConnectionHash(data: ConnectionInput, url?: string): string {
  return JSON.stringify({
    db_type: data.db_type,
    host: data.host,
    port: data.port,
    database: data.database,
    username: data.username,
    password: data.password,
    ssl_mode: data.ssl_mode,
    url,
  });
}

function validateConnectionUrl(value: string): { isValid: boolean; message: string } {
  const raw = value.trim();
  if (!raw) return { isValid: false, message: "Enter a connection string." };
  try {
    const parsed = new URL(raw);
    const protocol = parsed.protocol.toLowerCase();
    const supportedProtocols = ["postgres:", "postgresql:", "mysql:", "mariadb:", "clickhouse:", "clickhouses:", "sqlite:"];
    if (!supportedProtocols.includes(protocol)) {
      return { isValid: false, message: "Unsupported protocol in connection string." };
    }
    if (protocol === "sqlite:") {
      if (!parsed.pathname || parsed.pathname === "/") {
        return { isValid: false, message: "SQLite URL must include the database file path." };
      }
      return { isValid: true, message: "Valid SQLite connection string." };
    }
    if (!parsed.hostname) {
      return { isValid: false, message: "Connection string must include a host." };
    }
    if (!parsed.pathname || parsed.pathname === "/") {
      return { isValid: false, message: "Connection string must include a database name." };
    }
    return { isValid: true, message: "Valid connection string." };
  } catch {
    return { isValid: false, message: "Invalid connection string format." };
  }
}

function UrlInput({
  dbType,
  urlValue,
  onUrlChange,
  validation,
  autoFocus,
}: {
  dbType: DatabaseType;
  urlValue: string;
  onUrlChange: (value: string) => void;
  validation: { isValid: boolean; message: string };
  autoFocus?: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const detected = extractFromUrl(urlValue);

  useEffect(() => {
    if (autoFocus && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [autoFocus]);

  const items: string[] = [];
  if (detected.dbType) items.push(detected.dbType);
  if (detected.host) items.push(detected.host);
  if (detected.port) items.push(String(detected.port));
  if (detected.database) items.push(detected.database);

  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <Textarea
        ref={textareaRef}
        id="connection-url"
        rows={2}
        className="min-h-16 w-full max-w-full resize-none break-all wrap-anywhere whitespace-pre-wrap rounded-lg border-border bg-muted/15 font-mono text-xs leading-relaxed transition-colors focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/30"
        placeholder={`${dbType}://user:password@host:${DB_DEFAULTS[dbType].port}/database`}
        value={urlValue}
        onChange={(e) => onUrlChange(e.target.value)}
      />
      <p className={cn("text-[11px]", validation.isValid ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>
        {validation.message}
      </p>

    </div>
  );
}

function DetailsFields({
  formData,
  onUpdateField,
}: {
  formData: ConnectionInput;
  onUpdateField: <K extends keyof ConnectionInput>(field: K, value: ConnectionInput[K]) => void;
}) {
  const dbType = (formData.db_type || "postgresql") as DatabaseType;
  const [showPassword, setShowPassword] = useState(false);

  const handleSslModeChange = (value: SslMode) => {
    onUpdateField("ssl_mode", value);
    if (dbType !== "clickhouse") return;
    const currentPort = Number(formData.port) || DB_DEFAULTS.clickhouse.port;
    if (value === "require" && currentPort === 8123) {
      onUpdateField("port", getClickhouseEffectivePort("require", currentPort));
      return;
    }
    if (value !== "require" && currentPort === 8443) {
      onUpdateField("port", 8123);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {/* SQLite: file-based, no host/port/user/password needed */}
      {dbType === "sqlite" ? (
        <div className="flex flex-col gap-1">
          <Label htmlFor="conn-database" className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Database File Path
          </Label>
          <Input
            id="conn-database"
            placeholder="/path/to/database.db"
            value={formData.database}
            onChange={(e) => onUpdateField("database", e.target.value)}
            className="h-7 font-mono text-xs"
          />
          <p className="text-[11px] text-muted-foreground">
            SQLite is file-based — enter the path to the .db file or it will be created automatically.
          </p>
        </div>
      ) : (<>
        <div className="grid grid-cols-[1fr_76px] gap-2.5">
          <div className="flex flex-col gap-1">
            <Label htmlFor="conn-host" className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              Host
            </Label>
            <Input
              id="conn-host"
              placeholder="localhost"
              value={formData.host}
              onChange={(e) => onUpdateField("host", e.target.value)}
              className="h-7 font-mono text-xs"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="conn-port" className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              Port
            </Label>
            <Input
              id="conn-port"
              type="number"
              min={1}
              max={65535}
              value={formData.port}
              onChange={(e) =>
                onUpdateField("port", Number.parseInt(e.target.value, 10) || DB_DEFAULTS[dbType].port)
              }
              className="h-7 font-mono text-xs"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="conn-database" className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Database
          </Label>
          <Input
            id="conn-database"
            placeholder={DB_DEFAULTS[dbType].database}
            value={formData.database}
            onChange={(e) => onUpdateField("database", e.target.value)}
            className="h-7 font-mono text-xs"
          />
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div className="flex flex-col gap-1">
            <Label htmlFor="conn-username" className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              Username
            </Label>
            <Input
              id="conn-username"
              placeholder={DB_DEFAULTS[dbType].username}
              value={formData.username}
              onChange={(e) => onUpdateField("username", e.target.value)}
              className="h-7 font-mono text-xs"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="conn-password" className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              Password
            </Label>
            <div className="relative">
              <Input
                id="conn-password"
                type={showPassword ? "text" : "password"}
                placeholder="••••••••"
                value={formData.password}
                onChange={(e) => onUpdateField("password", e.target.value)}
                className="h-7 pr-8 font-mono text-xs"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showPassword ? <UiIcon name="eye-off" className="size-3" /> : <UiIcon name="eye" className="size-3" />}
              </button>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <Label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            SSL
          </Label>
          <Select
            value={formData.ssl_mode}
            onValueChange={(value) => handleSslModeChange(value as SslMode)}
          >
            <SelectTrigger className="h-7 text-xs">
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
          {dbType === "clickhouse" && (
            <p className="text-[10px] text-muted-foreground">
              SSL require uses HTTPS (`clickhouses://`) and usually port 8443.
            </p>
          )}
        </div>
      </>)}
    </div>
  );
}

function OrganizationFields({
  formData,
  onUpdateField,
}: {
  formData: ConnectionInput;
  onUpdateField: <K extends keyof ConnectionInput>(field: K, value: ConnectionInput[K]) => void;
}) {
  const [useCustomTag, setUseCustomTag] = useState(
    !!formData.tag && !TAG_OPTIONS.includes(formData.tag ?? ""),
  );

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-1">
        <Label htmlFor="conn-name" className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          Name
        </Label>
        <div className="flex items-center gap-2">
          <Input
            id="conn-name"
            placeholder="My database"
            value={formData.name}
            onChange={(e) => onUpdateField("name", e.target.value)}
            className="h-7"
          />
          <Button
            type="button"
            variant="outline"
            size="icon-xs"
            className="shrink-0"
            onClick={() => onUpdateField("name", generateRandomName())}
            title="Generate random name"
          >
            <UiIcon name="shuffle" className="size-3" />
          </Button>
        </div>
      </div>

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
                onClick={() => onUpdateField("tag", formData.tag === tag ? "" : tag)}
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
              onChange={(e) => onUpdateField("tag", e.target.value)}
              className="h-7 text-xs"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => { setUseCustomTag(false); onUpdateField("tag", ""); }}
              className="h-7 shrink-0 px-2 text-xs text-muted-foreground"
            >
              <UiIcon name="x" className="size-3" />
            </Button>
          </div>
        )}
      </div>

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
              onClick={() => onUpdateField("color", formData.color === colorOption ? "" : colorOption)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

type InputMode = "url" | "details";
type FormStep = "select_db" | "configure";
type ConfigureStep = "connection" | "organization";

interface ConnectionFormProps {
  connection: Connection | null;
  connections: Connection[];
  isOpen: boolean;
  onClose: () => void;
  onSave: (connection: ConnectionInput) => Promise<void>;
  onTest: (connection: ConnectionInput) => Promise<boolean>;
  isSaving: boolean;
  isTesting: boolean;
}

function normalizeUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    url.hash = "";
    url.searchParams.delete("sslmode");
    url.searchParams.delete("ssl");
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function findDuplicateConnection(
  connections: Connection[],
  formData: ConnectionInput,
  urlValue: string | undefined,
  inputMode: InputMode,
  editingId: string | undefined,
): Connection | null {
  return connections.find((c) => {
    if (c.id === editingId) return false;
    if (c.db_type !== (formData.db_type || "postgresql")) return false;

    if (inputMode === "url" && urlValue) {
      const normalized = normalizeUrl(urlValue);
      const existing = normalizeUrl(c.url || c.connection_string || "");
      if (normalized && existing && normalized === existing) return true;
    }

    return (
      c.host === formData.host
      && c.port === formData.port
      && c.database === formData.database
      && c.username === formData.username
    );
  }) ?? null;
}

export function ConnectionForm({
  connection,
  connections,
  isOpen,
  onClose,
  onSave,
  onTest,
  isSaving,
  isTesting,
}: ConnectionFormProps) {
  const isEditing = Boolean(connection);
  const [formData, setFormData] = useState<ConnectionInput>(DEFAULT_CONNECTION);
  const [inputMode, setInputMode] = useState<InputMode>("url");
  const [urlValue, setUrlValue] = useState("");
  const [testStatus, setTestStatus] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [lastTestedHash, setLastTestedHash] = useState<string>("");
  const [formStep, setFormStep] = useState<FormStep>("configure");
  const [configureStep, setConfigureStep] = useState<ConfigureStep>("connection");

  const dbType = (formData.db_type || "postgresql") as DatabaseType;

  const connectionHash = useMemo(
    () => getConnectionHash(formData, inputMode === "url" ? urlValue : undefined),
    [formData, inputMode, urlValue],
  );

  const hasTestedCurrent = lastTestedHash === connectionHash && testStatus?.success === true;
  const connectionStringValidation = useMemo(
    () => validateConnectionUrl(urlValue),
    [urlValue],
  );

  const duplicateConnection = useMemo(
    () =>
      !isEditing
        ? findDuplicateConnection(
            connections,
            formData,
            inputMode === "url" ? urlValue : undefined,
            inputMode,
            connection?.id,
          )
        : null,
    [connections, formData, inputMode, urlValue, isEditing, connection?.id],
  );

  // Reset / init form when dialog opens
  useEffect(() => {
    if (!isOpen) return;

    if (connection) {
      const base: ConnectionInput = {
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
      };
      setFormData(base);
      setInputMode("details");
      setFormStep("configure");
      setConfigureStep("connection");
      setUrlValue("");
      setLastTestedHash(getConnectionHash(base, connection.url || undefined));
      setTestStatus({ success: true, message: "Connection already verified" });
    } else {
      setFormData(DEFAULT_CONNECTION);
      setInputMode("url");
      setFormStep("select_db");
      setConfigureStep("connection");
      setUrlValue("");
      setLastTestedHash("");
      setTestStatus(null);
    }
  }, [connection, isOpen]);

  const updateField = <K extends keyof ConnectionInput>(
    field: K,
    value: ConnectionInput[K],
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleUrlChange = (value: string) => {
    setUrlValue(value);
    const parsed = extractFromUrl(value);
    if (!parsed.dbType && !parsed.host) return;

    setFormData((prev) => ({
      ...prev,
      ...(parsed.dbType ? { db_type: parsed.dbType } : {}),
      ...(parsed.host ? { host: parsed.host } : {}),
      ...(parsed.port ? { port: parsed.port } : {}),
      ...(parsed.database ? { database: parsed.database } : {}),
      ...(parsed.username ? { username: parsed.username } : {}),
      ...(parsed.password ? { password: parsed.password } : {}),
      ...(parsed.sslMode ? { ssl_mode: parsed.sslMode } : {}),
      name: !connection && !prev.name.trim() && parsed.database ? parsed.database : prev.name,
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
      const hash = getConnectionHash(formData, inputMode === "url" ? urlValue : undefined);
      setLastTestedHash(hash);
      setTestStatus({
        success,
        message: success ? "Connected" : "Connection failed",
      });
    } catch (err) {
      setLastTestedHash("");
      setTestStatus({
        success: false,
        message: err instanceof Error ? err.message : "Connection test failed",
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formStep !== "configure") return;
    const dataToSave: ConnectionInput =
      inputMode === "url" && urlValue
        ? { ...formData, url: urlValue }
        : { ...formData, url: undefined, connection_string: undefined };
    await onSave(dataToSave);
  };

  const handleSelectDbType = (type: DatabaseType) => {
    const defaults = DB_DEFAULTS[type];
    setFormData((prev) => ({
      ...prev,
      db_type: type,
      host: type === "sqlite" ? "" : "localhost",
      port: defaults.port,
      database: defaults.database,
      username: defaults.username,
      ssl_mode: type === "clickhouse" ? "disable" : type === "sqlite" ? "disable" : "prefer",
    }));
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="t-resize sm:max-w-115 max-h-[90vh] overflow-y-auto p-0 gap-0">
        <div className="p-5 pb-0">
          <DialogHeader className="gap-1">
            <DialogTitle>
              {connection
                ? "Edit Connection"
                : formStep === "select_db"
                  ? "Select Database Type"
                  : configureStep === "connection"
                    ? "New Connection · Connection"
                    : "New Connection · Organization"}
            </DialogTitle>
          </DialogHeader>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col">
          {formStep === "select_db" && !connection ? (
            <>
              <div className="flex flex-col gap-3 p-5">
                <p className="text-xs text-muted-foreground">
                  Choose the database engine first to preload the correct fields and connection guidance.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {DB_TYPE_OPTIONS.filter((option) => option.value !== "redis").map((option) => {
                    const isActive = dbType === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => handleSelectDbType(option.value)}
                        className={cn(
                          "flex items-center gap-2 rounded-md border px-3 py-2 text-left text-xs transition-colors",
                          isActive
                            ? "border-primary/30 bg-primary/5 text-primary"
                            : "border-border hover:border-muted-foreground/40",
                        )}
                      >
                        {option.icon}
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
                <Button type="button" variant="ghost" size="sm" onClick={onClose} className="h-7 px-2 text-xs">
                  Cancel
                </Button>
                <Button type="button" size="sm" className="h-7 gap-1 text-xs" onClick={() => setFormStep("configure")}>
                  Continue
                  <UiIcon name="arrow-right" className="size-3" />
                </Button>
              </div>
            </>
          ) : (
          <>
          <div className="flex flex-col gap-5 p-5">
            {configureStep === "connection" ? (
              <div className="flex flex-col gap-3.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                    Connection
                  </span>
                  {!connection && (
                  <div className="flex max-w-full gap-0.5 rounded-md border border-border bg-muted/30 p-0.5">
                    <button
                      type="button"
                      onClick={() => setInputMode("url")}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-[11px] font-medium transition-colors",
                        inputMode === "url"
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <UiIcon name="wifi" className="size-3" />
                      URL
                    </button>
                    <button
                      type="button"
                      onClick={() => setInputMode("details")}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-[11px] font-medium transition-colors",
                        inputMode === "details"
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <UiIcon name="server" className="size-3" />
                      Details
                    </button>
                  </div>
                  )}
                </div>

                {inputMode === "url" ? (
                  <UrlInput
                    dbType={dbType}
                    urlValue={urlValue}
                    onUrlChange={handleUrlChange}
                    validation={connectionStringValidation}
                  />
                ) : (
                  <DetailsFields formData={formData} onUpdateField={updateField} />
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-3.5">
                <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                  Organization
                </span>
                <OrganizationFields formData={formData} onUpdateField={updateField} />
              </div>
            )}
          </div>

          {/* Duplicate warning */}
          {duplicateConnection && (
            <div className="mx-5 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
              <UiIcon name="alert-triangle" className="size-3.5 shrink-0" />
              <span>
                Duplicate of <strong>{duplicateConnection.name}</strong> — same
                host, port, database and user already registered.
              </span>
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between gap-3 border-t px-5 py-3">
            {/* Status */}
            <div className="text-xs">
              {duplicateConnection ? (
                <span className="inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                  <UiIcon name="alert-triangle" className="size-3" />
                  Duplicate connection
                </span>
              ) : isEditing ? (
                <span className="text-muted-foreground">Save changes directly</span>
              ) : hasTestedCurrent ? (
                <span className="inline-flex items-center gap-1.5 text-green-600 dark:text-green-400">
                  <UiIcon name="circle-check" className="size-3" />
                  Verified
                </span>
              ) : testStatus && !testStatus.success ? (
                <span className="inline-flex items-center gap-1.5 text-red-600 dark:text-red-400">
                  <UiIcon name="alert-circle" className="size-3" />
                  {testStatus.message}
                </span>
              ) : (
                <span className="text-muted-foreground">Test before saving</span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {configureStep === "connection" && !connection && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setFormStep("select_db")}
                  disabled={isSaving || isTesting}
                  className="h-7 gap-1 px-2 text-xs"
                >
                  <UiIcon name="arrow-left" className="size-3" />
                  Back
                </Button>
              )}
              {configureStep === "organization" && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfigureStep("connection")}
                  disabled={isSaving || isTesting}
                  className="h-7 gap-1 px-2 text-xs"
                >
                  <UiIcon name="arrow-left" className="size-3" />
                  Back
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onClose}
                disabled={isSaving || isTesting}
                className="h-7 px-2 text-xs"
              >
                Cancel
              </Button>

              {configureStep === "connection" ? (
                <>
                  {!hasTestedCurrent ? (
                    <Button
                      type="button"
                      size="sm"
                      disabled={isTesting || !!duplicateConnection || (inputMode === "url" && !connectionStringValidation.isValid)}
                      onClick={handleTest}
                      className="h-7 gap-1 text-xs"
                    >
                      {isTesting ? (
                        <>
                          <UiIcon name="loader" className="size-3 animate-spin" />
                          Testing
                        </>
                      ) : (
                        <>
                          <UiIcon name="wifi" className="size-3" />
                          Test
                        </>
                      )}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => setConfigureStep("organization")}
                      disabled={!!duplicateConnection}
                      className="h-7 gap-1 text-xs"
                    >
                      Next
                      <UiIcon name="arrow-right" className="size-3" />
                    </Button>
                  )}
                </>
              ) : isEditing || (hasTestedCurrent && !duplicateConnection) ? (
                <Button
                  type="submit"
                  size="sm"
                  disabled={isSaving || !formData.name.trim() || !!duplicateConnection}
                  className="h-7 gap-1 text-xs"
                >
                  {isSaving ? (
                    <>
                      <UiIcon name="loader" className="size-3 animate-spin" />
                      Saving
                    </>
                  ) : (
                    <>
                      <UiIcon name="device-floppy" className="size-3" />
                      Save
                    </>
                  )}
                </Button>
              ) : null}
            </div>
          </div>
          </>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
