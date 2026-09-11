import { describe, expect, it } from "vitest";
import {
  buildExportFileName,
  serializeExport,
} from "@/features/database/utils/data-export";

const payload = {
  layers: {
    data: [
      {
        columns: ["id", "name"],
        rows: [{ id: 1, name: "Alice" }],
        schema: "public",
        table: "users",
      },
    ],
    indexes: [
      {
        name: "users_idx",
        schema: "public",
        sql: "CREATE INDEX users_idx ON users(id);",
        type: "index" as const,
      },
    ],
    schema: [
      {
        name: "users",
        schema: "public",
        sql: "CREATE TABLE users(id int);",
        type: "table" as const,
      },
    ],
  },
  metadata: {
    generatedAt: "2026-05-20T00:00:00.000Z",
    schema: "public",
    scope: "table" as const,
    table: "users",
  },
};

describe("data export utils", () => {
  it("builds stable export filename", () => {
    expect(buildExportFileName(payload, "sql")).toBe(
      "db-export-public.users.sql"
    );
  });

  it("serializes sql with inserts", () => {
    const sql = serializeExport(payload, "sql");
    expect(sql).toContain("CREATE TABLE users");
    expect(sql).toContain('INSERT INTO "public"."users"');
  });

  it("serializes markdown with metadata", () => {
    const md = serializeExport(payload, "markdown");
    expect(md).toContain("Scope: table");
    expect(md).toContain("public.users");
  });
});
