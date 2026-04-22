/**
 * MySQLDriver — implements DatabaseDriver for MySQL and MariaDB using Kysely.
 *
 * Schema introspection (getSchema, getSchemaSummary) uses Kysely query builder
 * for type safety against known information_schema tables.
 * listRows uses raw pool for data/count queries (dynamic table names need
 * proper identifier quoting), but uses Kysely for PK/FK introspection queries.
 * DDL uses shared builders (ddl-sql.ts) executed via pool.
 */
import mysql from "mysql2/promise";
import type { DatabaseType, SslMode } from "./types";
import type { DatabaseDriver, DriverConnectionConfig } from "./driver";
import { getMysqlPool, getMysqlKysely } from "./kysely-factory";
import {
  buildAddColumnSql,
  buildAlterColumnTypeSql,
  buildCreateIndexSql,
  buildCreateSchemaSql,
  buildCreateTableSql,
  buildDropColumnSql,
  buildDropIndexSql,
  buildDropTableSql,
  buildRenameColumnSql,
  buildRenameTableSql,
  buildSetColumnDefaultSql,
  buildSetColumnNullableSql,
} from "./ddl-sql";

// NOTE: DB_TYPE is set per-driver instance via createMysqlFamilyDriver(dbType).
// MariaDB gets its own dbType so builders can produce MariaDB-specific SQL
// (e.g. CHANGE COLUMN instead of RENAME COLUMN).
const MYSQL_DB_TYPE = "mysql" as DatabaseType;
const MARIADB_DB_TYPE = "mariadb" as DatabaseType;

// ---------------------------------------------------------------------------
// Server version detection & IF NOT EXISTS capability
// ---------------------------------------------------------------------------

export interface ServerVersion {
  major: number;
  minor: number;
  patch: number;
  /** Whether this is a MariaDB server (VERSION() contains "-MariaDB"). */
  isMariaDb: boolean;
}

/** Cache: connection string → parsed server version. Cleared on process exit. */
const serverVersionCache = new Map<string, ServerVersion>();

/**
 * Parse a MySQL/MariaDB version string (e.g. "8.0.35", "10.6.12-MariaDB")
 * into a structured ServerVersion.
 */
export function parseServerVersion(versionStr: string): ServerVersion {
  const isMariaDb = /mariadb/i.test(versionStr);
  const match = versionStr.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    // Unrecognised version — be conservative
    return { major: 0, minor: 0, patch: 0, isMariaDb };
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    isMariaDb,
  };
}

/**
 * Query the server for its version, caching the result per connection string.
 * Uses a lightweight `SELECT VERSION()` — does not require a persistent connection.
 */
async function getServerVersion(connectionString: string): Promise<ServerVersion> {
  const cached = serverVersionCache.get(connectionString);
  if (cached) return cached;

  const version = await withConnection(connectionString, async (conn) => {
    const [rows] = await conn.query("SELECT VERSION() AS v");
    const v = (rows as Array<{ v: string }>)[0]?.v ?? "";
    return parseServerVersion(v);
  });

  serverVersionCache.set(connectionString, version);
  return version;
}

/** Compare server version: ver >= major.minor.patch */
export function versionGte(ver: ServerVersion, major: number, minor: number, patch: number): boolean {
  if (ver.major !== major) return ver.major > major;
  if (ver.minor !== minor) return ver.minor > minor;
  return ver.patch >= patch;
}

/** MySQL 8.0.29+ and MariaDB 10.0.2+ support ADD COLUMN IF NOT EXISTS. */
export function supportsAddColumnIfNotExists(ver: ServerVersion, dbType: DatabaseType): boolean {
  if (dbType === "mariadb" || ver.isMariaDb) {
    return versionGte(ver, 10, 0, 2);
  }
  return versionGte(ver, 8, 0, 29);
}

/** No MySQL version supports CREATE INDEX IF NOT EXISTS; MariaDB 10.5.2+ does. */
export function supportsCreateIndexIfNotExists(ver: ServerVersion, dbType: DatabaseType): boolean {
  if (dbType === "mariadb" || ver.isMariaDb) {
    return versionGte(ver, 10, 5, 2);
  }
  // MySQL: not supported in any version
  return false;
}

// ---------------------------------------------------------------------------
// Type mapping — MySQL data types → display types
// ---------------------------------------------------------------------------

export function mapMySqlType(columnType: string): string {
  const t = (columnType ?? "").toLowerCase();
  const map: Record<string, string> = {
    varchar: "string",
    char: "string",
    text: "string",
    tinytext: "string",
    mediumtext: "string",
    longtext: "string",
    enum: "string",
    set: "string",
    int: "number",
    tinyint: "number",
    smallint: "number",
    mediumint: "number",
    bigint: "number",
    float: "number",
    double: "number",
    decimal: "number",
    numeric: "number",
    date: "date",
    datetime: "datetime",
    timestamp: "datetime",
    time: "time",
    year: "number",
    json: "json",
    boolean: "boolean",
    bool: "boolean",
    blob: "binary",
    tinyblob: "binary",
    mediumblob: "binary",
    longblob: "binary",
    binary: "binary",
    varbinary: "binary",
    bit: "number",
  };
  return map[t] || "unknown";
}

// ---------------------------------------------------------------------------
// Helper: open a mysql2 connection, run a function, then close it.
// ---------------------------------------------------------------------------

/**
 * Run a function with a single connection from the memoized pool.
 * Replaces the old `withConnection` that created a new connection each time.
 */
