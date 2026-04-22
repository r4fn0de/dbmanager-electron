/**
 * kysely-queries.test.ts — Verifies that Kysely query builder produces
 * the expected SQL for schema introspection queries.
 *
 * Uses Kysely's .compile() method which returns { sql, parameters } without
 * executing the query — no real database connection needed.
 */
import { describe, expect, test } from "vitest";
import { Kysely, PostgresDialect, MysqlDialect } from "kysely";
import type { PgDatabase, MysqlDatabase } from "@/ipc/db/kysely-types";

// ---------------------------------------------------------------------------
// Helpers — create lightweight Kysely instances for compilation-only testing
// ---------------------------------------------------------------------------

/**
 * Create a PG Kysely instance with a dummy pool (never actually connects).
 * We only call .compile() on queries — no execution happens.
 */
function createPgKyselyForCompile(): Kysely<PgDatabase> {
  return new Kysely<PgDatabase>({
    dialect: new PostgresDialect({
      pool: {} as never, // compile() doesn't use the pool
    }),
  });
}

/**
 * Create a MySQL Kysely instance with a dummy pool.
 */
function createMysqlKyselyForCompile(): Kysely<MysqlDatabase> {
  return new Kysely<MysqlDatabase>({
    dialect: new MysqlDialect({
      pool: {} as never, // compile() doesn't use the pool
    }),
  });
}

// ---------------------------------------------------------------------------
// PostgreSQL schema introspection queries
// ---------------------------------------------------------------------------

describe("PostgreSQL Kysely queries — SQL compilation", () => {
  const db = createPgKyselyForCompile();

  test("schemata query compiles with correct WHERE/ORDER BY", () => {
    const compiled = db
      .selectFrom("schemata")
      .select("schema_name")
      .where("schema_name", "not like", "pg_%")
      .where("schema_name", "!=", "information_schema")
      .orderBy("schema_name")
      .compile();

    expect(compiled.sql).toContain("from");
    expect(compiled.sql).toContain("schemata");
    expect(compiled.sql).toContain("schema_name");
    expect(compiled.sql).toContain("not like");
    expect(compiled.sql).toContain("order by");
    expect(compiled.parameters).toEqual(["pg_%", "information_schema"]);
  });

  test("columns query compiles with all selected fields", () => {
    const compiled = db
      .selectFrom("columns")
      .select([
        "table_schema",
        "table_name",
        "column_name",
        "data_type",
        "udt_name",
        "is_nullable",
        "column_default",
      ])
      .where("table_schema", "not like", "pg_%")
      .where("table_schema", "!=", "information_schema")
      .orderBy("table_schema")
      .orderBy("table_name")
      .orderBy("ordinal_position")
      .compile();

    expect(compiled.sql).toContain("columns");
    expect(compiled.sql).toContain("table_schema");
    expect(compiled.sql).toContain("table_name");
    expect(compiled.sql).toContain("column_name");
    expect(compiled.sql).toContain("data_type");
    expect(compiled.sql).toContain("udt_name");
    expect(compiled.sql).toContain("is_nullable");
    expect(compiled.sql).toContain("column_default");
    expect(compiled.sql).toContain("order by");
    expect(compiled.parameters).toEqual(["pg_%", "information_schema"]);
  });

  test("pg_indexes query compiles with schemaname filter", () => {
    const compiled = db
      .selectFrom("pg_indexes")
      .select(["schemaname", "tablename", "indexname", "indexdef"])
      .where("schemaname", "not like", "pg_%")
      .where("schemaname", "!=", "information_schema")
      .compile();

    expect(compiled.sql).toContain("pg_indexes");
    expect(compiled.sql).toContain("schemaname");
    expect(compiled.sql).toContain("tablename");
    expect(compiled.sql).toContain("indexname");
    expect(compiled.sql).toContain("indexdef");
    expect(compiled.parameters).toEqual(["pg_%", "information_schema"]);
  });

  test("FK query compiles with correct JOINs and schema filters", () => {
    const compiled = db
      .selectFrom("table_constraints as tc")
      .innerJoin("key_column_usage as kcu", (join) =>
        join
          .onRef("tc.constraint_name", "=", "kcu.constraint_name")
          .onRef("tc.constraint_schema", "=", "kcu.constraint_schema"),
      )
      .innerJoin("constraint_column_usage as ccu", (join) =>
        join
          .onRef("ccu.constraint_name", "=", "tc.constraint_name")
          .onRef("ccu.constraint_schema", "=", "tc.constraint_schema"),
      )
      .select([
        "tc.table_schema",
        "tc.table_name",
        "kcu.column_name",
        "ccu.table_schema as foreign_table_schema",
        "ccu.table_name as foreign_table_name",
        "ccu.column_name as foreign_column_name",
      ])
      .where("tc.constraint_type", "=", "FOREIGN KEY")
      .where("tc.table_schema", "not like", "pg_%")
      .where("tc.table_schema", "!=", "information_schema")
      .compile();

    // Verify JOIN clauses
    expect(compiled.sql).toContain("inner join");
    expect(compiled.sql).toContain("key_column_usage");
    expect(compiled.sql).toContain("constraint_column_usage");

    // Verify constraint_schema join condition (prevents cross-schema collisions)
    expect(compiled.sql).toContain("constraint_schema");

    // Verify WHERE filters — Kysely parameterizes ALL values (including
    // "FOREIGN KEY", "pg_%", "information_schema") so they appear in
    // the parameters array, not inline in the SQL text.
    expect(compiled.sql).toContain("not like");
    expect(compiled.sql).toContain("!=");

    // Verify all parameters — FOREIGN KEY, pg_%, information_schema
    expect(compiled.parameters).toEqual(["FOREIGN KEY", "pg_%", "information_schema"]);
  });

  test("PK query compiles for specific schema.table", () => {
    const compiled = db
      .selectFrom("table_constraints as tc")
      .innerJoin("key_column_usage as kcu", (join) =>
        join
          .onRef("tc.constraint_name", "=", "kcu.constraint_name")
          .onRef("tc.constraint_schema", "=", "kcu.constraint_schema"),
      )
      .select("kcu.column_name")
      .where("tc.constraint_type", "=", "PRIMARY KEY")
      .where("tc.table_schema", "=", "public")
      .where("tc.table_name", "=", "users")
      .compile();

    // Kysely parameterizes all values — verify via parameters array
    expect(compiled.parameters).toEqual(["PRIMARY KEY", "public", "users"]);
  });

  test("tables query compiles for schema summary", () => {
    const compiled = db
      .selectFrom("tables")
      .select(["table_schema", "table_name"])
      .where("table_schema", "not like", "pg_%")
      .where("table_schema", "!=", "information_schema")
      .orderBy("table_schema")
      .orderBy("table_name")
      .compile();

    expect(compiled.sql).toContain("tables");
    expect(compiled.sql).toContain("table_schema");
    expect(compiled.sql).toContain("table_name");
    expect(compiled.sql).toContain("order by");
    expect(compiled.parameters).toEqual(["pg_%", "information_schema"]);
  });
});

