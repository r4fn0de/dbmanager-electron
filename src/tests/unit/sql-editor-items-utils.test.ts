import { describe, expect, it } from "vitest";
import {
  buildItemsTree,
  buildSmartSqlFromColumnRefs,
  filterItemsTree,
  getStatementRangeAtOffset,
  makeQualifiedColumnRef,
  makeAliasedColumnRef,
  makeTableInsertTemplateSql,
  makeTableRef,
  makeTableSelectSql,
  makeTableUpdateTemplateSql,
  mergeDroppedColumnsIntoStatement,
  normalizeColumnRefs,
  parseColumnRef,
} from "@/features/database/components/SqlEditor/utils/itemsUtils";

describe("sql editor items utils", () => {
  const schemaCompletionData = {
    schemas: ["public", "audit"],
    tables: [
      {
        schema: "public",
        name: "users",
        columns: [
          { name: "id", dataType: "uuid" },
          { name: "email", dataType: "text" },
        ],
      },
      {
        schema: "public",
        name: "orders",
        columns: [
          { name: "id", dataType: "uuid" },
          { name: "user_id", dataType: "uuid" },
        ],
      },
      {
        schema: "audit",
        name: "events",
        columns: [
          { name: "id", dataType: "bigint" },
          { name: "payload", dataType: "jsonb" },
        ],
      },
    ],
  };

  it("builds grouped tree by schema and table", () => {
    const tree = buildItemsTree(schemaCompletionData);
    expect(tree).toHaveLength(2);
    expect(tree[0]?.name).toBe("audit");
    expect(tree[0]?.tables[0]?.name).toBe("events");
    expect(tree[1]?.name).toBe("public");
    expect(tree[1]?.tables.map((table) => table.name)).toEqual(["orders", "users"]);
  });

  it("filters by table and column names", () => {
    const tree = buildItemsTree(schemaCompletionData);
    const tableFiltered = filterItemsTree(tree, "users");
    expect(tableFiltered).toHaveLength(1);
    expect(tableFiltered[0]?.name).toBe("public");
    expect(tableFiltered[0]?.tables).toHaveLength(1);
    expect(tableFiltered[0]?.tables[0]?.name).toBe("users");

    const columnFiltered = filterItemsTree(tree, "payload");
    expect(columnFiltered).toHaveLength(1);
    expect(columnFiltered[0]?.name).toBe("audit");
    expect(columnFiltered[0]?.tables[0]?.columns).toEqual([
      { name: "payload", dataType: "jsonb" },
    ]);
  });

  it("creates SQL snippets for table and column insertion", () => {
    expect(makeTableSelectSql("public", "users")).toBe(
      "SELECT *\nFROM public.users\nLIMIT 100;",
    );
    expect(makeTableRef("public", "users")).toBe("public.users");
    expect(makeTableInsertTemplateSql("public", "users")).toBe(
      "INSERT INTO public.users (column1, column2)\nVALUES (value1, value2);",
    );
    expect(makeTableUpdateTemplateSql("public", "users")).toBe(
      "UPDATE public.users\nSET column1 = value1\nWHERE condition;",
    );
    expect(makeQualifiedColumnRef("public", "users", "email")).toBe(
      "public.users.email",
    );
    expect(makeAliasedColumnRef("users", "email")).toBe(
      "users.email AS email",
    );
  });

  it("parses and normalizes multi-column refs preserving order", () => {
    expect(parseColumnRef("public.users.email")).toEqual({
      schema: "public",
      table: "users",
      column: "email",
      qualified: "public.users.email",
    });
    expect(parseColumnRef("invalid")).toBeNull();

    const normalized = normalizeColumnRefs([
      "public.users.email",
      "public.users.email",
      "public.orders.user_id",
      "invalid",
    ]);
    expect(normalized.map((item) => item.qualified)).toEqual([
      "public.users.email",
      "public.orders.user_id",
    ]);
  });

  it("builds single-table SQL for multi-column drag", () => {
    const sql = buildSmartSqlFromColumnRefs([
      "public.users.id",
      "public.users.email",
    ], schemaCompletionData);
    expect(sql).toBe("SELECT id, email\nFROM public.users\nLIMIT 100;");
  });

  it("builds join SQL when a clear fk relation exists", () => {
    const sql = buildSmartSqlFromColumnRefs([
      "public.users.id",
      "public.users.email",
      "public.orders.user_id",
    ], schemaCompletionData);
    expect(sql).toBe(
      "SELECT t1.id AS t1_id, t1.email AS t1_email, t2.user_id AS t2_user_id\nFROM public.users t1\nJOIN public.orders t2 ON t2.user_id = t1.id\nLIMIT 100;",
    );
  });

  it("falls back to separate queries when no safe join is inferable", () => {
    const sql = buildSmartSqlFromColumnRefs([
      "public.users.email",
      "audit.events.payload",
    ], schemaCompletionData);
    expect(sql).toBe(
      "SELECT email\nFROM public.users\nLIMIT 100;\n\nSELECT payload\nFROM audit.events\nLIMIT 100;",
    );
  });

  it("finds statement range by cursor offset in multi-query sql", () => {
    const sql = "SELECT id FROM public.users;\n\nSELECT email FROM public.users;";
    const offsetInSecond = sql.lastIndexOf("email");
    const range = getStatementRangeAtOffset(sql, offsetInSecond);
    expect(range?.text).toBe("SELECT email FROM public.users");
  });

  it("merges dropped columns into existing select without overwriting statement", () => {
    const statement = "SELECT t1.id\nFROM public.users t1\nLIMIT 100;";
    const merged = mergeDroppedColumnsIntoStatement(
      statement,
      ["public.users.email"],
      schemaCompletionData,
    );
    expect(merged.merged).toBe(true);
    expect(merged.sql).toContain("\"t1\".id");
    expect(merged.sql).toContain("\"t1\".\"email\"");
    expect(merged.sql).toContain("\"public\".\"users\"");
  });

  it("adds join automatically when dropped columns reference related table", () => {
    const statement = "SELECT t1.id\nFROM public.users t1\nLIMIT 100;";
    const merged = mergeDroppedColumnsIntoStatement(
      statement,
      ["public.orders.user_id"],
      schemaCompletionData,
    );
    expect(merged.merged).toBe(true);
    expect(merged.sql).toContain("JOIN \"public\".\"orders\"");
    expect(merged.sql).toContain("ON");
    expect(merged.sql).toContain("\"t2\".\"user_id\"");
  });

  it("keeps existing join without duplicating when table already joined", () => {
    const statement = "SELECT u.id FROM public.users u INNER JOIN public.orders o ON o.user_id = u.id LIMIT 100;";
    const merged = mergeDroppedColumnsIntoStatement(
      statement,
      ["public.orders.id"],
      schemaCompletionData,
    );
    expect(merged.merged).toBe(true);
    expect(merged.sql.match(/JOIN "public"\."orders"/gi)?.length).toBe(1);
    expect(merged.sql).toContain("\"o\".\"id\"");
  });

  it("merges inside CTE outer select", () => {
    const statement = "WITH x AS (SELECT id FROM public.users) SELECT u.id FROM public.users u LIMIT 10;";
    const merged = mergeDroppedColumnsIntoStatement(
      statement,
      ["public.users.email"],
      schemaCompletionData,
    );
    expect(merged.merged).toBe(true);
    expect(merged.sql).toContain("WITH");
    expect(merged.sql).toContain("\"u\".\"email\"");
  });

  it("appends fallback block when relation is not inferable", () => {
    const statement = "SELECT id\nFROM public.users\nLIMIT 100;";
    const merged = mergeDroppedColumnsIntoStatement(
      statement,
      ["audit.events.payload"],
      schemaCompletionData,
    );
    expect(merged.merged).toBe(true);
    expect(merged.sql).toContain("SELECT id");
    expect(merged.sql).toContain("SELECT payload");
    expect(merged.sql).toContain("FROM audit.events");
  });
});
