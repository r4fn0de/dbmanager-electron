import { describe, test, expect, vi, beforeEach } from "vitest";
import type { BranchMeta, LocalDbEngine } from "@/ipc/db/types";

// ── Mock external dependencies ─────────────────────────────────────────
// Only mock what LocalDbManager imports at the module level.
// We do NOT mock node:fs — instead we mock the internal persistence methods
// of LocalDbManager directly (loadMetaList, saveMetaList, etc.)

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "/mock-user-data"),
    getAppPath: vi.fn(() => "/mock-app-path"),
  },
}));

vi.mock("embedded-postgres", () => {
  const mockClient = {
    connect: vi.fn(),
    end: vi.fn(),
    query: vi.fn(),
  };
  return {
    default: vi.fn(() => ({
      initialise: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      getPgClient: vi.fn(() => mockClient),
    })),
  };
});

vi.mock("better-sqlite3", () => ({
  default: vi.fn(() => ({
    pragma: vi.fn(),
    close: vi.fn(),
  })),
}));

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, randomUUID: vi.fn(() => "00000000-0000-0000-0000-000000000001") };
});

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: vi.fn(() => true), mkdirSync: vi.fn(), rmSync: vi.fn() };
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readFile: vi.fn(), writeFile: vi.fn(), mkdir: vi.fn() };
});

vi.mock("node:net", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:net")>();
  return { ...actual, createConnection: vi.fn() };
});

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawnSync: vi.fn() };
});

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, platform: vi.fn(() => "darwin"), arch: vi.fn(() => "arm64") };
});

vi.mock("node:module", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:module")>();
  return { ...actual, createRequire: vi.fn(() => (id: string) => {
    if (id.includes("package.json")) return { version: "1.0.0" };
    return {};
  }) };
});

vi.mock("@/ipc/db/constants", () => ({
  LOCAL_DB_DEFAULT_PASSWORD: "postgres",
}));

vi.mock("@/ipc/db/sqlite-driver", () => ({
  buildSqliteConnectionString: vi.fn((path: string) => `sqlite://${path}`),
  closeDb: vi.fn(),
  closeAllSqliteDbs: vi.fn(),
}));

// ── Import after mocks ────────────────────────────────────────────────

import { LocalDbManager } from "@/ipc/db/local-db-manager";
import { randomUUID } from "node:crypto";

// ── Types ──────────────────────────────────────────────────────────────

