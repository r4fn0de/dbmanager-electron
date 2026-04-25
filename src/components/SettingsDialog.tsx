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
import { Settings } from "@/components/icons/Settings";
import { Icon } from "@/components/ui/Icon";
import { AnimatePresence, motion } from "motion/react";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ThemeToggle } from "@/components/ThemeToggle";
import { AiSettingsPanel } from "@/components/AiSettingsPanel";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

type SettingsCategory = "appearance" | "ai" | "shortcuts";

interface SettingsItem {
  id: SettingsCategory;
  label: string;
  icon: 'palette' | 'sparkles' | 'keyboard';
}

const SETTINGS_ITEMS: SettingsItem[] = [
  { id: "appearance", label: "Appearance", icon: 'palette' },
  { id: "ai", label: "AI Assistant", icon: 'sparkles' },
  { id: "shortcuts", label: "Shortcuts", icon: 'keyboard' },
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

interface ShortcutItem {
  keys: string[];
  description: string;
}

interface ShortcutSection {
  title: string;
  items: ShortcutItem[];
}

function ShortcutsPanel() {
  const isMac = typeof navigator !== "undefined" && navigator.platform.toLowerCase().includes("mac");
  const mod = isMac ? "⌘" : "Ctrl";
  const shift = isMac ? "⇧" : "Shift";
  const opt = isMac ? "⌥" : "Alt";

  const sections: ShortcutSection[] = [
    {
      title: "Navigation",
      items: [
        { keys: ["1"], description: "Overview" },
        { keys: ["2"], description: "Tables" },
        { keys: ["3"], description: "SQL Editor" },
        { keys: ["4"], description: "Visualizer" },
        { keys: ["5"], description: "Definitions" },
        { keys: [mod, "B"], description: "Toggle tables sidebar" },
        { keys: [mod, "R"], description: "Refresh schema" },
      ],
    },
    {
      title: "Tabs",
      items: [
        { keys: [mod, "Tab"], description: "Next tab (MRU)" },
        { keys: [mod, shift, "Tab"], description: "Previous tab (MRU)" },
        { keys: [mod, "W"], description: "Close current tab" },
        { keys: [mod, shift, "]"], description: "Next tab (visual order)" },
        { keys: [mod, shift, "["], description: "Previous tab (visual order)" },
        { keys: ["Ctrl", "PageDown"], description: "Next tab" },
        { keys: ["Ctrl", "PageUp"], description: "Previous tab" },
      ],
    },
    {
      title: "AI Assistant",
      items: [
        { keys: [mod, "J"], description: "Toggle AI Chat panel" },
      ],
    },
    {
      title: "SQL Editor",
      items: [
        { keys: [mod, "Enter"], description: "Run SQL" },
        { keys: [mod, "S"], description: "Save query" },
        { keys: [mod, shift, "F"], description: "Format SQL" },
        { keys: [mod, "E"], description: "EXPLAIN query" },
        { keys: [mod, shift, "E"], description: "EXPLAIN ANALYZE query" },
        { keys: [mod, "K"], description: "Focus search" },
        { keys: ["/"], description: "Focus search (when not in input)" },
      ],
    },
    {
      title: "Global",
      items: [
        { keys: [mod, "C"], description: "Copy" },
        { keys: [mod, "V"], description: "Paste" },
        { keys: [mod, "X"], description: "Cut" },
        { keys: [mod, "Z"], description: "Undo" },
        { keys: [mod, shift, "Z"], description: "Redo" },
        { keys: [mod, "A"], description: "Select All" },
      ],
    },
  ];

  return (
    <div className="space-y-6">
      {sections.map((section) => (
        <div key={section.title} className="space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            {section.title}
          </h3>
          <div className="space-y-1.5">
            {section.items.map((item, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between py-1.5"
              >
                <span className="text-sm text-muted-foreground">
                  {item.description}
                </span>
                <KbdGroup>
                  {item.keys.map((key, keyIdx) => (
                    <Kbd key={keyIdx}>{key}</Kbd>
                  ))}
                </KbdGroup>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

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
        className="p-0 overflow-hidden flex flex-col !max-w-none gap-0"
        style={{ width: 880, height: 640, maxWidth: 880 }}
      >
        {/* Header minimalista */}
        <div className="px-5 py-3 shrink-0 border-b border-border/40">
          <h2 className="text-sm font-medium text-foreground">
            {activeItem.label}
          </h2>
        </div>

        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Sidebar */}
          <div className="w-48 shrink-0 border-r border-border/40 px-2 py-2 flex flex-col gap-0.5">
            {SETTINGS_ITEMS.map((item) => {
              const isActive = activeCategory === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveCategory(item.id)}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150 ease-out text-left active:scale-[0.98]",
                    isActive
                      ? "bg-muted/50 text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                  )}
                >
                  <Icon
                    name={item.icon}
                    size={16}
                    className={cn(
                      "shrink-0 transition-colors duration-150 ease-out",
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
                {activeCategory === "shortcuts" && <ShortcutsPanel />}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
