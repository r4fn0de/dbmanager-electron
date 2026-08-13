import { Kbd, KbdGroup } from "@/components/ui/kbd";

interface ShortcutItem {
  description: string;
  keys: string[];
}

interface ShortcutSection {
  items: ShortcutItem[];
  title: string;
}

export function ShortcutsPanel() {
  const isMac =
    typeof navigator !== "undefined" &&
    navigator.platform.toLowerCase().includes("mac");
  const mod = isMac ? "⌘" : "Ctrl";
  const shift = isMac ? "⇧" : "Shift";
  const opt = isMac ? "⌥" : "Alt";

  const sections: ShortcutSection[] = [
    {
      items: [
        { description: "Overview", keys: ["1"] },
        { description: "Tables", keys: ["2"] },
        { description: "SQL Editor", keys: ["3"] },
        { description: "Visualizer", keys: ["4"] },
        { description: "Definitions", keys: ["5"] },
        { description: "Toggle tables sidebar", keys: [mod, "B"] },
        { description: "Refresh schema", keys: [mod, "R"] },
      ],
      title: "Navigation",
    },
    {
      items: [
        { description: "Next tab (MRU)", keys: [mod, "Tab"] },
        { description: "Previous tab (MRU)", keys: [mod, shift, "Tab"] },
        { description: "Close current tab", keys: [mod, "W"] },
        { description: "Next tab (visual order)", keys: [mod, shift, "]"] },
        {
          description: "Previous tab (visual order)",
          keys: [mod, shift, "["],
        },
        { description: "Next tab", keys: ["Ctrl", "PageDown"] },
        { description: "Previous tab", keys: ["Ctrl", "PageUp"] },
      ],
      title: "Tabs",
    },
    {
      items: [{ description: "Toggle AI Chat panel", keys: [mod, "J"] }],
      title: "AI Assistant",
    },
    {
      items: [
        { description: "Run SQL", keys: [mod, "Enter"] },
        { description: "Save query", keys: [mod, "S"] },
        { description: "Format SQL", keys: [mod, shift, "F"] },
        { description: "EXPLAIN query", keys: [mod, "E"] },
        { description: "EXPLAIN ANALYZE query", keys: [mod, shift, "E"] },
        { description: "Focus search", keys: [mod, "K"] },
        { description: "Focus search (when not in input)", keys: ["/"] },
      ],
      title: "SQL Editor",
    },
    {
      items: [
        { description: "Copy", keys: [mod, "C"] },
        { description: "Paste", keys: [mod, "V"] },
        { description: "Cut", keys: [mod, "X"] },
        { description: "Undo", keys: [mod, "Z"] },
        { description: "Redo", keys: [mod, shift, "Z"] },
        { description: "Select All", keys: [mod, "A"] },
      ],
      title: "Global",
    },
  ];

  return (
    <div className="space-y-6">
      {sections.map((section) => (
        <div className="space-y-2" key={section.title}>
          <h3 className="font-semibold text-muted-foreground/70 text-xs uppercase tracking-wide">
            {section.title}
          </h3>
          <div className="divide-y divide-border/50 rounded-xl border border-border/60 bg-muted/[0.02] px-4">
            {section.items.map((item, idx) => (
              <div
                className="flex items-center justify-between py-2.5 first:pt-3 last:pb-3"
                key={idx}
              >
                <span className="text-foreground/90 text-sm">
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
