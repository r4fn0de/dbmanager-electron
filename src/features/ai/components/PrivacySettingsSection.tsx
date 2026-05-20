import { type PrivacyPreset, type PrivacySettings } from "@/shared/ai/streaming-contracts";
import { Icon as UiIcon } from "@/components/ui/Icon";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface PrivacySettingsSectionProps {
  privacyPreset: PrivacyPreset | null;
  privacySettings: PrivacySettings;
  currentProvider: string;
  providerLabel: string | undefined;
  onPresetChange: (preset: PrivacyPreset) => Promise<void>;
  onToggle: (key: keyof PrivacySettings, value: boolean) => Promise<void>;
}

const PRIVACY_TOGGLES: Array<{
  key: keyof PrivacySettings;
  label: string;
  desc: string;
}> = [
  { key: "schema", label: "Schema", desc: "Table names, columns, types" },
  {
    key: "connectionInfo",
    label: "Connection Info",
    desc: "Host, port, database name",
  },
  {
    key: "connectionsList",
    label: "Connections List",
    desc: "All your saved connections",
  },
  {
    key: "memory",
    label: "Memory",
    desc: "Recent conversations & similar queries",
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
      <Label className="text-xs font-medium text-muted-foreground">
        Privacy & Context
      </Label>

      {/* Preset buttons */}
      <div className="flex gap-1.5">
        {(["full", "minimal", "private"] as const).map((preset) => (
          <Button
            key={preset}
            variant={privacyPreset === preset ? "default" : "outline"}
            size="sm"
            onClick={() => onPresetChange(preset)}
            className="text-xs capitalize h-7 px-2.5"
          >
            {preset === "full" && <UiIcon name="globe" className="size-3 mr-1" />}
            {preset === "minimal" && (
              <UiIcon name="shield" className="size-3 mr-1" />
            )}
            {preset === "private" && (
              <UiIcon name="lock" className="size-3 mr-1" />
            )}
            {preset}
          </Button>
        ))}
      </div>

      {/* Individual toggles */}
      <div className="space-y-1.5 rounded-xl border p-3">
        {PRIVACY_TOGGLES.map((item) => (
          <label
            key={item.key}
            className="flex items-center justify-between py-1.5 cursor-pointer select-none"
          >
            <div>
              <p className="text-xs font-medium">{item.label}</p>
              <p className="text-[11px] text-muted-foreground">{item.desc}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={privacySettings[item.key]}
              onClick={() => onToggle(item.key, !privacySettings[item.key])}
              className={cn(
                "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200",
                privacySettings[item.key] ? "bg-primary" : "bg-input",
              )}
            >
              <span
                className={cn(
                  "pointer-events-none inline-block size-4 rounded-full bg-background shadow-sm transition-transform duration-200",
                  privacySettings[item.key]
                    ? "translate-x-4"
                    : "translate-x-0",
                )}
              />
            </button>
          </label>
        ))}
      </div>

      {/* Data-locality indicator */}
      {currentProvider === "ollama" ? (
        <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
          <UiIcon name="shield-check" className="size-4" />
          <span>All data stays on your machine</span>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
          <UiIcon name="cloud" className="size-4" />
          <span>
            Data is sent to{" "}
            {providerLabel ?? "external"} servers
          </span>
        </div>
      )}
    </div>
  );
}
