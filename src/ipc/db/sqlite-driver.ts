/**
 * SqliteDriver — implements DatabaseDriver for SQLite via better-sqlite3.
 *
 * SQLite is a file-based database with no separate server process.
 * It uses pragma-based introspection instead of information_schema.
 * Connection strings use the format: sqlite:///absolute/path/to/file.db
 */
import BetterSqlite3 from "better-sqlite3";
import type { DatabaseType, SslMode } from "./types";
import type { DatabaseDriver, DriverConnectionConfig } from "./driver";
import {
  buildCreateTableSql,
  buildDropTableSql,
  buildAddColumnSql,
  buildCreateIndexSql,
} from "./ddl-sql";

const DB_TYPE = "sqlite" as DatabaseType;

// ---------------------------------------------------------------------------
// Connection string helpers
// ---------------------------------------------------------------------------

/** Parse a sqlite:///path/to/file.db connection string into a file path. */
function parseConnectionString(connectionString: string): string {
  if (connectionString.startsWith("sqlite:///")) {
    return decodeURIComponent(connectionString.slice("sqlite:///".length));
  }
  if (connectionString.startsWith("sqlite://")) {
    return decodeURIComponent(connectionString.slice("sqlite://".length));
  }
  // Assume it's already a file path
  return connectionString;
}

/** Build a sqlite:/// connection string from a file path. */
export function buildSqliteConnectionString(filePath: string): string {
  return `sqlite:///${filePath}`;
}

// ---------------------------------------------------------------------------
// Type mapping
// ---------------------------------------------------------------------------

function mapSqliteType(declType: string | undefined): string {
  if (!declType) return "unknown";
  const upper = declType.toUpperCase();

  // SQLite type affinity rules
  if (upper.includes("INT")) return "number";
  if (upper.includes("REAL") || upper.includes("FLOA") || upper.includes("DOUB") || upper.includes("NUMERIC") || upper.includes("DECIMAL"))
    return "number";
  if (upper.includes("BOOL")) return "boolean";
  if (upper.includes("CHAR") || upper.includes("CLOB") || upper.includes("TEXT"))
    return "string";
  if (upper === "BLOB") return "binary";
  if (upper.includes("DATE") || upper.includes("TIME"))
    return "datetime";
  if (upper === "JSON") return "json";

  // Common SQLite-specific declarations
  if (upper === "INTEGER") return "number";
  if (upper === "TEXT") return "string";
  if (upper === "REAL") return "number";

  return "string"; // SQLite default affinity
}

// ---------------------------------------------------------------------------
// Database handle cache — one better-sqlite3 instance per file path
// ---------------------------------------------------------------------------

const dbCache = new Map<string, BetterSqlite3.Database>();

function getDb(connectionString: string): BetterSqlite3.Database {
  const existing = dbCache.get(connectionString);
  if (existing) return existing;

  const filePath = parseConnectionString(connectionString);
  const db = new BetterSqlite3(filePath);
  // Enable WAL mode for better concurrent read performance
  db.pragma("journal_mode = WAL");
  // Enable foreign keys
  db.pragma("foreign_keys = ON");
  dbCache.set(connectionString, db);
  return db;
}

/** Close and remove a cached database handle. */
export function closeDb(connectionString: string): void {
  const db = dbCache.get(connectionString);
  if (db) {
    db.close();
    dbCache.delete(connectionString);
  }
}

/** Close all cached database handles. */
export function closeAllSqliteDbs(): void {
  for (const db of dbCache.values()) {
    db.close();
  }
  dbCache.clear();
}

// ---------------------------------------------------------------------------
// Schema introspection helpers
// ---------------------------------------------------------------------------