// ---------------------------------------------------------------------------
// MySQL/MariaDB schema introspection queries
// ---------------------------------------------------------------------------

describe("MySQL Kysely queries — SQL compilation", () => {
  const db = createMysqlKyselyForCompile();
  const excludedSchemas = ["mysql", "information_schema", "performance_schema", "sys"];

  test("schemata query compiles with NOT IN filter", () => {
    const compiled = db
      .selectFrom("schemata")
      .select("SCHEMA_NAME")
      .where("SCHEMA_NAME", "not in", excludedSchemas)
      .orderBy("SCHEMA_NAME")
      .compile();

    expect(compiled.sql).toContain("schemata");
    expect(compiled.sql).toContain("SCHEMA_NAME");
    expect(compiled.sql).toContain("not in");
    expect(compiled.sql).toContain("order by");
    // 4 excluded schemas as parameters
    expect(compiled.parameters).toEqual(excludedSchemas);
  });

  test("columns query compiles with NOT IN and ORDINAL_POSITION ordering", () => {
    const compiled = db
      .selectFrom("columns")
      .select([
        "TABLE_SCHEMA",
        "TABLE_NAME",
        "COLUMN_NAME",
        "DATA_TYPE",
        "COLUMN_TYPE",
        "IS_NULLABLE",
        "COLUMN_DEFAULT",
      ])
      .where("TABLE_SCHEMA", "not in", excludedSchemas)
      .orderBy("TABLE_SCHEMA")
      .orderBy("TABLE_NAME")
      .orderBy("ORDINAL_POSITION")
      .compile();

    expect(compiled.sql).toContain("columns");
    expect(compiled.sql).toContain("TABLE_SCHEMA");
    expect(compiled.sql).toContain("TABLE_NAME");
    expect(compiled.sql).toContain("COLUMN_NAME");
    expect(compiled.sql).toContain("DATA_TYPE");
    expect(compiled.sql).toContain("COLUMN_TYPE");
    expect(compiled.sql).toContain("IS_NULLABLE");
    expect(compiled.sql).toContain("COLUMN_DEFAULT");
    expect(compiled.sql).toContain("ORDINAL_POSITION");
    expect(compiled.sql).toContain("not in");
  });

  test("statistics query compiles for indexes", () => {
    const compiled = db
      .selectFrom("statistics")
      .select([
        "TABLE_SCHEMA",
        "TABLE_NAME",
        "INDEX_NAME",
        "COLUMN_NAME",
        "NON_UNIQUE",
      ])
      .where("TABLE_SCHEMA", "not in", excludedSchemas)
      .orderBy("TABLE_SCHEMA")
      .orderBy("TABLE_NAME")
      .orderBy("INDEX_NAME")
      .orderBy("SEQ_IN_INDEX")
      .compile();

    expect(compiled.sql).toContain("statistics");
    expect(compiled.sql).toContain("INDEX_NAME");
    expect(compiled.sql).toContain("NON_UNIQUE");
    expect(compiled.sql).toContain("SEQ_IN_INDEX");
  });

  test("FK query compiles with table_constraints join for CONSTRAINT_TYPE filter", () => {
    const compiled = db
      .selectFrom("key_column_usage as kcu")
      .innerJoin("table_constraints as tc", (join) =>
        join
          .onRef("tc.CONSTRAINT_NAME", "=", "kcu.CONSTRAINT_NAME")
          .onRef("tc.CONSTRAINT_SCHEMA", "=", "kcu.CONSTRAINT_SCHEMA"),
      )
      .select([
        "kcu.CONSTRAINT_SCHEMA",
        "kcu.TABLE_NAME",
        "kcu.COLUMN_NAME",
        "kcu.REFERENCED_TABLE_SCHEMA",
        "kcu.REFERENCED_TABLE_NAME",
        "kcu.REFERENCED_COLUMN_NAME",
        "kcu.CONSTRAINT_NAME",
      ])
      .where("tc.CONSTRAINT_TYPE", "=", "FOREIGN KEY")
      .where("kcu.REFERENCED_TABLE_SCHEMA", "is not", null)
      .where("kcu.TABLE_SCHEMA", "not in", excludedSchemas)
      .compile();

    // Verify JOIN with table_constraints (ensures FK-only filtering)
    expect(compiled.sql).toContain("inner join");
    expect(compiled.sql).toContain("table_constraints");

    // Verify CONSTRAINT_SCHEMA join condition
    expect(compiled.sql).toContain("CONSTRAINT_SCHEMA");

    // Verify CONSTRAINT_TYPE = FOREIGN KEY — parameterized by Kysely
    expect(compiled.parameters[0]).toBe("FOREIGN KEY");

    // Verify NOT IN filter on TABLE_SCHEMA
    expect(compiled.sql).toContain("not in");
  });

  test("PK query compiles for specific schema.table", () => {
    const compiled = db
      .selectFrom("key_column_usage")
      .select("COLUMN_NAME")
      .where("TABLE_SCHEMA", "=", "mydb")
      .where("TABLE_NAME", "=", "users")
      .where("CONSTRAINT_NAME", "=", "PRIMARY")
      .orderBy("ORDINAL_POSITION")
      .compile();

    expect(compiled.sql).toContain("key_column_usage");
    expect(compiled.sql).toContain("COLUMN_NAME");
    // Kysely parameterizes all values — verify via parameters array
    expect(compiled.parameters).toEqual(["mydb", "users", "PRIMARY"]);
  });

  test("tables query compiles for schema summary", () => {
    const compiled = db
      .selectFrom("tables")
      .select(["TABLE_SCHEMA", "TABLE_NAME"])
      .where("TABLE_SCHEMA", "not in", excludedSchemas)
      .orderBy("TABLE_SCHEMA")
      .orderBy("TABLE_NAME")
      .compile();

    expect(compiled.sql).toContain("tables");
    expect(compiled.sql).toContain("TABLE_SCHEMA");
    expect(compiled.sql).toContain("TABLE_NAME");
    expect(compiled.sql).toContain("not in");
    expect(compiled.parameters).toEqual(excludedSchemas);
  });
});
