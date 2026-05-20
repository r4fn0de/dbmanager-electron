import { describe, expect, it } from "vitest";
import { buildExportFileName, serializeExport } from "@/features/database/utils/data-export";

const payload = {
  metadata: {
    scope: "table" as const,
    schema: "public",
    table: "users",
    generatedAt: "2026-05-20T00:00:00.000Z",
  },
  layers: {
    schema: [{ type: "table" as const, schema: "public", name: "users", sql: "CREATE TABLE users(id int);" }],
    indexes: [{ type: "index" as const, schema: "public", name: "users_idx", sql: "CREATE INDEX users_idx ON users(id);" }],
    data: [{ schema: "public", table: "users", columns: ["id", "name"], rows: [{ id: 1, name: "Alice" }] }],
  },
};

describe("data export utils", () => {
  it("builds stable export filename", () => {
    expect(buildExportFileName(payload, "sql")).toBe("db-export-public.users.sql");
  });

  it("serializes sql with inserts", () => {
    const sql = serializeExport(payload, "sql");
    expect(sql).toContain("CREATE TABLE users");
    expect(sql).toContain("INSERT INTO \"public\".\"users\"");
  });

  it("serializes markdown with metadata", () => {
    const md = serializeExport(payload, "markdown");
    expect(md).toContain("Scope: table");
    expect(md).toContain("public.users");
  });
});
