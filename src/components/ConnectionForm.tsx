import { useEffect, useState } from "react";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Connection, ConnectionInput, DatabaseType, SslMode } from "@/ipc/db/types";

const DB_TYPE_OPTIONS: { value: DatabaseType; label: string; description: string }[] = [
  { value: "postgresql", label: "PostgreSQL", description: "PostgreSQL, Neon, Supabase" },
  { value: "mysql", label: "MySQL", description: "MySQL 5.7+ / 8.0+" },
  { value: "mariadb", label: "MariaDB", description: "MariaDB 10.x+" },
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

interface ConnectionFormProps {
  connection: Connection | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (connection: ConnectionInput) => Promise<void>;
  onTest: (connection: ConnectionInput) => Promise<boolean>;
  isSaving: boolean;
  isTesting: boolean;
}

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

type InputMode = "fields" | "url";

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

export function ConnectionForm({
  connection,
  isOpen,
  onClose,
  onSave,
  onTest,
  isSaving,
  isTesting,
}: ConnectionFormProps) {
  const [formData, setFormData] = useState<ConnectionInput>(DEFAULT_CONNECTION);
  const [inputMode, setInputMode] = useState<InputMode>("fields");
  const [urlValue, setUrlValue] = useState("");
  const [testStatus, setTestStatus] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const detected = extractDatabaseNameFromUrl(urlValue);
  const detectedDatabase = detected.database;
  const detectedDbType = detected.dbType;

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
    } else {
      setFormData(DEFAULT_CONNECTION);
      setInputMode("fields");
      setUrlValue("");
    }
    setTestStatus(null);
  }, [connection, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const dataToSave: ConnectionInput =
      inputMode === "url" && urlValue
        ? { ...formData, url: urlValue }
        : { ...formData, url: undefined };
    await onSave(dataToSave);
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
    } catch (err) {
      setTestStatus({
        success: false,
        message: err instanceof Error ? err.message : "Connection test failed",
      });
    }
  };

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

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{connection ? "Edit Connection" : "New Connection"}</DialogTitle>
            <DialogDescription>Configure your database connection. Test before saving.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <Tabs
              value={inputMode}
              onValueChange={(v) => setInputMode(v as InputMode)}
              className="w-full"
            >
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="fields">Connection Details</TabsTrigger>
                <TabsTrigger value="url">URL</TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="grid gap-2">
              <Label>Database Type</Label>
              <Select
                value={formData.db_type || "postgresql"}
                onValueChange={(value) => handleDbTypeChange(value as DatabaseType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DB_TYPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label} — {opt.description}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label>Name</Label>
              <Input
                placeholder="My Database"
                value={formData.name}
                onChange={(e) => updateField("name", e.target.value)}
                required
              />
            </div>

            {inputMode === "url" ? (
              <div className="grid gap-2">
                <Label>Connection URL</Label>
                <textarea
                  className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  placeholder={`${formData.db_type === "mysql" ? "mysql" : formData.db_type === "mariadb" ? "mariadb" : "postgresql"}://user:password@host:port/database?sslmode=require`}
                  value={urlValue}
                  onChange={(e) => handleUrlChange(e.target.value)}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Paste your connection string (Neon, Supabase, PlanetScale, etc.)
                </p>
                {detectedDatabase && (
                  <p className="text-xs text-muted-foreground">
                    Database detected: {detectedDatabase}
                    {detectedDbType && (
                      <span className="ml-1 text-primary">({detectedDbType})</span>
                    )}
                  </p>
                )}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-4">
                  <div className="col-span-2 grid gap-2">
                    <Label>Host</Label>
                    <Input
                      placeholder="localhost"
                      value={formData.host}
                      onChange={(e) => updateField("host", e.target.value)}
                      required
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Port</Label>
                    <Input
                      type="number"
                      min={1}
                      max={65535}
                      value={formData.port}
                      onChange={(e) =>
                        updateField("port", Number.parseInt(e.target.value, 10) || DB_DEFAULTS[formData.db_type || "postgresql"].port)
                      }
                      required
                    />
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label>Database</Label>
                  <Input
                    placeholder={DB_DEFAULTS[formData.db_type || "postgresql"].database}
                    value={formData.database}
                    onChange={(e) => updateField("database", e.target.value)}
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label>Username</Label>
                    <Input
                      placeholder={DB_DEFAULTS[formData.db_type || "postgresql"].username}
                      value={formData.username}
                      onChange={(e) => updateField("username", e.target.value)}
                      required
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Password</Label>
                    <Input
                      type="password"
                      placeholder="••••••••"
                      value={formData.password}
                      onChange={(e) => updateField("password", e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label>SSL Mode</Label>
                  <Select
                    value={formData.ssl_mode}
                    onValueChange={(value) => updateField("ssl_mode", value as SslMode)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SSL_MODES
                        .filter((mode) => mode.dbTypes.includes(formData.db_type || "postgresql"))
                        .map((mode) => (
                          <SelectItem key={mode.value} value={mode.value}>
                            {mode.label}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            {testStatus && (
              <div
                className={`text-sm p-3 rounded-md border ${
                  testStatus.success
                    ? "bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800"
                    : "bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800"
                }`}
              >
                {testStatus.message}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:justify-end">
            <Button type="button" variant="secondary" onClick={handleTest} disabled={isTesting}>
              {isTesting ? "Testing..." : "Test Connection"}
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
