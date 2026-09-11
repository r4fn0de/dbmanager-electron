import { Button } from "@/components/ui/button";
import { Icon as UiIcon } from "@/components/ui/Icon";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type {
  PrivacyPreset,
  PrivacySettings,
} from "@/shared/ai/streaming-contracts";

interface PrivacySettingsSectionProps {
  currentProvider: string;
  onPresetChange: (preset: PrivacyPreset) => Promise<void>;
  onToggle: (key: keyof PrivacySettings, value: boolean) => Promise<void>;
  privacyPreset: PrivacyPreset | null;
  privacySettings: PrivacySettings;
  providerLabel: string | undefined;
}

const PRIVACY_TOGGLES: Array<{
  key: keyof PrivacySettings;
  label: string;
  desc: string;
}> = [
  { desc: "Table names, columns, types", key: "schema", label: "Schema" },
  {
    desc: "Host, port, database name",
    key: "connectionInfo",
    label: "Connection Info",
  },
  {
    desc: "All your saved connections",
    key: "connectionsList",
    label: "Connections List",
  },
  {
    desc: "Recent conversations & similar queries",
    key: "memory",
    label: "Memory",
  },
];

export function PrivacySettingsSection({
  privacyPreset,
  privacySettings,
  currentProvider,
  providerLabel,
  onPresetChange,
  onToggle,
}: PrivacySettingsSectionProps) {
  return (
    <div className="space-y-3">
      <Label className="font-medium text-muted-foreground text-xs">
        Privacy & Context
      </Label>

      {/* Preset buttons */}
      <div className="flex gap-1.5">
        {(["full", "minimal", "private"] as const).map((preset) => (
          <Button
            className="h-7 px-2.5 text-xs capitalize"
            key={preset}
            onClick={() => onPresetChange(preset)}
            size="sm"
            variant={privacyPreset === preset ? "default" : "outline"}
          >
            {preset === "full" && (
              <UiIcon className="mr-1 size-3" name="globe" />
            )}
            {preset === "minimal" && (
              <UiIcon className="mr-1 size-3" name="shield" />
            )}
            {preset === "private" && (
              <UiIcon className="mr-1 size-3" name="lock" />
            )}
            {preset}
          </Button>
        ))}
      </div>

      {/* Individual toggles */}
      <div className="space-y-1.5 rounded-xl border p-3">
        {PRIVACY_TOGGLES.map((item) => (
          <label
            className="flex cursor-pointer select-none items-center justify-between py-1.5"
            key={item.key}
          >
            <div>
              <p className="font-medium text-xs">{item.label}</p>
              <p className="text-[11px] text-muted-foreground">{item.desc}</p>
            </div>
            <button
              aria-checked={privacySettings[item.key]}
              className={cn(
                "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200",
                privacySettings[item.key] ? "bg-primary" : "bg-input"
              )}
              onClick={() => onToggle(item.key, !privacySettings[item.key])}
              role="switch"
              type="button"
            >
              <span
                className={cn(
                  "pointer-events-none inline-block size-4 rounded-full bg-background shadow-sm transition-transform duration-200",
                  privacySettings[item.key] ? "translate-x-4" : "translate-x-0"
                )}
              />
            </button>
          </label>
        ))}
      </div>

      {/* Data-locality indicator */}
      {currentProvider === "ollama" ? (
        <div className="flex items-center gap-2 text-emerald-600 text-xs dark:text-emerald-400">
          <UiIcon className="size-4" name="shield-check" />
          <span>All data stays on your machine</span>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-amber-600 text-xs dark:text-amber-400">
          <UiIcon className="size-4" name="cloud" />
          <span>Data is sent to {providerLabel ?? "external"} servers</span>
        </div>
      )}
    </div>
  );
}
