import { describe, test, expect } from "vitest";
import {
  createBranchSchema,
  deleteBranchSchema,
  switchBranchSchema,
  listBranchesSchema,
  renameBranchSchema,
  getBranchInfoSchema,
} from "@/ipc/db/schemas";

// ── Helpers ──────────────────────────────────────────────────────────

/** Expect parsing to succeed and return the parsed value. */
function expectValid<T>(schema: { parse: (v: unknown) => T }, input: unknown): T {
  const result = schema.parse(input);
  expect(result).toBeDefined();
  return result;
}

/** Expect parsing to fail (Zod throws on invalid input). */
function expectInvalid(schema: { parse: (v: unknown) => unknown }, input: unknown): void {
  expect(() => schema.parse(input)).toThrow();
}

/** Expect parsing to fail and the error message to contain a substring. */
function expectInvalidWithMessage(
  schema: { parse: (v: unknown) => unknown },
  input: unknown,
  messageFragment: string,
): void {
  try {
    schema.parse(input);
    expect.unreachable("Expected schema parsing to fail but it succeeded");
  } catch (err: any) {
    expect(err.message ?? String(err)).toContain(messageFragment);
  }
}

// ── Tests ────────────────────────────────────────────────────────────

describe("listBranchesSchema", () => {
  test("accepts valid input", () => {
    const result = expectValid(listBranchesSchema, { localDbId: "db-001" });
    expect(result.localDbId).toBe("db-001");
  });

  test("rejects missing localDbId", () => {
    expectInvalid(listBranchesSchema, {});
  });

  test("rejects non-string localDbId", () => {
    expectInvalid(listBranchesSchema, { localDbId: 123 });
  });

  test("strips unknown keys", () => {
    const result = listBranchesSchema.parse({ localDbId: "db-001", extra: true });
    expect((result as any).extra).toBeUndefined();
  });
});

describe("createBranchSchema", () => {
  test("accepts minimal valid input (only required fields)", () => {
    const result = expectValid(createBranchSchema, {
      localDbId: "db-001",
      name: "feature-x",
    });
    expect(result.localDbId).toBe("db-001");
    expect(result.name).toBe("feature-x");
  });

  test("accepts full valid input with all optional fields", () => {
    const input = {
      localDbId: "db-001",
      parentBranchId: "branch-parent",
      name: "feature-x",
      description: "A new feature branch",
      dataTables: [
        { schema: "public", table: "users" },
        { schema: "public", table: "orders" },
      ],
    };
    const result = expectValid(createBranchSchema, input);
    expect(result).toMatchObject(input);
  });

  test("rejects missing localDbId", () => {
    expectInvalid(createBranchSchema, { name: "feature-x" });
  });

  test("rejects missing name", () => {
    expectInvalid(createBranchSchema, { localDbId: "db-001" });
  });

  test("rejects empty name", () => {
    expectInvalidWithMessage(createBranchSchema, { localDbId: "db-001", name: "" }, "min");
  });

  test("rejects name exceeding 63 characters", () => {
    expectInvalidWithMessage(
      createBranchSchema,
      { localDbId: "db-001", name: "a".repeat(64) },
      "max",
    );
  });

  test("accepts name at exactly 63 characters", () => {
    expectValid(createBranchSchema, { localDbId: "db-001", name: "a".repeat(63) });
  });

  test("accepts name at exactly 1 character", () => {
    expectValid(createBranchSchema, { localDbId: "db-001", name: "x" });
  });

  test("rejects non-string name", () => {
    expectInvalid(createBranchSchema, { localDbId: "db-001", name: 42 });
  });

  test("rejects non-string localDbId", () => {
    expectInvalid(createBranchSchema, { localDbId: true, name: "feature-x" });
  });

  test("rejects non-string parentBranchId", () => {
    expectInvalid(createBranchSchema, { localDbId: "db-001", name: "x", parentBranchId: 42 });
  });

  test("rejects non-string description", () => {
    expectInvalid(createBranchSchema, { localDbId: "db-001", name: "x", description: 123 });
  });

  test("rejects invalid dataTables entries", () => {
    expectInvalid(createBranchSchema, {
      localDbId: "db-001",
      name: "x",
      dataTables: [{ schema: "public" }], // missing table
    });
  });

  test("rejects non-object dataTables entries", () => {
    expectInvalid(createBranchSchema, {
      localDbId: "db-001",
      name: "x",
      dataTables: ["not-an-object"],
    });
  });

  test("accepts empty dataTables array (schema-only branch)", () => {
    const result = expectValid(createBranchSchema, {
      localDbId: "db-001",
      name: "schema-only-branch",
      dataTables: [],
    });
    expect(result.dataTables).toEqual([]);
  });

  test("distinguishes empty array from undefined dataTables", () => {
    const withUndefined = createBranchSchema.parse({
      localDbId: "db-001",
      name: "full-copy-branch",
    });
    const withEmpty = createBranchSchema.parse({
      localDbId: "db-001",
      name: "schema-only-branch",
      dataTables: [],
    });
    // undefined = copy all data (backend default), [] = schema-only (truncate all)
    expect(withUndefined.dataTables).toBeUndefined();
    expect(withEmpty.dataTables).toEqual([]);
  });

  test("rejects non-array dataTables", () => {
    expectInvalid(createBranchSchema, {
      localDbId: "db-001",
      name: "x",
      dataTables: "not-an-array",
    });
  });

  test("strips unknown keys", () => {
    const result = createBranchSchema.parse({
      localDbId: "db-001",
      name: "feature-x",
      extra: true,
    } as any);
    expect((result as any).extra).toBeUndefined();
  });
});