/** Shape of the internal LocalDbMeta — only the fields we care about. */
interface TestMeta {
  id: string;
  name: string;
  database_name: string;
  username: string;
  password: string;
  port: number;
  postgres_version: string;
  auto_start: boolean;
  engine: LocalDbEngine;
  active_branch_id?: string;
  file_path?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Create a minimal main branch metadata entry. */
function mainBranch(localDbId: string, dbName = "testdb"): BranchMeta {
  return {
    id: localDbId,
    name: "main",
    dbName,
    parentId: localDbId,
    createdAt: "2025-01-01T00:00:00.000Z",
    isMain: true,
  };
}

/** Build a test LocalDbMeta entry. */
function testMeta(overrides: Partial<TestMeta> & { id: string }): TestMeta {
  return {
    name: "test-db",
    database_name: "testdb",
    username: "postgres",
    password: "postgres",
    port: 5432,
    postgres_version: "16.13.0",
    auto_start: false,
    engine: "postgresql",
    ...overrides,
  };
}

/** Simulate a running PG instance in the manager's internal map. */
function addRunningInstance(
  manager: LocalDbManager,
  id: string,
  metaOverrides: Record<string, unknown> = {},
) {
  const map = (manager as any).runningInstances as Map<string, any>;
  map.set(id, {
    pg: {
      getPgClient: vi.fn(() => ({
        connect: vi.fn(),
        end: vi.fn(),
        query: vi.fn(),
      })),
    },
    meta: {
      id,
      name: "test-db",
      database_name: "testdb",
      username: "postgres",
      password: "postgres",
      port: 5432,
      engine: "postgresql",
      ...metaOverrides,
    },
  });
}

/**
 * Wire up the internal persistence methods of a LocalDbManager
 * to use in-memory stores instead of the real filesystem.
 *
 * This is the key trick: we bypass the fragile FS mocking by
 * directly controlling what loadMetaList / loadBranchList return
 * and capturing what saveMetaList / saveBranchList receive.
 */
function wirePersistence(manager: LocalDbManager) {
  let metaStore: TestMeta[] = [];
  const branchStore = new Map<string, BranchMeta[]>();

  (manager as any).loadMetaList = vi.fn(async () => {
    // Return a deep copy so mutations don't affect the store
    return JSON.parse(JSON.stringify(metaStore));
  });

  (manager as any).saveMetaList = vi.fn(async (list: TestMeta[]) => {
    metaStore = JSON.parse(JSON.stringify(list));
  });

  (manager as any).loadBranchList = vi.fn(async (localDbId: string) => {
    return JSON.parse(JSON.stringify(branchStore.get(localDbId) ?? []));
  });

  (manager as any).saveBranchList = vi.fn(
    async (localDbId: string, list: BranchMeta[]) => {
      branchStore.set(localDbId, JSON.parse(JSON.stringify(list)));
    },
  );

  // Also expose helpers to seed data
  return {
    setMeta(list: TestMeta[]) {
      metaStore = JSON.parse(JSON.stringify(list));
    },
    setBranches(localDbId: string, branches: BranchMeta[]) {
      branchStore.set(localDbId, JSON.parse(JSON.stringify(branches)));
    },
    getMeta(): TestMeta[] {
      return metaStore;
    },
    getBranches(localDbId: string): BranchMeta[] {
      return branchStore.get(localDbId) ?? [];
    },
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe("LocalDbManager — Branch CRUD", () => {
  let manager: LocalDbManager;
  let store: ReturnType<typeof wirePersistence>;

  const DB_ID = "db-001";

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new LocalDbManager();
    // Clear internal caches
    (manager as any).metaCache = null;
    (manager as any).branchCache = new Map();
    store = wirePersistence(manager);
  });

  // ── ensureMainBranch ─────────────────────────────────────────────

  describe("ensureMainBranch", () => {
    test("creates a main branch when none exists", async () => {
      store.setMeta([testMeta({ id: DB_ID })]);
      // No branches seeded

      await (manager as any).ensureMainBranch(DB_ID);

      const branches = store.getBranches(DB_ID);
      expect(branches).toHaveLength(1);
      expect(branches[0]).toMatchObject({
        id: DB_ID,
        name: "main",
        dbName: "testdb",
        isMain: true,
      });
    });

    test("does not duplicate an existing main branch", async () => {
      store.setMeta([testMeta({ id: DB_ID, active_branch_id: DB_ID })]);
      store.setBranches(DB_ID, [mainBranch(DB_ID)]);

      await (manager as any).ensureMainBranch(DB_ID);

      const branches = store.getBranches(DB_ID);
      expect(branches).toHaveLength(1);
      expect(branches[0].name).toBe("main");
    });

    test("sets active_branch_id to main when no active branch is set", async () => {
      store.setMeta([testMeta({ id: DB_ID })]);

      await (manager as any).ensureMainBranch(DB_ID);

      const meta = store.getMeta();
      expect(meta[0].active_branch_id).toBe(DB_ID);
    });

    test("throws if local DB not found", async () => {
      store.setMeta([]);

      await expect(
        (manager as any).ensureMainBranch("nonexistent"),
      ).rejects.toThrow("Local database nonexistent not found");
    });
  });

  // ── listBranches ─────────────────────────────────────────────────

  describe("listBranches", () => {
    test("throws if local DB not found", async () => {
      store.setMeta([]);

      await expect(manager.listBranches("nonexistent")).rejects.toThrow(
        "Local database nonexistent not found",
      );
    });

    test("returns branches with correct isActive flags", async () => {
      const featureBranch: BranchMeta = {
        id: "branch-001",
        name: "feature-x",
        dbName: "br_feature_x_0001",
        parentId: DB_ID,
        createdAt: "2025-01-02T00:00:00.000Z",
        isMain: false,
      };
      store.setMeta([testMeta({ id: DB_ID, active_branch_id: DB_ID })]);
      store.setBranches(DB_ID, [mainBranch(DB_ID), featureBranch]);

      const branches = await manager.listBranches(DB_ID);

      expect(branches).toHaveLength(2);
      const main = branches.find((b) => b.isMain)!;
      const feature = branches.find((b) => b.name === "feature-x")!;
      expect(main.isActive).toBe(true);
      expect(feature.isActive).toBe(false);
    });

    test("defaults active to main branch when active_branch_id is not set", async () => {
      store.setMeta([testMeta({ id: DB_ID })]);
      store.setBranches(DB_ID, [mainBranch(DB_ID)]);

      const branches = await manager.listBranches(DB_ID);
      expect(branches[0].isActive).toBe(true);
    });

    test("returns empty array when no branches exist", async () => {
      store.setMeta([testMeta({ id: DB_ID })]);
      // No branches seeded

      const branches = await manager.listBranches(DB_ID);
      // Without ensureMainBranch, the branch list is empty
      expect(branches).toHaveLength(0);
    });
  });

  // ── getBranchInfo ────────────────────────────────────────────────

  describe("getBranchInfo", () => {
    test("throws if local DB not found", async () => {
      store.setMeta([]);
      await expect(
        manager.getBranchInfo("nonexistent", "branch-001"),
      ).rejects.toThrow("Local database nonexistent not found");
    });

    test("throws if branch not found", async () => {
      store.setMeta([testMeta({ id: DB_ID })]);
      store.setBranches(DB_ID, [mainBranch(DB_ID)]);

      await expect(
        manager.getBranchInfo(DB_ID, "nonexistent-branch"),
      ).rejects.toThrow("Branch nonexistent-branch not found");
    });

    test("returns correct branch info with isActive", async () => {
      const featureBranch: BranchMeta = {
        id: "branch-001",
        name: "feature-x",
        dbName: "br_feature_x_0001",
        parentId: DB_ID,
        createdAt: "2025-01-02T00:00:00.000Z",
        isMain: false,
      };
      store.setMeta([testMeta({ id: DB_ID, active_branch_id: DB_ID })]);
      store.setBranches(DB_ID, [mainBranch(DB_ID), featureBranch]);

      const info = await manager.getBranchInfo(DB_ID, "branch-001");
      expect(info).toMatchObject({
        id: "branch-001",
        name: "feature-x",
        isMain: false,
        isActive: false,
        databaseName: "br_feature_x_0001",
      });
    });

    test("returns isActive=true for the active branch", async () => {
      store.setMeta([testMeta({ id: DB_ID, active_branch_id: DB_ID })]);
      store.setBranches(DB_ID, [mainBranch(DB_ID)]);

      const info = await manager.getBranchInfo(DB_ID, DB_ID);
      expect(info.isActive).toBe(true);
    });
  });

  // ── createBranch ─────────────────────────────────────────────────

  describe("createBranch", () => {
    test("throws if local DB not found", async () => {
      store.setMeta([]);

      await expect(
        manager.createBranch({ localDbId: "nonexistent", name: "feature-x" }),
      ).rejects.toThrow("Local database nonexistent not found");
    });

    test("throws for SQLite local DBs", async () => {
      store.setMeta([testMeta({ id: DB_ID, engine: "sqlite" })]);

      await expect(
        manager.createBranch({ localDbId: DB_ID, name: "feature-x" }),
      ).rejects.toThrow("Branching is only supported for PostgreSQL");
    });

    test("throws if parent branch not found", async () => {
      store.setMeta([testMeta({ id: DB_ID })]);
      store.setBranches(DB_ID, [mainBranch(DB_ID)]);
      addRunningInstance(manager, DB_ID);

      await expect(
        manager.createBranch({
          localDbId: DB_ID,
          name: "feature-x",
          parentBranchId: "nonexistent-branch",
        }),
      ).rejects.toThrow("Parent branch nonexistent-branch not found");
    });

    test("throws on name collision", async () => {
      store.setMeta([testMeta({ id: DB_ID })]);
      store.setBranches(DB_ID, [mainBranch(DB_ID)]);
      addRunningInstance(manager, DB_ID);

      await expect(
        manager.createBranch({ localDbId: DB_ID, name: "main" }),
      ).rejects.toThrow('Branch "main" already exists');
    });

    test("throws if local DB is not running", async () => {
      store.setMeta([testMeta({ id: DB_ID })]);
      store.setBranches(DB_ID, [mainBranch(DB_ID)]);
      // No running instance added

      await expect(
        manager.createBranch({ localDbId: DB_ID, name: "feature-x" }),
      ).rejects.toThrow("Local database must be running to create a branch");
    });

    test("creates a branch with correct metadata", async () => {
      store.setMeta([testMeta({ id: DB_ID, active_branch_id: DB_ID })]);
      store.setBranches(DB_ID, [mainBranch(DB_ID)]);
      addRunningInstance(manager, DB_ID);

      const result = await manager.createBranch({
        localDbId: DB_ID,
        name: "feature-x",
        description: "A test branch",
      });

      expect(result).toMatchObject({
        name: "feature-x",
        isMain: false,
        isActive: false,
        parentId: DB_ID, // parent defaults to active branch (main)
        description: "A test branch",
      });
      // ID is a UUID generated by randomUUID — just verify it's a valid UUID format
      expect(result.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      // The sanitized DB name should start with "br_"
      expect(result.databaseName).toMatch(/^br_/);

      // Verify the branch was persisted
      const branches = store.getBranches(DB_ID);
      expect(branches).toHaveLength(2);
    });

    test("defaults parent to active branch when not specified", async () => {
      const featureBranch: BranchMeta = {
        id: "branch-001",
        name: "feature-x",
        dbName: "br_feature_x_0001",
        parentId: DB_ID,
        createdAt: "2025-01-02T00:00:00.000Z",
        isMain: false,
      };
      store.setMeta([testMeta({ id: DB_ID, active_branch_id: "branch-001" })]);
      store.setBranches(DB_ID, [mainBranch(DB_ID), featureBranch]);
      addRunningInstance(manager, DB_ID);

      // Use a different UUID for the new branch
      vi.mocked(randomUUID).mockReturnValue(
        "00000000-0000-0000-0000-000000000002",
      );

      const result = await manager.createBranch({
        localDbId: DB_ID,
        name: "feature-y",
      });

      // Parent should be the active branch (feature-x / branch-001)
      expect(result.parentId).toBe("branch-001");
    });

    test("generates a sanitized database name from the branch name", async () => {
      store.setMeta([testMeta({ id: DB_ID, active_branch_id: DB_ID })]);
      store.setBranches(DB_ID, [mainBranch(DB_ID)]);
      addRunningInstance(manager, DB_ID);

      const result = await manager.createBranch({
        localDbId: DB_ID,
        name: "feature/add-uuid",
      });

      // "feature/add-uuid" → "br_feature_add_uuid_<uuid-prefix>"
      expect(result.databaseName).toMatch(/^br_feature_add_uuid_/);
    });
  });

  // ── deleteBranch ─────────────────────────────────────────────────

  describe("deleteBranch", () => {
    test("throws if local DB not found", async () => {
      store.setMeta([]);

      await expect(
        manager.deleteBranch("nonexistent", "branch-001"),
      ).rejects.toThrow("Local database nonexistent not found");
    });

    test("throws if branch not found", async () => {
      store.setMeta([testMeta({ id: DB_ID })]);
      store.setBranches(DB_ID, [mainBranch(DB_ID)]);

      await expect(
        manager.deleteBranch(DB_ID, "nonexistent-branch"),
      ).rejects.toThrow("Branch nonexistent-branch not found");
    });

    test("throws when trying to delete the main branch", async () => {
      store.setMeta([testMeta({ id: DB_ID })]);
      store.setBranches(DB_ID, [mainBranch(DB_ID)]);

      await expect(manager.deleteBranch(DB_ID, DB_ID)).rejects.toThrow(
        "Cannot delete the main branch",
      );
    });

    test("throws when trying to delete the active branch", async () => {
      const featureBranch: BranchMeta = {
        id: "branch-001",
        name: "feature-x",
        dbName: "br_feature_x_0001",
        parentId: DB_ID,
        createdAt: "2025-01-02T00:00:00.000Z",
        isMain: false,
      };
      store.setMeta([testMeta({ id: DB_ID, active_branch_id: "branch-001" })]);
      store.setBranches(DB_ID, [mainBranch(DB_ID), featureBranch]);

      await expect(manager.deleteBranch(DB_ID, "branch-001")).rejects.toThrow(
        "Cannot delete the active branch",
      );
    });

    test("deletes a non-main, non-active branch", async () => {
      const featureBranch: BranchMeta = {
        id: "branch-001",
        name: "feature-x",
        dbName: "br_feature_x_0001",
        parentId: DB_ID,
        createdAt: "2025-01-02T00:00:00.000Z",
        isMain: false,
      };
      store.setMeta([testMeta({ id: DB_ID, active_branch_id: DB_ID })]);
      store.setBranches(DB_ID, [mainBranch(DB_ID), featureBranch]);
      addRunningInstance(manager, DB_ID);

      await manager.deleteBranch(DB_ID, "branch-001");

      const branches = store.getBranches(DB_ID);
      expect(branches).toHaveLength(1);
      expect(branches[0].isMain).toBe(true);
    });

    test("cascades delete to child branches", async () => {
      const parentBranch: BranchMeta = {
        id: "branch-001",
        name: "feature-x",
        dbName: "br_feature_x_0001",
        parentId: DB_ID,
        createdAt: "2025-01-02T00:00:00.000Z",
        isMain: false,
      };
      const childBranch: BranchMeta = {
        id: "branch-002",
        name: "feature-x-nested",
        dbName: "br_feature_x_nested_0002",
        parentId: "branch-001",
        createdAt: "2025-01-03T00:00:00.000Z",
        isMain: false,
      };
      store.setMeta([testMeta({ id: DB_ID, active_branch_id: DB_ID })]);
      store.setBranches(DB_ID, [mainBranch(DB_ID), parentBranch, childBranch]);
      addRunningInstance(manager, DB_ID);

      await manager.deleteBranch(DB_ID, "branch-001");

      const branches = store.getBranches(DB_ID);
      expect(branches).toHaveLength(1);
      expect(branches[0].isMain).toBe(true);
    });

    test("throws when a child of the branch being deleted is active", async () => {
      const parentBranch: BranchMeta = {
        id: "branch-001",
        name: "feature-x",
        dbName: "br_feature_x_0001",
        parentId: DB_ID,
        createdAt: "2025-01-02T00:00:00.000Z",
        isMain: false,
      };
      const childBranch: BranchMeta = {
        id: "branch-002",
        name: "feature-x-nested",
        dbName: "br_feature_x_nested_0002",
        parentId: "branch-001",
        createdAt: "2025-01-03T00:00:00.000Z",
        isMain: false,
      };
      // The child branch is the active one
      store.setMeta([testMeta({ id: DB_ID, active_branch_id: "branch-002" })]);
      store.setBranches(DB_ID, [mainBranch(DB_ID), parentBranch, childBranch]);
      addRunningInstance(manager, DB_ID);

      await expect(manager.deleteBranch(DB_ID, "branch-001")).rejects.toThrow(
        "is active",
      );
    });
  });

  // ── switchBranch ─────────────────────────────────────────────────

  describe("switchBranch", () => {
    test("throws if local DB not found", async () => {
      store.setMeta([]);

      await expect(
        manager.switchBranch("nonexistent", "branch-001"),
      ).rejects.toThrow("Local database nonexistent not found");
    });

    test("throws if branch not found", async () => {
      store.setMeta([testMeta({ id: DB_ID })]);
      store.setBranches(DB_ID, [mainBranch(DB_ID)]);

      await expect(
        manager.switchBranch(DB_ID, "nonexistent-branch"),
      ).rejects.toThrow("Branch nonexistent-branch not found");
    });

    test("returns current branch info if already on that branch", async () => {
      store.setMeta([testMeta({ id: DB_ID, active_branch_id: DB_ID })]);
      store.setBranches(DB_ID, [mainBranch(DB_ID)]);

      const result = await manager.switchBranch(DB_ID, DB_ID);

      expect(result.isActive).toBe(true);
      expect(result.id).toBe(DB_ID);
    });

    test("switches the active branch and persists the change", async () => {
      const featureBranch: BranchMeta = {
        id: "branch-001",
        name: "feature-x",
        dbName: "br_feature_x_0001",
        parentId: DB_ID,
        createdAt: "2025-01-02T00:00:00.000Z",
        isMain: false,
      };
      store.setMeta([testMeta({ id: DB_ID, active_branch_id: DB_ID })]);
      store.setBranches(DB_ID, [mainBranch(DB_ID), featureBranch]);

      const result = await manager.switchBranch(DB_ID, "branch-001");

      expect(result).toMatchObject({
        id: "branch-001",
        name: "feature-x",
        isActive: true,
      });

      // Verify persistence: the meta should now have active_branch_id = "branch-001"
      const savedMeta = store.getMeta();
      expect(savedMeta[0].active_branch_id).toBe("branch-001");
    });

    test("switching away from main marks main as inactive", async () => {
      const featureBranch: BranchMeta = {
        id: "branch-001",
        name: "feature-x",
        dbName: "br_feature_x_0001",
        parentId: DB_ID,
        createdAt: "2025-01-02T00:00:00.000Z",
        isMain: false,
      };
      store.setMeta([testMeta({ id: DB_ID, active_branch_id: DB_ID })]);
      store.setBranches(DB_ID, [mainBranch(DB_ID), featureBranch]);

      await manager.switchBranch(DB_ID, "branch-001");

      // Verify via listBranches that isActive flags are correct
      const branches = await manager.listBranches(DB_ID);
      const main = branches.find((b) => b.isMain)!;
      const feature = branches.find((b) => b.name === "feature-x")!;
      expect(main.isActive).toBe(false);
      expect(feature.isActive).toBe(true);
    });
  });

  // ── renameBranch ─────────────────────────────────────────────────

  describe("renameBranch", () => {
    test("throws if local DB not found", async () => {
      store.setMeta([]);

      await expect(
        manager.renameBranch("nonexistent", "branch-001", "new-name"),
      ).rejects.toThrow("Local database nonexistent not found");
    });

    test("throws if branch not found", async () => {
      store.setMeta([testMeta({ id: DB_ID })]);
      store.setBranches(DB_ID, [mainBranch(DB_ID)]);

      await expect(
        manager.renameBranch(DB_ID, "nonexistent-branch", "new-name"),
      ).rejects.toThrow("Branch nonexistent-branch not found");
    });

    test("throws when trying to rename the main branch", async () => {
      store.setMeta([testMeta({ id: DB_ID })]);
      store.setBranches(DB_ID, [mainBranch(DB_ID)]);

      await expect(
        manager.renameBranch(DB_ID, DB_ID, "renamed-main"),
      ).rejects.toThrow("Cannot rename the main branch");
    });

    test("throws on name collision with another branch", async () => {
      const featureBranch: BranchMeta = {
        id: "branch-001",
        name: "feature-x",
        dbName: "br_feature_x_0001",
        parentId: DB_ID,
        createdAt: "2025-01-02T00:00:00.000Z",
        isMain: false,
      };
      const otherBranch: BranchMeta = {
        id: "branch-002",
        name: "feature-y",
        dbName: "br_feature_y_0002",
        parentId: DB_ID,
        createdAt: "2025-01-03T00:00:00.000Z",
        isMain: false,
      };
      store.setMeta([testMeta({ id: DB_ID, active_branch_id: DB_ID })]);
      store.setBranches(DB_ID, [mainBranch(DB_ID), featureBranch, otherBranch]);

      await expect(
        manager.renameBranch(DB_ID, "branch-001", "feature-y"),
      ).rejects.toThrow('Branch "feature-y" already exists');
    });

    test("renames a branch successfully", async () => {
      const featureBranch: BranchMeta = {
        id: "branch-001",
        name: "feature-x",
        dbName: "br_feature_x_0001",
        parentId: DB_ID,
        createdAt: "2025-01-02T00:00:00.000Z",
        isMain: false,
      };
      store.setMeta([testMeta({ id: DB_ID, active_branch_id: DB_ID })]);
      store.setBranches(DB_ID, [mainBranch(DB_ID), featureBranch]);

      const result = await manager.renameBranch(
        DB_ID,
        "branch-001",
        "renamed-feature",
      );

      expect(result).toMatchObject({
        id: "branch-001",
        name: "renamed-feature",
        isMain: false,
      });

      // Verify persistence
      const branches = store.getBranches(DB_ID);
      const renamed = branches.find((b) => b.id === "branch-001")!;
      expect(renamed.name).toBe("renamed-feature");
    });

    test("allows renaming to the same name (no-op)", async () => {
      const featureBranch: BranchMeta = {
        id: "branch-001",
        name: "feature-x",
        dbName: "br_feature_x_0001",
        parentId: DB_ID,
        createdAt: "2025-01-02T00:00:00.000Z",
        isMain: false,
      };
      store.setMeta([testMeta({ id: DB_ID, active_branch_id: DB_ID })]);
      store.setBranches(DB_ID, [mainBranch(DB_ID), featureBranch]);

      const result = await manager.renameBranch(
        DB_ID,
        "branch-001",
        "feature-x",
      );

      // Should succeed (same branch, not a collision)
      expect(result.name).toBe("feature-x");
    });
  });
});

// ── sanitizeBranchName (indirect) ──────────────────────────────────────

describe("LocalDbManager — sanitizeBranchName (via createBranch)", () => {
  let manager: LocalDbManager;
  let store: ReturnType<typeof wirePersistence>;

  const DB_ID = "db-002";

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new LocalDbManager();
    (manager as any).metaCache = null;
    (manager as any).branchCache = new Map();
    store = wirePersistence(manager);
  });

  test("replaces non-alphanumeric chars with underscores", async () => {
    store.setMeta([testMeta({ id: DB_ID, active_branch_id: DB_ID })]);
    store.setBranches(DB_ID, [mainBranch(DB_ID)]);
    addRunningInstance(manager, DB_ID);

    const result = await manager.createBranch({
      localDbId: DB_ID,
      name: "feature/add-uuid",
    });

    expect(result.databaseName).toMatch(/^br_feature_add_uuid_/);
  });

  test("collapses multiple underscores", async () => {
    store.setMeta([testMeta({ id: DB_ID, active_branch_id: DB_ID })]);
    store.setBranches(DB_ID, [mainBranch(DB_ID)]);
    addRunningInstance(manager, DB_ID);

    const result = await manager.createBranch({
      localDbId: DB_ID,
      name: "test///path",
    });

    expect(result.databaseName).toMatch(/^br_test_path_/);
  });

  test("truncates to 63 characters max", async () => {
    store.setMeta([testMeta({ id: DB_ID, active_branch_id: DB_ID })]);
    store.setBranches(DB_ID, [mainBranch(DB_ID)]);
    addRunningInstance(manager, DB_ID);

    const longName = "a".repeat(80);
    const result = await manager.createBranch({
      localDbId: DB_ID,
      name: longName,
    });

    expect(result.databaseName.length).toBeLessThanOrEqual(63);
  });

  test("strips leading/trailing underscores from the sanitized part", async () => {
    store.setMeta([testMeta({ id: DB_ID, active_branch_id: DB_ID })]);
    store.setBranches(DB_ID, [mainBranch(DB_ID)]);
    addRunningInstance(manager, DB_ID);

    const result = await manager.createBranch({
      localDbId: DB_ID,
      name: "/hello/world/",
    });

    // "/hello/world/" → "_hello_world_" → "hello_world" → "br_hello_world_<uuid>"
    expect(result.databaseName).toMatch(/^br_hello_world_/);
  });
});
