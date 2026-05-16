import { useRef, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { RowRecord } from "../types";
import type { EffectiveRow } from "../utils/tableDataTransforms";

export const ROW_HEIGHT = 28;

export function useRowVirtualization(
  draftInserts: RowRecord[],
  effectiveRows: EffectiveRow[],
) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const totalVirtualRows = draftInserts.length + effectiveRows.length;
  const rowVirtualizer = useVirtualizer({
    count: totalVirtualRows,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });
  const virtualItems = rowVirtualizer.getVirtualItems();

  const visibleInsertIndices = useMemo(
    () =>
      new Set(
        virtualItems.reduce<number[]>((indices, virtualItem) => {
          if (virtualItem.index < draftInserts.length) {
            indices.push(virtualItem.index);
          }
          return indices;
        }, []),
      ),
    [virtualItems, draftInserts.length],
  );
  const visibleEffectiveArrayIndices = useMemo(
    () =>
      new Set(
        virtualItems.reduce<number[]>((indices, virtualItem) => {
          if (virtualItem.index >= draftInserts.length) {
            indices.push(virtualItem.index - draftInserts.length);
          }
          return indices;
        }, []),
      ),
    [virtualItems, draftInserts.length],
  );

  const visibleDraftInserts = useMemo<
    Array<{ row: RowRecord; insertIndex: number }>
  >(() => {
    const result: Array<{ row: RowRecord; insertIndex: number }> = [];
    for (let i = 0; i < draftInserts.length; i++) {
      if (visibleInsertIndices.has(i)) {
        result.push({ row: draftInserts[i], insertIndex: i });
      }
    }
    return result;
  }, [draftInserts, visibleInsertIndices]);

  const visibleEffectiveRows = useMemo(
    () =>
      effectiveRows.filter((_, arrayIdx) =>
        visibleEffectiveArrayIndices.has(arrayIdx),
      ),
    [effectiveRows, visibleEffectiveArrayIndices],
  );

  const topSpacerHeight =
    virtualItems.length > 0 ? virtualItems[0].start : 0;
  const bottomSpacerHeight =
    virtualItems.length > 0
      ? rowVirtualizer.getTotalSize() -
        virtualItems[virtualItems.length - 1].end
      : 0;

  return {
    scrollRef,
    rowVirtualizer,
    virtualItems,
    visibleInsertIndices,
    visibleEffectiveArrayIndices,
    visibleDraftInserts,
    visibleEffectiveRows,
    topSpacerHeight,
    bottomSpacerHeight,
    totalVirtualRows,
    ROW_HEIGHT,
  };
}
