import { useEffect, useState } from "react";

type LegacyMediaQueryList = MediaQueryList & {
  addListener?: (listener: (event: MediaQueryListEvent) => void) => void;
  removeListener?: (listener: (event: MediaQueryListEvent) => void) => void;
};

/**
 * Hook to detect user's reduced motion preference.
 * Returns true if user prefers reduced motion, false otherwise.
 * Defaults to false (no preference) during SSR to avoid hydration mismatch.
 */
export function useReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mediaQuery.matches);

    const handler = (event: MediaQueryListEvent) => {
      setReducedMotion(event.matches);
    };

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handler);
      return () => mediaQuery.removeEventListener("change", handler);
    }

    const legacyMediaQuery = mediaQuery as LegacyMediaQueryList;
    if (typeof legacyMediaQuery.addListener === "function") {
      legacyMediaQuery.addListener(handler);
      return () => legacyMediaQuery.removeListener?.(handler);
    }

    return undefined;
  }, []);

  return reducedMotion;
}
