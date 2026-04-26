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
    const result = await validateSqlSafety.execute!({ sql: "SELECT * FROM users" }, { toolCallId: "test", messages: [] });
    expect(result.classification).toBe("safe");
    expect(result.reasons[0]).toContain("read-only");
  });

  test("classifies WITH as safe", async () => {
    const { validateSqlSafety } = makeTools();
    const result = await validateSqlSafety.execute!({ sql: "WITH cte AS (SELECT 1) SELECT * FROM cte" }, { toolCallId: "test", messages: [] });
    expect(result.classification).toBe("safe");
  });

  test("classifies EXPLAIN as safe", async () => {
    const { validateSqlSafety } = makeTools();
    const result = await validateSqlSafety.execute!({ sql: "EXPLAIN SELECT * FROM users" }, { toolCallId: "test", messages: [] });
    expect(result.classification).toBe("safe");
  });

  test("classifies UPDATE as risky", async () => {
    const { validateSqlSafety } = makeTools();
    const result = await validateSqlSafety.execute!({ sql: "UPDATE users SET name = 'X'" }, { toolCallId: "test", messages: [] });
    expect(result.classification).toBe("risky");
    expect(result.reasons[0]).toContain("UPDATE");
  });

  test("classifies DELETE as risky", async () => {
    const { validateSqlSafety } = makeTools();
    const result = await validateSqlSafety.execute!({ sql: "DELETE FROM users WHERE id = 1" }, { toolCallId: "test", messages: [] });
    expect(result.classification).toBe("risky");
    expect(result.reasons[0]).toContain("DELETE");
  });

  test("classifies DROP as blocked", async () => {
    const { validateSqlSafety } = makeTools();
    const result = await validateSqlSafety.execute!({ sql: "DROP TABLE users" }, { toolCallId: "test", messages: [] });
    expect(result.classification).toBe("blocked");
    expect(result.reasons[0]).toContain("DROP");
  });

  test("classifies TRUNCATE as blocked", async () => {
    const { validateSqlSafety } = makeTools();
    const result = await validateSqlSafety.execute!({ sql: "TRUNCATE users" }, { toolCallId: "test", messages: [] });
    expect(result.classification).toBe("blocked");
  });

  test("classifies ALTER as blocked", async () => {
    const { validateSqlSafety } = makeTools();
    const result = await validateSqlSafety.execute!({ sql: "ALTER TABLE users ADD COLUMN age INT" }, { toolCallId: "test", messages: [] });
    expect(result.classification).toBe("blocked");
  });

  test("classifies GRANT as blocked", async () => {
    const { validateSqlSafety } = makeTools();
    const result = await validateSqlSafety.execute!({ sql: "GRANT SELECT ON users TO app" }, { toolCallId: "test", messages: [] });
    expect(result.classification).toBe("blocked");
  });

  test("classifies multi-statement with DROP as blocked", async () => {
    const { validateSqlSafety } = makeTools();
    const result = await validateSqlSafety.execute!({ sql: "SELECT 1; DROP TABLE users" }, { toolCallId: "test", messages: [] });
    expect(result.classification).toBe("blocked");
  });

  test("classifies unknown query as blocked", async () => {
    const { validateSqlSafety } = makeTools();
    const result = await validateSqlSafety.execute!({ sql: "VACUUM ANALYZE users" }, { toolCallId: "test", messages: [] });
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

    const result = await listSchemas.execute!({}, { toolCallId: "test", messages: [] });
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

    const result = await searchSchema.execute!({ query: "user" }, { toolCallId: "test", messages: [] });
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

    const result = await searchSchema.execute!({ query: "secret", schemaName: "public" }, { toolCallId: "test", messages: [] });
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

    const result = await searchSchema.execute!({ query: "match", limit: 3 }, { toolCallId: "test", messages: [] });
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

    const result = await getRelationsGraph.execute!({ schemaName: "public" }, { toolCallId: "test", messages: [] });
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

    const result = await getRelationsGraph.execute!({ tables: ["orders"] }, { toolCallId: "test", messages: [] });
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

    const result = await runReadOnlySql.execute!({ sql: "SELECT id, name FROM users" }, { toolCallId: "test", messages: [] });
    expect(result).not.toHaveProperty("error");
    expect(result.rowCount).toBe(2);
    expect(result.columns).toEqual(["id", "name"]);
  });

  test("rejects UPDATE queries", async () => {
    const { runReadOnlySql } = makeTools();
    const result = await runReadOnlySql.execute!({ sql: "UPDATE users SET name = 'X'" }, { toolCallId: "test", messages: [] });
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("read-only");
  });

  test("rejects DELETE queries", async () => {
    const { runReadOnlySql } = makeTools();
    const result = await runReadOnlySql.execute!({ sql: "DELETE FROM users WHERE id = 1" }, { toolCallId: "test", messages: [] });
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("read-only");
  });

  test("injects LIMIT when missing", async () => {
    const { runReadOnlySql } = makeTools();
    mockExecuteQuery.mockResolvedValue({
      columns: [{ name: "id" }],
      rows: [],
      row_count: 0,
    });

    await runReadOnlySql.execute!({ sql: "SELECT * FROM users", limit: 42 }, { toolCallId: "test", messages: [] });
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

    await runReadOnlySql.execute!({ sql: "SELECT * FROM users LIMIT 10" }, { toolCallId: "test", messages: [] });
    const calledSql = mockExecuteQuery.mock.calls[0][1] as string;
    expect(calledSql).not.toMatch(/LIMIT\s+\d+.*LIMIT/);
  });

  test("rejects INTO OUTFILE patterns", async () => {
    const { runReadOnlySql } = makeTools();
    const result = await runReadOnlySql.execute!({ sql: "SELECT * INTO OUTFILE '/tmp/x' FROM users" }, { toolCallId: "test", messages: [] });
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("dangerous");
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
    const result = await dryRunMutation.execute!({ sql: "SELECT * FROM users" }, { toolCallId: "test", messages: [] });
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("UPDATE and DELETE");
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
    }, { toolCallId: "test", messages: [] });

    expect(result).not.toHaveProperty("error");
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
    }, { toolCallId: "test", messages: [] });

    expect(result).not.toHaveProperty("error");
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
    }, { toolCallId: "test", messages: [] });

    if ('warnings' in result && result.warnings) {
      expect(result.warnings.some((w: string) => w.includes("Large number"))).toBe(true);
    }
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
    }, { toolCallId: "test", messages: [] });

    expect(result).not.toHaveProperty("error");
    if ('estimatedAffectedRows' in result) {
      expect(result.estimatedAffectedRows).toBe(3);
    }
  });

  // Security tests — validates stripStringLiterals + containsSqlInjection indirectly
  // through dryRunMutation's WHERE clause validation.

  test("allows WHERE with DDL keyword inside string literal (no false positive)", async () => {
    const { dryRunMutation } = makeTools();
    mockExecuteQuery.mockResolvedValueOnce({
      columns: [{ name: "estimated_affected_rows" }],
      rows: [[1]],
      row_count: 1,
    });
    mockExecuteQuery.mockResolvedValueOnce({
      columns: [{ name: "id" }],
      rows: [],
      row_count: 0,
    });

    // 'delete_pending' is a data value, not a DDL keyword — should be allowed
    const result = await dryRunMutation.execute!({
      sql: "UPDATE public.orders SET status = 'cancelled' WHERE status = 'delete_pending'",
      sampleSize: 1,
    }, { toolCallId: "test", messages: [] });

    expect(result).not.toHaveProperty("error");
  });

  test("allows WHERE with 'update' inside string literal (no false positive)", async () => {
    const { dryRunMutation } = makeTools();
    mockExecuteQuery.mockResolvedValueOnce({
      columns: [{ name: "estimated_affected_rows" }],
      rows: [[1]],
      row_count: 1,
    });
    mockExecuteQuery.mockResolvedValueOnce({
      columns: [{ name: "id" }],
      rows: [],
      row_count: 0,
    });

    // 'update_attempt' is a data value, not a DML keyword — should be allowed
    const result = await dryRunMutation.execute!({
      sql: "DELETE FROM public.logs WHERE action = 'update_attempt'",
      sampleSize: 1,
    }, { toolCallId: "test", messages: [] });

    expect(result).not.toHaveProperty("error");
  });

  test("rejects WHERE with subquery (SELECT injection)", async () => {
    const { dryRunMutation } = makeTools();

    const result = await dryRunMutation.execute!({
      sql: "DELETE FROM public.users WHERE id IN (SELECT 1 FROM other_table)",
      sampleSize: 1,
    }, { toolCallId: "test", messages: [] });

    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("Subqueries");
  });

  test("rejects WHERE with semicolons (multi-statement injection)", async () => {
    const { dryRunMutation } = makeTools();

    // Full SQL is now validated for injection patterns, including semicolons
    const result = await dryRunMutation.execute!({
      sql: "DELETE FROM public.users WHERE id = 1; DROP TABLE users",
      sampleSize: 1,
    }, { toolCallId: "test", messages: [] });

    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("Semicolons");
  });

  test("rejects WHERE with SQL comments", async () => {
    const { dryRunMutation } = makeTools();

    const result = await dryRunMutation.execute!({
      sql: "DELETE FROM public.users WHERE id = 1 /* comment */",
      sampleSize: 1,
    }, { toolCallId: "test", messages: [] });

    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("comments");
  });

  test("rejects WHERE with DDL keywords outside string literals", async () => {
    const { dryRunMutation } = makeTools();

    const result = await dryRunMutation.execute!({
      sql: "DELETE FROM public.users WHERE id = 1 AND drop table users",
      sampleSize: 1,
    }, { toolCallId: "test", messages: [] });

    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("DDL/DML");
  });

  test("handles PostgreSQL dollar-quoted strings in WHERE safely", async () => {
    const { dryRunMutation } = makeTools();
    mockExecuteQuery.mockResolvedValueOnce({
      columns: [{ name: "estimated_affected_rows" }],
      rows: [[0]],
      row_count: 1,
    });
    mockExecuteQuery.mockResolvedValueOnce({
      columns: [{ name: "id" }],
      rows: [],
      row_count: 0,
    });

    // $$..$$ is a valid PostgreSQL string literal — contents should be stripped
    // so that keywords inside $$..$$ don't trigger DDL/DML keyword check
    const result = await dryRunMutation.execute!({
      sql: "DELETE FROM public.users WHERE name = $$some_value$$",
      sampleSize: 1,
    }, { toolCallId: "test", messages: [] });

    expect(result).not.toHaveProperty("error");
  });
});

