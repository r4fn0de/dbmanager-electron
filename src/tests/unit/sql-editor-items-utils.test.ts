import { describe, expect, it } from "vitest";
import {
  buildItemsTree,
  buildSmartSqlFromColumnRefs,
  filterItemsTree,
  makeQualifiedColumnRef,
  makeTableSelectSql,
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
    expect(makeQualifiedColumnRef("public", "users", "email")).toBe(
      "public.users.email",
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
});
