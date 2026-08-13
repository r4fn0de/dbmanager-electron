import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { AiSettingsPanel } from "@/features/ai";
import { cn } from "@/lib/utils";
import { AppearanceSettings } from "./AppearanceSettings";
import { ShortcutsPanel } from "./ShortcutsPanel";
import { UpdatesPanel } from "./UpdatesPanel";

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

type SettingsCategory = "appearance" | "ai" | "shortcuts" | "updates";

const SETTINGS_ITEMS: Array<{
  id: SettingsCategory;
  label: string;
  description: string;
  icon: "palette" | "sparkles" | "keyboard" | "download";
}> = [
  {
    description: "Theme, colors and display preferences",
    icon: "palette",
    id: "appearance",
    label: "Appearance",
  },
  {
    description: "Providers, models and privacy controls",
    icon: "sparkles",
    id: "ai",
    label: "AI Assistant",
  },
  {
    description: "Keyboard shortcuts across the app",
    icon: "keyboard",
    id: "shortcuts",
    label: "Shortcuts",
  },
  {
    description: "App version and update checks",
    icon: "download",
    id: "updates",
    label: "Updates",
  },
];

export function SettingsPage() {
  const [activeCategory, setActiveCategory] =
    useState<SettingsCategory>("appearance");
  const activeItem = SETTINGS_ITEMS.find((item) => item.id === activeCategory);

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <header className="flex shrink-0 items-center gap-3 border-border/40 border-b px-6 py-4">
        <div className="flex size-9 items-center justify-center rounded-lg bg-muted/60 text-foreground/80">
          <Icon name={activeItem?.icon ?? "settings"} size={18} />
        </div>
        <div className="min-w-0 space-y-0.5">
          <h1 className="font-semibold text-base text-foreground leading-none">
            {activeItem?.label ?? "Settings"}
          </h1>
          <p className="truncate text-muted-foreground text-xs">
            {activeItem?.description ?? "Configure the application"}
          </p>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <nav
          aria-label="Settings categories"
          className="flex w-52 shrink-0 flex-col gap-1 border-border/40 border-r px-3 py-3"
        >
          {SETTINGS_ITEMS.map((item) => {
            const isActive = activeCategory === item.id;
            return (
              <button
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "group flex select-none items-center gap-3 rounded-lg px-3 py-2 text-left font-medium text-sm transition-colors duration-150 ease-out active:scale-[0.98]",
                  isActive
                    ? "bg-muted/60 text-foreground"
                    : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                )}
                key={item.id}
                onClick={() => setActiveCategory(item.id)}
                type="button"
              >
                <Icon
                  className={cn(
                    "shrink-0 transition-colors duration-150 ease-out",
                    isActive
                      ? "text-primary"
                      : "text-muted-foreground group-hover:text-foreground"
                  )}
                  name={item.icon}
                  size={16}
                />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="min-w-0 flex-1 overflow-hidden">
          <AnimatePresence initial={false} mode="wait">
            <motion.div
              animate={{ opacity: 1, y: 0 }}
              className="h-full overflow-y-auto"
              exit={{ opacity: 0, y: -4 }}
              initial={{ opacity: 0, y: 4 }}
              key={activeCategory}
              transition={{ duration: 0.18, ease: EASE_OUT }}
            >
              <div className="mx-auto max-w-2xl px-6 py-5">
                {activeCategory === "appearance" && <AppearanceSettings />}
                {activeCategory === "ai" && <AiSettingsPanel compact />}
                {activeCategory === "shortcuts" && <ShortcutsPanel />}
                {activeCategory === "updates" && <UpdatesPanel />}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}
