import { Faker, pt_BR } from "@faker-js/faker";

// Module-level faker for generators (non-deterministic, just for defaults)
const sharedFaker = new Faker({ locale: [pt_BR] });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GeneratorDef {
  category: string;
  generate: () => unknown;
  label: string;
}

export type GeneratorMap = Record<string, GeneratorDef>;

export interface ColumnSeedConfig {
  customExpression?: string;
  generatorId: string;
  nullable: boolean;
}

export interface ColumnMeta {
  columnDefault: string | null;
  dataType: string;
  enumValues?: string[];
  foreignKey?: {
    referencedSchema: string;
    referencedTable: string;
    referencedColumn: string;
  };
  isNullable: boolean;
  isPrimaryKey?: boolean;
  isUnique?: boolean;
  name: string;
  udtName?: string | null;
}

export interface GenerateRowsInput {
  columns: ColumnMeta[];
  configs: Record<string, ColumnSeedConfig>;
  count: number;
  referenceData?: Record<string, unknown[]>;
  seed?: number;
}

// ---------------------------------------------------------------------------
// Special generator IDs
// ---------------------------------------------------------------------------

export const SKIP_GENERATOR = "__skip__";
export const NULL_GENERATOR = "__null__";
export const REFERENCE_GENERATOR = "__reference__";
export const ENUM_GENERATOR = "__enum__";
export const CUSTOM_GENERATOR = "__custom__";

// ---------------------------------------------------------------------------
// Base generators — shared across all dialects
// ---------------------------------------------------------------------------

