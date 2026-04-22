/**
 * MySQLDriver — implements DatabaseDriver for MySQL and MariaDB.
 *
 * Uses the `mysql2/promise` package for async connection handling.
 * The driver is registered for both "mysql" and "mariadb" DatabaseTypes.
 */
import mysql from "mysql2/promise";
import type { DatabaseType, SslMode } from "./types";
import type { DatabaseDriver, DriverConnectionConfig } from "./driver";
import { getMysqlPool } from "./kysely-factory";
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

interface ServerVersion {
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
function parseServerVersion(versionStr: string): ServerVersion {
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
function versionGte(ver: ServerVersion, major: number, minor: number, patch: number): boolean {
  if (ver.major !== major) return ver.major > major;
  if (ver.minor !== minor) return ver.minor > minor;
  return ver.patch >= patch;
}

/** MySQL 8.0.29+ and MariaDB 10.0.2+ support ADD COLUMN IF NOT EXISTS. */
function supportsAddColumnIfNotExists(ver: ServerVersion, dbType: DatabaseType): boolean {
  if (dbType === "mariadb" || ver.isMariaDb) {
    return versionGte(ver, 10, 0, 2);
  }
  return versionGte(ver, 8, 0, 29);
}

/** No MySQL version supports CREATE INDEX IF NOT EXISTS; MariaDB 10.5.2+ does. */
function supportsCreateIndexIfNotExists(ver: ServerVersion, dbType: DatabaseType): boolean {
  if (dbType === "mariadb" || ver.isMariaDb) {
    return versionGte(ver, 10, 5, 2);
  }
  // MySQL: not supported in any version
  return false;
}

// ---------------------------------------------------------------------------
// Type mapping — MySQL data types → display types
// ---------------------------------------------------------------------------

function mapMySqlType(columnType: string): string {
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
      return withConnection(connectionString, async (conn) => {
        // MySQL uses "databases" instead of "schemas" — we map them.
        const [schemaRows] = await conn.query(
          "SELECT SCHEMA_NAME FROM information_schema.schemata WHERE SCHEMA_NAME NOT IN ('mysql','information_schema','performance_schema','sys') ORDER BY SCHEMA_NAME",
        );
        const schemas = (schemaRows as Array<{ SCHEMA_NAME: string }>).map((r) => r.SCHEMA_NAME);

        const [tableRows] = await conn.query(
          `SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
           FROM information_schema.columns
           WHERE TABLE_SCHEMA NOT IN ('mysql','information_schema','performance_schema','sys')
           ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION`,
        );

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

        for (const row of tableRows as Array<{
          TABLE_SCHEMA: string; TABLE_NAME: string; COLUMN_NAME: string;
          DATA_TYPE: string; COLUMN_TYPE: string; IS_NULLABLE: string;
          COLUMN_DEFAULT: string | null;
        }>) {
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

        // Indexes
        const [indexRows] = await conn.query(
          `SELECT TABLE_SCHEMA, TABLE_NAME, INDEX_NAME, COLUMN_NAME, NON_UNIQUE
           FROM information_schema.statistics
           WHERE TABLE_SCHEMA NOT IN ('mysql','information_schema','performance_schema','sys')
           ORDER BY TABLE_SCHEMA, TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
        );
        const indexMap = new Map<string, { columns: string[]; isUnique: boolean; isPrimary: boolean }>();
        for (const row of indexRows as Array<{
          TABLE_SCHEMA: string; TABLE_NAME: string; INDEX_NAME: string;
          COLUMN_NAME: string; NON_UNIQUE: number;
        }>) {
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

        // Foreign keys
        const [fkRows] = await conn.query(
          `SELECT CONSTRAINT_SCHEMA, TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_SCHEMA, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME, CONSTRAINT_NAME
           FROM information_schema.key_column_usage
           WHERE REFERENCED_TABLE_SCHEMA IS NOT NULL
             AND TABLE_SCHEMA NOT IN ('mysql','information_schema','performance_schema','sys')`,
        );
        for (const row of fkRows as Array<{
          CONSTRAINT_SCHEMA: string; TABLE_NAME: string; COLUMN_NAME: string;
          REFERENCED_TABLE_SCHEMA: string; REFERENCED_TABLE_NAME: string;
          REFERENCED_COLUMN_NAME: string; CONSTRAINT_NAME: string;
        }>) {
          const tKey = `${row.CONSTRAINT_SCHEMA}.${row.TABLE_NAME}`;
          const table = tablesMap.get(tKey);
          if (table) {
            table.foreign_keys.push({
              name: row.CONSTRAINT_NAME,
              column_name: row.COLUMN_NAME,
              referenced_schema: row.REFERENCED_TABLE_SCHEMA,
              referenced_table: row.REFERENCED_TABLE_NAME,
              referenced_column: row.REFERENCED_COLUMN_NAME,
            });
          }
        }

        return {
          schemas,
          tables: Array.from(tablesMap.values()),
        };
      });
    },

    async getSchemaSummary(connectionString) {
      const schema = await driver.getSchema(connectionString);
      return {
        schemas: schema.schemas,
        tables: schema.tables.map((t) => ({
          name: t.name,
          schema: t.schema,
          has_rls: t.has_rls,
        })),
      };
    },

    async getTableDetails(connectionString, schema, table) {
      const fullSchema = await driver.getSchema(connectionString);
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

        // Primary key
        const [pkRows] = await conn.query(
          `SELECT COLUMN_NAME FROM information_schema.key_column_usage
           WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY'
           ORDER BY ORDINAL_POSITION`,
          [schema, table],
        );
        const primaryKey = (pkRows as Array<{ COLUMN_NAME: string }>).map((r) => r.COLUMN_NAME);

        // Foreign keys
        const [fkRows] = await conn.query(
          `SELECT kcu.COLUMN_NAME, kcu.REFERENCED_TABLE_SCHEMA, kcu.REFERENCED_TABLE_NAME, kcu.REFERENCED_COLUMN_NAME, tc.CONSTRAINT_NAME
           FROM information_schema.key_column_usage kcu
           JOIN information_schema.table_constraints tc ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
           WHERE tc.CONSTRAINT_TYPE = 'FOREIGN KEY' AND kcu.TABLE_SCHEMA = ? AND kcu.TABLE_NAME = ? AND kcu.REFERENCED_TABLE_NAME IS NOT NULL`,
          [schema, table],
        );
        const foreignKeys = (fkRows as Array<{
          COLUMN_NAME: string; REFERENCED_TABLE_SCHEMA: string;
          REFERENCED_TABLE_NAME: string; REFERENCED_COLUMN_NAME: string;
          CONSTRAINT_NAME: string;
        }>).map((r) => ({
          name: r.CONSTRAINT_NAME,
          column_name: r.COLUMN_NAME,
          referenced_schema: r.REFERENCED_TABLE_SCHEMA,
          referenced_table: r.REFERENCED_TABLE_NAME,
          referenced_column: r.REFERENCED_COLUMN_NAME,
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

    // ── Clone / Export (stubs — MySQL full export not yet implemented) ─

    async exportSchemaDdl() {
      // TODO: implement MySQL schema export
      return { scripts: [], tableRowCounts: [] };
    },

    async exportTableData() {
      // TODO: implement MySQL data export
      return { rows: [], columns: [], hasMore: false, totalExported: 0 };
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
