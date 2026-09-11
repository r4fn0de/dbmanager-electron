import { useVirtualizer } from "@tanstack/react-virtual";
import { useMemo, useRef, type RefObject } from "react";
import type { RowRecord } from "../types";
import type { EffectiveRow } from "../utils/tableDataTransforms";

export const ROW_HEIGHT = 28;

export function useRowVirtualization(
  draftInserts: RowRecord[],
  effectiveRows: EffectiveRow[],
  externalScrollRef?: RefObject<HTMLDivElement | null>
) {
  const internalScrollRef = useRef<HTMLDivElement>(null);
  const scrollRef = externalScrollRef ?? internalScrollRef;
  const totalVirtualRows = draftInserts.length + effectiveRows.length;
  const rowVirtualizer = useVirtualizer({
    count: totalVirtualRows,
    estimateSize: () => ROW_HEIGHT,
    getScrollElement: () => scrollRef.current,
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
        }, [])
      ),
    [virtualItems, draftInserts.length]
  );
  const visibleEffectiveArrayIndices = useMemo(
    () =>
      new Set(
        virtualItems.reduce<number[]>((indices, virtualItem) => {
          if (virtualItem.index >= draftInserts.length) {
            indices.push(virtualItem.index - draftInserts.length);
          }
          return indices;
        }, [])
      ),
    [virtualItems, draftInserts.length]
  );

  const visibleDraftInserts = useMemo<
    Array<{ row: RowRecord; insertIndex: number }>
  >(() => {
    const result: Array<{ row: RowRecord; insertIndex: number }> = [];
    for (let i = 0; i < draftInserts.length; i++) {
      if (visibleInsertIndices.has(i)) {
        result.push({ insertIndex: i, row: draftInserts[i] });
      }
    }
    return result;
  }, [draftInserts, visibleInsertIndices]);

  const visibleEffectiveRows = useMemo(
    () =>
      effectiveRows.reduce<Array<EffectiveRow & { virtualIndex: number }>>(
        (rows, entry, arrayIndex) => {
          if (visibleEffectiveArrayIndices.has(arrayIndex)) {
            rows.push({
              ...entry,
              virtualIndex: draftInserts.length + arrayIndex,
            });
          }
          return rows;
        },
        []
      ),
    [draftInserts.length, effectiveRows, visibleEffectiveArrayIndices]
  );

  return {
    rowVirtualizer,
    scrollRef,
    totalRowHeight: rowVirtualizer.getTotalSize(),
    totalVirtualRows,
    virtualItems,
    visibleDraftInserts,
    visibleEffectiveArrayIndices,
    visibleEffectiveRows,
    visibleInsertIndices,
  };
}
