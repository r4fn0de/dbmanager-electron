import { useAppearanceStore } from "@/lib/stores/appearance";
import { ThemeToggle } from "./ThemeToggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Switch } from "@/components/ui/switch";
import { ipc } from "@/ipc/manager";

export function AppearanceSettings() {
  const solidBackground = useAppearanceStore((s) => s.solidBackground);
  const setSolidBackground = useAppearanceStore((s) => s.setSolidBackground);
  const themePreset = useAppearanceStore((s) => s.themePreset);
  const setThemePreset = useAppearanceStore((s) => s.setThemePreset);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-xl border border-border/60 bg-muted/[0.02] px-4 py-3 transition-colors duration-150 ease-out hover:border-border/80">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">Theme</p>
          <p className="text-xs text-muted-foreground">
            Switch between light and dark mode
          </p>
        </div>
        <ThemeToggle className="inline-flex size-9 items-center justify-center rounded-md text-foreground/75 hover:text-foreground hover:bg-muted/60 transition-colors duration-150 ease-out active:scale-[0.97]" />
      </div>

      <div className="flex items-center justify-between rounded-xl border border-border/60 bg-muted/[0.02] px-4 py-3 transition-colors duration-150 ease-out hover:border-border/80">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">Theme style</p>
          <p className="text-xs text-muted-foreground">
            Choose the visual palette used by the app
          </p>
        </div>
        <ToggleGroup
          value={[themePreset]}
          onValueChange={(value) => {
            const next = value[0];
            if (next === "default" || next === "neo") {
              setThemePreset(next);
            }
          }}
          variant="outline"
          size="sm"
          spacing={1}
          aria-label="Theme style"
        >
          <ToggleGroupItem value="default" aria-label="Default theme style">
            Default
          </ToggleGroupItem>
          <ToggleGroupItem value="neo" aria-label="Neo theme style">
            Neo
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div className="flex items-center justify-between rounded-xl border border-border/60 bg-muted/[0.02] px-4 py-3 transition-colors duration-150 ease-out hover:border-border/80">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">Solid background</p>
          <p className="text-xs text-muted-foreground">
            Disable blur and transparency effects
          </p>
        </div>
        <Switch
          size="default"
          checked={solidBackground}
          onCheckedChange={(checked) => {
            setSolidBackground(checked);
            void ipc.client.window.setWindowVibrancy({ solid: checked });
          }}
        />
      </div>
    </div>
  );
}
