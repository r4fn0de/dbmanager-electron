import { Faker, pt_BR } from "@faker-js/faker";

// Module-level faker for generators (non-deterministic, just for defaults)
const sharedFaker = new Faker({ locale: [pt_BR] });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GeneratorDef {
  label: string;
  category: string;
  generate: () => unknown;
}

export type GeneratorMap = Record<string, GeneratorDef>;

export interface ColumnSeedConfig {
  generatorId: string;
  nullable: boolean;
  customExpression?: string;
}

export interface ColumnMeta {
  name: string;
  dataType: string;
  udtName?: string | null;
  isNullable: boolean;
  columnDefault: string | null;
  isPrimaryKey?: boolean;
  isUnique?: boolean;
  foreignKey?: {
    referencedSchema: string;
    referencedTable: string;
    referencedColumn: string;
  };
  enumValues?: string[];
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
  [SKIP_GENERATOR]: { label: "Use default", category: "Special", generate: () => undefined },
  [NULL_GENERATOR]: { label: "NULL", category: "Special", generate: () => null },
  [REFERENCE_GENERATOR]: { label: "FK reference", category: "Special", generate: () => undefined },
  [ENUM_GENERATOR]: { label: "Enum value", category: "Special", generate: () => undefined },
  [CUSTOM_GENERATOR]: { label: "Custom SQL", category: "Special", generate: () => undefined },

  // Text
  "lorem.word": { label: "Word", category: "Text", generate: () => sharedFaker.lorem.word() },
  "lorem.sentence": { label: "Sentence", category: "Text", generate: () => sharedFaker.lorem.sentence() },
  "lorem.paragraph": { label: "Paragraph", category: "Text", generate: () => sharedFaker.lorem.paragraph() },
  "lorem.lines": { label: "Lines", category: "Text", generate: () => sharedFaker.lorem.lines() },
  "lorem.slug": { label: "Slug", category: "Text", generate: () => sharedFaker.lorem.slug() },
  "lorem.text": { label: "Text Block", category: "Text", generate: () => sharedFaker.lorem.text() },
  "string.alpha": { label: "Alpha String", category: "Text", generate: () => sharedFaker.string.alpha(10) },
  "string.alphanumeric": { label: "Alphanumeric", category: "Text", generate: () => sharedFaker.string.alphanumeric(10) },
  "string.hexadecimal": { label: "Hex String", category: "Text", generate: () => sharedFaker.string.hexadecimal({ length: 16 }) },

  // Person
  "person.firstName": { label: "First Name", category: "Person", generate: () => sharedFaker.person.firstName() },
  "person.lastName": { label: "Last Name", category: "Person", generate: () => sharedFaker.person.lastName() },
  "person.fullName": { label: "Full Name", category: "Person", generate: () => sharedFaker.person.fullName() },
  "person.jobTitle": { label: "Job Title", category: "Person", generate: () => sharedFaker.person.jobTitle() },
  "person.gender": { label: "Gender", category: "Person", generate: () => sharedFaker.person.gender() },

  // Internet
  "internet.email": { label: "Email", category: "Internet", generate: () => sharedFaker.internet.email() },
  "internet.url": { label: "URL", category: "Internet", generate: () => sharedFaker.internet.url() },
  "internet.username": { label: "Username", category: "Internet", generate: () => sharedFaker.internet.username() },
  "internet.displayName": { label: "Display Name", category: "Internet", generate: () => sharedFaker.internet.displayName() },
  "internet.password": { label: "Password", category: "Internet", generate: () => sharedFaker.internet.password() },
  "internet.ip": { label: "IPv4 Address", category: "Internet", generate: () => sharedFaker.internet.ip() },
  "internet.ipv6": { label: "IPv6 Address", category: "Internet", generate: () => sharedFaker.internet.ipv6() },
  "internet.mac": { label: "MAC Address", category: "Internet", generate: () => sharedFaker.internet.mac() },
  "internet.userAgent": { label: "User Agent", category: "Internet", generate: () => sharedFaker.internet.userAgent() },
  "internet.domainName": { label: "Domain Name", category: "Internet", generate: () => sharedFaker.internet.domainName() },
  "internet.port": { label: "Port", category: "Internet", generate: () => sharedFaker.internet.port() },
  "image.url": { label: "Image URL", category: "Internet", generate: () => sharedFaker.image.url() },
  "image.avatar": { label: "Avatar URL", category: "Internet", generate: () => sharedFaker.image.avatar() },