export const BASE_GENERATORS: GeneratorMap = {
  // Special
  [SKIP_GENERATOR]: {
    category: "Special",
    generate: () => undefined,
    label: "Use default",
  },
  [NULL_GENERATOR]: {
    category: "Special",
    generate: () => null,
    label: "NULL",
  },
  [REFERENCE_GENERATOR]: {
    category: "Special",
    generate: () => undefined,
    label: "FK reference",
  },
  [ENUM_GENERATOR]: {
    category: "Special",
    generate: () => undefined,
    label: "Enum value",
  },
  [CUSTOM_GENERATOR]: {
    category: "Special",
    generate: () => undefined,
    label: "Custom SQL",
  },
  "color.human": {
    category: "Other",
    generate: () => sharedFaker.color.human(),
    label: "Color Name",
  },
  "commerce.department": {
    category: "Commerce",
    generate: () => sharedFaker.commerce.department(),
    label: "Department",
  },

  // Commerce
  "commerce.price": {
    category: "Commerce",
    generate: () => Number(sharedFaker.commerce.price()),
    label: "Price",
  },
  "commerce.productDescription": {
    category: "Commerce",
    generate: () => sharedFaker.commerce.productDescription(),
    label: "Product Desc",
  },
  "commerce.productName": {
    category: "Commerce",
    generate: () => sharedFaker.commerce.productName(),
    label: "Product Name",
  },
  "company.name": {
    category: "Commerce",
    generate: () => sharedFaker.company.name(),
    label: "Company Name",
  },

  // Boolean
  "datatype.boolean": {
    category: "Boolean",
    generate: () => sharedFaker.datatype.boolean(),
    label: "Boolean",
  },
  "date.birthdate": {
    category: "Date",
    generate: () => sharedFaker.date.birthdate().toISOString(),
    label: "Birthdate",
  },
  "date.future": {
    category: "Date",
    generate: () => sharedFaker.date.future().toISOString(),
    label: "Future Date",
  },
  "date.month": {
    category: "Date",
    generate: () => sharedFaker.date.month(),
    label: "Month Name",
  },
  "date.past": {
    category: "Date",
    generate: () => sharedFaker.date.past().toISOString(),
    label: "Past Date",
  },

  // Date
  "date.recent": {
    category: "Date",
    generate: () => sharedFaker.date.recent().toISOString(),
    label: "Recent Date",
  },
  "date.soon": {
    category: "Date",
    generate: () => sharedFaker.date.soon().toISOString(),
    label: "Soon Date",
  },
  "date.time": {
    category: "Date",
    generate: () => sharedFaker.date.recent().toISOString().slice(11, 19),
    label: "Time",
  },
  "date.weekday": {
    category: "Date",
    generate: () => sharedFaker.date.weekday(),
    label: "Weekday",
  },

  // Finance
  "finance.amount": {
    category: "Finance",
    generate: () => Number(sharedFaker.finance.amount()),
    label: "Amount",
  },
  "finance.creditCardNumber": {
    category: "Finance",
    generate: () => sharedFaker.finance.creditCardNumber(),
    label: "Credit Card",
  },
  "finance.currencyCode": {
    category: "Finance",
    generate: () => sharedFaker.finance.currencyCode(),
    label: "Currency Code",
  },
  "finance.iban": {
    category: "Finance",
    generate: () => sharedFaker.finance.iban(),
    label: "IBAN",
  },
  "image.avatar": {
    category: "Internet",
    generate: () => sharedFaker.image.avatar(),
    label: "Avatar URL",
  },
  "image.url": {
    category: "Internet",
    generate: () => sharedFaker.image.url(),
    label: "Image URL",
  },
  "internet.displayName": {
    category: "Internet",
    generate: () => sharedFaker.internet.displayName(),
    label: "Display Name",
  },
  "internet.domainName": {
    category: "Internet",
    generate: () => sharedFaker.internet.domainName(),
    label: "Domain Name",
  },

  // Internet
  "internet.email": {
    category: "Internet",
    generate: () => sharedFaker.internet.email(),
    label: "Email",
  },
  "internet.ip": {
    category: "Internet",
    generate: () => sharedFaker.internet.ip(),
    label: "IPv4 Address",
  },
  "internet.ipv6": {
    category: "Internet",
    generate: () => sharedFaker.internet.ipv6(),
    label: "IPv6 Address",
  },
  "internet.mac": {
    category: "Internet",
    generate: () => sharedFaker.internet.mac(),
    label: "MAC Address",
  },
  "internet.password": {
    category: "Internet",
    generate: () => sharedFaker.internet.password(),
    label: "Password",
  },
  "internet.port": {
    category: "Internet",
    generate: () => sharedFaker.internet.port(),
    label: "Port",
  },
  "internet.url": {
    category: "Internet",
    generate: () => sharedFaker.internet.url(),
    label: "URL",
  },
  "internet.userAgent": {
    category: "Internet",
    generate: () => sharedFaker.internet.userAgent(),
    label: "User Agent",
  },
  "internet.username": {
    category: "Internet",
    generate: () => sharedFaker.internet.username(),
    label: "Username",
  },
  "json.object": {
    category: "Other",
    generate: () => ({
      key: sharedFaker.lorem.word(),
      value: sharedFaker.number.int({ max: 100 }),
    }),
    label: "JSON Object",
  },

  // Location
  "location.city": {
    category: "Location",
    generate: () => sharedFaker.location.city(),
    label: "City",
  },
  "location.country": {
    category: "Location",
    generate: () => sharedFaker.location.country(),
    label: "Country",
  },
  "location.countryCode": {
    category: "Location",
    generate: () => sharedFaker.location.countryCode(),
    label: "Country Code",
  },
  "location.latitude": {
    category: "Location",
    generate: () => sharedFaker.location.latitude(),
    label: "Latitude",
  },
  "location.longitude": {
    category: "Location",
    generate: () => sharedFaker.location.longitude(),
    label: "Longitude",
  },
  "location.state": {
    category: "Location",
    generate: () => sharedFaker.location.state(),
    label: "State",
  },
  "location.streetAddress": {
    category: "Location",
    generate: () => sharedFaker.location.streetAddress(),
    label: "Street Address",
  },
  "location.zipCode": {
    category: "Location",
    generate: () => sharedFaker.location.zipCode(),
    label: "Zip Code",
  },
  "lorem.lines": {
    category: "Text",
    generate: () => sharedFaker.lorem.lines(),
    label: "Lines",
  },
  "lorem.paragraph": {
    category: "Text",
    generate: () => sharedFaker.lorem.paragraph(),
    label: "Paragraph",
  },
  "lorem.sentence": {
    category: "Text",
    generate: () => sharedFaker.lorem.sentence(),
    label: "Sentence",
  },
  "lorem.slug": {
    category: "Text",
    generate: () => sharedFaker.lorem.slug(),
    label: "Slug",
  },
  "lorem.text": {
    category: "Text",
    generate: () => sharedFaker.lorem.text(),
    label: "Text Block",
  },

  // Text
  "lorem.word": {
    category: "Text",
    generate: () => sharedFaker.lorem.word(),
    label: "Word",
  },
  "number.bigInt": {
    category: "Number",
    generate: () =>
      String(sharedFaker.number.bigInt({ max: 9007199254740991n })),
    label: "Big Integer",
  },
  "number.float": {
    category: "Number",
    generate: () =>
      sharedFaker.number.float({ fractionDigits: 2, max: 10_000 }),
    label: "Float",
  },

  // Number
  "number.int": {
    category: "Number",
    generate: () => sharedFaker.number.int({ max: 10_000 }),
    label: "Integer",
  },
  "number.percentage": {
    category: "Number",
    generate: () =>
      sharedFaker.number.float({ fractionDigits: 2, max: 100, min: 0 }),
    label: "Percentage",
  },

  // Person
  "person.firstName": {
    category: "Person",
    generate: () => sharedFaker.person.firstName(),
    label: "First Name",
  },
  "person.fullName": {
    category: "Person",
    generate: () => sharedFaker.person.fullName(),
    label: "Full Name",
  },
  "person.gender": {
    category: "Person",
    generate: () => sharedFaker.person.gender(),
    label: "Gender",
  },
  "person.jobTitle": {
    category: "Person",
    generate: () => sharedFaker.person.jobTitle(),
    label: "Job Title",
  },
  "person.lastName": {
    category: "Person",
    generate: () => sharedFaker.person.lastName(),
    label: "Last Name",
  },

  // Other
  "phone.number": {
    category: "Other",
    generate: () => sharedFaker.phone.number(),
    label: "Phone Number",
  },
  "string.alpha": {
    category: "Text",
    generate: () => sharedFaker.string.alpha(10),
    label: "Alpha String",
  },
  "string.alphanumeric": {
    category: "Text",
    generate: () => sharedFaker.string.alphanumeric(10),
    label: "Alphanumeric",
  },
  "string.hexadecimal": {
    category: "Text",
    generate: () => sharedFaker.string.hexadecimal({ length: 16 }),
    label: "Hex String",
  },
  "string.nanoid": {
    category: "ID",
    generate: () => sharedFaker.string.nanoid(),
    label: "Nano ID",
  },
  "string.ulid": {
    category: "ID",
    generate: () => sharedFaker.string.ulid(),
    label: "ULID",
  },

  // ID
  "string.uuidV4": {
    category: "ID",
    generate: () => sharedFaker.string.uuid({ version: 4 }),
    label: "UUID v4",
  },
  "string.uuidV7": {
    category: "ID",
    generate: () => sharedFaker.string.uuid({ version: 7 }),
    label: "UUID v7",
  },
  "system.fileExt": {
    category: "System",
    generate: () => sharedFaker.system.fileExt(),
    label: "File Extension",
  },

  // System
  "system.fileName": {
    category: "System",
    generate: () => sharedFaker.system.fileName(),
    label: "File Name",
  },
  "system.mimeType": {
    category: "System",
    generate: () => sharedFaker.system.mimeType(),
    label: "MIME Type",
  },
  "system.semver": {
    category: "System",
    generate: () => sharedFaker.system.semver(),
    label: "Semver",
  },
};

