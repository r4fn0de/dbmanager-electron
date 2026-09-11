import { type IconName, Icon as UiIcon } from "@/components/ui/Icon";
import { Switch } from "@/components/ui/switch";
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
  {
    desc: "Table names, columns and types",
    key: "schema",
    label: "Schema",
  },
  {
    desc: "Host, port and database name",
    key: "connectionInfo",
    label: "Connection info",
  },
  {
    desc: "Names of your saved connections",
    key: "connectionsList",
    label: "Connections list",
  },
  {
    desc: "Recent conversations and similar queries",
    key: "memory",
    label: "Memory",
  },
];

/** Descriptions mirror the actual values in `PRIVACY_PRESETS`. */
const PRESETS: Array<{
  id: PrivacyPreset;
  label: string;
  desc: string;
  icon: IconName;
}> = [
  {
    desc: "Shares schema, connection info and memory",
    icon: "globe",
    id: "full",
    label: "Full",
  },
  {
    desc: "Hides the schema and the connections list",
    icon: "shield",
    id: "minimal",
    label: "Minimal",
  },
  {
    desc: "Shares nothing with the model",
    icon: "lock",
    id: "private",
    label: "Private",
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
  const staysLocal = currentProvider === "ollama";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <p className="font-medium text-muted-foreground text-xs">Preset</p>
        <div className="grid grid-cols-3 gap-2">
          {PRESETS.map((preset) => {
            const isActive = privacyPreset === preset.id;
            return (
              <button
                aria-pressed={isActive}
                className={cn(
                  "flex flex-col gap-1 rounded-xl border p-3 text-left outline-none transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]",
                  isActive
                    ? "border-primary/30 bg-primary/[0.08] ring-1 ring-primary/20"
                    : "border-border/70 hover:border-muted-foreground/30 hover:bg-muted/[0.02]"
                )}
                key={preset.id}
                onClick={() => onPresetChange(preset.id)}
                type="button"
              >
                <span className="flex items-center gap-1.5">
                  <UiIcon
                    className={cn(
                      "size-3.5 shrink-0",
                      isActive ? "text-primary" : "text-muted-foreground"
                    )}
                    name={preset.icon}
                  />
                  <span
                    className={cn(
                      "font-medium text-xs",
                      isActive ? "text-primary" : "text-foreground"
                    )}
                  >
                    {preset.label}
                  </span>
                </span>
                <span className="text-[11px] text-muted-foreground leading-snug">
                  {preset.desc}
                </span>
              </button>
            );
          })}
        </div>
        {privacyPreset === null && (
          <p className="text-[11px] text-muted-foreground">
            Custom — the toggles below don't match any preset.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <p className="font-medium text-muted-foreground text-xs">
          What the AI can see
        </p>
        <div className="overflow-hidden rounded-xl border border-border/70">
          {PRIVACY_TOGGLES.map((item, index) => {
            const switchId = `privacy-${item.key}`;
            return (
              <div
                className={cn(
                  "flex items-center justify-between gap-4 px-3.5 py-3",
                  index > 0 && "border-border/50 border-t"
                )}
                key={item.key}
              >
                <label className="min-w-0 cursor-pointer" htmlFor={switchId}>
                  <p className="font-medium text-xs">{item.label}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {item.desc}
                  </p>
                </label>
                <Switch
                  checked={privacySettings[item.key]}
                  id={switchId}
                  onCheckedChange={(checked) => onToggle(item.key, checked)}
                />
              </div>
            );
          })}
        </div>
      </div>

      <div
        className={cn(
          "flex items-center gap-2 rounded-lg px-3 py-2.5 text-xs",
          staysLocal
            ? "bg-emerald-500/[0.08] text-emerald-600 dark:text-emerald-400"
            : "bg-amber-500/[0.08] text-amber-600 dark:text-amber-400"
        )}
      >
        <UiIcon
          className="size-4 shrink-0"
          name={staysLocal ? "shield-check" : "cloud"}
        />
        <span>
          {staysLocal
            ? "All data stays on your machine"
            : `Data is sent to ${providerLabel ?? "external"} servers`}
        </span>
      </div>
    </div>
  );
}