  // Number
  "number.int": { label: "Integer", category: "Number", generate: () => sharedFaker.number.int({ max: 10000 }) },
  "number.float": { label: "Float", category: "Number", generate: () => sharedFaker.number.float({ max: 10000, fractionDigits: 2 }) },
  "number.bigInt": { label: "Big Integer", category: "Number", generate: () => String(sharedFaker.number.bigInt({ max: 9007199254740991n })) },
  "number.percentage": { label: "Percentage", category: "Number", generate: () => sharedFaker.number.float({ min: 0, max: 100, fractionDigits: 2 }) },

  // Date
  "date.recent": { label: "Recent Date", category: "Date", generate: () => sharedFaker.date.recent().toISOString() },
  "date.past": { label: "Past Date", category: "Date", generate: () => sharedFaker.date.past().toISOString() },
  "date.future": { label: "Future Date", category: "Date", generate: () => sharedFaker.date.future().toISOString() },
  "date.soon": { label: "Soon Date", category: "Date", generate: () => sharedFaker.date.soon().toISOString() },
  "date.birthdate": { label: "Birthdate", category: "Date", generate: () => sharedFaker.date.birthdate().toISOString() },
  "date.month": { label: "Month Name", category: "Date", generate: () => sharedFaker.date.month() },
  "date.weekday": { label: "Weekday", category: "Date", generate: () => sharedFaker.date.weekday() },
  "date.time": { label: "Time", category: "Date", generate: () => sharedFaker.date.recent().toISOString().slice(11, 19) },

  // Boolean
  "datatype.boolean": { label: "Boolean", category: "Boolean", generate: () => sharedFaker.datatype.boolean() },

  // ID
  "string.uuidV4": { label: "UUID v4", category: "ID", generate: () => sharedFaker.string.uuid({ version: 4 }) },
  "string.uuidV7": { label: "UUID v7", category: "ID", generate: () => sharedFaker.string.uuid({ version: 7 }) },
  "string.nanoid": { label: "Nano ID", category: "ID", generate: () => sharedFaker.string.nanoid() },
  "string.ulid": { label: "ULID", category: "ID", generate: () => sharedFaker.string.ulid() },

  // Location
  "location.city": { label: "City", category: "Location", generate: () => sharedFaker.location.city() },
  "location.country": { label: "Country", category: "Location", generate: () => sharedFaker.location.country() },
  "location.countryCode": { label: "Country Code", category: "Location", generate: () => sharedFaker.location.countryCode() },
  "location.state": { label: "State", category: "Location", generate: () => sharedFaker.location.state() },
  "location.streetAddress": { label: "Street Address", category: "Location", generate: () => sharedFaker.location.streetAddress() },
  "location.zipCode": { label: "Zip Code", category: "Location", generate: () => sharedFaker.location.zipCode() },
  "location.latitude": { label: "Latitude", category: "Location", generate: () => sharedFaker.location.latitude() },
  "location.longitude": { label: "Longitude", category: "Location", generate: () => sharedFaker.location.longitude() },

  // Finance
  "finance.amount": { label: "Amount", category: "Finance", generate: () => Number(sharedFaker.finance.amount()) },
  "finance.currencyCode": { label: "Currency Code", category: "Finance", generate: () => sharedFaker.finance.currencyCode() },
  "finance.creditCardNumber": { label: "Credit Card", category: "Finance", generate: () => sharedFaker.finance.creditCardNumber() },
  "finance.iban": { label: "IBAN", category: "Finance", generate: () => sharedFaker.finance.iban() },

