/**
 * ClickHouseDriver — implements DatabaseDriver for ClickHouse.
 *
 * Uses @clickhouse/client with memoized connections via kysely-factory.
 * ClickHouse has significant differences from PostgreSQL/MySQL:
 * - No transactions (ALTER TABLE ... UPDATE instead of UPDATE)
 * - No RETURNING clause
 * - Uses "databases" instead of "schemas"
 * - Schema introspection via system tables + information_schema
 * - SSL via protocol (clickhouses:// → https://)
 */
import type { DatabaseType, SslMode } from "./types";
import { getClickhouseEffectivePort } from "./types";
import type { DatabaseDriver, DriverConnectionConfig } from "./driver";
import { getClickhouseClient } from "./kysely-factory";

// ---------------------------------------------------------------------------
// Identifier escaping — prevent SQL injection for ClickHouse
// ClickHouse uses double-quotes for identifiers, backticks also supported.
// Values should use parameterized queries where possible.
// ---------------------------------------------------------------------------

/** Escape a ClickHouse identifier (schema, table, column name). */
function escId(identifier: string): string {
  // Double any existing double-quotes, then wrap in double-quotes
  return `"${identifier.replace(/"/g, '""')}"`;
}

/** Escape a string value for ClickHouse (single-quotes). */
function escVal(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

import {
  buildAddColumnSql,
  buildCreateTableSql,
  buildDropColumnSql,
  buildDropTableSql,
} from "./ddl-sql";

const DB_TYPE = "clickhouse" as DatabaseType;

/** System databases to exclude from schema introspection. */
const CH_SYSTEM_DATABASES = ["system", "information_schema", "INFORMATION_SCHEMA"];

// ---------------------------------------------------------------------------
// Type mapping — ClickHouse data types → display types
// ---------------------------------------------------------------------------

function mapClickhouseType(chType: string): string {
  const t = (chType ?? "").toLowerCase().replace(/^nullable\(/i, "").replace(/\)$/, "");
  const map: Record<string, string> = {
    string: "string",
    fixedstring: "string",
    uuid: "uuid",
    int8: "number",
    int16: "number",
    int32: "number",
    int64: "number",
    int128: "number",
    int256: "number",
    uint8: "number",
    uint16: "number",
    uint32: "number",
    uint64: "number",
    uint128: "number",
    uint256: "number",
    float32: "number",
    float64: "number",
    decimal: "number",
    date: "date",
    date32: "date",
    datetime: "datetime",
    datetime64: "datetime",
    bool: "boolean",
    boolean: "boolean",
    json: "json",
    array: "array",
    map: "map",
    tuple: "tuple",
    enum: "string",
    lowcardinality: "string",
  };
  // Handle prefixes like LowCardinality(String), Array(Int64), Nullable(String)
  if (t.startsWith("lowcardinality")) return "string";
  if (t.startsWith("array")) return "array";
  if (t.startsWith("map")) return "map";
  if (t.startsWith("tuple")) return "tuple";
  if (t.startsWith("enum")) return "string";
  // Match base type before any parentheses
  const baseType = t.replace(/\(.*/, "");
  return map[baseType] || "unknown";
}

// ---------------------------------------------------------------------------
// ClickHouse Driver implementation
// ---------------------------------------------------------------------------

export function createClickhouseDriver(): DatabaseDriver {
  return {
    type: DB_TYPE,
    defaultPort: 8123,
    defaultDatabase: "default",
    defaultUsername: "default",
    sslModes: ["disable", "require"] as SslMode[],

    buildConnectionString(config: DriverConnectionConfig): string {
      if (config.url) return config.url;
      const ssl = config.ssl_mode === "require";
      const protocol = ssl ? "clickhouses" : "clickhouse";
      // When SSL is enabled, use port 8443 (HTTPS) unless a non-default port is specified
      const port = getClickhouseEffectivePort(config.ssl_mode, config.port);
      return `${protocol}://${encodeURIComponent(config.username)}:${encodeURIComponent(config.password)}@${config.host}:${port}/${config.database}`;
    },

    async testConnection(config) {
      try {
        const connStr = this.buildConnectionString(config);
        const client = await getClickhouseClient(connStr);
        await client.query({ query: "SELECT 1" });
        return true;
      } catch {
        return false;
      }
    },

    async executeQuery(connectionString, sql) {
      const client = await getClickhouseClient(connectionString);
      try {
        // Check if it's a SELECT-type query
        const isSelect = /^\s*(SELECT|SHOW|DESCRIBE|EXPLAIN|WITH)/i.test(sql.trim());

        if (isSelect) {
          const result = await client.query({
            query: sql,
            format: "JSONEachRow",
          });
          const rows = await result.json() as Record<string, unknown>[];

          if (rows.length === 0) {
            return { columns: [], rows: [], row_count: 0 };
          }

          const columns = Object.keys(rows[0]).map((name) => ({
            name,
            type_name: "unknown", // ClickHouse JSON format doesn't include type info
          }));

          return {
            columns,
            rows: rows.map((row) => Object.values(row)),
            row_count: rows.length,
          };
        }

        // DDL/DML execution
        await client.exec({ query: sql });
        return { columns: [], rows: [], row_count: 0 };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`ClickHouse query error: ${msg}`);
      }
    },

    async getDatabaseInfo(connectionString) {
      const client = await getClickhouseClient(connectionString);
      try {
        const versionResult = await client.query({
          query: "SELECT version() AS version",
          format: "JSONEachRow",
        });
        const versionRows = await versionResult.json() as Array<{ version: string }>;
        const version = versionRows[0]?.version ?? "";

        const timezoneResult = await client.query({
          query: "SELECT timezone() AS timezone",
          format: "JSONEachRow",
        });
        const tzRows = await timezoneResult.json() as Array<{ timezone: string }>;
        const timezone = tzRows[0]?.timezone ?? "UTC";

        let size = "";
        try {
          const sizeResult = await client.query({
            query: "SELECT formatReadableSize(sum(data_compressed_bytes)) AS size FROM system.parts WHERE database = currentDatabase() AND active = 1",
            format: "JSONEachRow",
          });
          const sizeRows = await sizeResult.json() as Array<{ size: string }>;
          size = sizeRows[0]?.size ?? "";
        } catch {
          // Not all users have access to system.parts
        }

        return { version, encoding: "UTF-8", timezone, size };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`ClickHouse info error: ${msg}`);
      }
    },

    async getSchema(connectionString) {
      const client = await getClickhouseClient(connectionString);
      try {
        // Schemas → ClickHouse databases
        const schemasResult = await client.query({
          query: `SELECT name AS schema_name FROM system.databases WHERE name NOT IN (${CH_SYSTEM_DATABASES.map((d) => `'${d}'`).join(", ")}) ORDER BY name`,
          format: "JSONEachRow",
        });
        const schemaRows = await schemasResult.json() as Array<{ schema_name: string }>;
        const schemas = schemaRows.map((r) => r.schema_name);

        // Columns from system.columns
        const columnsResult = await client.query({
          query: `SELECT database, table, name AS column_name, type AS data_type, type AS column_type, type AS udt_name, default_kind, default_expression FROM system.columns WHERE database NOT IN (${CH_SYSTEM_DATABASES.map((d) => `'${d}'`).join(", ")}) ORDER BY database, table, position`,
          format: "JSONEachRow",
        });
        const columnRows = await columnsResult.json() as Array<{
          database: string;
          table: string;
          column_name: string;
          data_type: string;
          column_type: string;
          udt_name: string;
          default_kind: string;
          default_expression: string;
        }>;

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
          const key = `${row.database}.${row.table}`;
          if (!tablesMap.has(key)) {
            tablesMap.set(key, {
              name: row.table,
              schema: row.database,
              columns: [],
              indexes: [],
              foreign_keys: [],
              has_rls: false,
              rls_policies: [],
            });
          }

          const isNullable = row.data_type.startsWith("Nullable(");
          const defaultExpr = row.default_kind === "DEFAULT" ? row.default_expression : row.default_kind === "MATERIALIZED" ? row.default_expression : null;

          tablesMap.get(key)!.columns.push({
            name: row.column_name,
            data_type: mapClickhouseType(row.data_type),
            udt_name: row.data_type, // Store raw ClickHouse type for display
            is_nullable: isNullable,
            column_default: defaultExpr,
          });
        }

        return {
          schemas,
          tables: Array.from(tablesMap.values()),
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`ClickHouse schema error: ${msg}`);
      }
    },

    async getSchemaSummary(connectionString) {
      const client = await getClickhouseClient(connectionString);
      try {
        // 1. Schemas (databases) — lightweight query, no column data
        const schemasResult = await client.query({
          query: `SELECT name AS schema_name FROM system.databases WHERE name NOT IN (${CH_SYSTEM_DATABASES.map((d) => `'${d}'`).join(", ")}) ORDER BY name`,
          format: "JSONEachRow",
        });
        const schemaRows = await schemasResult.json() as Array<{ schema_name: string }>;

        // 2. Tables — just schema + name, no column/index data
        const tablesResult = await client.query({
          query: `SELECT database, name FROM system.tables WHERE database NOT IN (${CH_SYSTEM_DATABASES.map((d) => `'${d}'`).join(", ")}) AND engine NOT IN ('View', 'MaterializedView', 'Dictionary') ORDER BY database, name`,
          format: "JSONEachRow",
        });
        const tableRows = await tablesResult.json() as Array<{ database: string; name: string }>;

        return {
          schemas: schemaRows.map((r) => r.schema_name),
          tables: tableRows.map((t) => ({
            name: t.name,
            schema: t.database,
            has_rls: false,
          })),
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`ClickHouse schema summary error: ${msg}`);
      }
    },

    async getTableDetails(connectionString, schema, table) {
      const client = await getClickhouseClient(connectionString);

      try {
        // 1. Columns for this specific table only
        const columnsResult = await client.query({
          query: `SELECT name AS column_name, type AS data_type, type AS udt_name, default_kind, default_expression FROM system.columns WHERE database = ${escVal(schema)} AND table = ${escVal(table)} ORDER BY position`,
          format: "JSONEachRow",
        });
        const columnRows = await columnsResult.json() as Array<{
          column_name: string; data_type: string; udt_name: string;
          default_kind: string; default_expression: string;
        }>;

        const columns = columnRows.map((row) => {
          const isNullable = row.data_type.startsWith("Nullable(");
          const defaultExpr = row.default_kind === "DEFAULT" ? row.default_expression : row.default_kind === "MATERIALIZED" ? row.default_expression : null;
          return {
            name: row.column_name,
            data_type: mapClickhouseType(row.data_type),
            udt_name: row.data_type, // Store raw ClickHouse type for display
            is_nullable: isNullable,
            column_default: defaultExpr,
          };
        });

        return {
          name: table,
          schema,
          has_rls: false,
          columns,
          indexes: [], // ClickHouse indexes are materialized, not traditional
          foreign_keys: [], // ClickHouse doesn't have foreign keys
          rls_policies: [],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`ClickHouse table details error for ${schema}.${table}: ${msg}`);
      }
    },

    async getIndexes(connectionString, schema, table) {
      const client = await getClickhouseClient(connectionString);

      try {
        // ClickHouse data skipping indexes (not traditional indexes)
        const result = await client.query({
          query: `SELECT name, type, expr AS expression FROM system.data_skipping_indices WHERE database = ${escVal(schema)} AND table = ${escVal(table)}`,
          format: "JSONEachRow",
        });
        const indexRows = await result.json() as Array<{
          name: string;
          type: string;
          expression: string;
        }>;

        return indexRows.map((idx) => ({
          name: idx.name,
          schema,
          table,
          columns: [idx.expression], // Expressions, not column names
          isUnique: false, // ClickHouse doesn't have unique indexes
          isPrimary: false,
          type: idx.type,
        }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`ClickHouse getIndexes error for ${schema}.${table}: ${msg}`);
      }
    },

    async getConstraints(connectionString, schema, table) {
      // ClickHouse doesn't have traditional constraints (FK, unique, check)
      // It only has data skipping indices and primary keys via ORDER BY
      return [];
    },

    async getTableStats(connectionString, schema, table) {
      const client = await getClickhouseClient(connectionString);

      try {
        // Get table statistics from system.parts
        const result = await client.query({
          query: `SELECT
            sum(rows) AS row_count,
            sum(bytes_on_disk) AS size_bytes,
            max(modification_time) AS last_modified
          FROM system.parts
          WHERE database = ${escVal(schema)} AND table = ${escVal(table)} AND active = 1`,
          format: "JSONEachRow",
        });
        const statsRow = await result.json() as Array<{
          row_count: number;
          size_bytes: number;
          last_modified: string;
        }>;

        const row = statsRow[0];
        const sizeBytes = row?.size_bytes ?? 0;

        // Format size
        let sizeFormatted = "0 B";
        if (sizeBytes > 0) {
          if (sizeBytes < 1024) {
            sizeFormatted = `${sizeBytes} B`;
          } else if (sizeBytes < 1024 * 1024) {
            sizeFormatted = `${(sizeBytes / 1024).toFixed(2)} KB`;
          } else if (sizeBytes < 1024 * 1024 * 1024) {
            sizeFormatted = `${(sizeBytes / (1024 * 1024)).toFixed(2)} MB`;
          } else {
            sizeFormatted = `${(sizeBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
          }
        }

        return {
          schema,
          table,
          rowCount: Number(row?.row_count ?? 0),
          sizeBytes,
          sizeFormatted,
          lastVacuum: null,
          lastAnalyze: row?.last_modified ?? null,
          lastAutoanalyze: null,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`ClickHouse getTableStats error for ${schema}.${table}: ${msg}`);
      }
    },

    async listRows(connectionString, schema, table, page, pageSize, sort, filters) {
      const client = await getClickhouseClient(connectionString);

      // Build WHERE clause
      const conditions: string[] = [];
      if (filters) {
        for (const f of filters) {            const col = escId(f.column);
            switch (f.operator) {
              case "eq":
                if (f.value == null) conditions.push(`${col} IS NULL`);
                else conditions.push(`${col} = ${escVal(String(f.value))}`);
                break;
              case "neq":
                if (f.value == null) conditions.push(`${col} IS NOT NULL`);
                else conditions.push(`${col} != ${escVal(String(f.value))}`);
                break;
              case "contains":
                conditions.push(`${col} LIKE ${escVal(`%${String(f.value ?? "")}%`)}`);
                break;
              case "starts_with":
                conditions.push(`${col} LIKE ${escVal(`${String(f.value ?? "")}%`)}`);
                break;
              case "ends_with":
                conditions.push(`${col} LIKE ${escVal(`%${String(f.value ?? "")}`)}`);
                break;
              case "gt": conditions.push(`${col} > ${escVal(String(f.value))}`); break;
              case "gte": conditions.push(`${col} >= ${escVal(String(f.value))}`); break;
              case "lt": conditions.push(`${col} < ${escVal(String(f.value))}`); break;
              case "lte": conditions.push(`${col} <= ${escVal(String(f.value))}`); break;
              case "is_null": conditions.push(`${col} IS NULL`); break;
              case "is_not_null": conditions.push(`${col} IS NOT NULL`); break;
              default:
                conditions.push(`${col} LIKE ${escVal(`%${String(f.value ?? "")}%`)}`);
          }
        }
      }

      const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
      const orderBy = sort && sort.length > 0
        ? ` ORDER BY ${sort.map((s) => `"${s.column}" ${s.direction.toUpperCase()}`).join(", ")}`
        : "";
      const offset = (page - 1) * pageSize;

      try {
        const result = await client.query({
          query: `SELECT * FROM ${escId(schema)}.${escId(table)}${where}${orderBy} LIMIT ${pageSize} OFFSET ${offset}`,
          format: "JSONEachRow",
        });
        const rows = await result.json() as Record<string, unknown>[];

        // Count
        const countResult = await client.query({
          query: `SELECT count() AS cnt FROM ${escId(schema)}.${escId(table)}${where}`,
          format: "JSONEachRow",
        });
        const countRows = await countResult.json() as Array<{ cnt: number }>;
        const totalEstimate = Number(countRows[0]?.cnt ?? 0);

        // Primary key — ClickHouse uses ORDER BY as the primary key concept
        let primaryKey: string[] = [];
        try {
          const pkResult = await client.query({
            query: `SELECT name FROM system.columns WHERE database = ${escVal(schema)} AND table = ${escVal(table)} AND is_in_primary_key = 1 ORDER BY position`,
            format: "JSONEachRow",
          });
          const pkRows = await pkResult.json() as Array<{ name: string }>;
          primaryKey = pkRows.map((r) => r.name);
        } catch {
          // is_in_primary_key may not be available in older versions
        }

        const columns = rows.length > 0
          ? Object.keys(rows[0]).map((name) => ({ name, type_name: "unknown" }))
          : [];

        return {
          columns,
          rows,
          primaryKey,
          foreignKeys: [], // ClickHouse doesn't have foreign keys
          pageInfo: { page, pageSize },
          totalEstimate,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`ClickHouse listRows error: ${msg}`);
      }
    },

    // ── DDL operations ──────────────────────────────────────────────
    // ClickHouse DDL has many differences from PostgreSQL/MySQL.
    // We use the shared builders where possible, with ClickHouse-specific overrides.

    async createTable(connectionString, schema, tableName, columns, primaryKeyColumns, ifNotExists) {
      // ClickHouse requires ENGINE clause — default to MergeTree
      const sql = buildCreateTableSql(DB_TYPE, schema, tableName, columns, primaryKeyColumns ?? [], ifNotExists ?? false);
      const chSql = primaryKeyColumns && primaryKeyColumns.length > 0
        ? `${sql} ORDER BY (${primaryKeyColumns.map((c) => escId(c)).join(", ")}) ENGINE = MergeTree()`
        : `${sql} ENGINE = MergeTree() ORDER BY tuple()`;
      const client = await getClickhouseClient(connectionString);
      await client.exec({ query: chSql });
      return chSql;
    },

    async dropTable(connectionString, schema, tableName, _cascade, ifExists) {
      const sql = buildDropTableSql(DB_TYPE, schema, tableName, false, ifExists ?? false);
      const client = await getClickhouseClient(connectionString);
      await client.exec({ query: sql });
      return sql;
    },

    async renameTable(connectionString, schema, oldName, newName) {
      const sql = `RENAME TABLE ${escId(schema)}.${escId(oldName)} TO ${escId(schema)}.${escId(newName)}`;
      const client = await getClickhouseClient(connectionString);
      await client.exec({ query: sql });
      return sql;
    },

    async addColumn(connectionString, schema, table, columnName, dataType, isNullable, defaultExpr, ifNotExists) {
      const sql = buildAddColumnSql(DB_TYPE, schema, table, columnName, dataType, isNullable ?? true, defaultExpr, ifNotExists ?? false);
      const client = await getClickhouseClient(connectionString);
      await client.exec({ query: sql });
      return sql;
    },

    async dropColumn(connectionString, schema, table, columnName, _cascade, ifExists) {
      const sql = buildDropColumnSql(DB_TYPE, schema, table, columnName, false, ifExists ?? false);
      const client = await getClickhouseClient(connectionString);
      await client.exec({ query: sql });
      return sql;
    },

    async renameColumn(connectionString, schema, table, oldName, newName) {
      const sql = `ALTER TABLE ${escId(schema)}.${escId(table)} RENAME COLUMN ${escId(oldName)} TO ${escId(newName)}`;
      const client = await getClickhouseClient(connectionString);
      await client.exec({ query: sql });
      return sql;
    },

    async alterColumnType(connectionString, schema, table, columnName, newType, _usingExpr) {
      const sql = `ALTER TABLE ${escId(schema)}.${escId(table)} MODIFY COLUMN ${escId(columnName)} ${newType}`;
      const client = await getClickhouseClient(connectionString);
      await client.exec({ query: sql });
      return sql;
    },

    async setColumnNullable(connectionString, schema, table, columnName, isNullable) {
      // ClickHouse: need to know the current type to re-specify with/without Nullable
      const client = await getClickhouseClient(connectionString);
      const colResult = await client.query({
        query: `SELECT type FROM system.columns WHERE database = ${escVal(schema)} AND table = ${escVal(table)} AND name = ${escVal(columnName)}`,
        format: "JSONEachRow",
      });
      const colRows = await colResult.json() as Array<{ type: string }>;
      const currentType = colRows[0]?.type ?? "String";

      let newType: string;
      if (isNullable && !currentType.startsWith("Nullable(")) {
        newType = `Nullable(${currentType})`;
      } else if (!isNullable && currentType.startsWith("Nullable(")) {
        newType = currentType.replace(/^Nullable\(/, "").replace(/\)$/, "");
      } else {
        newType = currentType;
      }

      const sql = `ALTER TABLE ${escId(schema)}.${escId(table)} MODIFY COLUMN ${escId(columnName)} ${newType}`;
      await client.exec({ query: sql });
      return sql;
    },

    async setColumnDefault(connectionString, schema, table, columnName, defaultExpr) {
      const client = await getClickhouseClient(connectionString);
      // Get current type
      const colResult = await client.query({
        query: `SELECT type FROM system.columns WHERE database = ${escVal(schema)} AND table = ${escVal(table)} AND name = ${escVal(columnName)}`,
        format: "JSONEachRow",
      });
      const colRows = await colResult.json() as Array<{ type: string }>;
      const currentType = colRows[0]?.type ?? "String";

      const defaultClause = defaultExpr ? ` DEFAULT ${defaultExpr}` : "";
      const sql = `ALTER TABLE ${escId(schema)}.${escId(table)} MODIFY COLUMN ${escId(columnName)} ${currentType}${defaultClause}`;
      await client.exec({ query: sql });
      return sql;
    },

    async createIndex(connectionString, schema, table, indexName, columns, _unique, ifNotExists) {
      // ClickHouse uses "INDEX" within ALTER TABLE (Materialized indexes)
      const ifNotExistsClause = ifNotExists ? "IF NOT EXISTS " : "";
      const cols = columns.map((c) => escId(c)).join(", ");
      const sql = `ALTER TABLE ${escId(schema)}.${escId(table)} ADD INDEX ${ifNotExistsClause}${escId(indexName)} (${cols}) TYPE minbf GRANULARITY 1`;
      const client = await getClickhouseClient(connectionString);
      await client.exec({ query: sql });
      return sql;
    },

    async dropIndex(connectionString, schema, indexName, _cascade, ifExists) {
      // ClickHouse indexes are tied to tables — resolve table from system.columns
      const client = await getClickhouseClient(connectionString);
      const ifExistsClause = ifExists ? "IF EXISTS " : "";
      try {
        const tableResult = await client.query({
          query: `SELECT table FROM system.data_indexes WHERE database = ${escVal(schema)} AND name = ${escVal(indexName)} LIMIT 1`,
          format: "JSONEachRow",
        });
        const tableRows = await tableResult.json() as Array<{ table: string }>;
        const tableName = tableRows[0]?.table;
        if (!tableName) {
          if (ifExists) return `DROP INDEX ${ifExistsClause}${escId(indexName)}`;
          throw new Error(`Index ${schema}.${indexName} not found`);
        }
        const sql = `ALTER TABLE ${escId(schema)}.${escId(tableName)} DROP INDEX ${ifExistsClause}${escId(indexName)}`;
        await client.exec({ query: sql });
        return sql;
      } catch (err) {
        if (ifExists) return `DROP INDEX ${ifExistsClause}${escId(indexName)}`;
        throw err;
      }
    },

    async createSchema(connectionString, schemaName, ifNotExists) {
      const ifNotExistsClause = ifNotExists ? "IF NOT EXISTS " : "";
      const sql = `CREATE DATABASE ${ifNotExistsClause}${escId(schemaName)}`;
      const client = await getClickhouseClient(connectionString);
      await client.exec({ query: sql });
      return sql;
    },

    // ── Clone / Export ──────────────────────────────────────────────

    async exportSchemaDdl(connectionString: string) {
      const client = await getClickhouseClient(connectionString);
      const scripts: Array<{ type: string; schema: string; name: string; sql: string; dependsOn?: string[] }> = [];
      const tableRowCounts: Array<{ schema: string; table: string; rowCount: number }> = [];

      try {
        const excludedDbs = CH_SYSTEM_DATABASES.map((d) => escVal(d)).join(", ");

        // 1. Export databases (ClickHouse "schemas")
        const dbResult = await client.query({
          query: `SELECT name FROM system.databases WHERE name NOT IN (${excludedDbs}) ORDER BY name`,
          format: "JSONEachRow",
        });
        const dbRows = await dbResult.json() as Array<{ name: string }>;

        for (const row of dbRows) {
          scripts.push({
            type: "schema",
            schema: row.name,
            name: row.name,
            sql: `CREATE DATABASE IF NOT EXISTS ${escId(row.name)};`,
          });
        }

        // 2. Export tables using SHOW CREATE TABLE (includes engine, ORDER BY, indexes, etc.)
        const tablesResult = await client.query({
          query: `SELECT database, name, create_table_query FROM system.tables WHERE database NOT IN (${excludedDbs}) AND engine NOT IN ('View', 'MaterializedView', 'Dictionary') ORDER BY database, name`,
          format: "JSONEachRow",
        });
        const tableRows = await tablesResult.json() as Array<{ database: string; name: string; create_table_query: string }>;

        for (const row of tableRows) {
          // create_table_query from system.tables already contains the full
          // CREATE TABLE statement with engine, ORDER BY, PARTITION BY,
          // materialized indexes, etc. — use it directly.
          let sql = row.create_table_query;
          if (!sql.endsWith(";")) sql += ";";

          scripts.push({
            type: "table",
            schema: row.database,
            name: row.name,
            sql,
          });
        }

        // 3. Export materialized views separately
        const mvResult = await client.query({
          query: `SELECT database, name, create_table_query FROM system.tables WHERE database NOT IN (${excludedDbs}) AND engine = 'MaterializedView' ORDER BY database, name`,
          format: "JSONEachRow",
        });
        const mvRows = await mvResult.json() as Array<{ database: string; name: string; create_table_query: string }>;

        for (const row of mvRows) {
          let sql = row.create_table_query;
          if (!sql.endsWith(";")) sql += ";";

          scripts.push({
            type: "table",
            schema: row.database,
            name: row.name,
            sql,
          });
        }

        // 4. Get row counts for all tables — single query via system.parts
        //    (approximate counts from part metadata, much faster than per-table count())
        try {
          const countsResult = await client.query({
            query: `SELECT database, table, sum(rows) AS row_count FROM system.parts WHERE active AND database NOT IN (${excludedDbs}) GROUP BY database, table ORDER BY database, table`,
            format: "JSONEachRow",
          });
          const countsRows = await countsResult.json() as Array<{ database: string; table: string; row_count: number }>;

          // Build a lookup from the parts query
          const countLookup = new Map<string, number>();
          for (const cr of countsRows) {
            countLookup.set(`${cr.database}.${cr.table}`, Number(cr.row_count ?? 0));
          }

          // Merge with the exported tables (some tables may not appear in system.parts)
          for (const row of tableRows) {
            tableRowCounts.push({
              schema: row.database,
              table: row.name,
              rowCount: countLookup.get(`${row.database}.${row.name}`) ?? 0,
            });
          }
        } catch {
          // system.parts may not be accessible — fall back to zero counts
          for (const row of tableRows) {
            tableRowCounts.push({
              schema: row.database,
              table: row.name,
              rowCount: 0,
            });
          }
        }

        return { scripts, tableRowCounts };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`ClickHouse schema export error: ${msg}`);
      }
    },

    async exportTableData(connectionString: string, schema: string, table: string, batchSize: number, offset: number) {
      const client = await getClickhouseClient(connectionString);

      try {
        // Fetch batchSize + 1 rows to detect whether there are more
        const result = await client.query({
          query: `SELECT * FROM ${escId(schema)}.${escId(table)} LIMIT ${batchSize + 1} OFFSET ${offset}`,
          format: "JSONEachRow",
        });
        const allRows = await result.json() as Record<string, unknown>[];

        const hasMore = allRows.length > batchSize;
        const rows = hasMore ? allRows.slice(0, batchSize) : allRows;
        const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

        return {
          rows,
          columns,
          hasMore,
          totalExported: offset + rows.length,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`ClickHouse data export error: ${msg}`);
      }
    },

    async executeBatchDdl(connectionString, statements, _throwOnError) {
      const client = await getClickhouseClient(connectionString);
      const errors: Array<{ sql: string; error: string }> = [];
      for (const sql of statements) {
        try {
          await client.exec({ query: sql });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          errors.push({ sql, error: errMsg });
        }
      }
      return { errors };
    },

    async waitForDatabase(connectionString, maxRetries = 20, intervalMs = 250) {
      for (let i = 0; i < maxRetries; i++) {
        try {
          const client = await getClickhouseClient(connectionString);
          await client.query({ query: "SELECT 1" });
          return;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, intervalMs));
        }
      }
      throw new Error(
        `ClickHouse not ready after ${maxRetries * intervalMs}ms`,
      );
    },

    async importTableRows(connectionString, schema, table, columns, rows) {
      if (rows.length === 0) return 0;
      const client = await getClickhouseClient(connectionString);
      // Convert row arrays to objects matching column names for @clickhouse/client
      const rowsAsObjects = rows.map((row) => {
        const obj: Record<string, unknown> = {};
        for (let i = 0; i < columns.length; i++) {
          obj[columns[i]] = Array.isArray(row) ? row[i] : row;
        }
        return obj;
      });
      await client.insert({
        table: `${escId(schema)}.${escId(table)}`,
        values: rowsAsObjects,
        columns: columns as [string, ...string[]],
      });
      return rows.length;
    },
  };
}
