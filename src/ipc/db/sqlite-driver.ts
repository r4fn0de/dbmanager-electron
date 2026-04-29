/**
 * SqliteDriver — implements DatabaseDriver for SQLite via better-sqlite3.
 *
 * SQLite is a file-based database with no separate server process.
 * It uses pragma-based introspection instead of information_schema.
 * Connection strings use the format: sqlite:///absolute/path/to/file.db
 */
import path from "node:path";
import { createRequire } from "node:module";
import type { DatabaseType, SslMode, SchemaEnum, SchemaFunction, SchemaTrigger } from "./types";
import type { DatabaseDriver, DriverConnectionConfig } from "./driver";
import {
  buildCreateTableSql,
  buildDropTableSql,
  buildAddColumnSql,
  buildCreateIndexSql,
} from "./ddl-sql";

const DB_TYPE = "sqlite" as DatabaseType;

type BetterSqlite3Ctor = new (...args: any[]) => any;
const requireFromHere = createRequire(
  path.join(process.resourcesPath || process.cwd(), "package.json"),
);
let betterSqlite3Cached: BetterSqlite3Ctor | null = null;

function getBetterSqlite3(): BetterSqlite3Ctor {
  if (betterSqlite3Cached) return betterSqlite3Cached;

  const resourceBase = process.resourcesPath;
  const candidates = [
    "better-sqlite3",
    resourceBase ? path.join(resourceBase, "node_modules", "better-sqlite3") : null,
    resourceBase ? path.join(resourceBase, "app.asar.unpacked", "node_modules", "better-sqlite3") : null,
    resourceBase ? path.join(resourceBase, "better-sqlite3") : null,
  ].filter(Boolean) as string[];

  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      const loaded = requireFromHere(candidate) as BetterSqlite3Ctor;
      betterSqlite3Cached = loaded;
      return loaded;
    } catch (err) {
      lastError = err;
    }
  }

  throw new Error(
    `Failed to load better-sqlite3 from known locations. Last error: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

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

const dbCache = new Map<string, any>();

function getDb(connectionString: string): any {
  const existing = dbCache.get(connectionString);
  if (existing) return existing;

  const filePath = parseConnectionString(connectionString);
  const BetterSqlite3 = getBetterSqlite3();
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
        const BetterSqlite3 = getBetterSqlite3();
        const db = new BetterSqlite3(filePath);
        db.prepare("SELECT 1").get();
        db.close();
        return true;
      } catch {
        return false;
      }
    },

    async executeQuery(connectionString, sql, _signal) {
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

      // Compute database file size
      let size: string | undefined;
      try {
        const fs = await import("node:fs/promises");
        const stat = await fs.stat(filePath);
        const bytes = stat.size;
        if (bytes < 1024) size = `${bytes} B`;
        else if (bytes < 1024 * 1024) size = `${(bytes / 1024).toFixed(2)} KB`;
        else if (bytes < 1024 * 1024 * 1024) size = `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
        else size = `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
      } catch {
        // File may not be stat-able (e.g. in-memory or WAL mode)
      }

      return {
        version: `SQLite ${version}`,
        encoding: "UTF-8",
        timezone: "UTC",
        size,
        databaseName: path.basename(filePath),
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

      // Get row counts for each table (SQLite requires per-table COUNT)
      const tablesWithCounts = tableRows.map((t) => {
        let rowCount = 0;
        try {
          const countRow = db.prepare(`SELECT COUNT(*) as cnt FROM "${t.name.replace(/"/g, '""')}"`).get() as Record<string, number>;
          rowCount = countRow?.cnt ?? 0;
        } catch {
          // Table may be a virtual table or otherwise unreadable
        }
        return {
          name: t.name,
          schema: "main",
          has_rls: false,
          estimated_row_count: rowCount,
        };
      });

      return {
        schemas,
        tables: tablesWithCounts,
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

    async getIndexes(connectionString, schema, table) {
      const db = getDb(connectionString);

      try {
        const indexList = db.pragma(`index_list("${table}")`) as unknown as SqliteIndexInfo[];

        return indexList
          .filter((idx) => idx.origin !== "c") // Skip auto-indexes for constraints
          .map((idx) => {
            const idxCols = db.pragma(`index_xinfo("${idx.name}")`) as unknown as SqliteIndexColumn[];
            return {
              name: idx.name,
              schema: "main",
              table,
              columns: idxCols
                .filter((ic) => ic.cid >= 0 && ic.name)
                .map((ic) => ic.name!),
              isUnique: idx.unique === 1,
              isPrimary: idx.origin === "pk",
              type: "btree", // SQLite only supports btree indexes
            };
          });
      } catch (err) {
        throw new Error(`SQLite getIndexes error for ${table}: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    async getConstraints(connectionString, schema, table) {
      const db = getDb(connectionString);
      const constraints: import("./types").ConstraintInfo[] = [];

      try {
        // Get primary key info from table_info pragma
        const colInfo = db.pragma(`table_info("${table}")`) as unknown as SqliteColumnInfo[];
        const pkColumns = colInfo.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);

        if (pkColumns.length > 0) {
          constraints.push({
            name: `${table}_pkey`,
            schema: "main",
            table,
            type: "primary_key",
            columns: pkColumns,
          });
        }

        // Get foreign keys from foreign_key_list pragma
        const fkList = db.pragma(`foreign_key_list("${table}")`) as unknown as SqliteForeignKey[];
        const fkMap = new Map<number, import("./types").ConstraintInfo>();

        for (const fk of fkList) {
          if (!fkMap.has(fk.id)) {
            fkMap.set(fk.id, {
              name: `${table}_${fk.from}_fkey`,
              schema: "main",
              table,
              type: "foreign_key",
              columns: [],
              referencedSchema: "main",
              referencedTable: fk.table,
              referencedColumns: [],
            });
          }
          const constraint = fkMap.get(fk.id)!;
          constraint.columns.push(fk.from);
          constraint.referencedColumns!.push(fk.to);
        }

        constraints.push(...fkMap.values());

        // Get unique constraints from index_list pragma
        const indexList = db.pragma(`index_list("${table}")`) as unknown as SqliteIndexInfo[];
        for (const idx of indexList) {
          if (idx.unique === 1 && idx.origin === "c") {
            const idxCols = db.pragma(`index_xinfo("${idx.name}")`) as unknown as SqliteIndexColumn[];
            constraints.push({
              name: idx.name,
              schema: "main",
              table,
              type: "unique",
              columns: idxCols
                .filter((ic) => ic.cid >= 0 && ic.name)
                .map((ic) => ic.name!),
            });
          }
        }

        return constraints;
      } catch (err) {
        throw new Error(`SQLite getConstraints error for ${table}: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    async getEnums(_connectionString, _schema): Promise<SchemaEnum[]> {
      // SQLite doesn't have native enum types
      return [];
    },

    async getFunctions(connectionString, _schema): Promise<SchemaFunction[]> {
      const db = getDb(connectionString);
      try {
        // SQLite doesn't have user-defined functions accessible via SQL
        // Application-defined functions are not introspectable
        return [];
      } catch {
        return [];
      }
    },

    async getTriggers(connectionString, _schema): Promise<SchemaTrigger[]> {
      const db = getDb(connectionString);
      try {
        const triggers = db
          .prepare("SELECT name, tbl_name, sql FROM sqlite_master WHERE type='trigger' AND name NOT LIKE 'sqlite_%' ORDER BY tbl_name, name")
          .all() as Array<{ name: string; tbl_name: string; sql: string | null }>;

        return triggers.map((t) => {
          // Parse event and timing from the trigger SQL
          const sql = t.sql ?? "";
          const eventMatch = sql.match(/\b(AFTER|BEFORE|INSTEAD OF)\s+(INSERT|UPDATE|DELETE)\b/i);
          return {
            name: t.name,
            schema: "main",
            table: t.tbl_name,
            event: eventMatch?.[2]?.toUpperCase() ?? "UNKNOWN",
            timing: eventMatch?.[1]?.toUpperCase() ?? "AFTER",
            enabled: true, // SQLite doesn't have disabled triggers
            function_name: null,
            definition: t.sql ?? null,
          };
        });
      } catch {
        return [];
      }
    },

    async getTableStats(connectionString, schema, table) {
      const db = getDb(connectionString);

      try {
        // Get approximate row count via SELECT COUNT(*)
        const countRow = db.prepare(`SELECT COUNT(*) as cnt FROM "${table.replace(/"/g, '""')}"`).get() as Record<string, number>;
        const rowCount = countRow?.cnt ?? 0;

        // Get page count and size via pragma page_count and page_size
        const pageCount = db.pragma("page_count") as number;
        const pageSize = db.pragma("page_size") as number;
        const sizeBytes = pageCount * pageSize;

        // Format size
        let sizeFormatted = "0 B";
        if (sizeBytes > 0) {
          if (sizeBytes < 1024) {
            sizeFormatted = `${sizeBytes} B`;
          } else if (sizeBytes < 1024 * 1024) {
            sizeFormatted = `${(sizeBytes / 1024).toFixed(2)} KB`;
          } else {
            sizeFormatted = `${(sizeBytes / (1024 * 1024)).toFixed(2)} MB`;
          }
        }

        return {
          schema: "main",
          table,
          rowCount,
          sizeBytes,
          sizeFormatted,
          lastVacuum: null, // SQLite doesn't track vacuum time
          lastAnalyze: null, // SQLite doesn't have analyze
          lastAutoanalyze: null,
        };
      } catch (err) {
        throw new Error(`SQLite getTableStats error for ${table}: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    async explainQuery(connectionString, sql, analyze = false) {
      const db = getDb(connectionString);

      try {
        // SQLite uses EXPLAIN QUERY PLAN for the execution plan
        // Note: SQLite doesn't support EXPLAIN ANALYZE like PostgreSQL
        // We can only get the query plan, not actual execution stats
        const explainSql = `EXPLAIN QUERY PLAN ${sql}`;
        const stmt = db.prepare(explainSql);
        const rows = stmt.all() as Array<Record<string, unknown>>;

        // Format the plan as a readable tree
        const planLines = rows.map((row) => {
          const id = row.id ?? row.id;
          const parent = row.parent ?? row.parent;
          const notUsed = row.notused ?? row.notused;
          const detail = row.detail ?? row.detail;
          const depth = row.parent === 0 ? 0 : 1; // Simple depth estimation
          const indent = "  ".repeat(depth as number);
          return `${indent}${detail}`;
        });

        const planText = planLines.join("\n");

        // Try to extract row estimates from the plan
        let estimatedRows: number | undefined;
        for (const row of rows) {
          const detail = String(row.detail ?? "");
          // Look for patterns like "~N rows" or "SCAN TABLE" which indicates full scan
          const match = detail.match(/~(\d+) rows/);
          if (match) {
            estimatedRows = Number.parseInt(match[1], 10);
            break;
          }
        }

        return {
          plan: planText,
          hasExecutionStats: false, // SQLite doesn't support ANALYZE in EXPLAIN
          estimatedRows,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`SQLite explainQuery error: ${msg}`);
      }
    },

    async getTableSample(connectionString, schema, table, sampleSize = 100) {
      const db = getDb(connectionString);

      try {
        // Get total row count
        const countStmt = db.prepare(`SELECT COUNT(*) as cnt FROM "${table}"`);
        const totalRows = countStmt.get() as { cnt: number };

        // Get sample rows using random ordering (SQLite uses RANDOM())
        const sampleStmt = db.prepare(`
          SELECT * FROM "${table}"
          ORDER BY RANDOM()
          LIMIT ${sampleSize}
        `);
        const rows = sampleStmt.all() as Record<string, unknown>[];

        // Get column information from PRAGMA
        const pragmaStmt = db.prepare(`PRAGMA table_info("${table}")`);
        const columns = pragmaStmt.all() as Array<{ name: string; type: string; notnull: number }>;

        // Build column statistics
        const columnStats: import("./types").ColumnStat[] = [];

        for (const col of columns) {
          const colName = col.name;
          const dataType = col.type || "TEXT";
          const isNullable = col.notnull === 0;

          const stat: import("./types").ColumnStat = {
            columnName: colName,
            dataType: dataType,
          };

          // Try to get min/max/avg for numeric types
          if (
            dataType.toLowerCase().includes("int") ||
            dataType.toLowerCase().includes("real") ||
            dataType.toLowerCase().includes("float") ||
            dataType.toLowerCase().includes("double") ||
            dataType.toLowerCase().includes("numeric") ||
            dataType.toLowerCase().includes("decimal")
          ) {
            try {
              const statsStmt = db.prepare(`
                SELECT
                  MIN("${colName}") as min_val,
                  MAX("${colName}") as max_val,
                  AVG("${colName}") as avg_val,
                  COUNT(DISTINCT "${colName}") as unique_count,
                  COUNT(*) * 100.0 / NULLIF((SELECT COUNT(*) FROM "${table}"), 0) as null_pct
                FROM "${table}"
              `);
              const row = statsStmt.get() as Record<string, unknown>;
              stat.min = row.min_val as number | string | undefined;
              stat.max = row.max_val as number | string | undefined;
              stat.avg = row.avg_val ? Number.parseFloat(row.avg_val as string) : undefined;
              stat.uniqueCount = Number.parseInt(row.unique_count as string, 10);
              stat.nullPercentage = row.null_pct ? Number.parseFloat(row.null_pct as string) : 0;
            } catch {
              // Ignore stats errors
            }
          } else {
            // For string/categorical columns, get top values
            try {
              const topValuesStmt = db.prepare(`
                SELECT
                  "${colName}" as value,
                  COUNT(*) as count
                FROM "${table}"
                WHERE "${colName}" IS NOT NULL
                GROUP BY "${colName}"
                ORDER BY count DESC
                LIMIT 5
              `);
              const topValues = topValuesStmt.all() as Array<{ value: unknown; count: number }>;
              stat.topValues = topValues.map((r) => ({
                value: String(r.value),
                count: r.count,
              }));

              // Get unique count and null percentage
              const uniqueStmt = db.prepare(`
                SELECT
                  COUNT(DISTINCT "${colName}") as unique_count,
                  COUNT(*) * 100.0 / NULLIF((SELECT COUNT(*) FROM "${table}"), 0) as null_pct
                FROM "${table}"
              `);
              const uniqueRow = uniqueStmt.get() as Record<string, unknown>;
              stat.uniqueCount = Number.parseInt(uniqueRow.unique_count as string, 10);
              stat.nullPercentage = uniqueRow.null_pct ? Number.parseFloat(uniqueRow.null_pct as string) : 0;
            } catch {
              // Ignore stats errors
            }
          }

          columnStats.push(stat);
        }

        return {
          rows,
          columnStats,
          totalRows: totalRows.cnt,
          sampleSize: rows.length,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`SQLite getTableSample error: ${msg}`);
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
          const BetterSqlite3 = getBetterSqlite3();
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
