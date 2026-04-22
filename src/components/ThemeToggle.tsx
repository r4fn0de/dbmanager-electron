import { Sun } from "@/components/icons/Sun";
import { Moon } from "@/components/icons/Moon";
import { useTheme } from "next-themes";
import { AnimatePresence, motion } from "motion/react";
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

const ICON_MOTION = {
  initial: { opacity: 0, scale: 0.85, rotate: -20 },
  animate: { opacity: 1, scale: 1, rotate: 0 },
  exit: { opacity: 0, scale: 0.85, rotate: 20 },
  transition: { duration: 0.18, ease: [0.23, 1, 0.32, 1] as [number, number, number, number] },
};

interface ThemeToggleProps {
  className?: string;
}

export function ThemeToggle({ className }: ThemeToggleProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useHydrated();

  if (!mounted) {
    return (
      <button
        type="button"
        className={className}
        disabled
      >
        <Sun className="size-4" />
      </button>
    );
  }

  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.97 }}
      transition={{ duration: 0.1 }}
      className={className}
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      title={resolvedTheme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
    >
      <AnimatePresence mode="wait" initial={false}>
        {resolvedTheme === "dark" ? (
          <motion.div
            key="sun"
            className="flex items-center justify-center"
            {...ICON_MOTION}
          >
            <Sun className="size-4" />
          </motion.div>
        ) : (
          <motion.div
            key="moon"
            className="flex items-center justify-center"
            {...ICON_MOTION}
          >
            <Moon className="size-4" />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.button>
  );
}