// ---------------------------------------------------------------------------
// Auto-detect by column name
// ---------------------------------------------------------------------------

export function baseAutoDetectByName(name: string): string | undefined {
  const n = name.toLowerCase().replaceAll("_", "");

  if (n.includes("email")) {
    return "internet.email";
  }
  if (n === "firstname") {
    return "person.firstName";
  }
  if (n === "lastname" || n === "surname") {
    return "person.lastName";
  }
  if (n === "fullname" || n === "name") {
    return "person.fullName";
  }
  if (n.includes("phone") || n.includes("mobile") || n.includes("tel")) {
    return "phone.number";
  }
  if (n.includes("url") || n.includes("website") || n.includes("link")) {
    return "internet.url";
  }
  if (
    n.includes("avatar") ||
    n.includes("image") ||
    n.includes("photo") ||
    n.includes("picture")
  ) {
    return "image.url";
  }
  if (n.includes("username") || n === "login") {
    return "internet.username";
  }
  if (n.includes("title") || n.includes("subject")) {
    return "lorem.sentence";
  }
  if (
    n.includes("description") ||
    n.includes("content") ||
    n.includes("bio") ||
    n.includes("summary")
  ) {
    return "lorem.paragraph";
  }
  if (n.includes("city")) {
    return "location.city";
  }
  if (n.includes("countrycode")) {
    return "location.countryCode";
  }
  if (n.includes("country")) {
    return "location.country";
  }
  if (n.includes("ipaddress") || n === "ip") {
    return "internet.ip";
  }
  if (n.includes("address") || n.includes("street")) {
    return "location.streetAddress";
  }
  if (n.includes("zip") || n.includes("postal")) {
    return "location.zipCode";
  }
  if (n === "lat") {
    return "location.latitude";
  }
  if (n === "lng" || n === "lon") {
    return "location.longitude";
  }
  if (n.includes("company") || n.includes("organization")) {
    return "company.name";
  }
  if (
    n.includes("price") ||
    n.includes("amount") ||
    n.includes("cost") ||
    n.includes("total") ||
    n.includes("fee")
  ) {
    return "commerce.price";
  }
  if (n.includes("product")) {
    return "commerce.productName";
  }
  if (n.includes("color") || n.includes("colour")) {
    return "color.human";
  }
  if (n.includes("slug")) {
    return "lorem.slug";
  }
  if (n.includes("jobtitle") || n.includes("position") || n.includes("role")) {
    return "person.jobTitle";
  }
  if (n.includes("gender")) {
    return "person.gender";
  }
  if (n.includes("password") || n.includes("secret") || n.includes("hash")) {
    return "internet.password";
  }
  if (n.includes("domain")) {
    return "internet.domainName";
  }
  if (n.includes("useragent")) {
    return "internet.userAgent";
  }
  if (n.includes("currency") && n.includes("code")) {
    return "finance.currencyCode";
  }
  if (n.includes("currency")) {
    return "finance.currencyCode";
  }
  if (n.includes("iban")) {
    return "finance.iban";
  }
  if (n.includes("creditcard") || n.includes("cardnumber")) {
    return "finance.creditCardNumber";
  }
  if (n.includes("accountnumber")) {
    return "finance.accountNumber";
  }
  if (n.includes("timezone")) {
    return "date.time";
  }
  if (n.includes("filename")) {
    return "system.fileName";
  }
  if (n.includes("mimetype") || n.includes("contenttype")) {
    return "system.mimeType";
  }
  if (n.includes("version")) {
    return "system.semver";
  }
  if (n.includes("birthdate") || n.includes("birthday") || n.includes("dob")) {
    return "date.birthdate";
  }
  if (n.includes("displayname") || n.includes("nickname")) {
    return "internet.displayName";
  }
  if (n.includes("port")) {
    return "internet.port";
  }
}

