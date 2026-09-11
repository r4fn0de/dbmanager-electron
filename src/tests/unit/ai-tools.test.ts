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
  addColumn: vi.fn(),
  alterColumnType: vi.fn(),
  buildConnectionString: vi.fn(() => "postgres://localhost/test"),
  createIndex: vi.fn(),
  createSchema: vi.fn(),
  createTable: vi.fn(),
  defaultDatabase: "postgres",
  defaultPort: 5432,
  defaultUsername: "postgres",
  dropColumn: vi.fn(),
  dropIndex: vi.fn(),
  dropTable: vi.fn(),
  executeBatchDdl: vi.fn(),
  executeQuery: mockExecuteQuery,
  explainQuery: mockExplainQuery,
  exportSchemaDdl: vi.fn(),
  exportTableData: vi.fn(),
  getConstraints: mockGetConstraints,
  getDatabaseInfo: vi.fn(),
  getEnums: vi.fn(),
  getFunctions: vi.fn(),
  getIndexes: mockGetIndexes,
  getSchema: mockGetSchema,
  getSchemaSummary: mockGetSchemaSummary,
  getTableDetails: mockGetTableDetails,
  getTableSample: mockGetTableSample,
  getTableStats: mockGetTableStats,
  getTriggers: vi.fn(),
  importTableRows: vi.fn(),
  listRows: vi.fn(),
  renameColumn: vi.fn(),
  renameTable: vi.fn(),
  setColumnDefault: vi.fn(),
  setColumnNullable: vi.fn(),
  sslModes: ["disable", "prefer", "require"],
  // stubs for other driver methods
  testConnection: vi.fn(),
  type: "postgresql" as const,
  waitForDatabase: vi.fn(),
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
        database: "testdb",
        db_type: "postgresql",
        host: "localhost",
        id: "conn-1",
        name: "Test DB",
        password: "secret",
        port: 5432,
        ssl_mode: "prefer",
        username: "postgres",
      },
    ])
  ),
}));

