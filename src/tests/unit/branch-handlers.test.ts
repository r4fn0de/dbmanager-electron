import { beforeEach, describe, expect, test, vi } from "vitest";
import type { BranchInfo } from "@/ipc/db/types";

// ── Mocks ────────────────────────────────────────────────────────────
// The branch handlers are thin wrappers: they call localDbManager methods
// and catch errors to wrap them in ORPCError. We mock the local-db-manager
// module directly to provide a mock singleton, avoiding the need to mock
// all of its transitive dependencies (electron, node:fs, embedded-postgres, etc.).

// vi.hoisted ensures the mock object is available inside vi.mock factories,
// which are hoisted above all other code by Vitest.
const mockLocalDbManager = vi.hoisted(() => ({
  createBranch: vi.fn(),
  deleteBranch: vi.fn(),
  getBranchInfo: vi.fn(),
  listBranches: vi.fn(),
  mergeBranchSchema: vi.fn(),
  previewDeleteBranch: vi.fn(),
  renameBranch: vi.fn(),
  switchBranch: vi.fn(),
}));

vi.mock("@/ipc/db/local-db-manager", () => ({
  localDbManager: mockLocalDbManager,
}));

// Mock other modules that handlers.ts imports at module level
// (but that the branch handlers don't actually use).
vi.mock("@/ipc/db/connection-store", () => ({
  loadConnections: vi.fn(async () => []),
  saveConnections: vi.fn(async () => {}),
}));

vi.mock("@/ipc/ai/schema-cache", () => ({
  invalidateConnectionCache: vi.fn(),
  invalidateSchemaCache: vi.fn(),
  invalidateTableCache: vi.fn(),
  recordDdlOperation: vi.fn(),
}));

vi.mock("@/ipc/db/table-data-runtime", () => ({
  tableFkLookupRuntime: vi.fn(),
  tableSaveChangesRuntime: vi.fn(),
  tableTruncateRuntime: vi.fn(),
}));

vi.mock("@/ipc/db/registry", () => ({
  driverRegistry: {
    get: vi.fn(() => ({
      buildConnectionString: vi.fn(() => "postgresql://localhost:5432/test"),
      defaultDatabase: "postgres",
      defaultPort: 5432,
      defaultUsername: "postgres",
    })),
  },
  registerDrivers: vi.fn(),
}));

vi.mock("crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("crypto")>();
  return {
    ...actual,
    randomUUID: vi.fn(() => "00000000-0000-0000-0000-000000000001"),
  };
});

// ── Import after mocks ──────────────────────────────────────────────

import {
  createBranch,
  deleteBranch,
  getBranchInfo,
  listBranches,
  mergeBranchSchema,
  previewDeleteBranch,
  renameBranch,
  switchBranch,
} from "@/ipc/db/handlers";

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Extract the raw handler function from an oRPC procedure.
 *
 * NOTE: This accesses `procedure['~orpc'].handler`, which is an internal
 * API of @orpc/server. It could break on minor version bumps, but it's
 * the most straightforward way to unit-test oRPC handler logic without
 * setting up a full IPC MessagePort bridge.
 */
function getHandler(
  procedure: unknown
): (ctx: { input: unknown; context: unknown }) => Promise<unknown> {
  const orpc = (procedure as Record<string, unknown>)["~orpc"];
  if (
    !orpc ||
    typeof (orpc as Record<string, unknown>).handler !== "function"
  ) {
    throw new Error(
      "Could not extract handler from oRPC procedure. " +
        "The '~orpc' internal structure may have changed in @orpc/server."
    );
  }
  return (orpc as Record<string, unknown>).handler as (ctx: {
    input: unknown;
    context: unknown;
  }) => Promise<unknown>;
}

