import { describe, expect, it } from "vitest";
import {
  applyColumnMapping,
  buildColumnMapping,
  inferColumnsFromRows,
} from "@/features/database/utils/data-import";

describe("data import utils", () => {
  it("maps columns case-insensitively", () => {
    const result = buildColumnMapping(
      ["EMAIL", "Name", "extra"],
      [{ name: "email" }, { name: "name" }]
    );

    expect(result.mapping.EMAIL).toBe("email");
    expect(result.mapping.Name).toBe("name");
    expect(result.mapping.extra).toBeNull();
    expect(result.extraSourceColumns).toEqual(["extra"]);
  });

  it("applies mapping and drops ignored columns", () => {
    const mapped = applyColumnMapping(
      [{ EMAIL: "a@x.com", extra: "x", Name: "Alice" }],
      { EMAIL: "email", extra: null, Name: "name" }
    );

    expect(mapped).toEqual([{ email: "a@x.com", name: "Alice" }]);
  });

  it("infers primitive column types", () => {
    const inferred = inferColumnsFromRows([
      { active: true, created_at: "2026-01-01", id: 1, label: "hi" },
      { active: false, created_at: "2026-01-02", id: 2, label: "there" },
    ]);

    const typeByName = new Map(
      inferred.map((column) => [column.name, column.dataType])
    );
    expect(typeByName.get("id")).toBe("integer");
    expect(typeByName.get("active")).toBe("boolean");
    expect(typeByName.get("created_at")).toBe("timestamp");
    expect(typeByName.get("label")).toBe("text");
  });
});