// Invalidate schema-cache module between tests to keep caches clean
vi.mock("@/ipc/ai/schema-cache", () => ({
  getCachedConstraints: vi.fn(() => null),
  getCachedIndexes: vi.fn(() => null),
  getCachedTableDetails: vi.fn(() => null),
  getCachedTableSample: vi.fn(() => null),
  getCachedTableStats: vi.fn(() => null),
  setCachedConstraints: vi.fn(),
  setCachedIndexes: vi.fn(),
  setCachedTableDetails: vi.fn(),
  setCachedTableSample: vi.fn(),
  setCachedTableStats: vi.fn(),
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

interface SafetyResult {
    classification: string;
    reasons: string[] 
}

describe("validateSqlSafety", () => {
  test("classifies simple SELECT as safe", async () => {
    const { validateSqlSafety } = makeTools();
    const result = (await validateSqlSafety.execute!(
      { sql: "SELECT * FROM users" },
      { messages: [], toolCallId: "test" }
    )) as SafetyResult;
    expect(result.classification).toBe("safe");
    expect(result.reasons[0]).toContain("read-only");
  });

  test("classifies WITH as safe", async () => {
    const { validateSqlSafety } = makeTools();
    const result = (await validateSqlSafety.execute!(
      { sql: "WITH cte AS (SELECT 1) SELECT * FROM cte" },
      { messages: [], toolCallId: "test" }
    )) as SafetyResult;
    expect(result.classification).toBe("safe");
  });

  test("classifies EXPLAIN as safe", async () => {
    const { validateSqlSafety } = makeTools();
    const result = (await validateSqlSafety.execute!(
      { sql: "EXPLAIN SELECT * FROM users" },
      { messages: [], toolCallId: "test" }
    )) as SafetyResult;
    expect(result.classification).toBe("safe");
  });

  test("classifies UPDATE as risky", async () => {
    const { validateSqlSafety } = makeTools();
    const result = (await validateSqlSafety.execute!(
      { sql: "UPDATE users SET name = 'X'" },
      { messages: [], toolCallId: "test" }
    )) as SafetyResult;
    expect(result.classification).toBe("risky");
    expect(result.reasons[0]).toContain("UPDATE");
  });

  test("classifies DELETE as risky", async () => {
    const { validateSqlSafety } = makeTools();
    const result = (await validateSqlSafety.execute!(
      { sql: "DELETE FROM users WHERE id = 1" },
      { messages: [], toolCallId: "test" }
    )) as SafetyResult;
    expect(result.classification).toBe("risky");
    expect(result.reasons[0]).toContain("DELETE");
  });

  test("classifies DROP as risky", async () => {
    const { validateSqlSafety } = makeTools();
    const result = (await validateSqlSafety.execute!(
      { sql: "DROP TABLE users" },
      { messages: [], toolCallId: "test" }
    )) as SafetyResult;
    expect(result.classification).toBe("risky");
    expect(result.reasons[0]).toContain("DROP");
  });

  test("classifies TRUNCATE as risky", async () => {
    const { validateSqlSafety } = makeTools();
    const result = (await validateSqlSafety.execute!(
      { sql: "TRUNCATE users" },
      { messages: [], toolCallId: "test" }
    )) as SafetyResult;
    expect(result.classification).toBe("risky");
  });

  test("classifies ALTER as risky", async () => {
    const { validateSqlSafety } = makeTools();
    const result = (await validateSqlSafety.execute!(
      { sql: "ALTER TABLE users ADD COLUMN age INT" },
      { messages: [], toolCallId: "test" }
    )) as SafetyResult;
    expect(result.classification).toBe("risky");
  });

  test("classifies GRANT as risky", async () => {
    const { validateSqlSafety } = makeTools();
    const result = (await validateSqlSafety.execute!(
      { sql: "GRANT SELECT ON users TO app" },
      { messages: [], toolCallId: "test" }
    )) as SafetyResult;
    expect(result.classification).toBe("risky");
  });

  test("classifies multi-statement with DROP as risky", async () => {
    const { validateSqlSafety } = makeTools();
    const result = (await validateSqlSafety.execute!(
      { sql: "SELECT 1; DROP TABLE users" },
      { messages: [], toolCallId: "test" }
    )) as SafetyResult;
    expect(result.classification).toBe("risky");
  });

  test("classifies unknown query as blocked", async () => {
    const { validateSqlSafety } = makeTools();
    const result = (await validateSqlSafety.execute!(
      { sql: "VACUUM ANALYZE users" },
      { messages: [], toolCallId: "test" }
    )) as SafetyResult;
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
        {
          estimated_row_count: 100,
          has_rls: false,
          name: "users",
          schema: "public",
        },
        {
          estimated_row_count: 50,
          has_rls: false,
          name: "posts",
          schema: "public",
        },
        {
          estimated_row_count: 20,
          has_rls: true,
          name: "accounts",
          schema: "auth",
        },
      ],
    });

    const result = await listSchemas.execute!(
      {},
      { messages: [], toolCallId: "test" }
    );
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
          columns: [
            {
              column_default: null,
              data_type: "bigint",
              is_nullable: false,
              name: "id",
              udt_name: null,
            },
            {
              column_default: null,
              data_type: "character varying",
              is_nullable: false,
              name: "email",
              udt_name: null,
            },
          ],
          foreign_keys: [],
          has_rls: false,
          indexes: [],
          name: "users",
          rls_policies: [],
          schema: "public",
        },
        {
          columns: [
            {
              column_default: null,
              data_type: "bigint",
              is_nullable: false,
              name: "id",
              udt_name: null,
            },
            {
              column_default: null,
              data_type: "bigint",
              is_nullable: true,
              name: "user_id",
              udt_name: null,
            },
          ],
          foreign_keys: [],
          has_rls: false,
          indexes: [],
          name: "products",
          rls_policies: [],
          schema: "public",
        },
      ],
    });

    const result = (await searchSchema.execute!(
      { query: "user" },
      { messages: [], toolCallId: "test" }
    )) as Array<{
      schema: string;
      table: string;
      column?: string;
      matchType: string;
    }>;
    expect(result.length).toBeGreaterThanOrEqual(2);
    const tableMatches = result.filter(
      (r: { matchType: string }) => r.matchType === "table_name"
    );
    const columnMatches = result.filter(
      (r: { matchType: string }) => r.matchType === "column_name"
    );
    expect(
      tableMatches.some((r: { table: string }) => r.table === "users")
    ).toBe(true);
    expect(
      columnMatches.some((r: { column?: string }) => r.column === "user_id")
    ).toBe(true);
  });

  test("respects schemaName filter", async () => {
    const { searchSchema } = makeTools();
    mockGetSchema.mockResolvedValue({
      schemas: ["public", "private"],
      tables: [
        {
          columns: [
            {
              column_default: null,
              data_type: "bigint",
              is_nullable: false,
              name: "id",
              udt_name: null,
            },
          ],
          foreign_keys: [],
          has_rls: false,
          indexes: [],
          name: "secrets",
          rls_policies: [],
          schema: "private",
        },
      ],
    });

    const result = (await searchSchema.execute!(
      { query: "secret", schemaName: "public" },
      { messages: [], toolCallId: "test" }
    )) as unknown[];
    expect(result).toEqual([]);
  });

  test("respects limit", async () => {
    const { searchSchema } = makeTools();
    mockGetSchema.mockResolvedValue({
      schemas: ["public"],
      tables: Array.from({ length: 10 }, (_, i) => ({
        columns: [
          {
            column_default: null,
            data_type: "bigint",
            is_nullable: false,
            name: "match_col",
            udt_name: null,
          },
        ],
        foreign_keys: [],
        has_rls: false,
        indexes: [],
        name: `table_${i}`,
        rls_policies: [],
        schema: "public",
      })),
    });

    const result = (await searchSchema.execute!(
      { limit: 3, query: "match" },
      { messages: [], toolCallId: "test" }
    )) as unknown[];
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
          columns: [],
          foreign_keys: [
            {
              column_name: "user_id",
              name: "fk_orders_user_id",
              referenced_column: "id",
              referenced_schema: "public",
              referenced_table: "users",
            },
          ],
          has_rls: false,
          indexes: [],
          name: "orders",
          rls_policies: [],
          schema: "public",
        },
        {
          columns: [],
          foreign_keys: [],
          has_rls: false,
          indexes: [],
          name: "users",
          rls_policies: [],
          schema: "public",
        },
      ],
    });

    const result = (await getRelationsGraph.execute!(
      { schemaName: "public" },
      { messages: [], toolCallId: "test" }
    )) as Array<{
      fromTable: string;
      fromSchema: string;
      fromColumn: string;
      toTable: string;
      toSchema: string;
      toColumn: string;
      constraintName: string | null;
    }>;
    expect(result).toEqual([
      {
        constraintName: "fk_orders_user_id",
        fromColumn: "user_id",
        fromSchema: "public",
        fromTable: "orders",
        toColumn: "id",
        toSchema: "public",
        toTable: "users",
      },
    ]);
  });

  test("filters by table list", async () => {
    const { getRelationsGraph } = makeTools();
    mockGetSchema.mockResolvedValue({
      schemas: ["public"],
      tables: [
        {
          columns: [],
          foreign_keys: [
            {
              column_name: "user_id",
              name: "fk_orders_user_id",
              referenced_column: "id",
              referenced_schema: undefined,
              referenced_table: "users",
            },
          ],
          has_rls: false,
          indexes: [],
          name: "orders",
          rls_policies: [],
          schema: "public",
        },
        {
          columns: [],
          foreign_keys: [
            {
              column_name: "category_id",
              name: "fk_products_category_id",
              referenced_column: "id",
              referenced_schema: undefined,
              referenced_table: "categories",
            },
          ],
          has_rls: false,
          indexes: [],
          name: "products",
          rls_policies: [],
          schema: "public",
        },
      ],
    });

    const result = (await getRelationsGraph.execute!(
      { tables: ["orders"] },
      { messages: [], toolCallId: "test" }
    )) as Array<{
      fromTable: string;
      fromSchema: string;
      fromColumn: string;
      toTable: string;
      toSchema: string;
      toColumn: string;
      constraintName: string | null;
    }>;
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
      row_count: 2,
      rows: [
        [1, "Alice"],
        [2, "Bob"],
      ],
    });

    const result = (await runReadOnlySql.execute!(
      { sql: "SELECT id, name FROM users" },
      { messages: [], toolCallId: "test" }
    )) as { rowCount: number; columns: string[]; error?: string };
    expect(result).not.toHaveProperty("error");
    expect(result.rowCount).toBe(2);
    expect(result.columns).toEqual(["id", "name"]);
  });

  test("rejects UPDATE queries", async () => {
    const { runReadOnlySql } = makeTools();
    const result = await runReadOnlySql.execute!(
      { sql: "UPDATE users SET name = 'X'" },
      { messages: [], toolCallId: "test" }
    );
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("read-only");
  });

  test("rejects DELETE queries", async () => {
    const { runReadOnlySql } = makeTools();
    const result = await runReadOnlySql.execute!(
      { sql: "DELETE FROM users WHERE id = 1" },
      { messages: [], toolCallId: "test" }
    );
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("read-only");
  });

  test("injects LIMIT when missing", async () => {
    const { runReadOnlySql } = makeTools();
    mockExecuteQuery.mockResolvedValue({
      columns: [{ name: "id" }],
      row_count: 0,
      rows: [],
    });

    await runReadOnlySql.execute!(
      { limit: 42, sql: "SELECT * FROM users" },
      { messages: [], toolCallId: "test" }
    );
    const calledSql = mockExecuteQuery.mock.calls[0][1] as string;
    expect(calledSql).toContain("LIMIT 42");
  });

  test("does not double LIMIT if already present", async () => {
    const { runReadOnlySql } = makeTools();
    mockExecuteQuery.mockResolvedValue({
      columns: [{ name: "id" }],
      row_count: 0,
      rows: [],
    });

    await runReadOnlySql.execute!(
      { sql: "SELECT * FROM users LIMIT 10" },
      { messages: [], toolCallId: "test" }
    );
    const calledSql = mockExecuteQuery.mock.calls[0][1] as string;
    expect(calledSql).not.toMatch(/LIMIT\s+\d+.*LIMIT/);
  });

  test("rejects INTO OUTFILE patterns", async () => {
    const { runReadOnlySql } = makeTools();
    const result = await runReadOnlySql.execute!(
      { sql: "SELECT * INTO OUTFILE '/tmp/x' FROM users" },
      { messages: [], toolCallId: "test" }
    );
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
    const result = await dryRunMutation.execute!(
      { sql: "SELECT * FROM users" },
      { messages: [], toolCallId: "test" }
    );
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("UPDATE and DELETE");
  });

  test("estimates DELETE impact", async () => {
    const { dryRunMutation } = makeTools();
    mockExecuteQuery.mockResolvedValueOnce({
      columns: [{ name: "estimated_affected_rows" }],
      row_count: 1,
      rows: [[5]],
    });
    mockExecuteQuery.mockResolvedValueOnce({
      columns: [{ name: "id" }, { name: "name" }],
      row_count: 1,
      rows: [[1, "Alice"]],
    });

    const result = await dryRunMutation.execute!(
      {
        sampleSize: 1,
        sql: "DELETE FROM public.users WHERE id > 10",
      },
      { messages: [], toolCallId: "test" }
    );

    expect(result).not.toHaveProperty("error");
    expect(
      (result as { estimatedAffectedRows: number }).estimatedAffectedRows
    ).toBe(5);
    expect((result as { warnings: string[] }).warnings).toEqual([]);
    expect(
      (result as { samplePreview: { rows: unknown[] } }).samplePreview.rows
        .length
    ).toBe(1);
  });

  test("estimates UPDATE impact and warns about missing WHERE", async () => {
    const { dryRunMutation } = makeTools();
    mockExecuteQuery.mockResolvedValueOnce({
      columns: [{ name: "estimated_affected_rows" }],
      row_count: 1,
      rows: [[100]],
    });
    mockExecuteQuery.mockResolvedValueOnce({
      columns: [{ name: "id" }],
      row_count: 1,
      rows: [[1]],
    });

    const result = await dryRunMutation.execute!(
      {
        sampleSize: 1,
        sql: "UPDATE public.users SET name = 'X'",
      },
      { messages: [], toolCallId: "test" }
    );

    expect(result).not.toHaveProperty("error");
    expect(
      (result as { estimatedAffectedRows: number }).estimatedAffectedRows
    ).toBe(100);
    expect(
      (result as { warnings: string[] }).warnings.some((w: string) =>
        w.includes("WHERE")
      )
    ).toBe(true);
  });

  test("warns about large affected rows", async () => {
    const { dryRunMutation } = makeTools();
    mockExecuteQuery.mockResolvedValueOnce({
      columns: [{ name: "estimated_affected_rows" }],
      row_count: 1,
      rows: [[50_000]],
    });
    mockExecuteQuery.mockResolvedValueOnce({
      columns: [{ name: "id" }],
      row_count: 0,
      rows: [],
    });

    const result = await dryRunMutation.execute!(
      {
        sampleSize: 1,
        sql: "DELETE FROM public.users WHERE id > 0",
      },
      { messages: [], toolCallId: "test" }
    );

    if ("warnings" in result && result.warnings) {
      expect(
        result.warnings.some((w: string) => w.includes("Large number"))
      ).toBe(true);
    }
  });

  test("parses schema-qualified table in DELETE", async () => {
    const { dryRunMutation } = makeTools();
    mockExecuteQuery.mockResolvedValueOnce({
      columns: [{ name: "estimated_affected_rows" }],
      row_count: 1,
      rows: [[3]],
    });
    mockExecuteQuery.mockResolvedValueOnce({
      columns: [{ name: "id" }],
      row_count: 0,
      rows: [],
    });

    const result = await dryRunMutation.execute!(
      {
        sampleSize: 1,
        sql: 'DELETE FROM "my_schema"."my_table" WHERE active = false',
      },
      { messages: [], toolCallId: "test" }
    );

    expect(result).not.toHaveProperty("error");
    if ("estimatedAffectedRows" in result) {
      expect(result.estimatedAffectedRows).toBe(3);
    }
  });

  // Security tests — validates stripStringLiterals + containsSqlInjection indirectly
  // through dryRunMutation's WHERE clause validation.

  test("allows WHERE with DDL keyword inside string literal (no false positive)", async () => {
    const { dryRunMutation } = makeTools();
    mockExecuteQuery.mockResolvedValueOnce({
      columns: [{ name: "estimated_affected_rows" }],
      row_count: 1,
      rows: [[1]],
    });
    mockExecuteQuery.mockResolvedValueOnce({
      columns: [{ name: "id" }],
      row_count: 0,
      rows: [],
    });

    // 'delete_pending' is a data value, not a DDL keyword — should be allowed
    const result = await dryRunMutation.execute!(
      {
        sampleSize: 1,
        sql: "UPDATE public.orders SET status = 'cancelled' WHERE status = 'delete_pending'",
      },
      { messages: [], toolCallId: "test" }
    );

    expect(result).not.toHaveProperty("error");
  });

  test("allows WHERE with 'update' inside string literal (no false positive)", async () => {
    const { dryRunMutation } = makeTools();
    mockExecuteQuery.mockResolvedValueOnce({
      columns: [{ name: "estimated_affected_rows" }],
      row_count: 1,
      rows: [[1]],
    });
    mockExecuteQuery.mockResolvedValueOnce({
      columns: [{ name: "id" }],
      row_count: 0,
      rows: [],
    });

    // 'update_attempt' is a data value, not a DML keyword — should be allowed
    const result = await dryRunMutation.execute!(
      {
        sampleSize: 1,
        sql: "DELETE FROM public.logs WHERE action = 'update_attempt'",
      },
      { messages: [], toolCallId: "test" }
    );

    expect(result).not.toHaveProperty("error");
  });

  test("rejects WHERE with subquery (SELECT injection)", async () => {
    const { dryRunMutation } = makeTools();

    const result = await dryRunMutation.execute!(
      {
        sampleSize: 1,
        sql: "DELETE FROM public.users WHERE id IN (SELECT 1 FROM other_table)",
      },
      { messages: [], toolCallId: "test" }
    );

    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("Subqueries");
  });

  test("rejects WHERE with semicolons (multi-statement injection)", async () => {
    const { dryRunMutation } = makeTools();

    // Full SQL is now validated for injection patterns, including semicolons
    const result = await dryRunMutation.execute!(
      {
        sampleSize: 1,
        sql: "DELETE FROM public.users WHERE id = 1; DROP TABLE users",
      },
      { messages: [], toolCallId: "test" }
    );

    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("Semicolons");
  });

  test("rejects WHERE with SQL comments", async () => {
    const { dryRunMutation } = makeTools();

    const result = await dryRunMutation.execute!(
      {
        sampleSize: 1,
        sql: "DELETE FROM public.users WHERE id = 1 /* comment */",
      },
      { messages: [], toolCallId: "test" }
    );

    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("comments");
  });

  test("rejects WHERE with DDL keywords outside string literals", async () => {
    const { dryRunMutation } = makeTools();

    const result = await dryRunMutation.execute!(
      {
        sampleSize: 1,
        sql: "DELETE FROM public.users WHERE id = 1 AND drop table users",
      },
      { messages: [], toolCallId: "test" }
    );

    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("DDL/DML");
  });

  test("handles PostgreSQL dollar-quoted strings in WHERE safely", async () => {
    const { dryRunMutation } = makeTools();
    mockExecuteQuery.mockResolvedValueOnce({
      columns: [{ name: "estimated_affected_rows" }],
      row_count: 1,
      rows: [[0]],
    });
    mockExecuteQuery.mockResolvedValueOnce({
      columns: [{ name: "id" }],
      row_count: 0,
      rows: [],
    });

    // $$..$$ is a valid PostgreSQL string literal — contents should be stripped
    // so that keywords inside $$..$$ don't trigger DDL/DML keyword check
    const result = await dryRunMutation.execute!(
      {
        sampleSize: 1,
        sql: "DELETE FROM public.users WHERE name = $$some_value$$",
      },
      { messages: [], toolCallId: "test" }
    );

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
      estimatedRows: 100,
      executionTimeMs: null,
      hasExecutionStats: false,
      plan: "Seq Scan on users",
      totalCost: 10.0,
    });

    const result = await explain.execute!(
      { sql: "SELECT * FROM users WHERE id = 1" },
      { messages: [], toolCallId: "test" }
    );
    expect(result).not.toHaveProperty("error");
  });

  test("allows EXPLAIN SELECT with DDL keyword inside string literal", async () => {
    const { explain } = makeTools();
    mockExplainQuery.mockResolvedValue({
      estimatedRows: 100,
      executionTimeMs: null,
      hasExecutionStats: false,
      plan: "Seq Scan on users",
      totalCost: 10.0,
    });

    // 'delete_pending' is inside a string literal — should not trigger DDL check
    const result = await explain.execute!(
      { sql: "SELECT * FROM users WHERE status = 'delete_pending'" },
      { messages: [], toolCallId: "test" }
    );
    expect(result).not.toHaveProperty("error");
  });

  test("rejects EXPLAIN with DDL/DML keyword outside string literals", async () => {
    const { explain } = makeTools();

    // EXPLAIN DELETE is a dangerous operation
    const result = await explain.execute!(
      { sql: "EXPLAIN DELETE FROM users" },
      { messages: [], toolCallId: "test" }
    );
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("dangerous");
  });

  test("rejects non-SELECT/WITH/EXPLAIN queries", async () => {
    const { explain } = makeTools();

    const result = await explain.execute!(
      { sql: "UPDATE users SET name = 'X'" },
      { messages: [], toolCallId: "test" }
    );
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("Only SELECT");
  });
});
