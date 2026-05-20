import { Kbd, KbdGroup } from "@/components/ui/kbd";

interface ShortcutItem {
  keys: string[];
  description: string;
}

interface ShortcutSection {
  title: string;
  items: ShortcutItem[];
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
        {
          keys: [mod, shift, "["],
          description: "Previous tab (visual order)",
        },
        { keys: ["Ctrl", "PageDown"], description: "Next tab" },
        { keys: ["Ctrl", "PageUp"], description: "Previous tab" },
      ],
    },
    {
      title: "AI Assistant",
      items: [{ keys: [mod, "J"], description: "Toggle AI Chat panel" }],
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
          <h3 className="text-xs font-medium text-muted-foreground">
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