  // Commerce
  "commerce.price": { label: "Price", category: "Commerce", generate: () => Number(sharedFaker.commerce.price()) },
  "commerce.productName": { label: "Product Name", category: "Commerce", generate: () => sharedFaker.commerce.productName() },
  "commerce.productDescription": { label: "Product Desc", category: "Commerce", generate: () => sharedFaker.commerce.productDescription() },
  "commerce.department": { label: "Department", category: "Commerce", generate: () => sharedFaker.commerce.department() },
  "company.name": { label: "Company Name", category: "Commerce", generate: () => sharedFaker.company.name() },

  // System
  "system.fileName": { label: "File Name", category: "System", generate: () => sharedFaker.system.fileName() },
  "system.fileExt": { label: "File Extension", category: "System", generate: () => sharedFaker.system.fileExt() },
  "system.mimeType": { label: "MIME Type", category: "System", generate: () => sharedFaker.system.mimeType() },
  "system.semver": { label: "Semver", category: "System", generate: () => sharedFaker.system.semver() },

  // Other
  "phone.number": { label: "Phone Number", category: "Other", generate: () => sharedFaker.phone.number() },
  "color.human": { label: "Color Name", category: "Other", generate: () => sharedFaker.color.human() },
  "json.object": { label: "JSON Object", category: "Other", generate: () => ({ key: sharedFaker.lorem.word(), value: sharedFaker.number.int({ max: 100 }) }) },
};

// ---------------------------------------------------------------------------
// Auto-detect by column name
// ---------------------------------------------------------------------------

export function baseAutoDetectByName(name: string): string | undefined {
  const n = name.toLowerCase().replaceAll("_", "");

  if (n.includes("email")) return "internet.email";
  if (n === "firstname") return "person.firstName";
  if (n === "lastname" || n === "surname") return "person.lastName";
  if (n === "fullname" || n === "name") return "person.fullName";
  if (n.includes("phone") || n.includes("mobile") || n.includes("tel")) return "phone.number";
  if (n.includes("url") || n.includes("website") || n.includes("link")) return "internet.url";
  if (n.includes("avatar") || n.includes("image") || n.includes("photo") || n.includes("picture")) return "image.url";
  if (n.includes("username") || n === "login") return "internet.username";
  if (n.includes("title") || n.includes("subject")) return "lorem.sentence";
  if (n.includes("description") || n.includes("content") || n.includes("bio") || n.includes("summary")) return "lorem.paragraph";
  if (n.includes("city")) return "location.city";
  if (n.includes("countrycode")) return "location.countryCode";
  if (n.includes("country")) return "location.country";
  if (n.includes("ipaddress") || n === "ip") return "internet.ip";
  if (n.includes("address") || n.includes("street")) return "location.streetAddress";
  if (n.includes("zip") || n.includes("postal")) return "location.zipCode";
  if (n === "lat") return "location.latitude";
  if (n === "lng" || n === "lon") return "location.longitude";
  if (n.includes("company") || n.includes("organization")) return "company.name";
  if (n.includes("price") || n.includes("amount") || n.includes("cost") || n.includes("total") || n.includes("fee")) return "commerce.price";
  if (n.includes("product")) return "commerce.productName";
  if (n.includes("color") || n.includes("colour")) return "color.human";
  if (n.includes("slug")) return "lorem.slug";
  if (n.includes("jobtitle") || n.includes("position") || n.includes("role")) return "person.jobTitle";
  if (n.includes("gender")) return "person.gender";
  if (n.includes("password") || n.includes("secret") || n.includes("hash")) return "internet.password";
  if (n.includes("domain")) return "internet.domainName";
  if (n.includes("useragent")) return "internet.userAgent";
  if (n.includes("currency") && n.includes("code")) return "finance.currencyCode";
  if (n.includes("currency")) return "finance.currencyCode";
  if (n.includes("iban")) return "finance.iban";
  if (n.includes("creditcard") || n.includes("cardnumber")) return "finance.creditCardNumber";
  if (n.includes("accountnumber")) return "finance.accountNumber";
  if (n.includes("timezone")) return "date.time";
  if (n.includes("filename")) return "system.fileName";
  if (n.includes("mimetype") || n.includes("contenttype")) return "system.mimeType";
  if (n.includes("version")) return "system.semver";
  if (n.includes("birthdate") || n.includes("birthday") || n.includes("dob")) return "date.birthdate";
  if (n.includes("displayname") || n.includes("nickname")) return "internet.displayName";
  if (n.includes("port")) return "internet.port";

  return undefined;
}