async function withConnection<T>(
  connectionString: string,
  fn: (conn: mysql.PoolConnection) => Promise<T>,
): Promise<T> {
  const pool = await getMysqlPool(connectionString);
  const conn = await pool.getConnection();
  try {
    return await fn(conn);
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------------------
// Helper: parse a mysql:// or mariadb:// URL into mysql2 connection options
// ---------------------------------------------------------------------------

function parseMysqlUrl(url: string): mysql.ConnectionOptions {
  try {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: Number(u.port) || 3306,
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: decodeURIComponent(u.pathname.replace(/^\//, "")),
    };
  } catch {
    return {};
  }
}

/** Escape and quote a MySQL identifier (wrap in backticks, double internal backticks). */
export function escId(name: string): string {
  return "`" + name.replace(/`/g, "``") + "`";
}

// ---------------------------------------------------------------------------
// MySQL Driver implementation
// ---------------------------------------------------------------------------

/**
 * Create a driver for the MySQL family (MySQL or MariaDB).
 * Shared implementation — dbType selects engine-specific SQL in builders.
 */
function createMysqlFamilyDriver(dbType: DatabaseType): DatabaseDriver {
  const driver: DatabaseDriver = {
    type: dbType,
    defaultPort: 3306,
    defaultDatabase: "mysql",
    defaultUsername: "root",
    sslModes: ["disable", "prefer", "require", "verify_ca", "verify_full"] as SslMode[],

    buildConnectionString(config: DriverConnectionConfig): string {
      if (config.url) return config.url;
      const sslMode = config.ssl_mode || "prefer";
      const base = `mysql://${encodeURIComponent(config.username)}:${encodeURIComponent(config.password)}@${config.host}:${config.port}/${config.database}`;
      return `${base}?ssl=${sslMode === "disable" ? "false" : "true"}`;
    },

    async testConnection(config) {
      try {
        const conn = await mysql.createConnection({
          host: config.host,
          port: config.port,
          user: config.username,
          password: config.password,
          database: config.database,
          connectTimeout: 5000,
        });
        await conn.query("SELECT 1");
        await conn.end();
        return true;
      } catch {
        return false;
      }
    },

    async executeQuery(connectionString, sql) {
      return withConnection(connectionString, async (conn) => {
        const [rows, meta] = await conn.query({ sql, rowsAsArray: true });

        // Non-SELECT result (INSERT, UPDATE, DELETE, DDL)
        if (!Array.isArray(rows)) {
          const r = rows as mysql.ResultSetHeader;
          return {
            columns: [],
            rows: [],
            row_count: r.affectedRows ?? 0,
          };
        }

        // SELECT result — extract column metadata
        const columns = (meta as mysql.FieldPacket[]).map((f) => ({
          name: f.name,
          type_name: mapMySqlType(
            f.type ? String.fromCharCode(f.type) : "text",
          ),
        }));

        return {
          columns,
          rows: rows as unknown[][],
          row_count: (rows as unknown[][]).length,
        };
      });
    },

    async getDatabaseInfo(connectionString) {
      return withConnection(connectionString, async (conn) => {
        const [versionRows] = await conn.query("SELECT VERSION() AS version");
        const version = (versionRows as Array<{ version: string }>)[0]?.version ?? "";
        const [encodingRows] = await conn.query(
          "SELECT @@character_set_database AS encoding",
        );
        const encoding = (encodingRows as Array<{ encoding: string }>)[0]?.encoding ?? "";
        const [tzRows] = await conn.query("SELECT @@global.time_zone AS timezone");
        const timezone = (tzRows as Array<{ timezone: string }>)[0]?.timezone ?? "SYSTEM";
        let size = "";
        try {
          const [sizeRows] = await conn.query(
            "SELECT ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) AS size_mb FROM information_schema.tables WHERE table_schema = DATABASE()",
          );
          const sizeMb = (sizeRows as Array<{ size_mb: number }>)[0]?.size_mb;
          size = sizeMb != null ? `${sizeMb} MB` : "";
        } catch {
          // Not all users have PROCESS privilege
        }
        return { version, encoding, timezone, size };
      });
    },

    async getSchema(connectionString) {
      const db = await getMysqlKysely(connectionString);

      try {
        // 1. Schemas — Kysely query against information_schema.schemata
        const excludedSchemas = ["mysql", "information_schema", "performance_schema", "sys"];
        const schemaRows = await db
          .selectFrom("schemata")
          .select("SCHEMA_NAME")
          .where("SCHEMA_NAME", "not in", excludedSchemas)
          .orderBy("SCHEMA_NAME")
          .execute();
        const schemas = schemaRows.map((r) => r.SCHEMA_NAME);

        // 2. Columns — Kysely query against information_schema.columns
        const columnRows = await db
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
          .execute();

        // Build tables map
        const tablesMap = new Map<string, {
          name: string;
          schema: string;
          columns: Array<{ name: string; data_type: string; udt_name: string | null; is_nullable: boolean; column_default: string | null }>;
          indexes: Array<{ name: string; is_unique: boolean; is_primary: boolean; column_names: string[] }>;
          foreign_keys: Array<{ name: string; column_name: string; referenced_schema: string | undefined; referenced_table: string; referenced_column: string }>;
          has_rls: boolean;
          rls_policies: Array<{ name: string; kind: string; roles: string[]; using_expr: string | null; with_check_expr: string | null }>;
        }>();

        for (const row of columnRows) {
          const key = `${row.TABLE_SCHEMA}.${row.TABLE_NAME}`;
          if (!tablesMap.has(key)) {
            tablesMap.set(key, {
              name: row.TABLE_NAME,
              schema: row.TABLE_SCHEMA,
              columns: [],
              indexes: [],
              foreign_keys: [],
              has_rls: false,
              rls_policies: [],
            });
          }
          tablesMap.get(key)!.columns.push({
            name: row.COLUMN_NAME,
            data_type: row.DATA_TYPE,
            udt_name: row.COLUMN_TYPE ?? null,
            is_nullable: row.IS_NULLABLE === "YES",
            column_default: row.COLUMN_DEFAULT,
          });
        }

        // 3. Indexes — Kysely query against information_schema.statistics
        const indexRows = await db
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
          .execute();

        const indexMap = new Map<string, { columns: string[]; isUnique: boolean; isPrimary: boolean }>();
        for (const row of indexRows) {
          const iKey = `${row.TABLE_SCHEMA}.${row.TABLE_NAME}.${row.INDEX_NAME}`;
          if (!indexMap.has(iKey)) {
            indexMap.set(iKey, {
              columns: [],
              isUnique: row.NON_UNIQUE === 0,
              isPrimary: row.INDEX_NAME === "PRIMARY",
            });
          }
          indexMap.get(iKey)!.columns.push(row.COLUMN_NAME);
        }
        for (const [iKey, idx] of indexMap) {
          const [schema, tableName] = iKey.split(".");
          const tKey = `${schema}.${tableName}`;
          const table = tablesMap.get(tKey);
          if (table) {
            const name = iKey.split(".").pop()!;
            table.indexes.push({
              name,
              is_unique: idx.isUnique,
              is_primary: idx.isPrimary,
              column_names: idx.columns,
            });
          }
        }

        // 4. Foreign keys — Kysely query joining key_column_usage with table_constraints
        //    to ensure only actual FOREIGN KEY constraints are included (not UNIQUE, etc.)
        const fkRows = await db
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
          .execute();

        for (const row of fkRows) {
          const tKey = `${row.CONSTRAINT_SCHEMA}.${row.TABLE_NAME}`;
          const table = tablesMap.get(tKey);
          if (table) {
            table.foreign_keys.push({
              name: row.CONSTRAINT_NAME,
              column_name: row.COLUMN_NAME,
              referenced_schema: row.REFERENCED_TABLE_SCHEMA ?? undefined,
              referenced_table: row.REFERENCED_TABLE_NAME!,
              referenced_column: row.REFERENCED_COLUMN_NAME!,
            });
          }
        }

        return {
          schemas,
          tables: Array.from(tablesMap.values()),
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`MySQL schema error: ${msg}`);
      }
    },

    async getSchemaSummary(connectionString) {
      const db = await getMysqlKysely(connectionString);
      const excludedSchemas = ["mysql", "information_schema", "performance_schema", "sys"];

      const schemaRows = await db
        .selectFrom("schemata")
        .select("SCHEMA_NAME")
        .where("SCHEMA_NAME", "not in", excludedSchemas)
        .orderBy("SCHEMA_NAME")
        .execute();

      const tableRows = await db
        .selectFrom("tables")
        .select(["TABLE_SCHEMA", "TABLE_NAME"])
        .where("TABLE_SCHEMA", "not in", excludedSchemas)
        .orderBy("TABLE_SCHEMA")
        .orderBy("TABLE_NAME")
        .execute();

      return {
        schemas: schemaRows.map((r) => r.SCHEMA_NAME),
        tables: tableRows.map((t) => ({
          name: t.TABLE_NAME,
          schema: t.TABLE_SCHEMA,
          has_rls: false,
        })),
      };
    },

    async getTableDetails(connectionString, schema, table) {
      const fullSchema = await this.getSchema(connectionString);
      const tableInfo = fullSchema.tables.find(
        (t) => t.schema === schema && t.name === table,
      );
      if (!tableInfo) {
        throw new Error(`Table ${schema}.${table} not found`);
      }
      return {
        name: tableInfo.name,
        schema: tableInfo.schema,
        has_rls: tableInfo.has_rls,
        columns: tableInfo.columns,
        indexes: tableInfo.indexes,
        foreign_keys: tableInfo.foreign_keys,
        rls_policies: tableInfo.rls_policies,
      };
    },

    async listRows(connectionString, schema, table, page, pageSize, sort, filters) {
      return withConnection(connectionString, async (conn) => {
        const conditions: string[] = [];
        const params: unknown[] = [];

        if (filters) {
          for (const f of filters) {
            const col = `\`${f.column.replace(/`/g, "``")}\``;
            switch (f.operator) {
              case "eq":
                if (f.value == null) conditions.push(`${col} IS NULL`);
                else { conditions.push(`${col} = ?`); params.push(f.value); }
                break;
              case "neq":
                if (f.value == null) conditions.push(`${col} IS NOT NULL`);
                else { conditions.push(`${col} != ?`); params.push(f.value); }
                break;
              case "contains":
                conditions.push(`${col} LIKE ?`);
                params.push(`%${String(f.value ?? "")}%`);
                break;
              case "starts_with":
                conditions.push(`${col} LIKE ?`);
                params.push(`${String(f.value ?? "")}%`);
                break;
              case "ends_with":
                conditions.push(`${col} LIKE ?`);
                params.push(`%${String(f.value ?? "")}`);
                break;
              case "gt": conditions.push(`${col} > ?`); params.push(f.value); break;
              case "gte": conditions.push(`${col} >= ?`); params.push(f.value); break;
              case "lt": conditions.push(`${col} < ?`); params.push(f.value); break;
              case "lte": conditions.push(`${col} <= ?`); params.push(f.value); break;
              case "is_null": conditions.push(`${col} IS NULL`); break;
              case "is_not_null": conditions.push(`${col} IS NOT NULL`); break;
              default:
                conditions.push(`${col} LIKE ?`);
                params.push(`%${String(f.value ?? "")}%`);
            }
          }
        }

        const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
        const orderBy = sort && sort.length > 0
          ? ` ORDER BY ${sort.map((s) => `\`${s.column.replace(/`/g, "``")}\` ${s.direction.toUpperCase()}`).join(", ")}`
          : "";
        const offset = (page - 1) * pageSize;

        const [rows] = await conn.query(
          `SELECT * FROM \`${schema}\`.\`${table}\`${where}${orderBy} LIMIT ? OFFSET ?`,
          [...params, pageSize, offset],
        );

        const [countRows] = await conn.query(
          `SELECT COUNT(*) AS cnt FROM \`${schema}\`.\`${table}\`${where}`,
          params,
        );
        const totalEstimate = Number((countRows as Array<{ cnt: bigint }>)[0]?.cnt ?? 0);

        // Primary key — Kysely query against information_schema.key_column_usage
        const db = await getMysqlKysely(connectionString);
        const pkRows = await db
          .selectFrom("key_column_usage")
          .select("COLUMN_NAME")
          .where("TABLE_SCHEMA", "=", schema)
          .where("TABLE_NAME", "=", table)
          .where("CONSTRAINT_NAME", "=", "PRIMARY")
          .orderBy("ORDINAL_POSITION")
          .execute();
        const primaryKey = pkRows.map((r) => r.COLUMN_NAME);

        // Foreign keys — Kysely query with join to table_constraints
        const fkRows = await db
          .selectFrom("key_column_usage as kcu")
          .innerJoin("table_constraints as tc", (join) =>
            join
              .onRef("tc.CONSTRAINT_NAME", "=", "kcu.CONSTRAINT_NAME")
              .onRef("tc.CONSTRAINT_SCHEMA", "=", "kcu.CONSTRAINT_SCHEMA"),
          )
          .select([
            "kcu.COLUMN_NAME",
            "kcu.REFERENCED_TABLE_SCHEMA",
            "kcu.REFERENCED_TABLE_NAME",
            "kcu.REFERENCED_COLUMN_NAME",
            "tc.CONSTRAINT_NAME",
          ])
          .where("tc.CONSTRAINT_TYPE", "=", "FOREIGN KEY")
          .where("kcu.TABLE_SCHEMA", "=", schema)
          .where("kcu.TABLE_NAME", "=", table)
          .where("kcu.REFERENCED_TABLE_NAME", "is not", null)
          .execute();
        const foreignKeys = fkRows.map((r) => ({
          name: r.CONSTRAINT_NAME,
          column_name: r.COLUMN_NAME,
          referenced_schema: r.REFERENCED_TABLE_SCHEMA!,
          referenced_table: r.REFERENCED_TABLE_NAME!,
          referenced_column: r.REFERENCED_COLUMN_NAME!,
        }));

        const rowArr = rows as Record<string, unknown>[];
        const columns = Object.keys(rowArr[0] ?? {}).map((name) => ({
          name,
          type_name: "unknown", // Simplified; full type mapping from column metadata
        }));

        return {
          columns,
          rows: rowArr,
          primaryKey,
          foreignKeys,
          pageInfo: { page, pageSize },
          totalEstimate,
        };
      });
    },

    // ── DDL operations ──────────────────────────────────────────────
    // Build SQL via shared builders (ddl-sql.ts), execute, then return
    // the same SQL string.  This eliminates duplicate SQL construction
    // between the execute and display paths.

    async createTable(connectionString, schema, tableName, columns, primaryKeyColumns, ifNotExists) {
      const sql = buildCreateTableSql(dbType, schema, tableName, columns, primaryKeyColumns ?? [], ifNotExists ?? false);
      await withConnection(connectionString, (conn) => conn.query(sql));
      return sql;
    },

    async dropTable(connectionString, schema, tableName, _cascade, ifExists) {
      const sql = buildDropTableSql(dbType, schema, tableName, _cascade ?? false, ifExists ?? false);
      await withConnection(connectionString, (conn) => conn.query(sql));
      return sql;
    },

    async renameTable(connectionString, schema, oldName, newName) {
      const sql = buildRenameTableSql(dbType, schema, oldName, newName);
      await withConnection(connectionString, (conn) => conn.query(sql));
      return sql;
    },

    async addColumn(connectionString, schema, table, columnName, dataType, isNullable, defaultExpr, ifNotExists) {
      // Query server version to decide whether IF NOT EXISTS is supported.
      // MySQL 8.0.29+ and MariaDB 10.0.2+ support ADD COLUMN IF NOT EXISTS.
      let effectiveIfNotExists = ifNotExists ?? false;
      if (effectiveIfNotExists) {
        const ver = await getServerVersion(connectionString);
        if (!supportsAddColumnIfNotExists(ver, dbType)) {
          effectiveIfNotExists = false;
        }
      }
      const sql = buildAddColumnSql(dbType, schema, table, columnName, dataType, isNullable ?? true, defaultExpr, effectiveIfNotExists);
      await withConnection(connectionString, (conn) => conn.query(sql));
      return sql;
    },

    async dropColumn(connectionString, schema, table, columnName, _cascade, ifExists) {
      const sql = buildDropColumnSql(dbType, schema, table, columnName, _cascade ?? false, ifExists ?? false);
      await withConnection(connectionString, (conn) => conn.query(sql));
      return sql;
    },

    async renameColumn(connectionString, schema, table, oldName, newName) {
      // MySQL uses RENAME COLUMN; MariaDB uses CHANGE COLUMN (requires full column definition)
      if (dbType === "mariadb") {
        return withConnection(connectionString, async (conn) => {
          const [rows] = await conn.query(
            `SELECT COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT FROM information_schema.columns WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
            [schema, table, oldName],
          );
          const info = (rows as Array<{ COLUMN_TYPE: string; IS_NULLABLE: string; COLUMN_DEFAULT: string | null }>)[0];
          if (!info) {
            throw new Error(`Column ${schema}.${table}.${oldName} not found`);
          }
          const columnInfo = { columnType: info.COLUMN_TYPE, isNullable: info.IS_NULLABLE === "YES", defaultExpr: info.COLUMN_DEFAULT };
          const sql = buildRenameColumnSql(dbType, schema, table, oldName, newName, columnInfo);
          await conn.query(sql);
          return sql;
        });
      }
      const sql = buildRenameColumnSql(dbType, schema, table, oldName, newName);
      await withConnection(connectionString, (conn) => conn.query(sql));
      return sql;
    },

    async alterColumnType(connectionString, schema, table, columnName, newType, _usingExpr) {
      const sql = buildAlterColumnTypeSql(dbType, schema, table, columnName, newType, _usingExpr);
      await withConnection(connectionString, (conn) => conn.query(sql));
      return sql;
    },

    async setColumnNullable(connectionString, schema, table, columnName, isNullable) {
      // MySQL MODIFY COLUMN requires the current COLUMN_TYPE — look it up first
      return withConnection(connectionString, async (conn) => {
        const [rows] = await conn.query(
          `SELECT COLUMN_TYPE FROM information_schema.columns WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
          [schema, table, columnName],
        );
        const columnType = (rows as Array<{ COLUMN_TYPE: string }>)[0]?.COLUMN_TYPE;
        const sql = buildSetColumnNullableSql(dbType, schema, table, columnName, isNullable, columnType);
        await conn.query(sql);
        return sql;
      });
    },

    async setColumnDefault(connectionString, schema, table, columnName, defaultExpr) {
      // MySQL MODIFY COLUMN requires current COLUMN_TYPE and nullability
      return withConnection(connectionString, async (conn) => {
        const [rows] = await conn.query(
          `SELECT COLUMN_TYPE, IS_NULLABLE FROM information_schema.columns WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
          [schema, table, columnName],
        );
        const info = (rows as Array<{ COLUMN_TYPE: string; IS_NULLABLE: string }>)[0];
        if (!info) {
          throw new Error(`Column ${schema}.${table}.${columnName} not found`);
        }
        const isNullable = info.IS_NULLABLE === "YES";
        const sql = buildSetColumnDefaultSql(dbType, schema, table, columnName, defaultExpr, info.COLUMN_TYPE, isNullable);
        await conn.query(sql);
        return sql;
      });
    },

    async createIndex(connectionString, schema, table, indexName, columns, unique, ifNotExists) {
      // Query server version to decide whether IF NOT EXISTS is supported.
      // No MySQL version supports CREATE INDEX IF NOT EXISTS.
      // MariaDB 10.5.2+ does support it.
      let effectiveIfNotExists = ifNotExists ?? false;
      if (effectiveIfNotExists) {
        const ver = await getServerVersion(connectionString);
        if (!supportsCreateIndexIfNotExists(ver, dbType)) {
          effectiveIfNotExists = false;
        }
      }
      const sql = buildCreateIndexSql(dbType, schema, table, indexName, columns, unique ?? false, effectiveIfNotExists);
      await withConnection(connectionString, (conn) => conn.query(sql));
      return sql;
    },

    async dropIndex(connectionString, schema, indexName, _cascade, ifExists) {
      // MySQL requires: DROP INDEX `name` ON `schema`.`table` — resolve table first
      return withConnection(connectionString, async (conn) => {
        const [rows] = await conn.query(
          `SELECT TABLE_NAME FROM information_schema.statistics WHERE TABLE_SCHEMA = ? AND INDEX_NAME = ? LIMIT 1`,
          [schema, indexName],
        );
        const tableName = (rows as Array<{ TABLE_NAME: string }>)[0]?.TABLE_NAME;
        if (!tableName) {
          if (ifExists) return buildDropIndexSql(dbType, schema, indexName, _cascade ?? false, true);
          throw new Error(`Index ${schema}.${indexName} not found`);
        }
        const sql = buildDropIndexSql(dbType, schema, indexName, _cascade ?? false, ifExists ?? false, tableName);
        await conn.query(sql);
        return sql;
      });
    },

    async createSchema(connectionString, schemaName, ifNotExists) {
      const sql = buildCreateSchemaSql(dbType, schemaName, ifNotExists ?? false);
      await withConnection(connectionString, (conn) => conn.query(sql));
      return sql;
    },

    // ── Clone / Export ──────────────────────────────────────────────

    async exportSchemaDdl(connectionString: string) {
      return withConnection(connectionString, async (conn) => {
        const scripts: Array<{ type: string; schema: string; name: string; sql: string; dependsOn?: string[] }> = [];
        const tableRowCounts: Array<{ schema: string; table: string; rowCount: number }> = [];

        const excludedDbs = "'mysql','information_schema','performance_schema','sys'";

        // 1. Export databases (MySQL "schemas")
        const [dbRows] = await conn.query(
          `SELECT SCHEMA_NAME FROM information_schema.schemata WHERE SCHEMA_NAME NOT IN (${excludedDbs}) ORDER BY SCHEMA_NAME`,
        );
        for (const row of dbRows as Array<{ SCHEMA_NAME: string }>) {
          scripts.push({
            type: "schema",
            schema: row.SCHEMA_NAME,
            name: row.SCHEMA_NAME,
            sql: `CREATE DATABASE IF NOT EXISTS ${escId(row.SCHEMA_NAME)};`,
          });
        }

        // 2. Get table metadata (ENGINE, TABLE_COLLATION, AUTO_INCREMENT, TABLE_ROWS)
        const [tableMetaRows] = await conn.query(
          `SELECT TABLE_SCHEMA, TABLE_NAME, ENGINE, TABLE_COLLATION, AUTO_INCREMENT, TABLE_ROWS FROM information_schema.tables WHERE TABLE_SCHEMA NOT IN (${excludedDbs}) AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_SCHEMA, TABLE_NAME`,
        );
        const tableMeta = new Map<string, { engine: string | null; collation: string | null; autoIncrement: number | null; rowCount: number }>();
        for (const row of tableMetaRows as Array<{
          TABLE_SCHEMA: string; TABLE_NAME: string; ENGINE: string | null;
          TABLE_COLLATION: string | null; AUTO_INCREMENT: number | null; TABLE_ROWS: number | null;
        }>) {
          tableMeta.set(`${row.TABLE_SCHEMA}.${row.TABLE_NAME}`, {
            engine: row.ENGINE,
            collation: row.TABLE_COLLATION,
            autoIncrement: row.AUTO_INCREMENT,
            rowCount: Number(row.TABLE_ROWS ?? 0),
          });
        }

        // 3. Get columns for all tables
        // Note: EXPRESSION column only exists in MySQL 8.0+ (not 5.7 / MariaDB)
        let colRows: Array<{
          TABLE_SCHEMA: string; TABLE_NAME: string; COLUMN_NAME: string;
          COLUMN_TYPE: string; IS_NULLABLE: string; COLUMN_DEFAULT: string | null;
          EXTRA: string; EXPRESSION: string | null;
        }>;
        try {
          const [rows] = await conn.query(
            `SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA, EXPRESSION FROM information_schema.columns WHERE TABLE_SCHEMA NOT IN (${excludedDbs}) ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION`,
          );
          colRows = rows as typeof colRows;
        } catch {
          // Fallback for MySQL 5.7 / MariaDB which don't have the EXPRESSION column
          const [rows] = await conn.query(
            `SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA, NULL AS EXPRESSION FROM information_schema.columns WHERE TABLE_SCHEMA NOT IN (${excludedDbs}) ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION`,
          );
          colRows = rows as typeof colRows;
        }
        const tableColumns = new Map<string, Array<{
          COLUMN_NAME: string; COLUMN_TYPE: string; IS_NULLABLE: string;
          COLUMN_DEFAULT: string | null; EXTRA: string; EXPRESSION: string | null;
        }>>();
        for (const row of colRows) {
          const key = `${row.TABLE_SCHEMA}.${row.TABLE_NAME}`;
          if (!tableColumns.has(key)) tableColumns.set(key, []);
          tableColumns.get(key)!.push(row);
        }

        // 4. Get primary keys
        const [pkRows] = await conn.query(
          `SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME FROM information_schema.key_column_usage WHERE CONSTRAINT_NAME = 'PRIMARY' AND TABLE_SCHEMA NOT IN (${excludedDbs}) ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION`,
        );
        const tablePKs = new Map<string, string[]>();
        for (const row of pkRows as Array<{ TABLE_SCHEMA: string; TABLE_NAME: string; COLUMN_NAME: string }>) {
          const key = `${row.TABLE_SCHEMA}.${row.TABLE_NAME}`;
          if (!tablePKs.has(key)) tablePKs.set(key, []);
          tablePKs.get(key)!.push(row.COLUMN_NAME);
        }

        // 5. Build CREATE TABLE statements (skip views — handled in step 8)
        for (const [tableKey, columns] of tableColumns) {
          if (!tableMeta.has(tableKey)) continue; // Views don't have tableMeta entries
          const [schema, tableName] = tableKey.split(".");
          const pkCols = tablePKs.get(tableKey) || [];
          const meta = tableMeta.get(tableKey);

          const columnDefs: string[] = [];
          for (const col of columns) {
            // Skip generated columns (STORED/VIRTUAL) — would need GENERATION_EXPRESSION
            if (/\bSTORED GENERATED\b|\bVIRTUAL GENERATED\b/i.test(col.EXTRA)) continue;

            let def = `  ${escId(col.COLUMN_NAME)} ${col.COLUMN_TYPE}`;
            if (col.IS_NULLABLE === "NO") def += " NOT NULL";
            if (col.EXTRA.includes("auto_increment")) {
              def += " AUTO_INCREMENT";
            } else if (col.EXPRESSION) {
              // MySQL 8.0+ expression defaults e.g. (uuid())
              def += ` DEFAULT ${col.EXPRESSION}`;
            } else if (col.COLUMN_DEFAULT !== null) {
              def += ` DEFAULT ${col.COLUMN_DEFAULT}`;
            }
            // ON UPDATE clause (e.g., ON UPDATE CURRENT_TIMESTAMP)
            const onUpdateMatch = col.EXTRA.match(/on update\s+(\S+)/i);
            if (onUpdateMatch) def += ` ON UPDATE ${onUpdateMatch[1]}`;
            columnDefs.push(def);
          }

          if (pkCols.length > 0) {
            columnDefs.push(`  PRIMARY KEY (${pkCols.map((c) => escId(c)).join(", ")})`);
          }

          // Table options
          const options: string[] = [];
          if (meta?.engine) options.push(`ENGINE=${meta.engine}`);
          if (meta?.autoIncrement) options.push(`AUTO_INCREMENT=${meta.autoIncrement}`);
          if (meta?.collation) {
            const charset = meta.collation.split("_")[0];
            options.push(`DEFAULT CHARSET=${charset}`);
            options.push(`COLLATE=${meta.collation}`);
          }

          const optionsStr = options.length > 0 ? ` ${options.join(" ")}` : "";
          scripts.push({
            type: "table",
            schema,
            name: tableName,
            sql: `CREATE TABLE IF NOT EXISTS ${escId(schema)}.${escId(tableName)} (\n${columnDefs.join(",\n")}\n)${optionsStr};`,
          });
        }

        // 6. Get indexes (excluding PRIMARY KEY) — grouped in JS to avoid GROUP_CONCAT truncation
        const [idxRows] = await conn.query(
          `SELECT TABLE_SCHEMA, TABLE_NAME, INDEX_NAME, COLUMN_NAME, NON_UNIQUE FROM information_schema.statistics WHERE TABLE_SCHEMA NOT IN (${excludedDbs}) AND INDEX_NAME != 'PRIMARY' ORDER BY TABLE_SCHEMA, TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
        );
        const indexMap = new Map<string, { schema: string; table: string; name: string; columns: string[]; isUnique: boolean }>();
        for (const row of idxRows as Array<{
          TABLE_SCHEMA: string; TABLE_NAME: string; INDEX_NAME: string; COLUMN_NAME: string; NON_UNIQUE: number;
        }>) {
          const key = `${row.TABLE_SCHEMA}.${row.TABLE_NAME}.${row.INDEX_NAME}`;
          if (!indexMap.has(key)) {
            indexMap.set(key, {
              schema: row.TABLE_SCHEMA,
              table: row.TABLE_NAME,
              name: row.INDEX_NAME,
              columns: [],
              isUnique: row.NON_UNIQUE === 0,
            });
          }
          indexMap.get(key)!.columns.push(row.COLUMN_NAME);
        }
        for (const [, idx] of indexMap) {
          const unique = idx.isUnique ? "UNIQUE " : "";
          const cols = idx.columns.map((c) => escId(c)).join(", ");
          // Note: MySQL does not support CREATE INDEX IF NOT EXISTS; MariaDB 10.5.2+ does.
          scripts.push({
            type: "index",
            schema: idx.schema,
            name: idx.name,
            sql: `CREATE ${unique}INDEX ${escId(idx.name)} ON ${escId(idx.schema)}.${escId(idx.table)} (${cols});`,
          });
        }

        // 7. Get foreign keys (grouped by constraint for multi-column FKs)
        //    Join REFERENTIAL_CONSTRAINTS for ON DELETE / ON UPDATE actions
        const [fkRows] = await conn.query(
          `SELECT kcu.TABLE_SCHEMA, kcu.TABLE_NAME, kcu.COLUMN_NAME, kcu.REFERENCED_TABLE_SCHEMA, kcu.REFERENCED_TABLE_NAME, kcu.REFERENCED_COLUMN_NAME, kcu.CONSTRAINT_NAME, rc.DELETE_RULE, rc.UPDATE_RULE FROM information_schema.key_column_usage kcu JOIN information_schema.table_constraints tc ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA LEFT JOIN information_schema.REFERENTIAL_CONSTRAINTS rc ON rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME AND rc.CONSTRAINT_SCHEMA = kcu.TABLE_SCHEMA WHERE tc.CONSTRAINT_TYPE = 'FOREIGN KEY' AND kcu.TABLE_SCHEMA NOT IN (${excludedDbs}) AND kcu.REFERENCED_TABLE_NAME IS NOT NULL ORDER BY kcu.TABLE_SCHEMA, kcu.TABLE_NAME, kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION`,
        );
        const fkMap = new Map<string, {
          schema: string; table: string; constraintName: string;
          columns: string[]; refSchema: string; refTable: string; refColumns: string[];
          deleteRule: string; updateRule: string;
        }>();
        for (const row of fkRows as Array<{
          TABLE_SCHEMA: string; TABLE_NAME: string; COLUMN_NAME: string;
          REFERENCED_TABLE_SCHEMA: string; REFERENCED_TABLE_NAME: string;
          REFERENCED_COLUMN_NAME: string; CONSTRAINT_NAME: string;
          DELETE_RULE: string | null; UPDATE_RULE: string | null;
        }>) {
          const key = `${row.TABLE_SCHEMA}.${row.TABLE_NAME}.${row.CONSTRAINT_NAME}`;
          if (!fkMap.has(key)) {
            fkMap.set(key, {
              schema: row.TABLE_SCHEMA,
              table: row.TABLE_NAME,
              constraintName: row.CONSTRAINT_NAME,
              columns: [],
              refSchema: row.REFERENCED_TABLE_SCHEMA,
              refTable: row.REFERENCED_TABLE_NAME,
              refColumns: [],
              deleteRule: row.DELETE_RULE ?? "RESTRICT",
              updateRule: row.UPDATE_RULE ?? "RESTRICT",
            });
          }
          fkMap.get(key)!.columns.push(row.COLUMN_NAME);
          fkMap.get(key)!.refColumns.push(row.REFERENCED_COLUMN_NAME);
        }
        for (const [, fk] of fkMap) {
          const cols = fk.columns.map((c) => escId(c)).join(", ");
          const refCols = fk.refColumns.map((c) => escId(c)).join(", ");
          let fkSql = `ALTER TABLE ${escId(fk.schema)}.${escId(fk.table)} ADD CONSTRAINT ${escId(fk.constraintName)} FOREIGN KEY (${cols}) REFERENCES ${escId(fk.refSchema)}.${escId(fk.refTable)} (${refCols})`;
          if (fk.deleteRule && fk.deleteRule !== "RESTRICT") fkSql += ` ON DELETE ${fk.deleteRule}`;
          if (fk.updateRule && fk.updateRule !== "RESTRICT") fkSql += ` ON UPDATE ${fk.updateRule}`;
          scripts.push({
            type: "constraint",
            schema: fk.schema,
            name: fk.constraintName,
            sql: `${fkSql};`,
            dependsOn: [`${fk.refSchema}.${fk.refTable}`],
          });
        }

        // 8. Get views
        const [viewRows] = await conn.query(
          `SELECT TABLE_SCHEMA, TABLE_NAME, VIEW_DEFINITION FROM information_schema.views WHERE TABLE_SCHEMA NOT IN (${excludedDbs}) ORDER BY TABLE_SCHEMA, TABLE_NAME`,
        );
        for (const row of viewRows as Array<{ TABLE_SCHEMA: string; TABLE_NAME: string; VIEW_DEFINITION: string }>) {
          scripts.push({
            type: "view",
            schema: row.TABLE_SCHEMA,
            name: row.TABLE_NAME,
            sql: `CREATE OR REPLACE VIEW ${escId(row.TABLE_SCHEMA)}.${escId(row.TABLE_NAME)} AS ${row.VIEW_DEFINITION};`,
          });
        }

        // 9. Row counts (approximate from information_schema — fast, no per-table COUNT)
        for (const [tableKey, meta] of tableMeta) {
          const [schema, tableName] = tableKey.split(".");
          tableRowCounts.push({ schema, table: tableName, rowCount: meta.rowCount });
        }

        return { scripts, tableRowCounts };
      });
    },

    async exportTableData(connectionString: string, schema: string, table: string, batchSize: number, offset: number) {
      return withConnection(connectionString, async (conn) => {
        const [rows] = await conn.query(
          `SELECT * FROM ${escId(schema)}.${escId(table)} LIMIT ? OFFSET ?`,
          [batchSize + 1, offset],
        );

        const rowArr = rows as Record<string, unknown>[];
        const hasMore = rowArr.length > batchSize;
        const resultRows = hasMore ? rowArr.slice(0, batchSize) : rowArr;
        const columns = resultRows.length > 0 ? Object.keys(resultRows[0]) : [];

        return {
          rows: resultRows,
          columns,
          hasMore,
          totalExported: offset + resultRows.length,
        };
      });
    },

    async executeBatchDdl(connectionString, statements, _throwOnError) {
      return withConnection(connectionString, async (conn) => {
        const errors: Array<{ sql: string; error: string }> = [];
        for (const sql of statements) {
          try {
            await conn.query(sql);
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            errors.push({ sql, error: errMsg });
          }
        }
        return { errors };
      });
    },

    async waitForDatabase(connectionString, maxRetries = 20, intervalMs = 250) {
      for (let i = 0; i < maxRetries; i++) {
        try {
          const conn = await mysql.createConnection({
            ...parseMysqlUrl(connectionString),
            connectTimeout: 2000,
          });
          await conn.query("SELECT 1");
          await conn.end();
          return;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, intervalMs));
        }
      }
      throw new Error(
        `Database not ready after ${maxRetries * intervalMs}ms`,
      );
    },

    async importTableRows(connectionString, schema, table, columns, rows) {
      if (rows.length === 0) return 0;
      return withConnection(connectionString, async (conn) => {
        const quotedCols = columns.map((c) => `\`${c}\``).join(", ");
        const placeholders = columns.map(() => "?").join(", ");
        const insertSql = `INSERT INTO \`${schema}\`.\`${table}\` (${quotedCols}) VALUES (${placeholders})`;
        for (const row of rows) {
          const values = columns.map((col) => row[col]);
          await conn.query(insertSql, values);
        }
        return rows.length;
      });
    },
  };

  return driver;
}

