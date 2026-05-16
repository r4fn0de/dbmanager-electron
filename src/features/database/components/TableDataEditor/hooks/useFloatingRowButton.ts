import { useRef, useCallback } from "react";
import type { RowRecord } from "../types";

export function useFloatingRowButton(
  expandedRow: { rowKey: string; row: RowRecord; index: number } | null,
) {
  const hoveredRowAnchorRef = useRef<null | {
    rowKey: string;
    row: RowRecord;
    index: number;
    top: number;
    left: number;
    width: number;
    height: number;
  }>(null);
  const floatingRowButtonRef = useRef<HTMLButtonElement>(null);
  const hoverClearTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const showFloatingRowButton = useCallback(
    (payload: {
      rowKey: string;
      row: RowRecord;
      index: number;
      top: number;
      left: number;
      width: number;
      height: number;
    }) => {
      hoveredRowAnchorRef.current = payload;
      const button = floatingRowButtonRef.current;
      if (!button) return;
      button.style.top = `${payload.top}px`;
      button.style.left = `${payload.left}px`;
      button.style.opacity = expandedRow ? "0" : "1";
      button.style.pointerEvents = expandedRow ? "none" : "auto";
    },
    [expandedRow],
  );

  const cancelPendingHoverClear = useCallback(() => {
    if (!hoverClearTimeoutRef.current) return;
    clearTimeout(hoverClearTimeoutRef.current);
    hoverClearTimeoutRef.current = null;
  }, []);

  const scheduleHoverClear = useCallback(() => {
    cancelPendingHoverClear();
    hoverClearTimeoutRef.current = setTimeout(() => {
      hoveredRowAnchorRef.current = null;
      const button = floatingRowButtonRef.current;
      if (button) {
        button.style.opacity = "0";
        button.style.pointerEvents = "none";
      }
      hoverClearTimeoutRef.current = null;
    }, 180);
  }, [cancelPendingHoverClear]);

  return {
    hoveredRowAnchorRef,
    floatingRowButtonRef,
    hoverClearTimeoutRef,
    showFloatingRowButton,
    cancelPendingHoverClear,
    scheduleHoverClear,
  };
}