// ---------------------------------------------------------------------------
// Auto-detect by SQL type
// ---------------------------------------------------------------------------

export function baseAutoDetectByType(type: string): string | undefined {
  const t = type.toLowerCase();

  if (t === "uuid") {
    return "string.uuidV4";
  }
  if (t === "bool" || t === "boolean") {
    return "datatype.boolean";
  }
  if (
    /^int|^uint|^serial|^bigserial|^smallserial|^oid$/.test(t) ||
    t === "integer" ||
    t === "bigint" ||
    t === "smallint" ||
    t === "tinyint"
  ) {
    return "number.int";
  }
  if (
    t.includes("float") ||
    t.includes("double") ||
    t.includes("decimal") ||
    t.includes("numeric") ||
    t === "real" ||
    t === "money"
  ) {
    return "number.float";
  }
  if (
    t.includes("timestamp") ||
    t === "datetime" ||
    t === "datetime2" ||
    t === "datetimeoffset"
  ) {
    return "date.recent";
  }
  if (t === "date") {
    return "date.recent";
  }
  if (t.includes("time") || t === "timetz") {
    return "date.time";
  }
  if (t.includes("json") || t === "jsonb") {
    return "json.object";
  }
  if (
    t.includes("text") ||
    t.includes("varchar") ||
    t.includes("char") ||
    t.includes("nvarchar") ||
    t === "string"
  ) {
    return "lorem.sentence";
  }
  if (t === "inet" || t === "cidr") {
    return "internet.ip";
  }
  if (t === "macaddr" || t === "macaddr8") {
    return "internet.mac";
  }
  if (t === "xml") {
    return "lorem.sentence";
  }
  if (t === "bytea" || t === "varbinary" || t === "binary") {
    return "string.hexadecimal";
  }
}