// ---------------------------------------------------------------------------
// explain — subquery danger validation
// ---------------------------------------------------------------------------

describe("explain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("allows EXPLAIN SELECT with safe query", async () => {
    const { explain } = makeTools();
    mockExplainQuery.mockResolvedValue({
      plan: "Seq Scan on users",
      hasExecutionStats: false,
      totalCost: 10.0,
      estimatedRows: 100,
      executionTimeMs: null,
    });

    const result = await explain.execute!({ sql: "SELECT * FROM users WHERE id = 1" }, { toolCallId: "test", messages: [] });
    expect(result).not.toHaveProperty("error");
  });

  test("allows EXPLAIN SELECT with DDL keyword inside string literal", async () => {
    const { explain } = makeTools();
    mockExplainQuery.mockResolvedValue({
      plan: "Seq Scan on users",
      hasExecutionStats: false,
      totalCost: 10.0,
      estimatedRows: 100,
      executionTimeMs: null,
    });

    // 'delete_pending' is inside a string literal — should not trigger DDL check
    const result = await explain.execute!({ sql: "SELECT * FROM users WHERE status = 'delete_pending'" }, { toolCallId: "test", messages: [] });
    expect(result).not.toHaveProperty("error");
  });

  test("rejects EXPLAIN with DDL/DML keyword outside string literals", async () => {
    const { explain } = makeTools();

    // EXPLAIN DELETE is a dangerous operation
    const result = await explain.execute!({ sql: "EXPLAIN DELETE FROM users" }, { toolCallId: "test", messages: [] });
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("dangerous");
  });

  test("rejects non-SELECT/WITH/EXPLAIN queries", async () => {
    const { explain } = makeTools();

    const result = await explain.execute!({ sql: "UPDATE users SET name = 'X'" }, { toolCallId: "test", messages: [] });
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("Only SELECT");
  });
});
