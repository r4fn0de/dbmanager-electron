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
import { AnimatePresence, motion } from "motion/react";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ThemeToggle } from "@/components/ThemeToggle";
import { AiSettingsPanel } from "@/components/AiSettingsPanel";
import { cn } from "@/utils/tailwind";

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

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
      <div className="flex items-center justify-between rounded-xl border border-border/60 bg-muted/[0.02] px-4 py-3 transition-colors duration-150 ease-out hover:border-border">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">Theme</p>
          <p className="text-xs text-muted-foreground">
            Switch between light and dark mode
          </p>
        </div>
        <ThemeToggle className="inline-flex size-9 items-center justify-center rounded-md text-foreground/75 hover:text-foreground hover:bg-muted/60 transition-colors duration-150 ease-out active:scale-[0.97]" />
      </div>
    </div>
  );
}

export function SettingsDialog() {
  const [open, setOpen] = useState(false);
  const [activeCategory, setActiveCategory] =
    useState<SettingsCategory>("appearance");

  const activeItem = SETTINGS_ITEMS.find((i) => i.id === activeCategory)!;
  const ActiveIcon = activeItem.icon;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger>
        <span className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground cursor-default active:scale-[0.97]">
          <Cog className="size-4" />
        </span>
      </DialogTrigger>
      <DialogContent
        className="p-0 overflow-hidden flex flex-col !max-w-none gap-0"
        style={{ width: 880, height: 640, maxWidth: 880 }}
      >
        {/* Header como div simples, sem DialogHeader */}
        <div className="px-6 pt-3 shrink-0">
          <div className="flex items-center gap-2.5 text-base font-medium">
            <ActiveIcon className="size-4 text-primary" />
            Settings
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {activeItem.label}
          </p>
        </div>

        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Sidebar */}
          <div className="w-48 shrink-0 border-r border-border/40 px-2 py-2 flex flex-col gap-0.5">
            {SETTINGS_ITEMS.map((item) => {
              const isActive = activeCategory === item.id;
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveCategory(item.id)}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150 ease-out text-left active:scale-[0.98]",
                    isActive
                      ? "bg-primary/[0.10] text-primary ring-1 ring-primary/25"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                  )}
                >
                  <Icon
                    className={cn(
                      "size-4 shrink-0 transition-colors duration-150 ease-out",
                      isActive ? "text-primary" : "text-muted-foreground"
                    )}
                  />
                  {item.label}
                </button>
              );
            })}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0 overflow-hidden">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={activeCategory}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18, ease: EASE_OUT }}
                className="h-full overflow-y-auto px-6 py-4"
              >
                {activeCategory === "appearance" && <AppearanceSettings />}
                {activeCategory === "ai" && <AiSettingsPanel compact />}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
