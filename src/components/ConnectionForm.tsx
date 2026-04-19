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
import type { Connection, ConnectionInput, SslMode } from "@/ipc/db/types";

const SSL_MODES: { value: SslMode; label: string }[] = [
  { value: "disable", label: "Disable" },
  { value: "prefer", label: "Prefer" },
  { value: "require", label: "Require" },
  { value: "verify_ca", label: "Verify CA" },
  { value: "verify_full", label: "Verify Full" },
];

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
};

type InputMode = "fields" | "url";

function extractDatabaseNameFromUrl(connectionUrl: string): string | null {
  try {
    const parsed = new URL(connectionUrl.trim());
    const isPostgresProtocol = parsed.protocol === "postgres:" || parsed.protocol === "postgresql:";
    if (!isPostgresProtocol) return null;
    const database = decodeURIComponent(parsed.pathname).replace(/^\/+/, "");
    return database || "postgres";
  } catch {
    return null;
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
  const detectedDatabase = extractDatabaseNameFromUrl(urlValue);

  useEffect(() => {
    if (!isOpen) return;
    if (connection) {
      setFormData({
        id: connection.id,
        name: connection.name,
        host: connection.host,
        port: connection.port,
        database: connection.database,
        username: connection.username,
        password: connection.password,
        ssl_mode: connection.ssl_mode,
        is_local: connection.is_local,
        connection_string: connection.connection_string,
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

  const handleUrlChange = (value: string) => {
    setUrlValue(value);
    setTestStatus(null);
    const parsedDatabase = extractDatabaseNameFromUrl(value);
    if (!parsedDatabase) return;
    setFormData((prev) => ({
      ...prev,
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
            <DialogDescription>Configure your PostgreSQL connection. Test before saving.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <Tabs
              value={inputMode}
              onValueChange={(v) => setInputMode(v as InputMode)}
              className="w-full"
            >
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="fields">Connection Details</TabsTrigger>
                <TabsTrigger value="url">URL (Neon/Supabase)</TabsTrigger>
              </TabsList>
            </Tabs>

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
                  placeholder="postgresql://user:password@host:port/database?sslmode=require"
                  value={urlValue}
                  onChange={(e) => handleUrlChange(e.target.value)}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Paste your Neon, Supabase, or other PostgreSQL connection string
                </p>
                {detectedDatabase && (
                  <p className="text-xs text-muted-foreground">Database detected: {detectedDatabase}</p>
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
                        updateField("port", Number.parseInt(e.target.value, 10) || 5432)
                      }
                      required
                    />
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label>Database</Label>
                  <Input
                    placeholder="postgres"
                    value={formData.database}
                    onChange={(e) => updateField("database", e.target.value)}
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label>Username</Label>
                    <Input
                      placeholder="postgres"
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
                      {SSL_MODES.map((mode) => (
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