/**
 * Create a separate MariaDB driver that shares the same implementation.
 * MariaDB is wire-compatible with MySQL.
 */
export function createMysqlDriver(): DatabaseDriver {
  return createMysqlFamilyDriver(MYSQL_DB_TYPE);
}

/**
 * Create a MariaDB driver.
 *
 * MariaDB is wire-compatible with MySQL but has some DDL syntax differences:
 * - renameColumn uses CHANGE COLUMN instead of RENAME COLUMN (MariaDB < 10.5)
 * - ADD COLUMN IF NOT EXISTS supported (MariaDB 10.0.2+, detected via server version)
 * - CREATE INDEX IF NOT EXISTS supported (MariaDB 10.5.2+, detected via server version)
 * - buildConnectionString uses mariadb:// scheme
 *
 * All differences are handled by passing dbType="mariadb" through
 * the shared factory and builders.
 */
export function createMariadbDriver(): DatabaseDriver {
  const driver = createMysqlFamilyDriver(MARIADB_DB_TYPE);
  // Override connection string to use mariadb:// scheme
  return {
    ...driver,
    buildConnectionString(config: DriverConnectionConfig): string {
      if (config.url) return config.url;
      const sslMode = config.ssl_mode || "prefer";
      const base = `mariadb://${encodeURIComponent(config.username)}:${encodeURIComponent(config.password)}@${config.host}:${config.port}/${config.database}`;
      return `${base}?ssl=${sslMode === "disable" ? "false" : "true"}`;
    },
  };
}
