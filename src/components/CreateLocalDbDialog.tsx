import { useState } from "react";
import { HardDrive, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  { value: "18.3.0", label: "PostgreSQL 18" },
  { value: "17.9.0", label: "PostgreSQL 17" },
  { value: "16.13.0", label: "PostgreSQL 16" },
  { value: "15.17.0", label: "PostgreSQL 15" },
  { value: "14.22.0", label: "PostgreSQL 14" },
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
    postgresVersion: "16.13.0",
    password: "",
    port: 5432,
    autoStart: true,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await onCreate(formData);
    } catch {
      return;
    }
    setFormData({
      name: "",
      databaseName: "postgres",
      username: "postgres",
      postgresVersion: "16.13.0",
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
      <DialogContent className="sm:max-w-[460px] p-0 gap-0">
        <div className="p-5 pb-0">
          <DialogHeader className="gap-1">
            <DialogTitle className="flex items-center gap-2">
              <HardDrive className="size-4 text-muted-foreground" />
              New Local Database
            </DialogTitle>
          </DialogHeader>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col">
          <div className="flex flex-col gap-4 p-5">
            {/* Name */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="local-name" className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                Name
              </Label>
              <Input
                id="local-name"
                placeholder="My Local DB"
                value={formData.name}
                onChange={(e) => updateField("name", e.target.value)}
                required
                className="h-7"
              />
            </div>

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

            {/* Auto-start */}
            <div className="flex items-center gap-2.5">
              <Switch
                id="local-auto"
                checked={formData.autoStart}
                onCheckedChange={(checked) => updateField("autoStart", checked)}
              />
              <Label htmlFor="local-auto" className="text-xs cursor-pointer">
                Auto-start on creation
              </Label>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 border-t bg-muted/50 px-5 py-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              disabled={isCreating}
              className="h-7 px-2 text-xs"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={isCreating}
              className="h-7 text-xs gap-1"
            >
              {isCreating ? (
                <>
                  <Loader2 className="size-3 animate-spin" />
                  Creating…
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
