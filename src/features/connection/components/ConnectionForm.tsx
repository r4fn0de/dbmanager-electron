import { useEffect, useMemo, useRef, useState } from "react";
import { ClickHouse } from "@/components/icons/ClickHouse";
import { MariaDb } from "@/components/icons/MariaDb";
import { MySql } from "@/components/icons/MySql";
import { PostgreSql } from "@/components/icons/PostgreSql";
import { Sqlite } from "@/components/icons/Sqlite";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon as UiIcon } from "@/components/ui/Icon";
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
import type {
  Connection,
  ConnectionInput,
  DatabaseType,
  SslMode,
} from "@/ipc/db/types";
import { getClickhouseEffectivePort } from "@/ipc/db/types";
import { cn } from "@/lib/utils";

const DB_TYPE_OPTIONS: {
  value: DatabaseType;
  label: string;
  icon: React.ReactNode;
}[] = [
  {
    icon: <PostgreSql className="size-3 shrink-0" />,
    label: "PostgreSQL",
    value: "postgresql",
  },
  {
    icon: <MySql className="size-3 shrink-0" />,
    label: "MySQL",
    value: "mysql",
  },
  {
    icon: <MariaDb className="size-3 shrink-0" />,
    label: "MariaDB",
    value: "mariadb",
  },
  {
    icon: <ClickHouse className="size-3 shrink-0" />,
    label: "ClickHouse",
    value: "clickhouse",
  },
  {
    icon: <Sqlite className="size-3 shrink-0" />,
    label: "SQLite",
    value: "sqlite",
  },
];

const SSL_MODES: { value: SslMode; label: string; dbTypes: DatabaseType[] }[] =
  [
    {
      dbTypes: ["postgresql", "mysql", "mariadb", "clickhouse", "sqlite"],
      label: "Disable",
      value: "disable",
    },
    {
      dbTypes: ["postgresql", "mysql", "mariadb"],
      label: "Prefer",
      value: "prefer",
    },
    {
      dbTypes: ["postgresql", "mysql", "mariadb", "clickhouse"],
      label: "Require",
      value: "require",
    },
    {
      dbTypes: ["postgresql", "mysql", "mariadb"],
      label: "Verify CA",
      value: "verify_ca",
    },
    {
      dbTypes: ["postgresql", "mysql", "mariadb"],
      label: "Verify Full",
      value: "verify_full",
    },
  ];

const DB_DEFAULTS: Record<
  DatabaseType,
  { port: number; database: string; username: string }
> = {
  clickhouse: { database: "default", port: 8123, username: "default" },
  mariadb: { database: "mysql", port: 3306, username: "root" },
  mysql: { database: "mysql", port: 3306, username: "root" },
  postgresql: { database: "postgres", port: 5432, username: "postgres" },
  redis: {
    database: "",
    port: 0,
    username: "",
  },
  sqlite: { database: "main", port: 0, username: "" },
};

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

const DEFAULT_CONNECTION = {
  database: "postgres",
  host: "localhost",
  name: "",
  password: "",
  port: 5432,
  ssl_mode: "prefer" as SslMode,
  username: "postgres",
} as ConnectionInput;

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
    if (protocol === "postgres:" || protocol === "postgresql:") {
      dbType = "postgresql";
    } else if (protocol === "mysql:") {
      dbType = "mysql";
    } else if (protocol === "mariadb:") {
      dbType = "mariadb";
    } else if (protocol === "clickhouse:" || protocol === "clickhouses:") {
      dbType = "clickhouse";
    } else if (protocol === "sqlite:") {
      dbType = "sqlite";
    }
    if (!dbType) {
      return {
        database: null,
        dbType: null,
        host: null,
        password: null,
        port: null,
        sslMode: null,
        username: null,
      };
    }

    const host = url.hostname || null;
    let port = url.port ? Number.parseInt(url.port, 10) : null;
    // Auto-correct ClickHouse native protocol ports to HTTP(S) ports
    if (dbType === "clickhouse") {
      if (port === 9000) {
        port = 8123;
      } else if (port === 9440) {
        port = 8443;
      }
    }
    const database =
      decodeURIComponent(url.pathname).replace(/^\/+/, "") || null;
    const username = url.username || null;
    const password = url.password || null;

    let sslMode: SslMode | null = null;
    const sslParam =
      url.searchParams.get("sslmode") || url.searchParams.get("ssl");
    if (sslParam) {
      const valid = SSL_MODES.map((m) => m.value);
      if (valid.includes(sslParam as SslMode)) {
        sslMode = sslParam as SslMode;
      }
    }

    return { database, dbType, host, password, port, sslMode, username };
  } catch {
    return {
      database: null,
      dbType: null,
      host: null,
      password: null,
      port: null,
      sslMode: null,
      username: null,
    };
  }
}