describe("deleteBranchSchema", () => {
  test("accepts valid input", () => {
    const result = expectValid(deleteBranchSchema, {
      localDbId: "db-001",
      branchId: "branch-001",
    });
    expect(result.localDbId).toBe("db-001");
    expect(result.branchId).toBe("branch-001");
  });

  test("rejects missing localDbId", () => {
    expectInvalid(deleteBranchSchema, { branchId: "branch-001" });
  });

  test("rejects missing branchId", () => {
    expectInvalid(deleteBranchSchema, { localDbId: "db-001" });
  });

  test("rejects non-string localDbId", () => {
    expectInvalid(deleteBranchSchema, { localDbId: 123, branchId: "branch-001" });
  });

  test("rejects non-string branchId", () => {
    expectInvalid(deleteBranchSchema, { localDbId: "db-001", branchId: null });
  });

  test("strips unknown keys", () => {
    const result = deleteBranchSchema.parse({ localDbId: "db-001", branchId: "b1", extra: 1 } as any);
    expect((result as any).extra).toBeUndefined();
  });
});

describe("switchBranchSchema", () => {
  test("accepts valid input", () => {
    const result = expectValid(switchBranchSchema, {
      localDbId: "db-001",
      branchId: "branch-001",
    });
    expect(result.localDbId).toBe("db-001");
    expect(result.branchId).toBe("branch-001");
  });

  test("rejects missing localDbId", () => {
    expectInvalid(switchBranchSchema, { branchId: "branch-001" });
  });

  test("rejects missing branchId", () => {
    expectInvalid(switchBranchSchema, { localDbId: "db-001" });
  });

  test("rejects non-string localDbId", () => {
    expectInvalid(switchBranchSchema, { localDbId: [], branchId: "b1" });
  });

  test("rejects non-string branchId", () => {
    expectInvalid(switchBranchSchema, { localDbId: "db-001", branchId: {} });
  });
});

describe("getBranchInfoSchema", () => {
  test("accepts valid input", () => {
    const result = expectValid(getBranchInfoSchema, {
      localDbId: "db-001",
      branchId: "branch-001",
    });
    expect(result.localDbId).toBe("db-001");
    expect(result.branchId).toBe("branch-001");
  });

  test("rejects missing localDbId", () => {
    expectInvalid(getBranchInfoSchema, { branchId: "branch-001" });
  });

  test("rejects missing branchId", () => {
    expectInvalid(getBranchInfoSchema, { localDbId: "db-001" });
  });

  test("rejects non-string localDbId", () => {
    expectInvalid(getBranchInfoSchema, { localDbId: false, branchId: "b1" });
  });

  test("strips unknown keys", () => {
    const result = getBranchInfoSchema.parse({ localDbId: "db-001", branchId: "b1", extra: 1 } as any);
    expect((result as any).extra).toBeUndefined();
  });
});

describe("renameBranchSchema", () => {
  test("accepts valid input", () => {
    const result = expectValid(renameBranchSchema, {
      localDbId: "db-001",
      branchId: "branch-001",
      newName: "renamed-feature",
    });
    expect(result.localDbId).toBe("db-001");
    expect(result.branchId).toBe("branch-001");
    expect(result.newName).toBe("renamed-feature");
  });

  test("rejects missing localDbId", () => {
    expectInvalid(renameBranchSchema, { branchId: "b1", newName: "new" });
  });

  test("rejects missing branchId", () => {
    expectInvalid(renameBranchSchema, { localDbId: "db-001", newName: "new" });
  });

  test("rejects missing newName", () => {
    expectInvalid(renameBranchSchema, { localDbId: "db-001", branchId: "b1" });
  });

  test("rejects empty newName", () => {
    expectInvalidWithMessage(renameBranchSchema, {
      localDbId: "db-001",
      branchId: "b1",
      newName: "",
    }, "min");
  });

  test("rejects newName exceeding 63 characters", () => {
    expectInvalidWithMessage(renameBranchSchema, {
      localDbId: "db-001",
      branchId: "b1",
      newName: "n".repeat(64),
    }, "max");
  });

  test("accepts newName at exactly 63 characters", () => {
    expectValid(renameBranchSchema, {
      localDbId: "db-001",
      branchId: "b1",
      newName: "n".repeat(63),
    });
  });

  test("accepts newName at exactly 1 character", () => {
    expectValid(renameBranchSchema, {
      localDbId: "db-001",
      branchId: "b1",
      newName: "x",
    });
  });

  test("rejects non-string newName", () => {
    expectInvalid(renameBranchSchema, {
      localDbId: "db-001",
      branchId: "b1",
      newName: 42,
    });
  });

  test("strips unknown keys", () => {
    const result = renameBranchSchema.parse({
      localDbId: "db-001",
      branchId: "b1",
      newName: "new",
      extra: true,
    } as any);
    expect((result as any).extra).toBeUndefined();
  });
});
