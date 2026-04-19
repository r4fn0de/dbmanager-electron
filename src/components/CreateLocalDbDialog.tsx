import { useState } from "react";
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

export interface CreateLocalDbInput {
  name: string;
  databaseName: string;
  username: string;
  postgresVersion: string;
  password: string;
  port: number;
  autoStart: boolean;
  tag?: string;
  color?: string;
}

interface CreateLocalDbDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (input: CreateLocalDbInput) => Promise<void>;
  isCreating: boolean;
}

const POSTGRES_VERSIONS = [
  { value: "16", label: "PostgreSQL 16" },
  { value: "15", label: "PostgreSQL 15" },
  { value: "14", label: "PostgreSQL 14" },
  { value: "13", label: "PostgreSQL 13" },
];

export function CreateLocalDbDialog({
  isOpen,
  onClose,
  onCreate,
  isCreating,
}: CreateLocalDbDialogProps) {
  const [formData, setFormData] = useState<CreateLocalDbInput>({
    name: "",
    databaseName: "postgres",
    username: "postgres",
    postgresVersion: "16",
    password: "",
    port: 5432,
    autoStart: true,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onCreate(formData);
    setFormData({
      name: "",
      databaseName: "postgres",
      username: "postgres",
      postgresVersion: "16",
      password: "",
      port: 5432,
      autoStart: true,
    });
  };

  const updateField = <K extends keyof CreateLocalDbInput>(
    field: K,
    value: CreateLocalDbInput[K],
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[450px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>New Local Database</DialogTitle>
            <DialogDescription>
              Create a new local PostgreSQL database instance.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                placeholder="My Local DB"
                value={formData.name}
                onChange={(e) => updateField("name", e.target.value)}
                required
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="databaseName">Database Name</Label>
              <Input
                id="databaseName"
                placeholder="postgres"
                value={formData.databaseName}
                onChange={(e) => updateField("databaseName", e.target.value)}
                required
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="version">PostgreSQL Version</Label>
              <Select
                value={formData.postgresVersion}
                onValueChange={(value) => updateField("postgresVersion", value || "16")}
              >
                <SelectTrigger id="version">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {POSTGRES_VERSIONS.map((v) => (
                    <SelectItem key={v.value} value={v.value || "16"}>
                      {v.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  placeholder="postgres"
                  value={formData.username}
                  onChange={(e) => updateField("username", e.target.value)}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={formData.password}
                  onChange={(e) => updateField("password", e.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="port">Port</Label>
              <Input
                id="port"
                type="number"
                min={1024}
                max={65535}
                value={formData.port}
                onChange={(e) =>
                  updateField("port", Number.parseInt(e.target.value, 10) || 5432)
                }
                required
              />
            </div>

            <div className="flex items-center gap-2">
              <Switch
                id="autoStart"
                checked={formData.autoStart}
                onCheckedChange={(checked) => updateField("autoStart", checked)}
              />
              <Label htmlFor="autoStart" className="cursor-pointer">
                Auto-start on creation
              </Label>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:justify-end">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isCreating}>
              {isCreating ? "Creating..." : "Create Database"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