function getConnectionHash(data: ConnectionInput, url?: string): string {
  return JSON.stringify({
    database: data.database,
    db_type: data.db_type,
    host: data.host,
    password: data.password,
    port: data.port,
    ssl_mode: data.ssl_mode,
    url,
    username: data.username,
  });
}

function validateConnectionUrl(value: string): {
  isValid: boolean;
  message: string;
} {
  const raw = value.trim();
  if (!raw) {
    return { isValid: false, message: "Enter a connection string." };
  }
  try {
    const parsed = new URL(raw);
    const protocol = parsed.protocol.toLowerCase();
    const supportedProtocols = [
      "postgres:",
      "postgresql:",
      "mysql:",
      "mariadb:",
      "clickhouse:",
      "clickhouses:",
      "sqlite:",
    ];
    if (!supportedProtocols.includes(protocol)) {
      return {
        isValid: false,
        message: "Unsupported protocol in connection string.",
      };
    }
    if (protocol === "sqlite:") {
      if (!parsed.pathname || parsed.pathname === "/") {
        return {
          isValid: false,
          message: "SQLite URL must include the database file path.",
        };
      }
      return { isValid: true, message: "Valid SQLite connection string." };
    }
    if (!parsed.hostname) {
      return {
        isValid: false,
        message: "Connection string must include a host.",
      };
    }
    if (!parsed.pathname || parsed.pathname === "/") {
      return {
        isValid: false,
        message: "Connection string must include a database name.",
      };
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
  if (detected.dbType) {
    items.push(detected.dbType);
  }
  if (detected.host) {
    items.push(detected.host);
  }
  if (detected.port) {
    items.push(String(detected.port));
  }
  if (detected.database) {
    items.push(detected.database);
  }

  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <Textarea
        className="wrap-anywhere min-h-16 w-full max-w-full resize-none whitespace-pre-wrap break-all rounded-lg border-border bg-muted/15 font-mono text-xs leading-relaxed transition-colors focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/30"
        id="connection-url"
        onChange={(e) => onUrlChange(e.target.value)}
        placeholder={`${dbType}://user:password@host:${DB_DEFAULTS[dbType].port}/database`}
        ref={textareaRef}
        rows={2}
        value={urlValue}
      />
    </div>
  );
}

function DetailsFields({
  formData,
  onUpdateField,
}: {
  formData: ConnectionInput;
  onUpdateField: <K extends keyof ConnectionInput>(
    field: K,
    value: ConnectionInput[K]
  ) => void;
}) {
  const dbType = (formData.db_type || "postgresql") as DatabaseType;
  const [showPassword, setShowPassword] = useState(false);

  const handleSslModeChange = (value: SslMode) => {
    onUpdateField("ssl_mode", value);
    if (dbType !== "clickhouse") {
      return;
    }
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
        <div className="flex flex-col gap-1.5">
          <Label
            className="font-medium text-muted-foreground text-xs"
            htmlFor="conn-database"
          >
            Database File Path
          </Label>
          <Input
            className="h-8 font-mono text-xs"
            id="conn-database"
            onChange={(e) => onUpdateField("database", e.target.value)}
            placeholder="/path/to/database.db"
            value={formData.database}
          />
          <p className="text-[11px] text-muted-foreground">
            SQLite is file-based — enter the path to the .db file or it will be
            created automatically.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-[1fr_110px] gap-3">
            <div className="flex flex-col gap-1.5">
              <Label
                className="font-medium text-muted-foreground text-xs"
                htmlFor="conn-host"
              >
                Host
              </Label>
              <Input
                className="h-8 font-mono text-xs"
                id="conn-host"
                onChange={(e) => onUpdateField("host", e.target.value)}
                placeholder="localhost"
                value={formData.host}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label
                className="font-medium text-muted-foreground text-xs"
                htmlFor="conn-port"
              >
                Port
              </Label>
              <Input
                className="h-8 font-mono text-xs"
                id="conn-port"
                max={65_535}
                min={1}
                onChange={(e) =>
                  onUpdateField(
                    "port",
                    Number.parseInt(e.target.value, 10) ||
                      DB_DEFAULTS[dbType].port
                  )
                }
                type="number"
                value={formData.port}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label
              className="font-medium text-muted-foreground text-xs"
              htmlFor="conn-database"
            >
              Database
            </Label>
            <Input
              className="h-8 font-mono text-xs"
              id="conn-database"
              onChange={(e) => onUpdateField("database", e.target.value)}
              placeholder={DB_DEFAULTS[dbType].database}
              value={formData.database}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label
                className="font-medium text-muted-foreground text-xs"
                htmlFor="conn-username"
              >
                Username
              </Label>
              <Input
                className="h-8 font-mono text-xs"
                id="conn-username"
                onChange={(e) => onUpdateField("username", e.target.value)}
                placeholder={DB_DEFAULTS[dbType].username}
                value={formData.username}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label
                className="font-medium text-muted-foreground text-xs"
                htmlFor="conn-password"
              >
                Password
              </Label>
              <div className="relative">
                <Input
                  className="h-8 pr-8 font-mono text-xs"
                  id="conn-password"
                  onChange={(e) => onUpdateField("password", e.target.value)}
                  placeholder="••••••••"
                  type={showPassword ? "text" : "password"}
                  value={formData.password}
                />
                <button
                  className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() => setShowPassword(!showPassword)}
                  type="button"
                >
                  {showPassword ? (
                    <UiIcon className="size-3" name="eye-off" />
                  ) : (
                    <UiIcon className="size-3" name="eye" />
                  )}
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="font-medium text-muted-foreground text-xs">
              SSL Mode
            </Label>
            <Select
              onValueChange={(value) => handleSslModeChange(value as SslMode)}
              value={formData.ssl_mode}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SSL_MODES.filter((mode) => mode.dbTypes.includes(dbType)).map(
                  (mode) => (
                    <SelectItem key={mode.value} value={mode.value}>
                      {mode.label}
                    </SelectItem>
                  )
                )}
              </SelectContent>
            </Select>
            {dbType === "clickhouse" && (
              <p className="text-[10px] text-muted-foreground">
                SSL require uses HTTPS (`clickhouses://`) and usually port 8443.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function OrganizationFields({
  formData,
  onUpdateField,
}: {
  formData: ConnectionInput;
  onUpdateField: <K extends keyof ConnectionInput>(
    field: K,
    value: ConnectionInput[K]
  ) => void;
}) {
  const [useCustomTag, setUseCustomTag] = useState(
    !!formData.tag && !TAG_OPTIONS.includes(formData.tag ?? "")
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label
          className="font-medium text-muted-foreground text-xs"
          htmlFor="conn-name"
        >
          Name
        </Label>
        <div className="flex items-center gap-2">
          <Input
            className="h-8"
            id="conn-name"
            onChange={(e) => onUpdateField("name", e.target.value)}
            placeholder="My database"
            value={formData.name}
          />
          <Button
            className="shrink-0 transition-transform duration-150 ease-out active:scale-[0.97]"
            onClick={() => onUpdateField("name", generateRandomName())}
            size="icon-xs"
            title="Generate random name"
            type="button"
            variant="outline"
          >
            <UiIcon className="size-3" name="shuffle" />
          </Button>
        </div>
      </div>

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
              onChange={(e) => onUpdateField("tag", e.target.value)}
              placeholder="Custom tag"
              value={formData.tag ?? ""}
            />
            <Button
              className="h-8 shrink-0 px-2 text-muted-foreground text-xs"
              onClick={() => {
                setUseCustomTag(false);
                onUpdateField("tag", "");
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              <UiIcon className="size-3" name="x" />
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
                  onUpdateField("tag", formData.tag === tag ? "" : tag)
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
                onUpdateField(
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
  isSaving: boolean;
  isTesting: boolean;
  onClose: () => void;
  onSave: (connection: ConnectionInput) => Promise<void>;
  onTest: (connection: ConnectionInput) => Promise<boolean>;
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
  editingId: string | undefined
): Connection | null {
  return (
    connections.find((c) => {
      if (c.id === editingId) {
        return false;
      }
      if (c.db_type !== (formData.db_type || "postgresql")) {
        return false;
      }

      if (inputMode === "url" && urlValue) {
        const normalized = normalizeUrl(urlValue);
        const existing = normalizeUrl(c.url || c.connection_string || "");
        if (normalized && existing && normalized === existing) {
          return true;
        }
      }

      return (
        c.host === formData.host &&
        c.port === formData.port &&
        c.database === formData.database &&
        c.username === formData.username
      );
    }) ?? null
  );
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
  const [configureStep, setConfigureStep] =
    useState<ConfigureStep>("connection");

  const dbType = (formData.db_type || "postgresql") as DatabaseType;

  const connectionHash = useMemo(
    () =>
      getConnectionHash(formData, inputMode === "url" ? urlValue : undefined),
    [formData, inputMode, urlValue]
  );

  const hasTestedCurrent =
    lastTestedHash === connectionHash && testStatus?.success === true;
  const connectionStringValidation = useMemo(
    () => validateConnectionUrl(urlValue),
    [urlValue]
  );

  const duplicateConnection = useMemo(
    () =>
      isEditing
        ? null
        : findDuplicateConnection(
            connections,
            formData,
            inputMode === "url" ? urlValue : undefined,
            inputMode,
            connection?.id
          ),
    [connections, formData, inputMode, urlValue, isEditing, connection?.id]
  );

  // Reset / init form when dialog opens
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    if (connection) {
      const base: ConnectionInput = {
        color: connection.color,
        connection_string: connection.connection_string,
        database: connection.database,
        db_type: connection.db_type || "postgresql",
        engine_version: connection.engine_version,
        host: connection.host,
        id: connection.id,
        is_local: connection.is_local,
        local_auto_start: connection.local_auto_start,
        name: connection.name,
        password: connection.password,
        port: connection.port,
        postgres_version: connection.postgres_version,
        ssl_mode: connection.ssl_mode,
        tag: connection.tag,
        username: connection.username,
      };
      setFormData(base);
      setInputMode("details");
      setFormStep("configure");
      setConfigureStep("connection");
      setUrlValue("");
      setLastTestedHash(getConnectionHash(base, connection.url || undefined));
      setTestStatus({ message: "Connection already verified", success: true });
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
    value: ConnectionInput[K]
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleUrlChange = (value: string) => {
    setUrlValue(value);
    const parsed = extractFromUrl(value);
    if (!(parsed.dbType || parsed.host)) {
      return;
    }

    setFormData((prev) => ({
      ...prev,
      ...(parsed.dbType ? { db_type: parsed.dbType } : {}),
      ...(parsed.host ? { host: parsed.host } : {}),
      ...(parsed.port ? { port: parsed.port } : {}),
      ...(parsed.database ? { database: parsed.database } : {}),
      ...(parsed.username ? { username: parsed.username } : {}),
      ...(parsed.password ? { password: parsed.password } : {}),
      ...(parsed.sslMode ? { ssl_mode: parsed.sslMode } : {}),
      name:
        !(connection || prev.name.trim()) && parsed.database
          ? parsed.database
          : prev.name,
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
      const hash = getConnectionHash(
        formData,
        inputMode === "url" ? urlValue : undefined
      );
      setLastTestedHash(hash);
      setTestStatus({
        message: success ? "Connected" : "Connection failed",
        success,
      });
    } catch (err) {
      setLastTestedHash("");
      setTestStatus({
        message: err instanceof Error ? err.message : "Connection test failed",
        success: false,
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formStep !== "configure") {
      return;
    }
    const dataToSave: ConnectionInput =
      inputMode === "url" && urlValue
        ? { ...formData, url: urlValue }
        : { ...formData, connection_string: undefined, url: undefined };
    await onSave(dataToSave);
  };

  const handleSelectDbType = (type: DatabaseType) => {
    const defaults = DB_DEFAULTS[type];
    setFormData((prev) => ({
      ...prev,
      database: defaults.database,
      db_type: type,
      host: type === "sqlite" ? "" : "localhost",
      port: defaults.port,
      ssl_mode:
        type === "clickhouse"
          ? "disable"
          : type === "sqlite"
            ? "disable"
            : "prefer",
      username: defaults.username,
    }));
  };

  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open={isOpen}>
      <DialogContent className="t-resize max-h-[90vh] gap-0 overflow-y-auto p-0 sm:max-w-115">
        <div className="p-5 pb-0">
          <DialogHeader className="gap-1">
            <DialogTitle className="flex items-center gap-2">
              <UiIcon
                className="size-4 text-muted-foreground"
                name="hard-drive"
              />
              {connection
                ? "Edit Connection"
                : formStep === "select_db"
                  ? "Select Database Type"
                  : configureStep === "connection"
                    ? "New Connection"
                    : "New Connection"}
            </DialogTitle>
          </DialogHeader>
        </div>

        <form className="flex flex-col" onSubmit={handleSubmit}>
          {formStep === "select_db" && !connection ? (
            <>
              <div className="flex flex-col gap-4 p-5">
                <p className="text-muted-foreground text-xs">
                  Choose the database engine first to preload the correct fields
                  and connection guidance.
                </p>
                <div className="flex flex-col gap-2">
                  {DB_TYPE_OPTIONS.filter(
                    (option) => option.value !== "redis"
                  ).map((option) => {
                    const isActive = dbType === option.value;
                    return (
                      <button
                        className={cn(
                          "flex items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors duration-150 ease-out active:scale-[0.98]",
                          isActive
                            ? "border-primary/30 bg-primary/5 text-primary shadow-sm"
                            : "border-border bg-transparent text-muted-foreground hover:border-muted-foreground/30 hover:bg-muted/20 hover:text-foreground"
                        )}
                        key={option.value}
                        onClick={() => handleSelectDbType(option.value)}
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
                          {option.icon}
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <span className="font-semibold text-xs">
                            {option.label}
                          </span>
                          <span className="text-[10px] text-muted-foreground/70">
                            {option.value === "sqlite"
                              ? "File-based, no server"
                              : `Default port ${DB_DEFAULTS[option.value].port}`}
                          </span>
                        </div>
                        {isActive && (
                          <UiIcon
                            className="ml-auto size-4 shrink-0 text-primary"
                            name="check"
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex items-center justify-end gap-2.5 border-t bg-muted/30 px-5 py-3.5">
                <Button
                  className="h-8 px-3 text-xs"
                  onClick={onClose}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  Cancel
                </Button>
                <Button
                  className="h-8 gap-1.5 px-5 text-xs shadow-sm"
                  onClick={() => setFormStep("configure")}
                  size="sm"
                  type="button"
                >
                  Continue
                  <UiIcon className="size-3.5" name="arrow-right" />
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-5 p-5">
                {configureStep === "connection" ? (
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <UiIcon
                          className="size-3 text-muted-foreground/40"
                          name="plug-connected"
                        />
                        <span className="font-semibold text-[10px] text-muted-foreground/60 uppercase tracking-wider">
                          Connection
                        </span>
                      </div>
                      {!connection && (
                        <div className="flex max-w-full gap-0.5 rounded-lg border border-border/60 bg-muted/30 p-0.5">
                          <button
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium text-[11px] transition-colors duration-150 ease-out active:scale-[0.97]",
                              inputMode === "url"
                                ? "bg-card text-foreground shadow-sm"
                                : "text-muted-foreground hover:text-foreground"
                            )}
                            onClick={() => setInputMode("url")}
                            type="button"
                          >
                            <UiIcon className="size-3" name="wifi" />
                            URL
                          </button>
                          <button
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium text-[11px] transition-colors duration-150 ease-out active:scale-[0.97]",
                              inputMode === "details"
                                ? "bg-card text-foreground shadow-sm"
                                : "text-muted-foreground hover:text-foreground"
                            )}
                            onClick={() => setInputMode("details")}
                            type="button"
                          >
                            <UiIcon className="size-3" name="server" />
                            Details
                          </button>
                        </div>
                      )}
                    </div>

                    {inputMode === "url" ? (
                      <UrlInput
                        dbType={dbType}
                        onUrlChange={handleUrlChange}
                        urlValue={urlValue}
                        validation={connectionStringValidation}
                      />
                    ) : (
                      <DetailsFields
                        formData={formData}
                        onUpdateField={updateField}
                      />
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center gap-2">
                      <UiIcon
                        className="size-3 text-muted-foreground/40"
                        name="folder-open"
                      />
                      <span className="font-semibold text-[10px] text-muted-foreground/60 uppercase tracking-wider">
                        Organization
                      </span>
                    </div>
                    <OrganizationFields
                      formData={formData}
                      onUpdateField={updateField}
                    />
                  </div>
                )}
              </div>

              {/* Duplicate warning */}
              {duplicateConnection && (
                <div className="mx-5 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-amber-600 text-xs dark:text-amber-400">
                  <UiIcon className="size-3.5 shrink-0" name="alert-triangle" />
                  <span className="select-text">
                    Duplicate of <strong>{duplicateConnection.name}</strong> —
                    same host, port, database and user already registered.
                  </span>
                </div>
              )}

              {/* Footer */}
              <div className="flex items-center justify-between gap-3 border-t bg-muted/30 px-5 py-3.5">
                {/* Status */}
                <div className="text-xs">
                  {duplicateConnection ? (
                    <span className="inline-flex select-text items-center gap-1.5 text-amber-600 dark:text-amber-400">
                      <UiIcon className="size-3.5" name="alert-triangle" />
                      Duplicate connection
                    </span>
                  ) : isEditing ? (
                    <span className="select-text text-muted-foreground">
                      Save changes directly
                    </span>
                  ) : hasTestedCurrent ? (
                    <span className="inline-flex select-text items-center gap-1.5 text-green-600 dark:text-green-400">
                      <UiIcon className="size-3.5" name="circle-check" />
                      Verified
                    </span>
                  ) : testStatus && !testStatus.success ? (
                    <span className="inline-flex select-text items-center gap-1.5 text-red-600 dark:text-red-400">
                      <UiIcon className="size-3.5" name="alert-circle" />
                      {testStatus.message}
                    </span>
                  ) : (
                    <span className="select-text text-muted-foreground">
                      Test before saving
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {configureStep === "connection" && !connection && (
                    <Button
                      className="h-8 gap-1.5 px-3 text-xs"
                      disabled={isSaving || isTesting}
                      onClick={() => setFormStep("select_db")}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      <UiIcon className="size-3.5" name="chevron-left" />
                      Back
                    </Button>
                  )}
                  {configureStep === "organization" && (
                    <Button
                      className="h-8 gap-1.5 px-3 text-xs"
                      disabled={isSaving || isTesting}
                      onClick={() => setConfigureStep("connection")}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      <UiIcon className="size-3.5" name="chevron-left" />
                      Back
                    </Button>
                  )}
                  <Button
                    className="h-8 px-3 text-xs"
                    disabled={isSaving || isTesting}
                    onClick={onClose}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    Cancel
                  </Button>

                  {configureStep === "connection" ? (
                    hasTestedCurrent ? (
                        <Button
                          className="h-8 gap-1.5 px-5 text-xs shadow-sm"
                          disabled={!!duplicateConnection}
                          onClick={() => setConfigureStep("organization")}
                          size="sm"
                          type="button"
                        >
                          Next
                          <UiIcon className="size-3.5" name="arrow-right" />
                        </Button>
                      ) : (
                        <Button
                          className="h-8 gap-1.5 px-4 text-xs shadow-sm"
                          disabled={
                            isTesting ||
                            !!duplicateConnection ||
                            (inputMode === "url" &&
                              !connectionStringValidation.isValid)
                          }
                          onClick={handleTest}
                          size="sm"
                          type="button"
                        >
                          {isTesting ? (
                            <>
                              <UiIcon
                                className="size-3.5 animate-spin"
                                name="loader"
                              />
                              Testing
                            </>
                          ) : (
                            <>
                              <UiIcon className="size-3.5" name="wifi" />
                              Test
                            </>
                          )}
                        </Button>
                      )
                  ) : isEditing ||
                    (hasTestedCurrent && !duplicateConnection) ? (
                    <Button
                      className="h-8 gap-1.5 px-5 text-xs shadow-sm"
                      disabled={
                        isSaving ||
                        !formData.name.trim() ||
                        !!duplicateConnection
                      }
                      size="sm"
                      type="submit"
                    >
                      {isSaving ? (
                        <>
                          <UiIcon
                            className="size-3.5 animate-spin"
                            name="loader"
                          />
                          Saving
                        </>
                      ) : (
                        <>
                          <UiIcon className="size-3.5" name="device-floppy" />
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
