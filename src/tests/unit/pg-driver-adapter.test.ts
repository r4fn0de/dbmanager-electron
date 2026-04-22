import { describe, expect, test } from "vitest";
import {
  pgEscId,
  buildPgWhereClause,
  mapPgType,
} from "@/ipc/db/pg-driver-adapter";
import type { TableFilter } from "@/ipc/db/types";

// ---------------------------------------------------------------------------
// pgEscId — PostgreSQL identifier escaping
// ---------------------------------------------------------------------------

describe("pgEscId", () => {
  test("wraps simple identifier in double quotes", () => {
    expect(pgEscId("users")).toBe('"users"');
  });

  test("escapes internal double quotes by doubling", () => {
    expect(pgEscId('col"with"quotes')).toBe('"col""with""quotes"');
  });

  test("handles identifier with single double-quote", () => {
    expect(pgEscId('my"col')).toBe('"my""col"');
  });

  test("handles empty string", () => {
    expect(pgEscId("")).toBe('""');
  });

  test("handles identifier with spaces (requires quoting)", () => {
    expect(pgEscId("my column")).toBe('"my column"');
  });

  test("handles reserved words", () => {
    expect(pgEscId("select")).toBe('"select"');
  });

  test("handles schema-qualified name parts separately", () => {
    // Caller is responsible for escaping each part individually
    const qualified = `${pgEscId("my schema")}.${pgEscId("my table")}`;
    expect(qualified).toBe('"my schema"."my table"');
  });
});

// ---------------------------------------------------------------------------
// buildPgWhereClause — filter → WHERE clause with positional params
// ---------------------------------------------------------------------------

describe("buildPgWhereClause", () => {
  test("returns empty for no filters", () => {
    const result = buildPgWhereClause([], 1);
    expect(result.conditions).toEqual([]);
    expect(result.params).toEqual([]);
  });

  test("eq with value produces parameterized condition", () => {
    const result = buildPgWhereClause(
      [{ column: "name", operator: "eq", value: "Alice" }],
      1,
    );
    expect(result.conditions).toEqual(['"name" = $1']);
    expect(result.params).toEqual(["Alice"]);
  });

  test("eq with null value produces IS NULL", () => {
    const result = buildPgWhereClause(
      [{ column: "name", operator: "eq", value: null }],
      1,
    );
    expect(result.conditions).toEqual(['"name" IS NULL']);
    expect(result.params).toEqual([]);
  });

  test("eq with undefined value produces IS NULL", () => {
    const result = buildPgWhereClause(
      [{ column: "name", operator: "eq" }],
      1,
    );
    expect(result.conditions).toEqual(['"name" IS NULL']);
    expect(result.params).toEqual([]);
  });

  test("neq with value produces parameterized condition", () => {
    const result = buildPgWhereClause(
      [{ column: "age", operator: "neq", value: 25 }],
      1,
    );
    expect(result.conditions).toEqual(['"age" != $1']);
    expect(result.params).toEqual([25]);
  });

  test("neq with null value produces IS NOT NULL", () => {
    const result = buildPgWhereClause(
      [{ column: "age", operator: "neq", value: null }],
      1,
    );
    expect(result.conditions).toEqual(['"age" IS NOT NULL']);
    expect(result.params).toEqual([]);
  });

  test("contains wraps value with % wildcards and uses ILIKE", () => {
    const result = buildPgWhereClause(
      [{ column: "name", operator: "contains", value: "li" }],
      1,
    );
    expect(result.conditions).toEqual(['"name"::text ILIKE $1']);
    expect(result.params).toEqual(["%li%"]);
  });

  test("starts_with appends % wildcard", () => {
    const result = buildPgWhereClause(
      [{ column: "name", operator: "starts_with", value: "Al" }],
      1,
    );
    expect(result.conditions).toEqual(['"name"::text ILIKE $1']);
    expect(result.params).toEqual(["Al%"]);
  });

  test("ends_with prepends % wildcard", () => {
    const result = buildPgWhereClause(
      [{ column: "name", operator: "ends_with", value: "ce" }],
      1,
    );
    expect(result.conditions).toEqual(['"name"::text ILIKE $1']);
    expect(result.params).toEqual(["%ce"]);
  });

  test("gt / gte / lt / lte produce correct operators", () => {
    const result = buildPgWhereClause(
      [
        { column: "a", operator: "gt", value: 1 },
        { column: "b", operator: "gte", value: 2 },
        { column: "c", operator: "lt", value: 3 },
        { column: "d", operator: "lte", value: 4 },
      ],
      3, // startIdx=3 like data queries ($1=LIMIT, $2=OFFSET)
    );
    expect(result.conditions).toEqual([
      '"a" > $3',
      '"b" >= $4',
      '"c" < $5',
      '"d" <= $6',
    ]);
    expect(result.params).toEqual([1, 2, 3, 4]);
  });

  test("is_null produces condition with no params", () => {
    const result = buildPgWhereClause(
      [{ column: "deleted_at", operator: "is_null" }],
      1,
    );
    expect(result.conditions).toEqual(['"deleted_at" IS NULL']);
    expect(result.params).toEqual([]);
  });

  test("is_not_null produces condition with no params", () => {
    const result = buildPgWhereClause(
      [{ column: "deleted_at", operator: "is_not_null" }],
      1,
    );
    expect(result.conditions).toEqual(['"deleted_at" IS NOT NULL']);
    expect(result.params).toEqual([]);
  });

  test("default operator falls back to ILIKE contains", () => {
    const result = buildPgWhereClause(
      [{ column: "name", operator: "unknown_op" as TableFilter["operator"], value: "test" }],
      1,
    );
    expect(result.conditions).toEqual(['"name"::text ILIKE $1']);
    expect(result.params).toEqual(["%test%"]);
  });

  test("startIdx offsets parameter indices correctly", () => {
    const result = buildPgWhereClause(
      [
        { column: "a", operator: "eq", value: 1 },
        { column: "b", operator: "eq", value: 2 },
      ],
      3, // data query: $1=LIMIT, $2=OFFSET, filters start at $3
    );
    expect(result.conditions).toEqual(['"a" = $3', '"b" = $4']);
    expect(result.params).toEqual([1, 2]);
  });

  test("startIdx=1 for count queries", () => {
    const result = buildPgWhereClause(
      [{ column: "status", operator: "eq", value: "active" }],
      1,
    );
    expect(result.conditions).toEqual(['"status" = $1']);
    expect(result.params).toEqual(["active"]);
  });

  test("mixed operators produce correct parameter indices", () => {
    const result = buildPgWhereClause(
      [
        { column: "name", operator: "contains", value: "al" },
        { column: "age", operator: "gte", value: 18 },
        { column: "active", operator: "is_null" },
        { column: "role", operator: "eq", value: "admin" },
      ],
      1,
    );
    // contains→$1 (param), gte→$2 (param), is_null→no param, eq→$3 (param)
    expect(result.conditions).toEqual([
      '"name"::text ILIKE $1',
      '"age" >= $2',
      '"active" IS NULL',
      '"role" = $3',
    ]);
    expect(result.params).toEqual(["%al%", 18, "admin"]);
  });

  test("contains with empty value wraps %%", () => {
    const result = buildPgWhereClause(
      [{ column: "name", operator: "contains", value: "" }],
      1,
    );
    expect(result.params).toEqual(["%%"]);
  });

  test("contains with undefined value wraps %%", () => {
    const result = buildPgWhereClause(
      [{ column: "name", operator: "contains" }],
      1,
    );
    expect(result.params).toEqual(["%%"]);
  });
});

