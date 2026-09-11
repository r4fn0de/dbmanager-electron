import { describe, expect, test } from "vitest";
import type { ServerVersion } from "@/ipc/db/mysql-client";
import {
  escId,
  mapMySqlType,
  parseServerVersion,
  supportsAddColumnIfNotExists,
  supportsCreateIndexIfNotExists,
  versionGte,
} from "@/ipc/db/mysql-client";

// ---------------------------------------------------------------------------
// escId — MySQL identifier escaping
// ---------------------------------------------------------------------------

describe("escId", () => {
  test("wraps simple identifier in backticks", () => {
    expect(escId("users")).toBe("`users`");
  });

  test("escapes internal backticks by doubling", () => {
    expect(escId("col`with`backticks")).toBe("`col``with``backticks`");
  });

  test("handles identifier with single backtick", () => {
    expect(escId("my`col")).toBe("`my``col`");
  });

  test("handles empty string", () => {
    expect(escId("")).toBe("``");
  });

  test("handles identifier with spaces", () => {
    expect(escId("my column")).toBe("`my column`");
  });

  test("handles reserved words", () => {
    expect(escId("select")).toBe("`select`");
  });

  test("handles schema-qualified name parts separately", () => {
    const qualified = `${escId("my db")}.${escId("my table")}`;
    expect(qualified).toBe("`my db`.`my table`");
  });
});

// ---------------------------------------------------------------------------
// mapMySqlType — MySQL data type → display type
// ---------------------------------------------------------------------------

