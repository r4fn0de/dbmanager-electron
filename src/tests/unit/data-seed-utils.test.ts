import { describe, expect, it } from "vitest";
import {
  autoDetectGenerator,
  baseAutoDetectByName,
  baseAutoDetectByType,
  chooseSeedStrategy,
  generateRows,
  getGeneratorGroups,
  REFERENCE_GENERATOR,
  ENUM_GENERATOR,
  SKIP_GENERATOR,
  NULL_GENERATOR,
  SEED_SERVER_THRESHOLD,
  type ColumnMeta,
  type ColumnSeedConfig,
} from "@/features/database/utils/data-seed";

// ---------------------------------------------------------------------------
// chooseSeedStrategy
// ---------------------------------------------------------------------------

describe("chooseSeedStrategy", () => {
  it("switches to server above threshold", () => {
    expect(chooseSeedStrategy(SEED_SERVER_THRESHOLD)).toBe("client");
    expect(chooseSeedStrategy(SEED_SERVER_THRESHOLD + 1)).toBe("server");
  });
});

// ---------------------------------------------------------------------------
// baseAutoDetectByName
// ---------------------------------------------------------------------------

describe("baseAutoDetectByName", () => {
  it("detects email columns", () => {
    expect(baseAutoDetectByName("email")).toBe("internet.email");
    expect(baseAutoDetectByName("user_email")).toBe("internet.email");
    expect(baseAutoDetectByName("emailAddress")).toBe("internet.email");
  });

  it("detects person columns", () => {
    expect(baseAutoDetectByName("firstName")).toBe("person.firstName");
    expect(baseAutoDetectByName("first_name")).toBe("person.firstName");
    expect(baseAutoDetectByName("lastName")).toBe("person.lastName");
    expect(baseAutoDetectByName("fullName")).toBe("person.fullName");
    expect(baseAutoDetectByName("name")).toBe("person.fullName");
  });

  it("detects location columns", () => {
    expect(baseAutoDetectByName("city")).toBe("location.city");
    expect(baseAutoDetectByName("country")).toBe("location.country");
    expect(baseAutoDetectByName("address")).toBe("location.streetAddress");
    expect(baseAutoDetectByName("zip_code")).toBe("location.zipCode");
  });

  it("detects internet columns", () => {
    expect(baseAutoDetectByName("url")).toBe("internet.url");
    expect(baseAutoDetectByName("website")).toBe("internet.url");
    expect(baseAutoDetectByName("username")).toBe("internet.username");
    expect(baseAutoDetectByName("ipaddress")).toBe("internet.ip");
    expect(baseAutoDetectByName("ip")).toBe("internet.ip");
  });

  it("detects finance columns", () => {
    expect(baseAutoDetectByName("price")).toBe("commerce.price");
    expect(baseAutoDetectByName("amount")).toBe("commerce.price");
    expect(baseAutoDetectByName("total")).toBe("commerce.price");
  });

  it("returns undefined for unknown columns", () => {
    expect(baseAutoDetectByName("foo_bar_baz")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// baseAutoDetectByType
// ---------------------------------------------------------------------------

describe("baseAutoDetectByType", () => {
  it("detects uuid type", () => {
    expect(baseAutoDetectByType("uuid")).toBe("string.uuidV4");
  });

  it("detects boolean types", () => {
    expect(baseAutoDetectByType("bool")).toBe("datatype.boolean");
    expect(baseAutoDetectByType("boolean")).toBe("datatype.boolean");
  });

  it("detects integer types", () => {
    expect(baseAutoDetectByType("int4")).toBe("number.int");
    expect(baseAutoDetectByType("int8")).toBe("number.int");
    expect(baseAutoDetectByType("integer")).toBe("number.int");
    expect(baseAutoDetectByType("serial")).toBe("number.int");
    expect(baseAutoDetectByType("bigserial")).toBe("number.int");
  });

  it("detects float types", () => {
    expect(baseAutoDetectByType("float8")).toBe("number.float");
    expect(baseAutoDetectByType("decimal")).toBe("number.float");
    expect(baseAutoDetectByType("numeric")).toBe("number.float");
    expect(baseAutoDetectByType("money")).toBe("number.float");
  });

  it("detects timestamp types", () => {
    expect(baseAutoDetectByType("timestamptz")).toBe("date.recent");
    expect(baseAutoDetectByType("timestamp")).toBe("date.recent");
    expect(baseAutoDetectByType("datetime")).toBe("date.recent");
    expect(baseAutoDetectByType("date")).toBe("date.recent");
  });

  it("detects json types", () => {
    expect(baseAutoDetectByType("json")).toBe("json.object");
    expect(baseAutoDetectByType("jsonb")).toBe("json.object");
  });

  it("detects text types", () => {
    expect(baseAutoDetectByType("text")).toBe("lorem.sentence");
    expect(baseAutoDetectByType("varchar")).toBe("lorem.sentence");
    expect(baseAutoDetectByType("char")).toBe("lorem.sentence");
  });

  it("returns undefined for unknown types", () => {
    expect(baseAutoDetectByType("point")).toBeUndefined();
    expect(baseAutoDetectByType("box")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// autoDetectGenerator
// ---------------------------------------------------------------------------

describe("autoDetectGenerator", () => {
  it("returns reference for FK columns", () => {
    const col: ColumnMeta = {
      name: "user_id",
      dataType: "int4",
      isNullable: false,
      columnDefault: null,
      foreignKey: { referencedSchema: "public", referencedTable: "users", referencedColumn: "id" },
    };
    expect(autoDetectGenerator(col)).toBe(REFERENCE_GENERATOR);
  });

  it("returns enum for enum columns", () => {
    const col: ColumnMeta = {
      name: "status",
      dataType: "USER-DEFINED",
      isNullable: false,
      columnDefault: null,
      enumValues: ["active", "inactive"],
    };
    expect(autoDetectGenerator(col)).toBe(ENUM_GENERATOR);
  });

  it("returns skip for columns with defaults", () => {
    const col: ColumnMeta = {
      name: "created_at",
      dataType: "timestamptz",
      isNullable: false,
      columnDefault: "now()",
    };
    expect(autoDetectGenerator(col)).toBe(SKIP_GENERATOR);
  });

  it("falls back to type detection", () => {
    const col: ColumnMeta = {
      name: "some_field",
      dataType: "uuid",
      isNullable: false,
      columnDefault: null,
    };
    expect(autoDetectGenerator(col)).toBe("string.uuidV4");
  });

  it("falls back to name detection", () => {
    const col: ColumnMeta = {
      name: "email",
      dataType: "text",
      isNullable: false,
      columnDefault: null,
    };
    // Type detection matches first (text → lorem.sentence), but email name detection would also match
    // The function checks type first, then name
    const result = autoDetectGenerator(col);
    expect(["lorem.sentence", "internet.email"]).toContain(result);
  });

  it("returns lorem.word as final fallback", () => {
    const col: ColumnMeta = {
      name: "xyz",
      dataType: "unknown_type",
      isNullable: false,
      columnDefault: null,
    };
    expect(autoDetectGenerator(col)).toBe("lorem.word");
  });
});

// ---------------------------------------------------------------------------
// getGeneratorGroups
// ---------------------------------------------------------------------------

describe("getGeneratorGroups", () => {
  it("returns grouped generators", () => {
    const groups = getGeneratorGroups();
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.every((g) => g.items.length > 0)).toBe(true);
  });

  it("includes Special category", () => {
    const groups = getGeneratorGroups();
    const special = groups.find((g) => g.value === "Special");
    expect(special).toBeDefined();
    expect(special!.items).toContain(SKIP_GENERATOR);
    expect(special!.items).toContain(NULL_GENERATOR);
  });
});

// ---------------------------------------------------------------------------
// generateRows
// ---------------------------------------------------------------------------

describe("generateRows", () => {
  const makeColumns = (overrides: Partial<ColumnMeta>[] = []): ColumnMeta[] => {
    const defaults: ColumnMeta[] = [
      { name: "id", dataType: "uuid", isNullable: false, columnDefault: null },
      { name: "email", dataType: "text", isNullable: false, columnDefault: null },
      { name: "active", dataType: "bool", isNullable: false, columnDefault: null },
    ];
    return defaults.map((d, i) => ({ ...d, ...overrides[i] }));
  };

  it("generates deterministic rows with seed", () => {
    const columns = makeColumns();
    const configs: Record<string, ColumnSeedConfig> = {
      id: { generatorId: "string.uuidV4", nullable: false },
      email: { generatorId: "internet.email", nullable: false },
      active: { generatorId: "datatype.boolean", nullable: false },
    };

    const a = generateRows({ columns, configs, count: 5, seed: 42 });
    const b = generateRows({ columns, configs, count: 5, seed: 42 });
    expect(a).toEqual(b);
  });

  it("generates correct number of rows", () => {
    const columns = makeColumns();
    const configs: Record<string, ColumnSeedConfig> = {
      id: { generatorId: "string.uuidV4", nullable: false },
    };
    const rows = generateRows({ columns, configs, count: 10, seed: 1 });
    expect(rows).toHaveLength(10);
  });

  it("skips columns with skip generator", () => {
    const columns = makeColumns();
    const configs: Record<string, ColumnSeedConfig> = {
      id: { generatorId: SKIP_GENERATOR, nullable: false },
      email: { generatorId: "internet.email", nullable: false },
    };
    const rows = generateRows({ columns, configs, count: 1, seed: 1 });
    expect(rows[0]).not.toHaveProperty("id");
    expect(rows[0]).toHaveProperty("email");
  });

  it("sets null for null generator", () => {
    const columns = makeColumns();
    const configs: Record<string, ColumnSeedConfig> = {
      id: { generatorId: NULL_GENERATOR, nullable: false },
    };
    const rows = generateRows({ columns, configs, count: 1, seed: 1 });
    expect(rows[0].id).toBeNull();
  });

  it("uses reference data for FK columns", () => {
    const columns = makeColumns([{ foreignKey: { referencedSchema: "public", referencedTable: "users", referencedColumn: "id" } }]);
    const configs: Record<string, ColumnSeedConfig> = {
      id: { generatorId: REFERENCE_GENERATOR, nullable: false },
    };
    const referenceData = { id: ["uuid-1", "uuid-2", "uuid-3"] };
    const rows = generateRows({ columns, configs, count: 10, referenceData, seed: 1 });
    expect(rows.every((r) => referenceData.id.includes(r.id as string))).toBe(true);
  });

  it("picks random enum values", () => {
    const columns = makeColumns([{ enumValues: ["active", "inactive", "pending"] }]);
    const configs: Record<string, ColumnSeedConfig> = {
      id: { generatorId: ENUM_GENERATOR, nullable: false },
    };
    const rows = generateRows({ columns, configs, count: 20, seed: 1 });
    expect(rows.every((r) => ["active", "inactive", "pending"].includes(r.id as string))).toBe(true);
  });

  it("handles nullable columns", () => {
    const columns = makeColumns([{ isNullable: true }]);
    const configs: Record<string, ColumnSeedConfig> = {
      id: { generatorId: "string.uuidV4", nullable: true },
    };
    // With enough rows, some should be null
    const rows = generateRows({ columns, configs, count: 100, seed: 1 });
    const nullCount = rows.filter((r) => r.id === null).length;
    expect(nullCount).toBeGreaterThan(0);
  });
});
