import { AnimatePresence, motion } from "motion/react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { Moon } from "@/components/icons/Moon";
import { Sun } from "@/components/icons/Sun";

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
    () => false
  );
}

const ICON_MOTION = {
  animate: { opacity: 1, rotate: 0, scale: 1 },
  exit: { opacity: 0, rotate: 20, scale: 0.85 },
  initial: { opacity: 0, rotate: -20, scale: 0.85 },
  transition: {
    duration: 0.18,
    ease: [0.23, 1, 0.32, 1] as [number, number, number, number],
  },
};

interface ThemeToggleProps {
  className?: string;
}

export function ThemeToggle({ className }: ThemeToggleProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useHydrated();

  if (!mounted) {
    return (
      <button className={className} disabled type="button">
        <Sun className="size-4" />
      </button>
    );
  }

  return (
    <motion.button
      className={className}
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      title={
        resolvedTheme === "dark"
          ? "Switch to light theme"
          : "Switch to dark theme"
      }
      transition={{ duration: 0.1 }}
      type="button"
      whileTap={{ scale: 0.97 }}
    >
      <AnimatePresence initial={false} mode="wait">
        {resolvedTheme === "dark" ? (
          <motion.div
            className="flex items-center justify-center"
            key="sun"
            {...ICON_MOTION}
          >
            <Sun className="size-4" />
          </motion.div>
        ) : (
          <motion.div
            className="flex items-center justify-center"
            key="moon"
            {...ICON_MOTION}
          >
            <Moon className="size-4" />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.button>
  );
}
