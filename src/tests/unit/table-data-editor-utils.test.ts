import { describe, expect, it } from "vitest";
import {
  buildEffectiveRows,
  getGridCellIndex,
  rowKeyFromPk,
} from "@/features/database/components/TableDataEditor/utils/tableDataTransforms";

describe("TableDataEditor data transforms", () => {
  it("builds stable PK-based row keys", () => {
    const key = rowKeyFromPk(["id"], { id: 42, name: "Ada" }, "row:0");
    expect(key).toBe("pk:42");
  });

  it("filters out rows staged for delete", () => {
    const rows = [
      { id: 1, name: "A" },
      { id: 2, name: "B" },
      { id: 3, name: "C" },
    ];
    const deletes = { "pk:2": { staged: true } };
    const effective = buildEffectiveRows(rows, ["id"], deletes);
    expect(effective.map((row) => row.rowKey)).toEqual(["pk:1", "pk:3"]);
  });

  it("computes linear cell index without scanning full grid", () => {
    expect(getGridCellIndex(0, 0, 5)).toBe(0);
    expect(getGridCellIndex(2, 3, 5)).toBe(13);
  });

  it("handles a 10k-row scenario for baseline profiling inputs", () => {
    const rows = Array.from({ length: 10_000 }, (_, index) => ({
      id: index + 1,
      name: `row-${index + 1}`,
      active: index % 2 === 0,
      created_at: `2026-01-${(index % 28) + 1}`,
    }));
    const deletes = { "pk:10": true, "pk:100": true, "pk:1000": true };
    const effective = buildEffectiveRows(rows, ["id"], deletes);
    expect(effective.length).toBe(9_997);
    expect(effective[0]?.rowKey).toBe("pk:1");
  });
});