// ---------------------------------------------------------------------------
// Auto-detect generator for a column
// ---------------------------------------------------------------------------

export function autoDetectGenerator(column: ColumnMeta): string {
  // FK column → reference
  if (column.foreignKey) {
    return REFERENCE_GENERATOR;
  }

  // Enum column → enum
  if (column.enumValues && column.enumValues.length > 0) {
    return ENUM_GENERATOR;
  }

  // Column with default → skip (use DB default)
  if (column.columnDefault) {
    return SKIP_GENERATOR;
  }

  // Try type-based detection
  const typeResult = baseAutoDetectByType(column.udtName ?? column.dataType);
  if (typeResult) {
    return typeResult;
  }

  // Try name-based detection
  const nameResult = baseAutoDetectByName(column.name);
  if (nameResult) {
    return nameResult;
  }

  return "lorem.word";
}

// ---------------------------------------------------------------------------
// Generator groups for UI combobox
// ---------------------------------------------------------------------------

export interface GeneratorGroup {
  items: string[];
  value: string;
}

export function getGeneratorGroups(): GeneratorGroup[] {
  const groups: GeneratorGroup[] = [];
  for (const [id, gen] of Object.entries(BASE_GENERATORS)) {
    const existing = groups.find((g) => g.value === gen.category);
    if (existing) {
      existing.items.push(id);
    } else {
      groups.push({ items: [id], value: gen.category });
    }
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Row generation
// ---------------------------------------------------------------------------

export function generateRows(
  input: GenerateRowsInput
): Record<string, unknown>[] {
  const { columns, configs, count, referenceData, seed } = input;

  // Seed the shared faker so generators produce deterministic output
  if (seed !== undefined) {
    sharedFaker.seed(seed);
  }

  return Array.from({ length: count }, () => {
    const row: Record<string, unknown> = {};

    for (const column of columns) {
      const config = configs[column.name];
      if (!config) {
        continue;
      }

      const { generatorId, nullable, customExpression } = config;

      // Skip → omit column from row (use DB default)
      if (generatorId === SKIP_GENERATOR) {
        continue;
      }

      // NULL
      if (generatorId === NULL_GENERATOR) {
        row[column.name] = null;
        continue;
      }

      // Custom SQL expression
      if (generatorId === CUSTOM_GENERATOR && customExpression?.trim()) {
        row[column.name] = customExpression.trim();
        continue;
      }

      // Nullable — 10% chance of null
      if (
        nullable &&
        column.isNullable &&
        sharedFaker.number.int({ max: 9, min: 0 }) === 0
      ) {
        row[column.name] = null;
        continue;
      }

      // FK reference
      if (generatorId === REFERENCE_GENERATOR) {
        const values = referenceData?.[column.name];
        if (values && values.length > 0) {
          row[column.name] = sharedFaker.helpers.arrayElement(values);
        }
        continue;
      }

      // Enum
      if (generatorId === ENUM_GENERATOR) {
        if (column.enumValues && column.enumValues.length > 0) {
          row[column.name] = sharedFaker.helpers.arrayElement(
            column.enumValues
          );
        }
        continue;
      }

      // Regular generator
      const gen = BASE_GENERATORS[generatorId];
      if (gen) {
        row[column.name] = gen.generate();
      }
    }

    return row;
  });
}

// ---------------------------------------------------------------------------
// Legacy types (kept for backward compat with existing tests)
// ---------------------------------------------------------------------------

export const SEED_SERVER_THRESHOLD = 5000;

export type SeedStrategy = "client" | "server";

export function chooseSeedStrategy(rowCount: number): SeedStrategy {
  return rowCount > SEED_SERVER_THRESHOLD ? "server" : "client";
}
