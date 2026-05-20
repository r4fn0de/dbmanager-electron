import { useState } from "react";
import { Settings } from "@/components/icons/Settings";
import { Icon } from "@/components/ui/Icon";
import { AnimatePresence, motion } from "motion/react";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from "@/components/ui/dialog";
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
  icon: "palette" | "sparkles" | "keyboard" | "download";
}> = [
  { id: "appearance", label: "Appearance", icon: "palette" },
  { id: "ai", label: "AI Assistant", icon: "sparkles" },
  { id: "shortcuts", label: "Shortcuts", icon: "keyboard" },
  { id: "updates", label: "Updates", icon: "download" },
];

export function SettingsDialog() {
  const [open, setOpen] = useState(false);
  const [activeCategory, setActiveCategory] =
    useState<SettingsCategory>("appearance");

  const activeItem = SETTINGS_ITEMS.find((i) => i.id === activeCategory)!;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger>
        <span className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground cursor-default active:scale-[0.97]">
          <Settings className="size-4" />
        </span>
      </DialogTrigger>
      <DialogContent
        className="t-resize p-0 overflow-hidden flex flex-col !max-w-none gap-0"
        style={{ width: 880, height: 640, maxWidth: 880 }}
      >
        <div className="px-5 py-3 shrink-0 border-b border-border/40">
          <h2 className="text-sm font-medium text-foreground">
            {activeItem.label}
          </h2>
        </div>

        <div className="flex flex-1 min-h-0 overflow-hidden">
          <div className="w-48 shrink-0 border-r border-border/40 px-2 py-2 flex flex-col gap-0.5">
            {SETTINGS_ITEMS.map((item) => {
              const isActive = activeCategory === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveCategory(item.id)}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150 ease-out text-left active:scale-[0.98] select-none",
                    isActive
                      ? "bg-muted/50 text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/40",
                  )}
                >
                  <Icon
                    name={item.icon}
                    size={16}
                    className={cn(
                      "shrink-0 transition-colors duration-150 ease-out",
                      isActive ? "text-primary" : "text-muted-foreground",
                    )}
                  />
                  {item.label}
                </button>
              );
            })}
          </div>

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
                {activeCategory === "shortcuts" && <ShortcutsPanel />}
                {activeCategory === "updates" && <UpdatesPanel />}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