// ---------------------------------------------------------------------------
// Auto-detect by SQL type
// ---------------------------------------------------------------------------

export function baseAutoDetectByType(type: string): string | undefined {
  const t = type.toLowerCase();

  if (t === "uuid") return "string.uuidV4";
  if (t === "bool" || t === "boolean") return "datatype.boolean";
  if (/^int|^uint|^serial|^bigserial|^smallserial|^oid$/.test(t) || t === "integer" || t === "bigint" || t === "smallint" || t === "tinyint") return "number.int";
  if (t.includes("float") || t.includes("double") || t.includes("decimal") || t.includes("numeric") || t === "real" || t === "money") return "number.float";
  if (t.includes("timestamp") || t === "datetime" || t === "datetime2" || t === "datetimeoffset") return "date.recent";
  if (t === "date") return "date.recent";
  if (t.includes("time") || t === "timetz") return "date.time";
  if (t.includes("json") || t === "jsonb") return "json.object";
  if (t.includes("text") || t.includes("varchar") || t.includes("char") || t.includes("nvarchar") || t === "string") return "lorem.sentence";
  if (t === "inet" || t === "cidr") return "internet.ip";
  if (t === "macaddr" || t === "macaddr8") return "internet.mac";
  if (t === "xml") return "lorem.sentence";
  if (t === "bytea" || t === "varbinary" || t === "binary") return "string.hexadecimal";

  return undefined;
}

// ---------------------------------------------------------------------------
// Auto-detect generator for a column
// ---------------------------------------------------------------------------

export function autoDetectGenerator(column: ColumnMeta): string {
  // FK column → reference
  if (column.foreignKey) return REFERENCE_GENERATOR;

  // Enum column → enum
  if (column.enumValues && column.enumValues.length > 0) return ENUM_GENERATOR;

  // Column with default → skip (use DB default)
  if (column.columnDefault) return SKIP_GENERATOR;

  // Try type-based detection
  const typeResult = baseAutoDetectByType(column.udtName ?? column.dataType);
  if (typeResult) return typeResult;

  // Try name-based detection
  const nameResult = baseAutoDetectByName(column.name);
  if (nameResult) return nameResult;

  return "lorem.word";
}

// ---------------------------------------------------------------------------
// Generator groups for UI combobox
// ---------------------------------------------------------------------------

export interface GeneratorGroup {
  value: string;
  items: string[];
}

export function getGeneratorGroups(): GeneratorGroup[] {
  const groups: GeneratorGroup[] = [];
  for (const [id, gen] of Object.entries(BASE_GENERATORS)) {
    const existing = groups.find((g) => g.value === gen.category);
    if (existing) {
      existing.items.push(id);
    } else {
      groups.push({ value: gen.category, items: [id] });
    }
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Row generation
// ---------------------------------------------------------------------------

export function generateRows(input: GenerateRowsInput): Record<string, unknown>[] {
  const { columns, configs, count, referenceData, seed } = input;

  // Seed the shared faker so generators produce deterministic output
  if (seed !== undefined) sharedFaker.seed(seed);

  return Array.from({ length: count }, () => {
    const row: Record<string, unknown> = {};

    for (const column of columns) {
      const config = configs[column.name];
      if (!config) continue;

      const { generatorId, nullable, customExpression } = config;

      // Skip → omit column from row (use DB default)
      if (generatorId === SKIP_GENERATOR) continue;

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
      if (nullable && column.isNullable && sharedFaker.number.int({ min: 0, max: 9 }) === 0) {
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
          row[column.name] = sharedFaker.helpers.arrayElement(column.enumValues);
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
