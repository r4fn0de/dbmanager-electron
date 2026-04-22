import { Button } from "@/components/ui/button";
import { Sun } from "@/components/icons/Sun";
import { Moon } from "@/components/icons/Moon";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

// Hydration-safe mounted check — avoids the useEffect + useState pattern
// that causes an extra render cycle. useSyncExternalStore with a
// server snapshot of false and client snapshot of true gives us the
// same result without the intermediate state update.
const noop = () => {};
const emptySubscribe = () => noop;
function useHydrated() {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useHydrated();

  if (!mounted) {
    return (
      <Button variant="ghost" size="icon" className="h-9 w-9">
        <Sun className="h-4 w-4" />
      </Button>
    );
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-9 w-9"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      title={resolvedTheme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
    >
      {resolvedTheme === "dark" ? (
        <Sun className="h-4 w-4" />
      ) : (
        <Moon className="h-4 w-4" />
      )}
    </Button>
  );
}