describe("mapMySqlType", () => {
  test("maps string types", () => {
    expect(mapMySqlType("varchar")).toBe("string");
    expect(mapMySqlType("char")).toBe("string");
    expect(mapMySqlType("text")).toBe("string");
    expect(mapMySqlType("tinytext")).toBe("string");
    expect(mapMySqlType("mediumtext")).toBe("string");
    expect(mapMySqlType("longtext")).toBe("string");
    expect(mapMySqlType("enum")).toBe("string");
    expect(mapMySqlType("set")).toBe("string");
  });

  test("maps numeric types", () => {
    expect(mapMySqlType("int")).toBe("number");
    expect(mapMySqlType("tinyint")).toBe("number");
    expect(mapMySqlType("smallint")).toBe("number");
    expect(mapMySqlType("mediumint")).toBe("number");
    expect(mapMySqlType("bigint")).toBe("number");
    expect(mapMySqlType("float")).toBe("number");
    expect(mapMySqlType("double")).toBe("number");
    expect(mapMySqlType("decimal")).toBe("number");
    expect(mapMySqlType("numeric")).toBe("number");
    expect(mapMySqlType("bit")).toBe("number");
    expect(mapMySqlType("year")).toBe("number");
  });

  test("maps date/time types", () => {
    expect(mapMySqlType("date")).toBe("date");
    expect(mapMySqlType("datetime")).toBe("datetime");
    expect(mapMySqlType("timestamp")).toBe("datetime");
    expect(mapMySqlType("time")).toBe("time");
  });

  test("maps boolean types", () => {
    expect(mapMySqlType("boolean")).toBe("boolean");
    expect(mapMySqlType("bool")).toBe("boolean");
  });

  test("maps json type", () => {
    expect(mapMySqlType("json")).toBe("json");
  });

  test("maps binary types", () => {
    expect(mapMySqlType("blob")).toBe("binary");
    expect(mapMySqlType("tinyblob")).toBe("binary");
    expect(mapMySqlType("mediumblob")).toBe("binary");
    expect(mapMySqlType("longblob")).toBe("binary");
    expect(mapMySqlType("binary")).toBe("binary");
    expect(mapMySqlType("varbinary")).toBe("binary");
  });

  test("case insensitive", () => {
    expect(mapMySqlType("VARCHAR")).toBe("string");
    expect(mapMySqlType("INT")).toBe("number");
    expect(mapMySqlType("JSON")).toBe("json");
  });

  test("unknown type returns 'unknown'", () => {
    expect(mapMySqlType("geometry")).toBe("unknown");
  });

  test("empty string returns 'unknown'", () => {
    expect(mapMySqlType("")).toBe("unknown");
  });

  test("null-like input returns 'unknown'", () => {
    expect(mapMySqlType(null as unknown as string)).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// parseServerVersion — version string → ServerVersion
// ---------------------------------------------------------------------------

describe("parseServerVersion", () => {
  test("parses standard MySQL version", () => {
    const v = parseServerVersion("8.0.35");
    expect(v).toEqual({ isMariaDb: false, major: 8, minor: 0, patch: 35 });
  });

  test("parses MariaDB version with -MariaDB suffix", () => {
    const v = parseServerVersion("10.6.12-MariaDB");
    expect(v).toEqual({ isMariaDb: true, major: 10, minor: 6, patch: 12 });
  });

  test("parses MariaDB version with lowercase suffix", () => {
    const v = parseServerVersion("10.5.2-mariadb");
    expect(v).toEqual({ isMariaDb: true, major: 10, minor: 5, patch: 2 });
  });

  test("parses MySQL 5.7 version", () => {
    const v = parseServerVersion("5.7.44");
    expect(v).toEqual({ isMariaDb: false, major: 5, minor: 7, patch: 44 });
  });

  test("parses MySQL 8.0.29 (IF NOT EXISTS threshold)", () => {
    const v = parseServerVersion("8.0.29");
    expect(v).toEqual({ isMariaDb: false, major: 8, minor: 0, patch: 29 });
  });

  test("returns conservative defaults for unrecognised string", () => {
    const v = parseServerVersion("unknown");
    expect(v).toEqual({ isMariaDb: false, major: 0, minor: 0, patch: 0 });
  });

  test("returns conservative defaults for empty string", () => {
    const v = parseServerVersion("");
    expect(v).toEqual({ isMariaDb: false, major: 0, minor: 0, patch: 0 });
  });

  test("detects MariaDB even in unrecognised version", () => {
    const v = parseServerVersion("mariadb-unknown");
    expect(v.isMariaDb).toBe(true);
    expect(v.major).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// versionGte — version comparison
// ---------------------------------------------------------------------------

describe("versionGte", () => {
  const v8_0_29: ServerVersion = {
    isMariaDb: false,
    major: 8,
    minor: 0,
    patch: 29,
  };
  const v8_0_28: ServerVersion = {
    isMariaDb: false,
    major: 8,
    minor: 0,
    patch: 28,
  };
  const v10_6_12: ServerVersion = {
    isMariaDb: true,
    major: 10,
    minor: 6,
    patch: 12,
  };

  test("exact match returns true", () => {
    expect(versionGte(v8_0_29, 8, 0, 29)).toBe(true);
  });

  test("greater patch returns true", () => {
    expect(versionGte(v8_0_29, 8, 0, 28)).toBe(true);
  });

  test("lesser patch returns false", () => {
    expect(versionGte(v8_0_28, 8, 0, 29)).toBe(false);
  });

  test("greater minor returns true", () => {
    expect(versionGte(v8_0_29, 8, 0, 0)).toBe(true);
  });

  test("lesser minor returns false", () => {
    expect(versionGte(v8_0_28, 8, 1, 0)).toBe(false);
  });

  test("greater major returns true", () => {
    expect(versionGte(v10_6_12, 8, 99, 99)).toBe(true);
  });

  test("lesser major returns false", () => {
    expect(versionGte(v8_0_29, 10, 0, 0)).toBe(false);
  });

  test("zero version is less than any positive target", () => {
    const v0: ServerVersion = {
      isMariaDb: false,
      major: 0,
      minor: 0,
      patch: 0,
    };
    expect(versionGte(v0, 1, 0, 0)).toBe(false);
    expect(versionGte(v0, 0, 0, 1)).toBe(false);
    expect(versionGte(v0, 0, 0, 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// supportsAddColumnIfNotExists
// ---------------------------------------------------------------------------

describe("supportsAddColumnIfNotExists", () => {
  test("MySQL 8.0.29+ supports it", () => {
    const v: ServerVersion = {
      isMariaDb: false,
      major: 8,
      minor: 0,
      patch: 29,
    };
    expect(supportsAddColumnIfNotExists(v, "mysql")).toBe(true);
  });

  test("MySQL 8.0.28 does NOT support it", () => {
    const v: ServerVersion = {
      isMariaDb: false,
      major: 8,
      minor: 0,
      patch: 28,
    };
    expect(supportsAddColumnIfNotExists(v, "mysql")).toBe(false);
  });

  test("MySQL 5.7 does NOT support it", () => {
    const v: ServerVersion = {
      isMariaDb: false,
      major: 5,
      minor: 7,
      patch: 44,
    };
    expect(supportsAddColumnIfNotExists(v, "mysql")).toBe(false);
  });

  test("MariaDB 10.0.2+ supports it", () => {
    const v: ServerVersion = { isMariaDb: true, major: 10, minor: 0, patch: 2 };
    expect(supportsAddColumnIfNotExists(v, "mariadb")).toBe(true);
  });

  test("MariaDB 10.0.1 does NOT support it", () => {
    const v: ServerVersion = { isMariaDb: true, major: 10, minor: 0, patch: 1 };
    expect(supportsAddColumnIfNotExists(v, "mariadb")).toBe(false);
  });

  test("MySQL driver with MariaDB server detected supports it at 10.0.2+", () => {
    // If dbType is "mysql" but the server reports isMariaDb=true, use MariaDB rules
    const v: ServerVersion = { isMariaDb: true, major: 10, minor: 0, patch: 2 };
    expect(supportsAddColumnIfNotExists(v, "mysql")).toBe(true);
  });

  test("unknown version returns false", () => {
    const v: ServerVersion = { isMariaDb: false, major: 0, minor: 0, patch: 0 };
    expect(supportsAddColumnIfNotExists(v, "mysql")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// supportsCreateIndexIfNotExists
// ---------------------------------------------------------------------------

describe("supportsCreateIndexIfNotExists", () => {
  test("MySQL never supports it", () => {
    const v: ServerVersion = {
      isMariaDb: false,
      major: 8,
      minor: 0,
      patch: 35,
    };
    expect(supportsCreateIndexIfNotExists(v, "mysql")).toBe(false);
  });

  test("MySQL 9.x still does not support it", () => {
    const v: ServerVersion = { isMariaDb: false, major: 9, minor: 0, patch: 0 };
    expect(supportsCreateIndexIfNotExists(v, "mysql")).toBe(false);
  });

  test("MariaDB 10.5.2+ supports it", () => {
    const v: ServerVersion = { isMariaDb: true, major: 10, minor: 5, patch: 2 };
    expect(supportsCreateIndexIfNotExists(v, "mariadb")).toBe(true);
  });

  test("MariaDB 10.5.1 does NOT support it", () => {
    const v: ServerVersion = { isMariaDb: true, major: 10, minor: 5, patch: 1 };
    expect(supportsCreateIndexIfNotExists(v, "mariadb")).toBe(false);
  });

  test("MariaDB 10.4.x does NOT support it", () => {
    const v: ServerVersion = {
      isMariaDb: true,
      major: 10,
      minor: 4,
      patch: 99,
    };
    expect(supportsCreateIndexIfNotExists(v, "mariadb")).toBe(false);
  });

  test("MySQL driver with MariaDB server detected supports it at 10.5.2+", () => {
    const v: ServerVersion = { isMariaDb: true, major: 10, minor: 5, patch: 2 };
    expect(supportsCreateIndexIfNotExists(v, "mysql")).toBe(true);
  });

  test("unknown version returns false", () => {
    const v: ServerVersion = { isMariaDb: false, major: 0, minor: 0, patch: 0 };
    expect(supportsCreateIndexIfNotExists(v, "mariadb")).toBe(false);
  });
});
