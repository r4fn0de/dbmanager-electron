import {
  defaultRangeExtractor,
  useVirtualizer,
  type Range,
} from "@tanstack/react-virtual";
import {
  useCallback,
  useLayoutEffect,
  useRef,
  type RefObject,
} from "react";

export const ROW_GUTTER_WIDTH = 48;

/**
 * Coordinate-space contract (why `paddingStart`):
 *
 * The scroll container renders a 48px sticky row-number gutter, so the first
 * data column sits 48px into the scroll space. TanStack Virtual maps
 * `scrollLeft` directly against item coordinates, so instead of subtracting
 * the gutter from every rendered `left` (which desyncs `scrollToIndex`), the
 * gutter is baked into item space via `paddingStart`: item N's `start` is its
 * exact CSS `left` inside the table body, and `scrollToIndex` + 
 * `scrollPaddingStart: 48` lands a column exactly to the right of the gutter.
 *
 * Sizes are exact (`resolveColumnWidth`), not estimates, so no
 * `measureElement` ResizeObserver is needed on cells.
 */
export function useColumnVirtualization(
  visibleColumns: string[],
  resolveColumnWidth: (columnName: string) => number,
  scrollRef: RefObject<HTMLDivElement | null>,
  pinnedColumnIndex: number | null = null
) {
  // Kept in a ref so the extractor identity stays stable across renders
  // (a new extractor identity would invalidate the virtualizer's range memo
  // on every render).
  const pinnedColumnIndexRef = useRef<number | null>(pinnedColumnIndex);
  pinnedColumnIndexRef.current = pinnedColumnIndex;

  // Sticky-item pattern: keep the edited/focused column in the rendered set
  // even when scrolled out of the horizontal viewport, so an inline editor is
  // not unmounted mid-edit (remount would drop caret/focus state).
  const rangeExtractor = useCallback((range: Range): number[] => {
    const base = defaultRangeExtractor(range);
    const pinned = pinnedColumnIndexRef.current;
    if (pinned === null || pinned < 0 || base.includes(pinned)) {
      return base;
    }
    const next = [...base, pinned];
    next.sort((a, b) => a - b);
    return next;
  }, []);

  const estimateSize = useCallback(
    (index: number) => resolveColumnWidth(visibleColumns[index] ?? ""),
    [resolveColumnWidth, visibleColumns]
  );

  const columnVirtualizer = useVirtualizer({
    count: visibleColumns.length,
    estimateSize,
    getScrollElement: () => scrollRef.current,
    horizontal: true,
    // See coordinate-space contract above.
    paddingStart: ROW_GUTTER_WIDTH,
    // Column cells are heavier than plain list items (CellExpandPopover,
    // checkbox, FK link); 4 on each side keeps fast horizontal scrolling
    // blank-free without tripling the rendered cell count.
    overscan: 4,
    rangeExtractor,
    scrollPaddingStart: ROW_GUTTER_WIDTH,
  });

  /**
   * virtual-core caches measurements keyed by `count / paddingStart /
   * getItemKey / enabled / lanes` — `estimateSize` is NOT a dependency. With
   * a constant column count, width changes (resize commit, hide/show, table
   * switch) would keep stale `start`/`size` values forever, desyncing cell
   * offsets from rendered widths — the bug that killed the previous column
   * virtualizer. Invalidate whenever the geometry actually changes.
   *
   * Runs in a layout effect so the invalidated measurements re-render before
   * paint (no stale frame), and `measure()` only fires when the signature or
   * column identity actually changed.
   */
  const geometrySignature = `${visibleColumns.length}:${visibleColumns
    .map((name) => resolveColumnWidth(name))
    .join(",")}`;
  useLayoutEffect(() => {
    columnVirtualizer.measure();
    // geometrySignature already encodes visibleColumns identity + every
    // width, so no separate visibleColumns dep (avoids extra measure() on
    // array identity churn with identical content).
  }, [columnVirtualizer, geometrySignature]);

  const virtualColumns = columnVirtualizer.getVirtualItems();
  const totalSpan = columnVirtualizer.getTotalSize();
  const totalColumnWidth = Math.max(0, totalSpan - ROW_GUTTER_WIDTH);

  return {
    columnVirtualizer,
    totalColumnWidth,
    virtualColumns,
  };
}