// ---------------------------------------------------------------------------
// mapPgType — pg dataTypeID → display type
// ---------------------------------------------------------------------------

describe("mapPgType", () => {
  test("maps boolean (16)", () => {
    expect(mapPgType(16)).toBe("boolean");
  });

  test("maps binary/bytea (17)", () => {
    expect(mapPgType(17)).toBe("binary");
  });

  test("maps int8 (20), int2 (21), int4 (23) to number", () => {
    expect(mapPgType(20)).toBe("number");
    expect(mapPgType(21)).toBe("number");
    expect(mapPgType(23)).toBe("number");
  });

  test("maps text (25) to string", () => {
    expect(mapPgType(25)).toBe("string");
  });

  test("maps json (114) and json[] (199) to json", () => {
    expect(mapPgType(114)).toBe("json");
    expect(mapPgType(199)).toBe("json");
  });

  test("maps float4 (700) and float8 (701) to number", () => {
    expect(mapPgType(700)).toBe("number");
    expect(mapPgType(701)).toBe("number");
  });

  test("maps varchar (1043) to string", () => {
    expect(mapPgType(1043)).toBe("string");
  });

  test("maps date (1082) to date", () => {
    expect(mapPgType(1082)).toBe("date");
  });

  test("maps time (1083) and timetz (1266) to time", () => {
    expect(mapPgType(1083)).toBe("time");
    expect(mapPgType(1266)).toBe("time");
  });

  test("maps timestamp (1114) and timestamptz (1184) to datetime", () => {
    expect(mapPgType(1114)).toBe("datetime");
    expect(mapPgType(1184)).toBe("datetime");
  });

  test("maps numeric (1700) and numeric[] (1231) to number", () => {
    expect(mapPgType(1700)).toBe("number");
    expect(mapPgType(1231)).toBe("number");
  });

  test("maps uuid (2950) to uuid", () => {
    expect(mapPgType(2950)).toBe("uuid");
  });

  test("maps jsonb (3802) to json", () => {
    expect(mapPgType(3802)).toBe("json");
  });

  test("unknown type returns 'unknown'", () => {
    expect(mapPgType(9999)).toBe("unknown");
  });
});