interface SqliteColumnInfo {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

interface SqliteIndexInfo {
  seq: number;
  name: string;
  unique: number;
  origin: string;
  partial: number;
}

interface SqliteIndexColumn {
  seqno: number;
  cid: number;
  name: string | null;
}

interface SqliteForeignKey {
  id: number;
  seq: number;
  table: string;
  from: string;
  to: string;
  on_update: string;
  on_delete: string;
  match: string;
}

// ---------------------------------------------------------------------------
// Driver implementation
// ---------------------------------------------------------------------------

export function createSqliteDriver(): DatabaseDriver {
  return {
    type: DB_TYPE,
    defaultPort: 0, // SQLite has no port
    defaultDatabase: "main",
    defaultUsername: "",
    sslModes: ["disable"] as SslMode[], // SQLite doesn't support SSL

    buildConnectionString(config: DriverConnectionConfig): string {
      // For SQLite, the "database" field is the file path
      if (config.url) return config.url;
      return buildSqliteConnectionString(config.database);
    },

    async testConnection(config) {
      try {
        const connStr = this.buildConnectionString(config);
        const filePath = parseConnectionString(connStr);
        const db = new BetterSqlite3(filePath);
        db.prepare("SELECT 1").get();
        db.close();
        return true;
      } catch {
        return false;
      }
    },

    async executeQuery(connectionString, sql) {
      const db = getDb(connectionString);
      try {
        const stmt = db.prepare(sql);
        const isRead = stmt.reader;

        if (isRead) {
          const rows = stmt.all() as Record<string, unknown>[];
          const columns = Object.keys(rows[0] ?? {});
          return {
            columns: columns.map((name) => {
              // Try to infer type from the first row's value
              const val = rows[0]?.[name];
              const type = typeof val;
              return {
                name,
                type_name: type === "object" && val instanceof Date ? "datetime"
                  : type === "number" ? "number"
                  : type === "string" ? "string"
                  : type === "boolean" ? "boolean"
                  : "unknown",
              };
            }),
            rows: rows.map((row) => Object.values(row)),
            row_count: rows.length,
          };
        }
        // Write statement
        const info = stmt.run();
        return {
          columns: [],
          rows: [],
          row_count: info.changes,
        };
      } catch (err) {
        throw new Error(`SQLite query error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    async getDatabaseInfo(connectionString) {
      const db = getDb(connectionString);
      const version = (db.prepare("SELECT sqlite_version()").get() as Record<string, string>)?.["sqlite_version()"] ?? "unknown";
      const filePath = parseConnectionString(connectionString);

      return {
        version: `SQLite ${version}`,
        encoding: "UTF-8",
        timezone: "UTC",
        size: undefined, // Could compute file size, but not essential
      };
    },

    async getSchema(connectionString) {
      const db = getDb(connectionString);

      // SQLite has a single "main" schema (plus temp)
      const schemas = ["main"];

      // Get all table names (excluding sqlite_ internal tables)
      const tables = (db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .all() as Array<{ name: string }>);

      const schemaTables = tables.map((t) => {
        const tableName = t.name;

        // Columns
        const colInfo = db.pragma(`table_info("${tableName}")`) as unknown as SqliteColumnInfo[];
        const columns = colInfo.map((c) => ({
          name: c.name,
          data_type: c.type || "TEXT",
          udt_name: c.type || null,
          is_nullable: c.notnull === 0,
          column_default: c.dflt_value,
        }));

        // Indexes
        const indexList = db.pragma(`index_list("${tableName}")`) as unknown as SqliteIndexInfo[];
        const indexes = indexList
          .filter((idx) => idx.origin !== "c") // Skip auto-indexes for constraints
          .map((idx) => {
            const idxCols = db.pragma(`index_xinfo("${idx.name}")`) as unknown as SqliteIndexColumn[];
            return {
              name: idx.name,
              is_unique: idx.unique === 1,
              is_primary: idx.origin === "pk",
              column_names: idxCols
                .filter((ic) => ic.cid >= 0 && ic.name)
                .map((ic) => ic.name!),
            };
          });

        // Foreign keys
        const fkList = db.pragma(`foreign_key_list("${tableName}")`) as unknown as SqliteForeignKey[];
        const foreignKeys = fkList.map((fk) => ({
          name: `${tableName}_${fk.from}_fkey`,
          column_name: fk.from,
          referenced_schema: "main",
          referenced_table: fk.table,
          referenced_column: fk.to,
        }));

        return {
          name: tableName,
          schema: "main",
          columns,
          indexes,
          foreign_keys: foreignKeys,
          has_rls: false,
          rls_policies: [],
        };
      });

      return {
        schemas,
        tables: schemaTables,
      };
    },

    async getSchemaSummary(connectionString) {
      const db = getDb(connectionString);

      // SQLite has a single "main" schema — no need for full introspection
      const schemas = ["main"];
      const tableRows = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .all() as Array<{ name: string }>;

      return {
        schemas,
        tables: tableRows.map((t) => ({
          name: t.name,
          schema: "main",
          has_rls: false,
        })),
      };
    },

    async getTableDetails(connectionString, schema, table) {
      const db = getDb(connectionString);

      try {
        // 1. Columns for this specific table only
        const colInfo = db.pragma(`table_info("${table}")`) as unknown as SqliteColumnInfo[];
        const columns = colInfo.map((c) => ({
          name: c.name,
          data_type: c.type || "TEXT",
          udt_name: c.type || null,
          is_nullable: c.notnull === 0,
          column_default: c.dflt_value,
        }));

        // 2. Indexes for this specific table
        const indexList = db.pragma(`index_list("${table}")`) as unknown as SqliteIndexInfo[];
        const indexes = indexList
          .filter((idx) => idx.origin !== "c") // Skip auto-indexes for constraints
          .map((idx) => {
            const idxCols = db.pragma(`index_xinfo("${idx.name}")`) as unknown as SqliteIndexColumn[];
            return {
              name: idx.name,
              is_unique: idx.unique === 1,
              is_primary: idx.origin === "pk",
              column_names: idxCols
                .filter((ic) => ic.cid >= 0 && ic.name)
                .map((ic) => ic.name!),
            };
          });

        // 3. Foreign keys for this specific table
        const fkList = db.pragma(`foreign_key_list("${table}")`) as unknown as SqliteForeignKey[];
        const foreignKeys = fkList.map((fk) => ({
          name: `${table}_${fk.from}_fkey`,
          column_name: fk.from,
          referenced_schema: "main",
          referenced_table: fk.table,
          referenced_column: fk.to,
        }));

        return {
          name: table,
          schema: "main",
          has_rls: false,
          columns,
          indexes,
          foreign_keys: foreignKeys,
          rls_policies: [],
        };
      } catch (err) {
        throw new Error(`SQLite table details error for ${table}: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    async listRows(connectionString, schema, table, page, pageSize, sort, filters) {
      const db = getDb(connectionString);
      const offset = (page - 1) * pageSize;

      // Build WHERE clause
      const whereParts: string[] = [];
      const params: unknown[] = [];
      if (filters && filters.length > 0) {
        for (const f of filters) {
          const col = `"${f.column.replace(/"/g, '""')}"`;
          switch (f.operator) {
            case "eq":
              if (f.value == null) whereParts.push(`${col} IS NULL`);
              else { whereParts.push(`${col} = ?`); params.push(f.value); }
              break;
            case "neq":
              if (f.value == null) whereParts.push(`${col} IS NOT NULL`);
              else { whereParts.push(`${col} != ?`); params.push(f.value); }
              break;
            case "contains":
              whereParts.push(`${col} LIKE ?`);
              params.push(`%${String(f.value ?? "")}%`);
              break;
            case "starts_with":
              whereParts.push(`${col} LIKE ?`);
              params.push(`${String(f.value ?? "")}%`);
              break;
            case "ends_with":
              whereParts.push(`${col} LIKE ?`);
              params.push(`%${String(f.value ?? "")}`);
              break;
            case "gt":
              whereParts.push(`${col} > ?`);
              params.push(f.value);
              break;
            case "gte":
              whereParts.push(`${col} >= ?`);
              params.push(f.value);
              break;
            case "lt":
              whereParts.push(`${col} < ?`);
              params.push(f.value);
              break;
            case "lte":
              whereParts.push(`${col} <= ?`);
              params.push(f.value);
              break;
            case "is_null":
              whereParts.push(`${col} IS NULL`);
              break;
            case "is_not_null":
              whereParts.push(`${col} IS NOT NULL`);
              break;
            default:
              whereParts.push(`${col} LIKE ?`);
              params.push(`%${String(f.value ?? "")}%`);
          }
        }
      }
      const where = whereParts.length > 0 ? ` WHERE ${whereParts.join(" AND ")}` : "";

      // Build ORDER BY
      const orderBy = sort && sort.length > 0
        ? ` ORDER BY ${sort.map((s) => `"${s.column.replace(/"/g, '""')}" ${s.direction.toUpperCase()}`).join(", ")}`
        : "";

      // Rows
      const rows = db.prepare(`SELECT * FROM "${table.replace(/"/g, '""')}"${where}${orderBy} LIMIT ? OFFSET ?`)
        .all(...params, pageSize, offset) as Record<string, unknown>[];

      // Count
      const countRow = db.prepare(`SELECT COUNT(*) as cnt FROM "${table.replace(/"/g, '""')}"${where}`)
        .get(...params) as Record<string, number>;
      const totalEstimate = countRow?.cnt ?? 0;

      // Get column types from pragma for more accurate type info
      const colInfo = db.pragma(`table_info("${table}")`) as unknown as SqliteColumnInfo[];
      const colTypeMap = new Map(colInfo.map((c) => [c.name, c.type]));
      const columnsWithTypes = Object.keys(rows[0] ?? {}).map((name) => ({
        name,
        type_name: mapSqliteType(colTypeMap.get(name)),
      }));

      // Primary keys
      const primaryKey = colInfo.filter((c) => c.pk > 0).map((c) => c.name);

      // Foreign keys
      const fkList = db.pragma(`foreign_key_list("${table}")`) as unknown as SqliteForeignKey[];
      const foreignKeys = fkList.map((fk) => ({
        name: `${table}_${fk.from}_fkey`,
        column_name: fk.from,
        referenced_schema: "main",
        referenced_table: fk.table,
        referenced_column: fk.to,
      }));

      return {
        columns: columnsWithTypes,
        rows,
        primaryKey,
        foreignKeys,
        pageInfo: { page, pageSize },
        totalEstimate,
      };
    },

    // ── DDL ─────────────────────────────────────────────────────────

    async createTable(connectionString, schema, tableName, columns, primaryKeyColumns, ifNotExists) {
      const sql = buildCreateTableSql(DB_TYPE, schema, tableName, columns, primaryKeyColumns ?? [], ifNotExists ?? false);
      const db = getDb(connectionString);
      db.exec(sql);
      return sql;
    },

    async dropTable(connectionString, schema, tableName, cascade, ifExists) {
      const sql = buildDropTableSql(DB_TYPE, schema, tableName, cascade ?? false, ifExists ?? false);
      const db = getDb(connectionString);
      db.exec(sql);
      return sql;
    },

    async renameTable(connectionString, schema, oldName, newName) {
      // SQLite uses: ALTER TABLE ... RENAME TO ...
      const sql = `ALTER TABLE "${oldName.replace(/"/g, '""')}" RENAME TO "${newName.replace(/"/g, '""')}"`;
      const db = getDb(connectionString);
      db.exec(sql);
      return sql;
    },

    async addColumn(connectionString, schema, table, columnName, dataType, isNullable, defaultExpr, ifNotExists) {
      // SQLite doesn't support IF NOT EXISTS for ADD COLUMN
      let def = `"${columnName.replace(/"/g, '""')}" ${dataType}`;
      if (!(isNullable ?? true)) def += " NOT NULL";
      if (defaultExpr) def += ` DEFAULT ${defaultExpr}`;
      const sql = `ALTER TABLE "${table.replace(/"/g, '""')}" ADD COLUMN ${def}`;
      const db = getDb(connectionString);
      db.exec(sql);
      return sql;
    },

    async dropColumn(connectionString, schema, table, columnName, _cascade, _ifExists) {
      // SQLite 3.35.0+ supports DROP COLUMN
      const sql = `ALTER TABLE "${table.replace(/"/g, '""')}" DROP COLUMN "${columnName.replace(/"/g, '""')}"`;
      const db = getDb(connectionString);
      db.exec(sql);
      return sql;
    },

    async renameColumn(connectionString, schema, table, oldName, newName) {
      // SQLite 3.25.0+ supports RENAME COLUMN
      const sql = `ALTER TABLE "${table.replace(/"/g, '""')}" RENAME COLUMN "${oldName.replace(/"/g, '""')}" TO "${newName.replace(/"/g, '""')}"`;
      const db = getDb(connectionString);
      db.exec(sql);
      return sql;
    },

    async alterColumnType(connectionString, schema, table, columnName, newType) {
      // SQLite doesn't support ALTER COLUMN TYPE directly.
      // The standard approach is: recreate table, but that's very complex.
      // For now, throw a clear error.
      throw new Error(
        `SQLite does not support ALTER COLUMN TYPE. To change the type of "${columnName}" in "${table}", ` +
        `you need to create a new table with the desired schema, copy data, drop the old table, and rename.`
      );
    },

    async setColumnNullable(connectionString, schema, table, columnName, isNullable) {
      // SQLite doesn't support changing nullability directly.
      throw new Error(
        `SQLite does not support changing column nullability directly. To change nullability of "${columnName}" in "${table}", ` +
        `you need to recreate the table with the desired schema.`
      );
    },

    async setColumnDefault(connectionString, schema, table, columnName, defaultExpr) {
      // SQLite doesn't support SET/DROP DEFAULT directly.
      throw new Error(
        `SQLite does not support changing column defaults directly. To change the default of "${columnName}" in "${table}", ` +
        `you need to recreate the table with the desired schema.`
      );
    },

    async createIndex(connectionString, schema, table, indexName, columns, unique, ifNotExists) {
      const sql = buildCreateIndexSql(DB_TYPE, schema, table, indexName, columns, unique ?? false, ifNotExists ?? false);
      const db = getDb(connectionString);
      db.exec(sql);
      return sql;
    },

    async dropIndex(connectionString, schema, indexName, _cascade, ifExists) {
      // SQLite: DROP INDEX if_exists? index_name
      const ifExistsClause = ifExists ? "IF EXISTS " : "";
      const sql = `DROP INDEX ${ifExistsClause}"${indexName.replace(/"/g, '""')}"`;
      const db = getDb(connectionString);
      db.exec(sql);
      return sql;
    },

    async createSchema(connectionString, schemaName, ifNotExists) {
      // SQLite doesn't support CREATE SCHEMA — it only has "main" and "temp".
      // For compatibility, we silently ignore this.
      console.warn(`SQLite does not support CREATE SCHEMA. Ignoring createSchema("${schemaName}")`);
      return `-- SQLite does not support CREATE SCHEMA. Schema "${schemaName}" not created.`;
    },

    // ── Clone / Export ──────────────────────────────────────────────

    async exportSchemaDdl(connectionString) {
      const db = getDb(connectionString);

      const tables = (db
        .prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .all() as Array<{ name: string; sql: string | null }>);

      const indexes = (db
        .prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .all() as Array<{ name: string; sql: string | null }>);

      const scripts: Array<{ type: string; schema: string; name: string; sql: string; dependsOn?: string[] }> = [];

      for (const t of tables) {
        if (t.sql) {
          scripts.push({
            type: "table",
            schema: "main",
            name: t.name,
            sql: t.sql.endsWith(";") ? t.sql : `${t.sql};`,
          });
        }
      }

      for (const idx of indexes) {
        if (idx.sql) {
          scripts.push({
            type: "index",
            schema: "main",
            name: idx.name,
            sql: idx.sql.endsWith(";") ? idx.sql : `${idx.sql};`,
          });
        }
      }

      // Row counts
      const tableRowCounts: Array<{ schema: string; table: string; rowCount: number }> = [];
      for (const t of tables) {
        try {
          const countRow = db.prepare(`SELECT COUNT(*) as cnt FROM "${t.name.replace(/"/g, '""')}"`).get() as Record<string, number>;
          tableRowCounts.push({ schema: "main", table: t.name, rowCount: countRow.cnt });
        } catch {
          tableRowCounts.push({ schema: "main", table: t.name, rowCount: 0 });
        }
      }

      return { scripts, tableRowCounts };
    },

    async exportTableData(connectionString, _schema, table, batchSize, offset) {
      const db = getDb(connectionString);
      const rows = db.prepare(`SELECT * FROM "${table.replace(/"/g, '""')}" LIMIT ? OFFSET ?`)
        .all(batchSize + 1, offset) as Record<string, unknown>[];

      const hasMore = rows.length > batchSize;
      const resultRows = hasMore ? rows.slice(0, batchSize) : rows;

      const columns = resultRows.length > 0 ? Object.keys(resultRows[0]) : [];

      return {
        rows: resultRows,
        columns,
        hasMore,
        totalExported: offset + resultRows.length,
      };
    },

    async executeBatchDdl(connectionString, statements, throwOnError) {
      const db = getDb(connectionString);
      const errors: Array<{ sql: string; error: string }> = [];

      for (const sql of statements) {
        try {
          db.exec(sql);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          errors.push({ sql, error: errMsg });
          if (throwOnError) {
            throw new Error(`DDL execution failed: ${errMsg}\nSQL: ${sql}`);
          }
        }
      }

      return { errors };
    },

    async waitForDatabase(connectionString, maxRetries, intervalMs) {
      // SQLite doesn't need to wait for a server — file existence check
      const filePath = parseConnectionString(connectionString);
      for (let i = 0; i < (maxRetries ?? 20); i++) {
        try {
          const db = new BetterSqlite3(filePath);
          db.prepare("SELECT 1").get();
          db.close();
          return;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, intervalMs ?? 250));
        }
      }
      throw new Error(`SQLite database not ready after ${(maxRetries ?? 20) * (intervalMs ?? 250)}ms: ${filePath}`);
    },

    async importTableRows(connectionString, _schema, table, columns, rows) {
      if (rows.length === 0) return 0;

      const db = getDb(connectionString);
      const quotedCols = columns.map((c) => `"${c.replace(/"/g, '""')}"`).join(", ");
      const placeholders = columns.map(() => "?").join(", ");
      const insertSql = `INSERT INTO "${table.replace(/"/g, '""')}" (${quotedCols}) VALUES (${placeholders})`;

      const stmt = db.prepare(insertSql);
      const insertMany = db.transaction((allRows: Record<string, unknown>[]) => {
        for (const row of allRows) {
          const values = columns.map((col) => row[col]);
          stmt.run(...values);
        }
      });

      insertMany(rows);
      return rows.length;
    },
  };
}
