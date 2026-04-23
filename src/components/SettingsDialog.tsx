/**
 * SettingsDialog — global settings modal with sidebar navigation.
 *
 * Consolidates app-level preferences that were previously scattered:
 * - Theme toggle (also kept in TitleBar for convenience)
 * - AI configuration (moved from per-connection sidebar)
 *
 * Uses a sidebar layout instead of top tabs for better scannability
 * and to match the app's existing sidebar-heavy visual language.
 */
import { useState } from "react";
import { Cog, Palette, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ThemeToggle } from "@/components/ThemeToggle";
import { AiSettingsPanel } from "@/components/AiSettingsPanel";
import { cn } from "@/utils/tailwind";

type SettingsCategory = "appearance" | "ai";

interface SettingsItem {
  id: SettingsCategory;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const SETTINGS_ITEMS: SettingsItem[] = [
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "ai", label: "AI Assistant", icon: Sparkles },
];

function AppearanceSettings() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3 transition-colors duration-150 hover:border-border/80">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">Theme</p>
          <p className="text-xs text-muted-foreground">
            Switch between light and dark mode
          </p>
        </div>
        <ThemeToggle className="inline-flex size-9 items-center justify-center rounded-md text-foreground/75 hover:text-foreground hover:bg-muted/60 transition-colors duration-150 active:scale-[0.97]" />
      </div>
    </div>
  );
}

export function SettingsDialog() {
  const [open, setOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>("appearance");

  const activeItem = SETTINGS_ITEMS.find((i) => i.id === activeCategory)!;
  const ActiveIcon = activeItem.icon;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger>
        <span className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:text-foreground cursor-default active:scale-[0.97]">
          <Cog className="size-4" />
        </span>
      </DialogTrigger>
      <DialogContent
        className="p-0 overflow-hidden flex flex-col !max-w-none"
        style={{ width: 960, height: 760, maxWidth: 960 }}
      >
        <DialogHeader className="px-6 pt-6 pb-0 shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <ActiveIcon className="size-4 text-primary" />
            Settings
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-1 min-h-0 mt-5 overflow-hidden">
          {/* Sidebar */}
          <div className="w-44 shrink-0 border-r border-border/50 px-2 py-2 flex flex-col gap-0.5">
            {SETTINGS_ITEMS.map((item) => {
              const isActive = activeCategory === item.id;
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveCategory(item.id)}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-all duration-150 ease-out text-left active:scale-[0.98]",
                    isActive
                      ? "bg-primary/8 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  )}
                >
                  <Icon className={cn("size-4 shrink-0", isActive && "text-primary")} />
                  {item.label}
                </button>
              );
            })}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0 p-6 overflow-hidden">
            <div className="h-full overflow-y-auto">
              {activeCategory === "appearance" && <AppearanceSettings />}
              {activeCategory === "ai" && <AiSettingsPanel compact />}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
