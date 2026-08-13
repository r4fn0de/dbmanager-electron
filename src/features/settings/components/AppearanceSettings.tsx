import type { ReactNode } from "react";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ipc } from "@/ipc/manager";
import { useAppearanceStore } from "@/lib/stores/appearance";
import { LangToggle } from "./LangToggle";
import { ThemeToggle } from "./ThemeToggle";

function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-border/60 bg-muted/[0.02] px-4 py-3 transition-colors duration-150 ease-out hover:border-border/80">
      <div className="space-y-0.5">
        <p className="font-medium text-sm">{title}</p>
        <p className="text-muted-foreground text-xs">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function AppearanceSettings() {
  const solidBackground = useAppearanceStore((s) => s.solidBackground);
  const setSolidBackground = useAppearanceStore((s) => s.setSolidBackground);
  const themePreset = useAppearanceStore((s) => s.themePreset);
  const setThemePreset = useAppearanceStore((s) => s.setThemePreset);

  return (
    <div className="space-y-4">
      <SettingRow
        description="Switch between light and dark mode"
        title="Theme"
      >
        <ThemeToggle className="inline-flex size-9 items-center justify-center rounded-md text-foreground/75 transition-colors duration-150 ease-out hover:bg-muted/60 hover:text-foreground active:scale-[0.97]" />
      </SettingRow>

      <SettingRow description="Choose the interface language" title="Language">
        <LangToggle />
      </SettingRow>

      <SettingRow
        description="Choose the visual palette used by the app"
        title="Theme style"
      >
        <ToggleGroup
          aria-label="Theme style"
          onValueChange={(value) => {
            const next = value[0];
            if (next === "default" || next === "neo") {
              setThemePreset(next);
            }
          }}
          size="sm"
          spacing={1}
          value={[themePreset]}
          variant="outline"
        >
          <ToggleGroupItem aria-label="Default theme style" value="default">
            Default
          </ToggleGroupItem>
          <ToggleGroupItem aria-label="Neo theme style" value="neo">
            Neo
          </ToggleGroupItem>
        </ToggleGroup>
      </SettingRow>

      <SettingRow
        description="Disable blur and transparency effects"
        title="Solid background"
      >
        <Switch
          checked={solidBackground}
          onCheckedChange={(checked) => {
            setSolidBackground(checked);
            void ipc.client.window.setWindowVibrancy({ solid: checked });
          }}
          size="default"
        />
      </SettingRow>
    </div>
  );
}
