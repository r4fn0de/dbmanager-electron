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
    <section className="flex h-full min-h-0 overflow-hidden rounded-md border bg-background">
      <nav
        aria-label="Settings categories"
        className="flex w-44 shrink-0 flex-col gap-0.5 px-3 py-4"
      >
        <p className="select-none px-2.5 pb-2 font-medium text-[11px] text-muted-foreground/60 uppercase tracking-wider">
          Settings
        </p>
        {SETTINGS_ITEMS.map((item) => {
          const isActive = activeCategory === item.id;
          return (
            <button
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "group flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] outline-none transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]",
                isActive
                  ? "bg-muted/70 font-medium text-foreground"
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
                    ? "text-foreground"
                    : "text-muted-foreground/70 group-hover:text-foreground"
                )}
                name={item.icon}
                size={14}
              />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="min-w-0 flex-1 overflow-hidden border-border/40 border-l">
        <AnimatePresence initial={false} mode="wait">
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="h-full overflow-y-auto"
            exit={{ opacity: 0, y: -4 }}
            initial={{ opacity: 0, y: 4 }}
            key={activeCategory}
            transition={{ duration: 0.18, ease: EASE_OUT }}
          >
            <div className="mx-auto max-w-2xl px-8 py-6">
              <div className="mb-5">
                <h1 className="font-medium text-foreground text-sm">
                  {activeItem?.label ?? "Settings"}
                </h1>
                <p className="mt-0.5 text-muted-foreground text-xs">
                  {activeItem?.description ?? "Configure the application"}
                </p>
              </div>
              {activeCategory === "appearance" && <AppearanceSettings />}
              {activeCategory === "ai" && <AiSettingsPanel compact />}
              {activeCategory === "shortcuts" && <ShortcutsPanel />}
              {activeCategory === "updates" && <UpdatesPanel />}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}