/** A minimal BranchInfo for test assertions. */
function mockBranchInfo(
  overrides: Partial<BranchInfo> & { id: string }
): BranchInfo {
  return {
    connectionString: "postgresql://postgres:postgres@localhost:5432/testdb",
    createdAt: "2025-01-01T00:00:00.000Z",
    databaseName: "testdb",
    isActive: true,
    isMain: true,
    name: "main",
    parentId: "db-001",
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("Branch oRPC handlers", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // ── listBranches ────────────────────────────────────────────────

  describe("listBranches", () => {
    const handler = getHandler(listBranches);

    test("returns branches from localDbManager.listBranches", async () => {
      const branches = [
        mockBranchInfo({
          id: "db-001",
          isActive: true,
          isMain: true,
          name: "main",
        }),
        mockBranchInfo({
          id: "branch-001",
          isActive: false,
          isMain: false,
          name: "feature-x",
        }),
      ];
      mockLocalDbManager.listBranches.mockResolvedValue(branches);

      const result = await handler({
        context: {},
        input: { localDbId: "db-001" },
      });

      expect(mockLocalDbManager.listBranches).toHaveBeenCalledWith("db-001");
      expect(result).toEqual(branches);
    });

    test("wraps errors in ORPCError with sanitized message", async () => {
      mockLocalDbManager.listBranches.mockRejectedValue(
        new Error("Local database missing not found")
      );

      await expect(
        handler({ context: {}, input: { localDbId: "missing" } })
      ).rejects.toThrow("Local database missing not found");

      try {
        await handler({ context: {}, input: { localDbId: "missing" } });
      } catch (err) {
        expect((err as any).code).toBe("BAD_REQUEST");
      }
    });

    test("sanitizes credentials in error messages", async () => {
      mockLocalDbManager.listBranches.mockRejectedValue(
        new Error(
          "Connection to postgresql://admin:s3cret@localhost:5432 failed"
        )
      );

      await expect(
        handler({ context: {}, input: { localDbId: "db-001" } })
      ).rejects.toThrow("[CONNECTION_STRING]");

      try {
        await handler({ context: {}, input: { localDbId: "db-001" } });
      } catch (err) {
        expect((err as any).message).not.toContain("s3cret");
      }
    });

    test("uses fallback message for non-Error throws", async () => {
      mockLocalDbManager.listBranches.mockRejectedValue("string error");

      await expect(
        handler({ context: {}, input: { localDbId: "db-001" } })
      ).rejects.toThrow("Failed to list branches");
    });
  });

  // ── createBranch ────────────────────────────────────────────────

  describe("createBranch", () => {
    const handler = getHandler(createBranch);

    test("delegates to localDbManager.createBranch with all fields", async () => {
      const branch = mockBranchInfo({
        databaseName: "br_feature_x_0001",
        id: "branch-001",
        isActive: false,
        isMain: false,
        name: "feature-x",
      });
      mockLocalDbManager.createBranch.mockResolvedValue(branch);

      const input = {
        dataTables: [{ schema: "public", table: "users" }],
        description: "A new feature",
        localDbId: "db-001",
        name: "feature-x",
        parentBranchId: "db-001",
      };

      const result = await handler({ context: {}, input });

      expect(mockLocalDbManager.createBranch).toHaveBeenCalledWith({
        dataTables: [{ schema: "public", table: "users" }],
        description: "A new feature",
        localDbId: "db-001",
        name: "feature-x",
        parentBranchId: "db-001",
      });
      expect(result).toEqual(branch);
    });

    test("passes undefined optional fields as-is", async () => {
      const branch = mockBranchInfo({
        id: "branch-001",
        isActive: false,
        isMain: false,
        name: "feature-y",
      });
      mockLocalDbManager.createBranch.mockResolvedValue(branch);

      const input = {
        localDbId: "db-001",
        name: "feature-y",
      };

      await handler({ context: {}, input });

      expect(mockLocalDbManager.createBranch).toHaveBeenCalledWith({
        dataTables: undefined,
        description: undefined,
        localDbId: "db-001",
        name: "feature-y",
        parentBranchId: undefined,
      });
    });

    test("passes empty dataTables array for schema-only branch", async () => {
      const branch = mockBranchInfo({
        id: "branch-002",
        isActive: false,
        isMain: false,
        name: "schema-only",
      });
      mockLocalDbManager.createBranch.mockResolvedValue(branch);

      const input = {
        dataTables: [],
        localDbId: "db-001",
        name: "schema-only",
      };

      await handler({ context: {}, input });

      expect(mockLocalDbManager.createBranch).toHaveBeenCalledWith({
        dataTables: [],
        description: undefined,
        localDbId: "db-001",
        name: "schema-only",
        parentBranchId: undefined,
      });
    });

    test("distinguishes empty array from undefined dataTables in handler input", async () => {
      const branch = mockBranchInfo({
        id: "branch-003",
        isActive: false,
        isMain: false,
        name: "test-branch",
      });
      mockLocalDbManager.createBranch.mockResolvedValue(branch);

      // Call with dataTables: [] — should pass [] through, not undefined
      await handler({
        context: {},
        input: { dataTables: [], localDbId: "db-001", name: "test-branch" },
      });

      const callArgs = mockLocalDbManager.createBranch.mock.calls[0][0];
      expect(callArgs.dataTables).toEqual([]);
      expect(callArgs.dataTables).not.toBeUndefined();
    });

    test("wraps errors in ORPCError with sanitized message", async () => {
      mockLocalDbManager.createBranch.mockRejectedValue(
        new Error('Branch "main" already exists')
      );

      await expect(
        handler({ context: {}, input: { localDbId: "db-001", name: "main" } })
      ).rejects.toThrow('Branch "main" already exists');

      try {
        await handler({
          context: {},
          input: { localDbId: "db-001", name: "main" },
        });
      } catch (err) {
        expect((err as any).code).toBe("BAD_REQUEST");
      }
    });

    test("sanitizes password= patterns in error messages", async () => {
      mockLocalDbManager.createBranch.mockRejectedValue(
        new Error("Failed with password=mysecretpassword in config")
      );

      await expect(
        handler({
          context: {},
          input: { localDbId: "db-001", name: "feature" },
        })
      ).rejects.toThrow("password=[REDACTED]");

      try {
        await handler({
          context: {},
          input: { localDbId: "db-001", name: "feature" },
        });
      } catch (err) {
        expect((err as any).message).not.toContain("mysecretpassword");
      }
    });

    test("uses fallback message for non-Error throws", async () => {
      mockLocalDbManager.createBranch.mockRejectedValue(null);

      await expect(
        handler({
          context: {},
          input: { localDbId: "db-001", name: "feature" },
        })
      ).rejects.toThrow("Failed to create branch");
    });
  });

  // ── deleteBranch ────────────────────────────────────────────────

  describe("deleteBranch", () => {
    const handler = getHandler(deleteBranch);

    test("delegates to localDbManager.deleteBranch", async () => {
      mockLocalDbManager.deleteBranch.mockResolvedValue(undefined);

      const result = await handler({
        context: {},
        input: { branchId: "branch-001", localDbId: "db-001" },
      });

      expect(mockLocalDbManager.deleteBranch).toHaveBeenCalledWith(
        "db-001",
        "branch-001"
      );
      expect(result).toBeUndefined();
    });

    test("wraps errors in ORPCError", async () => {
      mockLocalDbManager.deleteBranch.mockRejectedValue(
        new Error("Cannot delete the main branch")
      );

      await expect(
        handler({
          context: {},
          input: { branchId: "db-001", localDbId: "db-001" },
        })
      ).rejects.toThrow("Cannot delete the main branch");

      try {
        await handler({
          context: {},
          input: { branchId: "db-001", localDbId: "db-001" },
        });
      } catch (err) {
        expect((err as any).code).toBe("BAD_REQUEST");
      }
    });

    test("sanitizes :password@ patterns in error messages", async () => {
      mockLocalDbManager.deleteBranch.mockRejectedValue(
        new Error("Failed with :secretpass@host connection")
      );

      await expect(
        handler({
          context: {},
          input: { branchId: "branch-001", localDbId: "db-001" },
        })
      ).rejects.toThrow(":[REDACTED]@");

      try {
        await handler({
          context: {},
          input: { branchId: "branch-001", localDbId: "db-001" },
        });
      } catch (err) {
        expect((err as any).message).not.toContain("secretpass");
      }
    });

    test("uses fallback message for non-Error throws", async () => {
      mockLocalDbManager.deleteBranch.mockRejectedValue(42);

      await expect(
        handler({
          context: {},
          input: { branchId: "branch-001", localDbId: "db-001" },
        })
      ).rejects.toThrow("Failed to delete branch");
    });
  });

  // ── switchBranch ────────────────────────────────────────────────

  describe("switchBranch", () => {
    const handler = getHandler(switchBranch);

    test("delegates to localDbManager.switchBranch", async () => {
      const branch = mockBranchInfo({
        id: "branch-001",
        isActive: true,
        isMain: false,
        name: "feature-x",
      });
      mockLocalDbManager.switchBranch.mockResolvedValue(branch);

      const result = await handler({
        context: {},
        input: { branchId: "branch-001", localDbId: "db-001" },
      });

      expect(mockLocalDbManager.switchBranch).toHaveBeenCalledWith(
        "db-001",
        "branch-001"
      );
      expect(result).toEqual(branch);
    });

    test("wraps errors in ORPCError", async () => {
      mockLocalDbManager.switchBranch.mockRejectedValue(
        new Error("Branch nonexistent not found")
      );

      await expect(
        handler({
          context: {},
          input: { branchId: "nonexistent", localDbId: "db-001" },
        })
      ).rejects.toThrow("Branch nonexistent not found");

      try {
        await handler({
          context: {},
          input: { branchId: "nonexistent", localDbId: "db-001" },
        });
      } catch (err) {
        expect((err as any).code).toBe("BAD_REQUEST");
      }
    });

    test("uses fallback message for non-Error throws", async () => {
      mockLocalDbManager.switchBranch.mockRejectedValue(undefined);

      await expect(
        handler({
          context: {},
          input: { branchId: "branch-001", localDbId: "db-001" },
        })
      ).rejects.toThrow("Failed to switch branch");
    });
  });

  // ── getBranchInfo ───────────────────────────────────────────────

  describe("getBranchInfo", () => {
    const handler = getHandler(getBranchInfo);

    test("delegates to localDbManager.getBranchInfo", async () => {
      const branch = mockBranchInfo({
        databaseName: "br_feature_x_0001",
        id: "branch-001",
        isActive: false,
        isMain: false,
        name: "feature-x",
      });
      mockLocalDbManager.getBranchInfo.mockResolvedValue(branch);

      const result = await handler({
        context: {},
        input: { branchId: "branch-001", localDbId: "db-001" },
      });

      expect(mockLocalDbManager.getBranchInfo).toHaveBeenCalledWith(
        "db-001",
        "branch-001"
      );
      expect(result).toEqual(branch);
    });

    test("wraps errors in ORPCError", async () => {
      mockLocalDbManager.getBranchInfo.mockRejectedValue(
        new Error("Branch missing not found")
      );

      await expect(
        handler({
          context: {},
          input: { branchId: "missing", localDbId: "db-001" },
        })
      ).rejects.toThrow("Branch missing not found");

      try {
        await handler({
          context: {},
          input: { branchId: "missing", localDbId: "db-001" },
        });
      } catch (err) {
        expect((err as any).code).toBe("BAD_REQUEST");
      }
    });

    test("uses fallback message for empty Error messages", async () => {
      mockLocalDbManager.getBranchInfo.mockRejectedValue(new Error());

      await expect(
        handler({
          context: {},
          input: { branchId: "branch-001", localDbId: "db-001" },
        })
      ).rejects.toThrow("Failed to get branch info");
    });
  });

  // ── renameBranch ────────────────────────────────────────────────

  describe("renameBranch", () => {
    const handler = getHandler(renameBranch);

    test("delegates to localDbManager.renameBranch", async () => {
      const branch = mockBranchInfo({
        id: "branch-001",
        isActive: false,
        isMain: false,
        name: "renamed-feature",
      });
      mockLocalDbManager.renameBranch.mockResolvedValue(branch);

      const result = await handler({
        context: {},
        input: {
          branchId: "branch-001",
          localDbId: "db-001",
          newName: "renamed-feature",
        },
      });

      expect(mockLocalDbManager.renameBranch).toHaveBeenCalledWith(
        "db-001",
        "branch-001",
        "renamed-feature"
      );
      expect(result).toEqual(branch);
    });

    test("wraps errors in ORPCError", async () => {
      mockLocalDbManager.renameBranch.mockRejectedValue(
        new Error("Cannot rename the main branch")
      );

      await expect(
        handler({
          context: {},
          input: {
            branchId: "db-001",
            localDbId: "db-001",
            newName: "renamed",
          },
        })
      ).rejects.toThrow("Cannot rename the main branch");

      try {
        await handler({
          context: {},
          input: {
            branchId: "db-001",
            localDbId: "db-001",
            newName: "renamed",
          },
        });
      } catch (err) {
        expect((err as any).code).toBe("BAD_REQUEST");
      }
    });

    test("wraps name collision errors in ORPCError", async () => {
      mockLocalDbManager.renameBranch.mockRejectedValue(
        new Error('Branch "feature-y" already exists')
      );

      await expect(
        handler({
          context: {},
          input: {
            branchId: "branch-001",
            localDbId: "db-001",
            newName: "feature-y",
          },
        })
      ).rejects.toThrow('Branch "feature-y" already exists');

      try {
        await handler({
          context: {},
          input: {
            branchId: "branch-001",
            localDbId: "db-001",
            newName: "feature-y",
          },
        });
      } catch (err) {
        expect((err as any).code).toBe("BAD_REQUEST");
      }
    });

    test("uses fallback message for non-Error throws", async () => {
      mockLocalDbManager.renameBranch.mockRejectedValue({});

      await expect(
        handler({
          context: {},
          input: {
            branchId: "branch-001",
            localDbId: "db-001",
            newName: "new",
          },
        })
      ).rejects.toThrow("Failed to rename branch");
    });
  });

  describe("previewDeleteBranch", () => {
    const handler = getHandler(previewDeleteBranch);

    test("delegates to localDbManager.previewDeleteBranch", async () => {
      const preview = {
        branchesToDelete: [
          mockBranchInfo({
            id: "branch-001",
            isActive: false,
            isMain: false,
            name: "feature-x",
          }),
        ],
        count: 1,
      };
      mockLocalDbManager.previewDeleteBranch.mockResolvedValue(preview);
      const result = await handler({
        context: {},
        input: { branchId: "branch-001", localDbId: "db-001" },
      });
      expect(mockLocalDbManager.previewDeleteBranch).toHaveBeenCalledWith(
        "db-001",
        "branch-001"
      );
      expect(result).toEqual(preview);
    });
  });

  describe("mergeBranchSchema", () => {
    const handler = getHandler(mergeBranchSchema);

    test("delegates to localDbManager.mergeBranchSchema", async () => {
      const mergeResult = {
        applied: 1,
        errors: [],
        statements: ["CREATE TABLE x(id int);"],
      };
      mockLocalDbManager.mergeBranchSchema.mockResolvedValue(mergeResult);
      const result = await handler({
        context: {},
        input: {
          dryRun: false,
          localDbId: "db-001",
          sourceBranchId: "branch-a",
          targetBranchId: "branch-b",
        },
      });
      expect(mockLocalDbManager.mergeBranchSchema).toHaveBeenCalledWith({
        dryRun: false,
        localDbId: "db-001",
        sourceBranchId: "branch-a",
        targetBranchId: "branch-b",
      });
      expect(result).toEqual(mergeResult);
    });
  });

  // ── Cross-cutting: credential sanitization ──────────────────────

  describe("credential sanitization across all handlers", () => {
    const connectionStrError = new Error(
      "Failed with postgresql://admin:s3cret@db.example.com:5432/mydb"
    );

    test("listBranches sanitizes connection strings", async () => {
      mockLocalDbManager.listBranches.mockRejectedValue(connectionStrError);
      try {
        await getHandler(listBranches)({
          context: {},
          input: { localDbId: "db-001" },
        });
      } catch (err) {
        expect((err as any).message).toContain("[CONNECTION_STRING]");
        expect((err as any).message).not.toContain("s3cret");
      }
    });

    test("createBranch sanitizes connection strings", async () => {
      mockLocalDbManager.createBranch.mockRejectedValue(connectionStrError);
      try {
        await getHandler(createBranch)({
          context: {},
          input: { localDbId: "db-001", name: "x" },
        });
      } catch (err) {
        expect((err as any).message).toContain("[CONNECTION_STRING]");
        expect((err as any).message).not.toContain("s3cret");
      }
    });

    test("deleteBranch sanitizes connection strings", async () => {
      mockLocalDbManager.deleteBranch.mockRejectedValue(connectionStrError);
      try {
        await getHandler(deleteBranch)({
          context: {},
          input: { branchId: "b1", localDbId: "db-001" },
        });
      } catch (err) {
        expect((err as any).message).toContain("[CONNECTION_STRING]");
        expect((err as any).message).not.toContain("s3cret");
      }
    });

    test("switchBranch sanitizes connection strings", async () => {
      mockLocalDbManager.switchBranch.mockRejectedValue(connectionStrError);
      try {
        await getHandler(switchBranch)({
          context: {},
          input: { branchId: "b1", localDbId: "db-001" },
        });
      } catch (err) {
        expect((err as any).message).toContain("[CONNECTION_STRING]");
        expect((err as any).message).not.toContain("s3cret");
      }
    });

    test("getBranchInfo sanitizes connection strings", async () => {
      mockLocalDbManager.getBranchInfo.mockRejectedValue(connectionStrError);
      try {
        await getHandler(getBranchInfo)({
          context: {},
          input: { branchId: "b1", localDbId: "db-001" },
        });
      } catch (err) {
        expect((err as any).message).toContain("[CONNECTION_STRING]");
        expect((err as any).message).not.toContain("s3cret");
      }
    });

    test("renameBranch sanitizes connection strings", async () => {
      mockLocalDbManager.renameBranch.mockRejectedValue(connectionStrError);
      try {
        await getHandler(renameBranch)({
          context: {},
          input: { branchId: "b1", localDbId: "db-001", newName: "new" },
        });
      } catch (err) {
        expect((err as any).message).toContain("[CONNECTION_STRING]");
        expect((err as any).message).not.toContain("s3cret");
      }
    });
  });
});

// ── Coverage gap note ────────────────────────────────────────────────
// These tests extract the raw handler from the oRPC procedure via the
// `~orpc` internal property, which bypasses Zod input validation.
// Schema validation (e.g. name.min(1).max(63), required fields) should
// be tested separately or covered by integration tests that call through
// the full oRPC pipeline.
