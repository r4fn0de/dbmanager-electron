export type TableEditorPerfMetric =
  | "filter_to_rows_painted"
  | "sort_to_rows_settled"
  | "edit_confirm_to_draft_updated"
  | "table_switch_to_first_usable_frame";

function isPerfTrackerEnabled(): boolean {
  if (typeof window === "undefined") return false;
  const globalFlag = (
    window as typeof window & { __TABLE_EDITOR_PERF__?: boolean }
  ).__TABLE_EDITOR_PERF__;
  if (typeof globalFlag === "boolean") return globalFlag;
  try {
    return window.localStorage.getItem("table-editor-perf") === "1";
  } catch {
    return false;
  }
}

type MarksMap = Map<TableEditorPerfMetric, number>;

function now(): number {
  if (typeof performance !== "undefined") {
    return performance.now();
  }
  return Date.now();
}

export function createTableEditorPerfTracker() {
  const enabled = isPerfTrackerEnabled();
  const marks: MarksMap = new Map();

  return {
    enabled,
    start(metric: TableEditorPerfMetric) {
      if (!enabled) return;
      marks.set(metric, now());
    },
    end(metric: TableEditorPerfMetric, metadata?: Record<string, unknown>) {
      if (!enabled) return;
      const startedAt = marks.get(metric);
      if (startedAt === undefined) return;
      marks.delete(metric);
      const durationMs = Math.round((now() - startedAt) * 100) / 100;
      console.info("[TableDataEditor:perf]", metric, `${durationMs}ms`, metadata ?? {});
    },
  };
}
