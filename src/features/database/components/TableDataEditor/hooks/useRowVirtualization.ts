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
  // Callbacks estáveis: recriar `estimateSize`/`getScrollElement` a cada
  // render faz o virtualizer descartar as medidas e recalcular a faixa do
  // zero — exatamente o "pulo + branco + trava" no scroll contínuo.
  // `scrollRef` é um objeto ref estável (useRef), então a closure direta é
  // segura e o linter reclamaría de dep desnecessária com useMemo.
  const rowVirtualizer = useVirtualizer({
    count: totalVirtualRows,
    estimateSize: () => ROW_HEIGHT,
    gap: 0,
    getScrollElement: () => scrollRef.current,
    // Overscan enxuto: cada linha monta N células com Popover + Checkbox;
    // overscan 12 em tabela larga (10+ colunas) = ~350 células extras por
    // frame. 6 acima/abaixo cobre scroll normal sem explodir o custo —
    // principal causa das "travadas".
    isScrollingResetDelay: 150,
    overscan: 6,
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
