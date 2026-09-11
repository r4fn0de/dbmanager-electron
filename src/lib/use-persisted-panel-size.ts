import type { Size } from "motion-panels/react";
import { useCallback, useState } from "react";

/** Prefix for the panel sizes this app persists. */
const STORAGE_PREFIX = "tars:panel-size:";

/** Prefix react-resizable-panels' useDefaultLayout wrote under — read so existing layouts survive. */
const LEGACY_PREFIX = "react-resizable-panels:";

const PERCENTAGE_PATTERN = /^\d+(?:\.\d+)?%$/;

function isSize(value: unknown): value is Size {
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  return typeof value === "string" && PERCENTAGE_PATTERN.test(value);
}

/** Resolves a size the previous resizable-panels group stored for `panelId`, as a percentage. */
function readLegacySize(id: string, panelId: string): Size | null {
  try {
    const raw = localStorage.getItem(`${LEGACY_PREFIX}${id}`);
    if (!raw) {
      return null;
    }
    const layout: unknown = JSON.parse(raw);
    if (typeof layout !== "object" || layout === null) {
      return null;
    }
    const percentage = (layout as Record<string, unknown>)[panelId];
    if (typeof percentage !== "number" || !Number.isFinite(percentage)) {
      return null;
    }
    return `${percentage}%`;
  } catch {
    return null;
  }
}

function readStoredSize(storageKey: string): Size | null {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    return isSize(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Keeps a panel size in localStorage so a drag survives a reload.
 *
 * Falls back to the layout react-resizable-panels used to persist under the same
 * group id, which keeps widths people already tuned instead of resetting them.
 */
export function usePersistedPanelSize(
  id: string,
  fallback: Size,
  legacyPanelId?: string
): [Size, (size: Size) => void] {
  const storageKey = `${STORAGE_PREFIX}${id}`;
  const [size, setSize] = useState<Size>(
    () =>
      readStoredSize(storageKey) ??
      (legacyPanelId ? readLegacySize(id, legacyPanelId) : null) ??
      fallback
  );

  const update = useCallback(
    (next: Size) => {
      setSize(next);
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // Storage can be unavailable (private mode, quota) — the size still applies this session.
      }
    },
    [storageKey]
  );

  return [size, update];
}

/** Pixel width a percentage size resolves to inside a container. */
export function percentageToPixels(size: Size, containerWidth: number): number {
  if (typeof size === "number") {
    return Math.round(size);
  }
  return Math.round((Number.parseFloat(size) / 100) * containerWidth);
}
