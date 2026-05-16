import { useRef, useCallback } from "react";

export function useColumnResizing(
  columnWidths: Record<string, number>,
  setColumnWidths: React.Dispatch<
    React.SetStateAction<Record<string, number>>
  >,
  defaultColumnWidths: Record<string, number>,
) {
  const resizeRef = useRef<{
    column: string;
    startX: number;
    startWidth: number;
  } | null>(null);
  const resizeRafRef = useRef<number | null>(null);
  const pendingResizeRef = useRef<{ column: string; width: number } | null>(
    null,
  );
  const columnWidthsRef = useRef(columnWidths);
  columnWidthsRef.current = columnWidths;
  const defaultColumnWidthsRef = useRef(defaultColumnWidths);
  defaultColumnWidthsRef.current = defaultColumnWidths;

  const handleResizeMouseDown = useCallback(
    (column: string, event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const currentWidth =
        columnWidthsRef.current[column] ??
        defaultColumnWidthsRef.current[column] ??
        200;
      resizeRef.current = {
        column,
        startX: event.clientX,
        startWidth: currentWidth,
      };
      const handleMouseMove = (e: MouseEvent) => {
        const resizeState = resizeRef.current;
        if (!resizeState) return;
        const delta = e.clientX - resizeState.startX;
        const newWidth = Math.max(60, resizeState.startWidth + delta);
        pendingResizeRef.current = {
          column: resizeState.column,
          width: newWidth,
        };
        if (resizeRafRef.current !== null) return;
        resizeRafRef.current = requestAnimationFrame(() => {
          const pending = pendingResizeRef.current;
          resizeRafRef.current = null;
          if (!pending) return;
          setColumnWidths((prev) => {
            if (prev[pending.column] === pending.width) return prev;
            return {
              ...prev,
              [pending.column]: pending.width,
            };
          });
        });
      };
      const handleMouseUp = () => {
        resizeRef.current = null;
        pendingResizeRef.current = null;
        if (resizeRafRef.current !== null) {
          cancelAnimationFrame(resizeRafRef.current);
          resizeRafRef.current = null;
        }
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [setColumnWidths],
  );

  return {
    columnWidths,
    setColumnWidths,
    resizeRef,
    resizeRafRef,
    pendingResizeRef,
    handleResizeMouseDown,
  };
}
