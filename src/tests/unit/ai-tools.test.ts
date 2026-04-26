import { beforeEach, describe, expect, test, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockExecuteQuery = vi.fn();
const mockGetSchema = vi.fn();
const mockGetSchemaSummary = vi.fn();
const mockGetTableDetails = vi.fn();
const mockGetIndexes = vi.fn();
const mockGetConstraints = vi.fn();
const mockGetTableStats = vi.fn();
const mockGetTableSample = vi.fn();
const mockExplainQuery = vi.fn();

const mockDriver = {
  type: "postgresql" as const,
  defaultPort: 5432,
  defaultDatabase: "postgres",
  defaultUsername: "postgres",
  sslModes: ["disable", "prefer", "require"],
  buildConnectionString: vi.fn(() => "postgres://localhost/test"),
  executeQuery: mockExecuteQuery,
  getSchema: mockGetSchema,
  getSchemaSummary: mockGetSchemaSummary,
  getTableDetails: mockGetTableDetails,
  getIndexes: mockGetIndexes,
  getConstraints: mockGetConstraints,
  getTableStats: mockGetTableStats,
  getTableSample: mockGetTableSample,
  explainQuery: mockExplainQuery,
  // stubs for other driver methods
  testConnection: vi.fn(),
  getDatabaseInfo: vi.fn(),
  getEnums: vi.fn(),
  getFunctions: vi.fn(),
  getTriggers: vi.fn(),
  listRows: vi.fn(),
  createTable: vi.fn(),
  dropTable: vi.fn(),
  renameTable: vi.fn(),
  addColumn: vi.fn(),
  dropColumn: vi.fn(),
  renameColumn: vi.fn(),
  alterColumnType: vi.fn(),
  setColumnNullable: vi.fn(),
  setColumnDefault: vi.fn(),
  createIndex: vi.fn(),
  dropIndex: vi.fn(),
  createSchema: vi.fn(),
  exportSchemaDdl: vi.fn(),
  exportTableData: vi.fn(),
  executeBatchDdl: vi.fn(),
  waitForDatabase: vi.fn(),
  importTableRows: vi.fn(),
};

vi.mock("@/ipc/db/registry", () => ({
  driverRegistry: {
    get: vi.fn(() => mockDriver),
  },
}));

vi.mock("@/ipc/db/connection-store", () => ({
  loadConnections: vi.fn(() =>
    Promise.resolve([
      {
        id: "conn-1",
        name: "Test DB",
        db_type: "postgresql",
        host: "localhost",
        port: 5432,
        database: "testdb",
        username: "postgres",
        password: "secret",
        ssl_mode: "prefer",
      },
    ]),
  ),
}));

// Invalidate schema-cache module between tests to keep caches clean
vi.mock("@/ipc/ai/schema-cache", () => ({
  getCachedTableDetails: vi.fn(() => null),
  getCachedIndexes: vi.fn(() => null),
  getCachedConstraints: vi.fn(() => null),
  getCachedTableStats: vi.fn(() => null),
  getCachedTableSample: vi.fn(() => null),
  setCachedTableDetails: vi.fn(),
  setCachedIndexes: vi.fn(),
  setCachedConstraints: vi.fn(),
  setCachedTableStats: vi.fn(),
  setCachedTableSample: vi.fn(),
}));

import { createAiTools } from "@/ipc/ai/tools";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTools() {
  return createAiTools("conn-1");
}

// ---------------------------------------------------------------------------
// validateSqlSafety — classification without DB connection
// ---------------------------------------------------------------------------

describe("validateSqlSafety", () => {
  test("classifies simple SELECT as safe", async () => {
    const { validateSqlSafety } = makeTools();
    const result = await validateSqlSafety.execute!({ sql: "SELECT * FROM users" });
    expect(result.classification).toBe("safe");
    expect(result.reasons[0]).toContain("read-only");
  });

  test("classifies WITH as safe", async () => {
    const { validateSqlSafety } = makeTools();
    const result = await validateSqlSafety.execute!({ sql: "WITH cte AS (SELECT 1) SELECT * FROM cte" });
    expect(result.classification).toBe("safe");
  });

  test("classifies EXPLAIN as safe", async () => {
    const { validateSqlSafety } = makeTools();
    const result = await validateSqlSafety.execute!({ sql: "EXPLAIN SELECT * FROM users" });
    expect(result.classification).toBe("safe");
  });

  test("classifies UPDATE as risky", async () => {
    const { validateSqlSafety } = makeTools();
    const result = await validateSqlSafety.execute!({ sql: "UPDATE users SET name = 'X'" });
    expect(result.classification).toBe("risky");
    expect(result.reasons[0]).toContain("UPDATE");
  });

  test("classifies DELETE as risky", async () => {
    const { validateSqlSafety } = makeTools();
    const result = await validateSqlSafety.execute!({ sql: "DELETE FROM users WHERE id = 1" });
    expect(result.classification).toBe("risky");
    expect(result.reasons[0]).toContain("DELETE");
  });

  test("classifies DROP as blocked", async () => {
    const { validateSqlSafety } = makeTools();
    const result = await validateSqlSafety.execute!({ sql: "DROP TABLE users" });
    expect(result.classification).toBe("blocked");
    expect(result.reasons[0]).toContain("DROP");
  });

  test("classifies TRUNCATE as blocked", async () => {
    const { validateSqlSafety } = makeTools();
    const result = await validateSqlSafety.execute!({ sql: "TRUNCATE users" });
    expect(result.classification).toBe("blocked");
  });

  test("classifies ALTER as blocked", async () => {
    const { validateSqlSafety } = makeTools();
    const result = await validateSqlSafety.execute!({ sql: "ALTER TABLE users ADD COLUMN age INT" });
    expect(result.classification).toBe("blocked");
  });

  test("classifies GRANT as blocked", async () => {
    const { validateSqlSafety } = makeTools();
    const result = await validateSqlSafety.execute!({ sql: "GRANT SELECT ON users TO app" });
    expect(result.classification).toBe("blocked");
  });

  test("classifies multi-statement with DROP as blocked", async () => {
    const { validateSqlSafety } = makeTools();
    const result = await validateSqlSafety.execute!({ sql: "SELECT 1; DROP TABLE users" });
    expect(result.classification).toBe("blocked");
  });

  test("classifies unknown query as blocked", async () => {
    const { validateSqlSafety } = makeTools();
    const result = await validateSqlSafety.execute!({ sql: "VACUUM ANALYZE users" });
    expect(result.classification).toBe("blocked");
  });
});

// ---------------------------------------------------------------------------
// listSchemas
// ---------------------------------------------------------------------------

describe("listSchemas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns schemas with table counts", async () => {
    const { listSchemas } = makeTools();
    mockGetSchemaSummary.mockResolvedValue({
      schemas: ["public", "auth"],
      tables: [
        { name: "users", schema: "public", has_rls: false, estimated_row_count: 100 },
        { name: "posts", schema: "public", has_rls: false, estimated_row_count: 50 },
        { name: "accounts", schema: "auth", has_rls: true, estimated_row_count: 20 },
      ],
    });

    const result = await listSchemas.execute!({});
    expect(result).toEqual([
      { name: "public", tableCount: 2 },
      { name: "auth", tableCount: 1 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// searchSchema
// ---------------------------------------------------------------------------

describe("searchSchema", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("finds tables and columns by keyword", async () => {
    const { searchSchema } = makeTools();
    mockGetSchema.mockResolvedValue({
      schemas: ["public"],
      tables: [
        {
          name: "users",
          schema: "public",
          columns: [
            { name: "id", data_type: "bigint", udt_name: null, is_nullable: false, column_default: null },
            { name: "email", data_type: "character varying", udt_name: null, is_nullable: false, column_default: null },
          ],
          indexes: [],
          foreign_keys: [],
          has_rls: false,
          rls_policies: [],
        },
        {
          name: "products",
          schema: "public",
          columns: [
            { name: "id", data_type: "bigint", udt_name: null, is_nullable: false, column_default: null },
            { name: "user_id", data_type: "bigint", udt_name: null, is_nullable: true, column_default: null },
          ],
          indexes: [],
          foreign_keys: [],
          has_rls: false,
          rls_policies: [],
        },
      ],
    });

    const result = await searchSchema.execute!({ query: "user" });
    expect(result.length).toBeGreaterThanOrEqual(2);
    const tableMatches = result.filter((r) => r.matchType === "table_name");
    const columnMatches = result.filter((r) => r.matchType === "column_name");
    expect(tableMatches.some((r) => r.table === "users")).toBe(true);
    expect(columnMatches.some((r) => r.column === "user_id")).toBe(true);
  });

  test("respects schemaName filter", async () => {
    const { searchSchema } = makeTools();
    mockGetSchema.mockResolvedValue({
      schemas: ["public", "private"],
      tables: [
        {
          name: "secrets",
          schema: "private",
          columns: [{ name: "id", data_type: "bigint", udt_name: null, is_nullable: false, column_default: null }],
          indexes: [],
          foreign_keys: [],
          has_rls: false,
          rls_policies: [],
        },
      ],
    });

    const result = await searchSchema.execute!({ query: "secret", schemaName: "public" });
    expect(result).toEqual([]);
  });

  test("respects limit", async () => {
    const { searchSchema } = makeTools();
    mockGetSchema.mockResolvedValue({
      schemas: ["public"],
      tables: Array.from({ length: 10 }, (_, i) => ({
        name: `table_${i}`,
        schema: "public",
        columns: [{ name: "match_col", data_type: "bigint", udt_name: null, is_nullable: false, column_default: null }],
        indexes: [],
        foreign_keys: [],
        has_rls: false,
        rls_policies: [],
      })),
    });

    const result = await searchSchema.execute!({ query: "match", limit: 3 });
    expect(result.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// getRelationsGraph
// ---------------------------------------------------------------------------

describe("getRelationsGraph", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns FK relations for schema", async () => {
    const { getRelationsGraph } = makeTools();
    mockGetSchema.mockResolvedValue({
      schemas: ["public"],
      tables: [
        {
          name: "orders",
          schema: "public",
          columns: [],
          indexes: [],
          foreign_keys: [
            { name: "fk_orders_user_id", column_name: "user_id", referenced_schema: "public", referenced_table: "users", referenced_column: "id" },
          ],
          has_rls: false,
          rls_policies: [],
        },
        {
          name: "users",
          schema: "public",
          columns: [],
          indexes: [],
          foreign_keys: [],
          has_rls: false,
          rls_policies: [],
        },
      ],
    });

    const result = await getRelationsGraph.execute!({ schemaName: "public" });
    expect(result).toEqual([
      {
        fromTable: "orders",
        fromSchema: "public",
        fromColumn: "user_id",
        toTable: "users",
        toSchema: "public",
        toColumn: "id",
        constraintName: "fk_orders_user_id",
      },
    ]);
  });

  test("filters by table list", async () => {
    const { getRelationsGraph } = makeTools();
    mockGetSchema.mockResolvedValue({
      schemas: ["public"],
      tables: [
        {
          name: "orders",
          schema: "public",
          columns: [],
          indexes: [],
          foreign_keys: [
            { name: "fk_orders_user_id", column_name: "user_id", referenced_schema: undefined, referenced_table: "users", referenced_column: "id" },
          ],
          has_rls: false,
          rls_policies: [],
        },
        {
          name: "products",
          schema: "public",
          columns: [],
          indexes: [],
          foreign_keys: [
            { name: "fk_products_category_id", column_name: "category_id", referenced_schema: undefined, referenced_table: "categories", referenced_column: "id" },
          ],
          has_rls: false,
          rls_policies: [],
        },
      ],
    });

    const result = await getRelationsGraph.execute!({ tables: ["orders"] });
    expect(result.length).toBe(1);
    expect(result[0].fromTable).toBe("orders");
  });
});

// ---------------------------------------------------------------------------
// runReadOnlySql
// ---------------------------------------------------------------------------

describe("runReadOnlySql", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("executes SELECT and returns results", async () => {
    const { runReadOnlySql } = makeTools();
    mockExecuteQuery.mockResolvedValue({
      columns: [{ name: "id" }, { name: "name" }],
      rows: [[1, "Alice"], [2, "Bob"]],
      row_count: 2,
    });

    const result = await runReadOnlySql.execute!({ sql: "SELECT id, name FROM users" });
    expect(result.error).toBeUndefined();
    expect(result.rowCount).toBe(2);
    expect(result.columns).toEqual(["id", "name"]);
  });

  test("rejects UPDATE queries", async () => {
    const { runReadOnlySql } = makeTools();
    const result = await runReadOnlySql.execute!({ sql: "UPDATE users SET name = 'X'" });
    expect(result.error).toContain("read-only");
  });

  test("rejects DELETE queries", async () => {
    const { runReadOnlySql } = makeTools();
    const result = await runReadOnlySql.execute!({ sql: "DELETE FROM users WHERE id = 1" });
    expect(result.error).toContain("read-only");
  });

  test("injects LIMIT when missing", async () => {
    const { runReadOnlySql } = makeTools();
    mockExecuteQuery.mockResolvedValue({
      columns: [{ name: "id" }],
      rows: [],
      row_count: 0,
    });

    await runReadOnlySql.execute!({ sql: "SELECT * FROM users", limit: 42 });
    const calledSql = mockExecuteQuery.mock.calls[0][1] as string;
    expect(calledSql).toContain("LIMIT 42");
  });

  test("does not double LIMIT if already present", async () => {
    const { runReadOnlySql } = makeTools();
    mockExecuteQuery.mockResolvedValue({
      columns: [{ name: "id" }],
      rows: [],
      row_count: 0,
    });

    await runReadOnlySql.execute!({ sql: "SELECT * FROM users LIMIT 10" });
    const calledSql = mockExecuteQuery.mock.calls[0][1] as string;
    expect(calledSql).not.toMatch(/LIMIT\s+\d+.*LIMIT/);
  });

  test("rejects INTO OUTFILE patterns", async () => {
    const { runReadOnlySql } = makeTools();
    const result = await runReadOnlySql.execute!({ sql: "SELECT * INTO OUTFILE '/tmp/x' FROM users" });
    expect(result.error).toContain("dangerous");
  });
});

// ---------------------------------------------------------------------------
// dryRunMutation
// ---------------------------------------------------------------------------

describe("dryRunMutation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("rejects SELECT queries", async () => {
    const { dryRunMutation } = makeTools();
    const result = await dryRunMutation.execute!({ sql: "SELECT * FROM users" });
    expect(result.error).toContain("UPDATE and DELETE");
  });

  test("estimates DELETE impact", async () => {
    const { dryRunMutation } = makeTools();
    mockExecuteQuery.mockResolvedValueOnce({
      columns: [{ name: "estimated_affected_rows" }],
      rows: [[5]],
      row_count: 1,
    });
    mockExecuteQuery.mockResolvedValueOnce({
      columns: [{ name: "id" }, { name: "name" }],
      rows: [[1, "Alice"]],
      row_count: 1,
    });

    const result = await dryRunMutation.execute!({
      sql: "DELETE FROM public.users WHERE id > 10",
      sampleSize: 1,
    });

    expect(result.error).toBeUndefined();
    expect(result.estimatedAffectedRows).toBe(5);
    expect(result.warnings).toEqual([]);
    expect(result.samplePreview.rows.length).toBe(1);
  });

  test("estimates UPDATE impact and warns about missing WHERE", async () => {
    const { dryRunMutation } = makeTools();
    mockExecuteQuery.mockResolvedValueOnce({
      columns: [{ name: "estimated_affected_rows" }],
      rows: [[100]],
      row_count: 1,
    });
    mockExecuteQuery.mockResolvedValueOnce({
      columns: [{ name: "id" }],
      rows: [[1]],
      row_count: 1,
    });

    const result = await dryRunMutation.execute!({
      sql: "UPDATE public.users SET name = 'X'",
      sampleSize: 1,
    });

    expect(result.error).toBeUndefined();
    expect(result.estimatedAffectedRows).toBe(100);
    expect(result.warnings.some((w: string) => w.includes("WHERE"))).toBe(true);
  });

  test("warns about large affected rows", async () => {
    const { dryRunMutation } = makeTools();
    mockExecuteQuery.mockResolvedValueOnce({
      columns: [{ name: "estimated_affected_rows" }],
      rows: [[50000]],
      row_count: 1,
    });
    mockExecuteQuery.mockResolvedValueOnce({
      columns: [{ name: "id" }],
      rows: [],
      row_count: 0,
    });

    const result = await dryRunMutation.execute!({
      sql: "DELETE FROM public.users WHERE id > 0",
      sampleSize: 1,
    });

    expect(result.warnings.some((w: string) => w.includes("Large number"))).toBe(true);
  });

  test("parses schema-qualified table in DELETE", async () => {
    const { dryRunMutation } = makeTools();
    mockExecuteQuery.mockResolvedValueOnce({
      columns: [{ name: "estimated_affected_rows" }],
      rows: [[3]],
      row_count: 1,
    });
    mockExecuteQuery.mockResolvedValueOnce({
      columns: [{ name: "id" }],
      rows: [],
      row_count: 0,
    });

    const result = await dryRunMutation.execute!({
      sql: 'DELETE FROM "my_schema"."my_table" WHERE active = false',
      sampleSize: 1,
    });

    expect(result.error).toBeUndefined();
    expect(result.estimatedAffectedRows).toBe(3);
  });
});
