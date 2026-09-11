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

import { formatUptime } from "@/constants";
import type { DatabaseDriver, DriverConnectionConfig } from "./driver";
import { closeClickhouseClient, getClickhouseClient } from "./kysely-factory";
import type {
  DatabaseType,
  SchemaEnum,
  SchemaFunction,
  SchemaTrigger,
  SslMode,
} from "./types";
import { getClickhouseEffectivePort } from "./types";

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
const CH_SYSTEM_DATABASES = [
  "system",
  "information_schema",
  "INFORMATION_SCHEMA",
];

// ---------------------------------------------------------------------------
// Type mapping — ClickHouse data types → display types
// ---------------------------------------------------------------------------

function mapClickhouseType(chType: string): string {
  const t = (chType ?? "")
    .toLowerCase()
    .replace(/^nullable\(/i, "")
    .replace(/\)$/, "");
  const map: Record<string, string> = {
    array: "array",
    bool: "boolean",
    boolean: "boolean",
    date: "date",
    date32: "date",
    datetime: "datetime",
    datetime64: "datetime",
    decimal: "number",
    enum: "string",
    fixedstring: "string",
    float32: "number",
    float64: "number",
    int8: "number",
    int16: "number",
    int32: "number",
    int64: "number",
    int128: "number",
    int256: "number",
    json: "json",
    lowcardinality: "string",
    map: "map",
    string: "string",
    tuple: "tuple",
    uint8: "number",
    uint16: "number",
    uint32: "number",
    uint64: "number",
    uint128: "number",
    uint256: "number",
    uuid: "uuid",
  };
  // Handle prefixes like LowCardinality(String), Array(Int64), Nullable(String)
  if (t.startsWith("lowcardinality")) {
    return "string";
  }
  if (t.startsWith("array")) {
    return "array";
  }
  if (t.startsWith("map")) {
    return "map";
  }
  if (t.startsWith("tuple")) {
    return "tuple";
  }
  if (t.startsWith("enum")) {
    return "string";
  }
  // Match base type before any parentheses
  const baseType = t.replace(/\(.*/, "");
  return map[baseType] || "unknown";
}

// ---------------------------------------------------------------------------
// ClickHouse Driver implementation
// ---------------------------------------------------------------------------

export function createClickhouseDriver(): DatabaseDriver {
  return {
    async addColumn(
      connectionString,
      schema,
      table,
      columnName,
      dataType,
      isNullable,
      defaultExpr,
      ifNotExists
    ) {
      const sql = buildAddColumnSql(
        DB_TYPE,
        schema,
        table,
        columnName,
        dataType,
        isNullable ?? true,
        defaultExpr,
        ifNotExists ?? false
      );
      const client = await getClickhouseClient(connectionString);
      await client.exec({ query: sql });
      return sql;
    },

    async alterColumnType(
      connectionString,
      schema,
      table,
      columnName,
      newType,
      _usingExpr
    ) {
      const sql = `ALTER TABLE ${escId(schema)}.${escId(table)} MODIFY COLUMN ${escId(columnName)} ${newType}`;
      const client = await getClickhouseClient(connectionString);
      await client.exec({ query: sql });
      return sql;
    },

    buildConnectionString(config: DriverConnectionConfig): string {
      const ssl = config.ssl_mode === "require";
      const protocol = ssl ? "clickhouses" : "clickhouse";
      // When SSL is enabled, use port 8443 (HTTPS) unless a non-default port is specified.
      const effectivePort = getClickhouseEffectivePort(
        config.ssl_mode,
        config.port
      );

      if (config.url) {
        try {
          const parsed = new URL(config.url);
          const currentProtocol = parsed.protocol.toLowerCase();
          if (
            currentProtocol === "clickhouse:" ||
            currentProtocol === "clickhouses:"
          ) {
            parsed.protocol = `${protocol}:`;
            // Force HTTP(S) endpoint port for @clickhouse/client.
            parsed.port = String(effectivePort);
            // Keep database path from URL when present, otherwise use structured database.
            if (!parsed.pathname || parsed.pathname === "/") {
              parsed.pathname = `/${encodeURIComponent(config.database)}`;
            }
            return parsed.toString();
          }
        } catch {
          // Fall back to structured fields below when URL cannot be parsed.
        }
      }

      return `${protocol}://${encodeURIComponent(config.username)}:${encodeURIComponent(config.password)}@${config.host}:${effectivePort}/${config.database}`;
    },

    async createIndex(
      connectionString,
      schema,
      table,
      indexName,
      columns,
      _unique,
      ifNotExists
    ) {
      // ClickHouse uses "INDEX" within ALTER TABLE (Materialized indexes)
      const ifNotExistsClause = ifNotExists ? "IF NOT EXISTS " : "";
      const cols = columns.map((c) => escId(c)).join(", ");
      const sql = `ALTER TABLE ${escId(schema)}.${escId(table)} ADD INDEX ${ifNotExistsClause}${escId(indexName)} (${cols}) TYPE minbf GRANULARITY 1`;
      const client = await getClickhouseClient(connectionString);
      await client.exec({ query: sql });
      return sql;
    },

    async createSchema(connectionString, schemaName, ifNotExists) {
      const ifNotExistsClause = ifNotExists ? "IF NOT EXISTS " : "";
      const sql = `CREATE DATABASE ${ifNotExistsClause}${escId(schemaName)}`;
      const client = await getClickhouseClient(connectionString);
      await client.exec({ query: sql });
      return sql;
    },

    // ── DDL operations ──────────────────────────────────────────────
    // ClickHouse DDL has many differences from PostgreSQL/MySQL.
    // We use the shared builders where possible, with ClickHouse-specific overrides.

    async createTable(
      connectionString,
      schema,
      tableName,
      columns,
      primaryKeyColumns,
      ifNotExists
    ) {
      // ClickHouse requires ENGINE clause — default to MergeTree
      const sql = buildCreateTableSql(
        DB_TYPE,
        schema,
        tableName,
        columns,
        primaryKeyColumns ?? [],
        ifNotExists ?? false
      );
      const chSql =
        primaryKeyColumns && primaryKeyColumns.length > 0
          ? `${sql} ORDER BY (${primaryKeyColumns.map((c) => escId(c)).join(", ")}) ENGINE = MergeTree()`
          : `${sql} ENGINE = MergeTree() ORDER BY tuple()`;
      const client = await getClickhouseClient(connectionString);
      await client.exec({ query: chSql });
      return chSql;
    },
    defaultDatabase: "default",
    defaultPort: 8123,
    defaultUsername: "default",

    async dropColumn(
      connectionString,
      schema,
      table,
      columnName,
      _cascade,
      ifExists
    ) {
      const sql = buildDropColumnSql(
        DB_TYPE,
        schema,
        table,
        columnName,
        false,
        ifExists ?? false
      );
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
          format: "JSONEachRow",
          query: `SELECT table FROM system.data_indexes WHERE database = ${escVal(schema)} AND name = ${escVal(indexName)} LIMIT 1`,
        });
        const tableRows = (await tableResult.json()) as Array<{
          table: string;
        }>;
        const tableName = tableRows[0]?.table;
        if (!tableName) {
          if (ifExists) {
            return `DROP INDEX ${ifExistsClause}${escId(indexName)}`;
          }
          throw new Error(`Index ${schema}.${indexName} not found`);
        }
        const sql = `ALTER TABLE ${escId(schema)}.${escId(tableName)} DROP INDEX ${ifExistsClause}${escId(indexName)}`;
        await client.exec({ query: sql });
        return sql;
      } catch (err) {
        if (ifExists) {
          return `DROP INDEX ${ifExistsClause}${escId(indexName)}`;
        }
        throw err;
      }
    },

    async dropTable(connectionString, schema, tableName, _cascade, ifExists) {
      const sql = buildDropTableSql(
        DB_TYPE,
        schema,
        tableName,
        false,
        ifExists ?? false
      );
      const client = await getClickhouseClient(connectionString);
      await client.exec({ query: sql });
      return sql;
    },

    async executeBatchDdl(connectionString, statements, _throwOnError) {
      const client = await getClickhouseClient(connectionString);
      const errors: Array<{ sql: string; error: string }> = [];
      for (const sql of statements) {
        try {
          await client.exec({ query: sql });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          errors.push({ error: errMsg, sql });
        }
      }
      return { errors };
    },

    async executeQuery(connectionString, sql, _signal) {
      const client = await getClickhouseClient(connectionString);
      try {
        // Check if it's a SELECT-type query
        const isSelect = /^\s*(SELECT|SHOW|DESCRIBE|EXPLAIN|WITH)/i.test(
          sql.trim()
        );

        if (isSelect) {
          const result = await client.query({
            format: "JSONEachRow",
            query: sql,
          });
          const rows = (await result.json()) as Record<string, unknown>[];

          if (rows.length === 0) {
            return { columns: [], row_count: 0, rows: [] };
          }

          const columns = Object.keys(rows[0]).map((name) => ({
            name,
            type_name: "unknown", // ClickHouse JSON format doesn't include type info
          }));

          return {
            columns,
            row_count: rows.length,
            rows: rows.map((row) => Object.values(row)),
          };
        }

        // DDL/DML execution
        await client.exec({ query: sql });
        return { columns: [], row_count: 0, rows: [] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`ClickHouse query error: ${msg}`);
      }
    },

    async explainQuery(connectionString, sql, analyze = false) {
      const client = await getClickhouseClient(connectionString);

      try {
        // ClickHouse uses EXPLAIN with various settings
        // For ANALYZE, we use EXPLAIN PIPELINE or EXPLAIN PLAN
        let explainSql: string;
        if (analyze) {
          // ClickHouse 20.6+ supports EXPLAIN ANALYZE
          explainSql = `EXPLAIN ANALYZE ${sql}`;
        } else {
          explainSql = `EXPLAIN PLAN ${sql}`;
        }

        const result = await client.query({
          format: "JSONEachRow",
          query: explainSql,
        });
        const rows = await result.json<Record<string, unknown>[]>();

        // Format the plan
        const planText = rows
          .map((row) =>
            Object.entries(row)
              .map(([k, v]) => `${k}: ${v}`)
              .join("\n")
          )
          .join("\n\n");

        return {
          hasExecutionStats: analyze,
          plan: planText,
        };
      } catch (err) {
        // Fallback to simple EXPLAIN if ANALYZE fails
        if (analyze) {
          try {
            const result = await client.query({
              format: "JSONEachRow",
              query: `EXPLAIN PLAN ${sql}`,
            });
            const rows = await result.json<Record<string, unknown>[]>();

            const planText = rows
              .map((row) =>
                Object.entries(row)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join("\n")
              )
              .join("\n\n");

            return {
              hasExecutionStats: false,
              plan: planText,
            };
          } catch {
            // Fall through to outer error
          }
        }
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`ClickHouse explainQuery error: ${msg}`);
      }
    },

    // ── Clone / Export ──────────────────────────────────────────────

    async exportSchemaDdl(connectionString: string) {
      const client = await getClickhouseClient(connectionString);
      const scripts: Array<{
        type: string;
        schema: string;
        name: string;
        sql: string;
        dependsOn?: string[];
      }> = [];
      const tableRowCounts: Array<{
        schema: string;
        table: string;
        rowCount: number;
      }> = [];

      try {
        const excludedDbs = CH_SYSTEM_DATABASES.map((d) => escVal(d)).join(
          ", "
        );

        // 1. Export databases (ClickHouse "schemas")
        const dbResult = await client.query({
          format: "JSONEachRow",
          query: `SELECT name FROM system.databases WHERE name NOT IN (${excludedDbs}) ORDER BY name`,
        });
        const dbRows = (await dbResult.json()) as Array<{ name: string }>;

        for (const row of dbRows) {
          scripts.push({
            name: row.name,
            schema: row.name,
            sql: `CREATE DATABASE IF NOT EXISTS ${escId(row.name)};`,
            type: "schema",
          });
        }

        // 2. Export tables using SHOW CREATE TABLE (includes engine, ORDER BY, indexes, etc.)
        const tablesResult = await client.query({
          format: "JSONEachRow",
          query: `SELECT database, name, create_table_query FROM system.tables WHERE database NOT IN (${excludedDbs}) AND engine NOT IN ('View', 'MaterializedView', 'Dictionary') ORDER BY database, name`,
        });
        const tableRows = (await tablesResult.json()) as Array<{
          database: string;
          name: string;
          create_table_query: string;
        }>;

        for (const row of tableRows) {
          // create_table_query from system.tables already contains the full
          // CREATE TABLE statement with engine, ORDER BY, PARTITION BY,
          // materialized indexes, etc. — use it directly.
          let sql = row.create_table_query;
          if (!sql.endsWith(";")) {
            sql += ";";
          }

          scripts.push({
            name: row.name,
            schema: row.database,
            sql,
            type: "table",
          });
        }

        // 3. Export materialized views separately
        const mvResult = await client.query({
          format: "JSONEachRow",
          query: `SELECT database, name, create_table_query FROM system.tables WHERE database NOT IN (${excludedDbs}) AND engine = 'MaterializedView' ORDER BY database, name`,
        });
        const mvRows = (await mvResult.json()) as Array<{
          database: string;
          name: string;
          create_table_query: string;
        }>;

        for (const row of mvRows) {
          let sql = row.create_table_query;
          if (!sql.endsWith(";")) {
            sql += ";";
          }

          scripts.push({
            name: row.name,
            schema: row.database,
            sql,
            type: "table",
          });
        }

        // 4. Get row counts for all tables — single query via system.parts
        //    (approximate counts from part metadata, much faster than per-table count())
        try {
          const countsResult = await client.query({
            format: "JSONEachRow",
            query: `SELECT database, table, sum(rows) AS row_count FROM system.parts WHERE active AND database NOT IN (${excludedDbs}) GROUP BY database, table ORDER BY database, table`,
          });
          const countsRows = (await countsResult.json()) as Array<{
            database: string;
            table: string;
            row_count: number;
          }>;

          // Build a lookup from the parts query
          const countLookup = new Map<string, number>();
          for (const cr of countsRows) {
            countLookup.set(
              `${cr.database}.${cr.table}`,
              Number(cr.row_count ?? 0)
            );
          }

          // Merge with the exported tables (some tables may not appear in system.parts)
          for (const row of tableRows) {
            tableRowCounts.push({
              rowCount: countLookup.get(`${row.database}.${row.name}`) ?? 0,
              schema: row.database,
              table: row.name,
            });
          }
        } catch {
          // system.parts may not be accessible — fall back to zero counts
          for (const row of tableRows) {
            tableRowCounts.push({
              rowCount: 0,
              schema: row.database,
              table: row.name,
            });
          }
        }

        return { scripts, tableRowCounts };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`ClickHouse schema export error: ${msg}`);
      }
    },

    async exportTableData(
      connectionString: string,
      schema: string,
      table: string,
      batchSize: number,
      offset: number
    ) {
      const client = await getClickhouseClient(connectionString);

      try {
        // Fetch batchSize + 1 rows to detect whether there are more
        const result = await client.query({
          format: "JSONEachRow",
          query: `SELECT * FROM ${escId(schema)}.${escId(table)} LIMIT ${batchSize + 1} OFFSET ${offset}`,
        });
        const allRows = (await result.json()) as Record<string, unknown>[];

        const hasMore = allRows.length > batchSize;
        const rows = hasMore ? allRows.slice(0, batchSize) : allRows;
        const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

        return {
          columns,
          hasMore,
          rows,
          totalExported: offset + rows.length,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`ClickHouse data export error: ${msg}`);
      }
    },

    async getConstraints(_connectionString, _schema, _table) {
      // ClickHouse doesn't have traditional constraints (FK, unique, check)
      // It only has data skipping indices and primary keys via ORDER BY
      return [];
    },

    async getDatabaseInfo(connectionString) {
      const client = await getClickhouseClient(connectionString);
      try {
        // Core info — these should always work
        const versionResult = await client.query({
          format: "JSONEachRow",
          query: "SELECT version() AS version",
        });
        const versionRows = (await versionResult.json()) as Array<{
          version: string;
        }>;
        const version = versionRows[0]?.version ?? "";

        const timezoneResult = await client.query({
          format: "JSONEachRow",
          query: "SELECT timezone() AS timezone",
        });
        const tzRows = (await timezoneResult.json()) as Array<{
          timezone: string;
        }>;
        const timezone = tzRows[0]?.timezone ?? "UTC";

        let size = "";
        try {
          const sizeResult = await client.query({
            format: "JSONEachRow",
            query:
              "SELECT formatReadableSize(sum(data_compressed_bytes)) AS size FROM system.parts WHERE database = currentDatabase() AND active = 1",
          });
          const sizeRows = (await sizeResult.json()) as Array<{ size: string }>;
          size = sizeRows[0]?.size ?? "";
        } catch {
          // Not all users have access to system.parts
        }

        // Extended stats — may fail on restricted environments.
        // Wrapped in try/catch so basic info still returns.
        let uptime: string | undefined;
        let activeConnections: number | undefined;
        let maxConnections: number | undefined;
        let cacheHitRatio: number | undefined;
        let databaseName: string | undefined;

        try {
          // ClickHouse uptime from system.server_settings or uptime() function
          const uptimeResult = await client.query({
            format: "JSONEachRow",
            query: "SELECT uptime() AS uptime_seconds",
          });
          const uptimeRows = (await uptimeResult.json()) as Array<{
            uptime_seconds: number;
          }>;
          const secs = uptimeRows[0]?.uptime_seconds;
          if (secs != null && secs > 0 && !Number.isNaN(secs)) {
            uptime = formatUptime(secs);
          }
        } catch {
          // uptime() may not be available in older ClickHouse versions
        }

        try {
          // Active connections from system.metrics
          const connResult = await client.query({
            format: "JSONEachRow",
            query:
              "SELECT value FROM system.metrics WHERE metric = 'Connection'",
          });
          const connRows = (await connResult.json()) as Array<{
            value: string;
          }>;
          activeConnections =
            connRows[0]?.value == null ? undefined : Number(connRows[0].value);
        } catch {
          // system.metrics may not be accessible
        }

        try {
          // Max connections from system.settings
          const maxConnResult = await client.query({
            format: "JSONEachRow",
            query:
              "SELECT value FROM system.settings WHERE name = 'max_connections'",
          });
          const maxConnRows = (await maxConnResult.json()) as Array<{
            value: string;
          }>;
          maxConnections =
            maxConnRows[0]?.value == null
              ? undefined
              : Number(maxConnRows[0].value);
        } catch {
          // system.settings may not be accessible
        }

        try {
          const dbResult = await client.query({
            format: "JSONEachRow",
            query: "SELECT currentDatabase() AS database_name",
          });
          const dbRows = (await dbResult.json()) as Array<{
            database_name: string;
          }>;
          databaseName = dbRows[0]?.database_name ?? undefined;
        } catch {
          // Should always work, but be safe
        }

        // Mark cache hit ratio — ClickHouse's closest analog to a buffer cache hit ratio.
        // Uses system.events: MarkCacheHits / (MarkCacheHits + MarkCacheMissesOrTooEarly).
        try {
          const cacheResult = await client.query({
            format: "JSONEachRow",
            query: `
              SELECT
                (SELECT value FROM system.events WHERE event = 'MarkCacheHits') AS hits,
                (SELECT value FROM system.events WHERE event = 'MarkCacheMissesOrTooEarly') AS misses
            `,
          });
          const cacheRows = (await cacheResult.json()) as Array<{
            hits: string;
            misses: string;
          }>;
          const hits =
            cacheRows[0]?.hits == null ? undefined : Number(cacheRows[0].hits);
          const misses =
            cacheRows[0]?.misses == null
              ? undefined
              : Number(cacheRows[0].misses);
          if (hits != null && misses != null) {
            const total = hits + misses;
            if (total > 0) {
              cacheHitRatio = Math.round((hits / total) * 1000) / 10;
            }
          }
        } catch {
          // system.events may not be accessible in restricted environments
        }

        return {
          activeConnections,
          cacheHitRatio,
          databaseName,
          encoding: "UTF-8",
          maxConnections,
          size,
          timezone,
          uptime,
          version,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`ClickHouse info error: ${msg}`);
      }
    },

    async getEnums(connectionString, schema): Promise<SchemaEnum[]> {
      const client = await getClickhouseClient(connectionString);
      try {
        // ClickHouse Enum types are embedded in column definitions, e.g. Enum8('a'=1,'b'=2)
        // Extract from system.columns
        const result = await client.query({
          format: "JSONEachRow",
          query: `SELECT name, type, table
                   FROM system.columns
                   WHERE database = ${escVal(schema)}
                     AND type LIKE 'Enum%'
                   ORDER BY table, name`,
        });
        const rows = (await result.json()) as Array<{
          name: string;
          type: string;
          table: string;
        }>;

        const enumMap = new Map<string, SchemaEnum>();
        for (const row of rows) {
          // Parse Enum8('val1'=1,'val2'=2) or Enum16(...)
          const match = row.type.match(/^Enum\d+\((.*)\)$/);
          if (!match) {
            continue;
          }
          const values = match[1].split(",").map((v: string) => {
            const valMatch = v.trim().match(/^'([^']*)'/);
            return valMatch ? valMatch[1] : v.trim();
          });
          const enumName = `${row.table}_${row.name}_enum`;
          if (!enumMap.has(enumName)) {
            enumMap.set(enumName, { name: enumName, schema, values });
          }
        }
        return Array.from(enumMap.values());
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`ClickHouse getEnums error for ${schema}: ${msg}`);
      }
    },

    async getFunctions(_connectionString, _schema): Promise<SchemaFunction[]> {
      // ClickHouse doesn't have user-defined functions in the traditional sense
      // It has lambda functions in column expressions, but those aren't introspectable
      return [];
    },

    async getIndexes(connectionString, schema, table) {
      const client = await getClickhouseClient(connectionString);

      try {
        // ClickHouse data skipping indexes (not traditional indexes)
        const result = await client.query({
          format: "JSONEachRow",
          query: `SELECT name, type, expr AS expression FROM system.data_skipping_indices WHERE database = ${escVal(schema)} AND table = ${escVal(table)}`,
        });
        const indexRows = (await result.json()) as Array<{
          name: string;
          type: string;
          expression: string;
        }>;

        return indexRows.map((idx) => ({
          columns: [idx.expression], // Expressions, not column names
          isPrimary: false,
          isUnique: false, // ClickHouse doesn't have unique indexes
          name: idx.name,
          schema,
          table,
          type: idx.type,
        }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `ClickHouse getIndexes error for ${schema}.${table}: ${msg}`
        );
      }
    },

    async getSchema(connectionString) {
      const client = await getClickhouseClient(connectionString);
      try {
        // Schemas → ClickHouse databases
        const schemasResult = await client.query({
          format: "JSONEachRow",
          query: `SELECT name AS schema_name FROM system.databases WHERE name NOT IN (${CH_SYSTEM_DATABASES.map((d) => `'${d}'`).join(", ")}) ORDER BY name`,
        });
        const schemaRows = (await schemasResult.json()) as Array<{
          schema_name: string;
        }>;
        const schemas = schemaRows.map((r) => r.schema_name);

        // Columns from system.columns
        const columnsResult = await client.query({
          format: "JSONEachRow",
          query: `SELECT database, table, name AS column_name, type AS data_type, type AS column_type, type AS udt_name, default_kind, default_expression FROM system.columns WHERE database NOT IN (${CH_SYSTEM_DATABASES.map((d) => `'${d}'`).join(", ")}) ORDER BY database, table, position`,
        });
        const columnRows = (await columnsResult.json()) as Array<{
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
        const tablesMap = new Map<
          string,
          {
            name: string;
            schema: string;
            columns: Array<{
              name: string;
              data_type: string;
              udt_name: string | null;
              is_nullable: boolean;
              column_default: string | null;
            }>;
            indexes: Array<{
              name: string;
              is_unique: boolean;
              is_primary: boolean;
              column_names: string[];
            }>;
            foreign_keys: Array<{
              name: string;
              column_name: string;
              referenced_schema: string | undefined;
              referenced_table: string;
              referenced_column: string;
            }>;
            has_rls: boolean;
            rls_policies: Array<{
              name: string;
              kind: string;
              roles: string[];
              using_expr: string | null;
              with_check_expr: string | null;
            }>;
          }
        >();

        for (const row of columnRows) {
          const key = `${row.database}.${row.table}`;
          if (!tablesMap.has(key)) {
            tablesMap.set(key, {
              columns: [],
              foreign_keys: [],
              has_rls: false,
              indexes: [],
              name: row.table,
              rls_policies: [],
              schema: row.database,
            });
          }

          const isNullable = row.data_type.startsWith("Nullable(");
          const defaultExpr =
            row.default_kind === "DEFAULT"
              ? row.default_expression
              : row.default_kind === "MATERIALIZED"
                ? row.default_expression
                : null;

          tablesMap.get(key)!.columns.push({
            column_default: defaultExpr,
            data_type: mapClickhouseType(row.data_type),
            is_nullable: isNullable,
            name: row.column_name,
            udt_name: row.data_type, // Store raw ClickHouse type for display
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
          format: "JSONEachRow",
          query: `SELECT name AS schema_name FROM system.databases WHERE name NOT IN (${CH_SYSTEM_DATABASES.map((d) => `'${d}'`).join(", ")}) ORDER BY name`,
        });
        const schemaRows = (await schemasResult.json()) as Array<{
          schema_name: string;
        }>;

        // 2. Tables — schema + name + estimated row count from system.parts
        const tablesResult = await client.query({
          format: "JSONEachRow",
          query: `SELECT database, name, total_rows FROM system.tables WHERE database NOT IN (${CH_SYSTEM_DATABASES.map((d) => `'${d}'`).join(", ")}) AND engine NOT IN ('View', 'MaterializedView', 'Dictionary') ORDER BY database, name`,
        });
        const tableRows = (await tablesResult.json()) as Array<{
          database: string;
          name: string;
          total_rows: string | null;
        }>;

        return {
          schemas: schemaRows.map((r) => r.schema_name),
          tables: tableRows.map((t) => ({
            // total_rows from system.tables may be NULL for empty/new tables
            estimated_row_count:
              t.total_rows == null ? 0 : Number(t.total_rows),
            has_rls: false,
            name: t.name,
            schema: t.database,
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
          format: "JSONEachRow",
          query: `SELECT name AS column_name, type AS data_type, type AS udt_name, default_kind, default_expression FROM system.columns WHERE database = ${escVal(schema)} AND table = ${escVal(table)} ORDER BY position`,
        });
        const columnRows = (await columnsResult.json()) as Array<{
          column_name: string;
          data_type: string;
          udt_name: string;
          default_kind: string;
          default_expression: string;
        }>;

        const columns = columnRows.map((row) => {
          const isNullable = row.data_type.startsWith("Nullable(");
          const defaultExpr =
            row.default_kind === "DEFAULT"
              ? row.default_expression
              : row.default_kind === "MATERIALIZED"
                ? row.default_expression
                : null;
          return {
            column_default: defaultExpr,
            data_type: mapClickhouseType(row.data_type),
            is_nullable: isNullable,
            name: row.column_name,
            udt_name: row.data_type, // Store raw ClickHouse type for display
          };
        });

        return {
          columns,
          foreign_keys: [], // ClickHouse doesn't have foreign keys
          has_rls: false,
          indexes: [], // ClickHouse indexes are materialized, not traditional
          name: table,
          rls_policies: [],
          schema,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `ClickHouse table details error for ${schema}.${table}: ${msg}`
        );
      }
    },

    async getTableSample(connectionString, schema, table, sampleSize = 100) {
      const client = await getClickhouseClient(connectionString);

      try {
        // Get total row count
        const countResult = await client.query({
          format: "JSONEachRow",
          query: `SELECT count() as cnt FROM ${escId(schema)}.${escId(table)}`,
        });
        const countRows = (await countResult.json()) as Array<{ cnt: string }>;
        const totalRows = Number.parseInt(countRows[0]?.cnt ?? "0", 10);

        // Get sample using ClickHouse's sampling
        // ClickHouse has native sampling via SAMPLE clause
        let sampleQuery: string;
        if (totalRows > 10_000) {
          // Use native sampling for large tables
          const sampleRatio = Math.min((sampleSize / totalRows) * 100, 100);
          sampleQuery = `SELECT * FROM ${escId(schema)}.${escId(table)} SAMPLE ${sampleRatio} LIMIT ${sampleSize}`;
        } else {
          // Use ORDER BY rand() for smaller tables
          sampleQuery = `SELECT * FROM ${escId(schema)}.${escId(table)} ORDER BY rand() LIMIT ${sampleSize}`;
        }

        const sampleResult = await client.query({
          format: "JSONEachRow",
          query: sampleQuery,
        });
        const rows = (await sampleResult.json()) as Record<string, unknown>[];

        // Get column information from system.columns
        const columnsResult = await client.query({
          format: "JSONEachRow",
          query: `SELECT
            name as column_name,
            type as data_type
          FROM system.columns
          WHERE database = ${escVal(schema)} AND table = ${escVal(table)}
          ORDER BY position`,
        });
        const columns = (await columnsResult.json()) as Array<{
          column_name: string;
          data_type: string;
        }>;

        // Build column statistics using ClickHouse's built-in functions
        const columnStats: import("./types").ColumnStat[] = [];

        for (const col of columns) {
          const colName = col.column_name;
          const dataType = col.data_type;

          const stat: import("./types").ColumnStat = {
            columnName: colName,
            dataType,
          };

          // Check if type is numeric
          const isNumeric =
            dataType.includes("Int") ||
            dataType.includes("Float") ||
            dataType.includes("Decimal") ||
            dataType.includes("Double");

          if (isNumeric) {
            try {
              const statsResult = await client.query({
                format: "JSONEachRow",
                query: `SELECT
                  min("${colName}") as min_val,
                  max("${colName}") as max_val,
                  avg("${colName}") as avg_val,
                  uniqExact("${colName}") as unique_count,
                  countIf("${colName}" IS NULL) * 100.0 / count() as null_pct
                FROM ${escId(schema)}.${escId(table)}`,
              });
              const statsRows = (await statsResult.json()) as Record<string, unknown>[];
              const row = statsRows[0] as
                | {
                    min_val?: unknown;
                    max_val?: unknown;
                    avg_val?: string;
                    unique_count?: string;
                    null_pct?: string;
                  }
                | undefined;
              if (row) {
                stat.min = row.min_val as number | string | undefined;
                stat.max = row.max_val as number | string | undefined;
                stat.avg = row.avg_val
                  ? Number.parseFloat(row.avg_val)
                  : undefined;
                stat.uniqueCount = row.unique_count
                  ? Number.parseInt(row.unique_count, 10)
                  : undefined;
                stat.nullPercentage = row.null_pct
                  ? Number.parseFloat(row.null_pct)
                  : 0;
              }
            } catch {
              // Ignore stats errors
            }
          } else {
            // For string/categorical columns
            try {
              const topValuesResult = await client.query({
                format: "JSONEachRow",
                query: `SELECT
                  "${colName}" as value,
                  count() as count
                FROM ${escId(schema)}.${escId(table)}
                WHERE "${colName}" IS NOT NULL
                GROUP BY "${colName}"
                ORDER BY count DESC
                LIMIT 5`,
              });
              const topValues = (await topValuesResult.json()) as Array<{
                value: unknown;
                count: string;
              }>;
              stat.topValues = topValues.map((r) => ({
                count: Number.parseInt(r.count, 10),
                value: String(r.value),
              }));

              // Get unique count and null percentage
              const uniqueResult = await client.query({
                format: "JSONEachRow",
                query: `SELECT
                  uniqExact("${colName}") as unique_count,
                  countIf("${colName}" IS NULL) * 100.0 / count() as null_pct
                FROM ${escId(schema)}.${escId(table)}`,
              });
              const uniqueRows = (await uniqueResult.json()) as Record<string, unknown>[];
              const uniqueRow = uniqueRows[0] as
                | { unique_count?: string; null_pct?: string }
                | undefined;
              if (uniqueRow) {
                stat.uniqueCount = uniqueRow.unique_count
                  ? Number.parseInt(uniqueRow.unique_count, 10)
                  : undefined;
                stat.nullPercentage = uniqueRow.null_pct
                  ? Number.parseFloat(uniqueRow.null_pct)
                  : 0;
              }
            } catch {
              // Ignore stats errors
            }
          }

          columnStats.push(stat);
        }

        return {
          columnStats,
          rows,
          sampleSize: rows.length,
          totalRows,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`ClickHouse getTableSample error: ${msg}`);
      }
    },

    async getTableStats(connectionString, schema, table) {
      const client = await getClickhouseClient(connectionString);

      try {
        // Get table statistics from system.parts
        const result = await client.query({
          format: "JSONEachRow",
          query: `SELECT
            sum(rows) AS row_count,
            sum(bytes_on_disk) AS size_bytes,
            max(modification_time) AS last_modified
          FROM system.parts
          WHERE database = ${escVal(schema)} AND table = ${escVal(table)} AND active = 1`,
        });
        const statsRow = (await result.json()) as Array<{
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
          lastAnalyze: row?.last_modified ?? null,
          lastAutoanalyze: null,
          lastVacuum: null,
          rowCount: Number(row?.row_count ?? 0),
          schema,
          sizeBytes,
          sizeFormatted,
          table,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `ClickHouse getTableStats error for ${schema}.${table}: ${msg}`
        );
      }
    },

    async getTriggers(_connectionString, _schema): Promise<SchemaTrigger[]> {
      // ClickHouse doesn't have triggers
      return [];
    },

    async importTableRows(connectionString, schema, table, columns, rows) {
      if (rows.length === 0) {
        return 0;
      }
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
        columns: columns as [string, ...string[]],
        table: `${escId(schema)}.${escId(table)}`,
        values: rowsAsObjects,
      });
      return rows.length;
    },

    async listRows(
      connectionString,
      schema,
      table,
      page,
      pageSize,
      sort,
      filters
    ) {
      const client = await getClickhouseClient(connectionString);

      // Build WHERE clause
      const conditions: string[] = [];
      if (filters) {
        for (const f of filters) {
          const col = escId(f.column);
          switch (f.operator) {
            case "eq":
              if (f.value == null) {
                conditions.push(`${col} IS NULL`);
              } else {
                conditions.push(`${col} = ${escVal(String(f.value))}`);
              }
              break;
            case "neq":
              if (f.value == null) {
                conditions.push(`${col} IS NOT NULL`);
              } else {
                conditions.push(`${col} != ${escVal(String(f.value))}`);
              }
              break;
            case "contains":
              conditions.push(
                `${col} LIKE ${escVal(`%${String(f.value ?? "")}%`)}`
              );
              break;
            case "starts_with":
              conditions.push(
                `${col} LIKE ${escVal(`${String(f.value ?? "")}%`)}`
              );
              break;
            case "ends_with":
              conditions.push(
                `${col} LIKE ${escVal(`%${String(f.value ?? "")}`)}`
              );
              break;
            case "gt":
              conditions.push(`${col} > ${escVal(String(f.value))}`);
              break;
            case "gte":
              conditions.push(`${col} >= ${escVal(String(f.value))}`);
              break;
            case "lt":
              conditions.push(`${col} < ${escVal(String(f.value))}`);
              break;
            case "lte":
              conditions.push(`${col} <= ${escVal(String(f.value))}`);
              break;
            case "is_null":
              conditions.push(`${col} IS NULL`);
              break;
            case "is_not_null":
              conditions.push(`${col} IS NOT NULL`);
              break;
            default:
              conditions.push(
                `${col} LIKE ${escVal(`%${String(f.value ?? "")}%`)}`
              );
          }
        }
      }

      const where =
        conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
      const orderBy =
        sort && sort.length > 0
          ? ` ORDER BY ${sort.map((s) => `"${s.column}" ${s.direction.toUpperCase()}`).join(", ")}`
          : "";
      const offset = (page - 1) * pageSize;

      try {
        const result = await client.query({
          format: "JSONEachRow",
          query: `SELECT * FROM ${escId(schema)}.${escId(table)}${where}${orderBy} LIMIT ${pageSize} OFFSET ${offset}`,
        });
        const rows = (await result.json()) as Record<string, unknown>[];

        // Count
        const countResult = await client.query({
          format: "JSONEachRow",
          query: `SELECT count() AS cnt FROM ${escId(schema)}.${escId(table)}${where}`,
        });
        const countRows = (await countResult.json()) as Array<{ cnt: number }>;
        const totalEstimate = Number(countRows[0]?.cnt ?? 0);

        // Primary key — ClickHouse uses ORDER BY as the primary key concept
        let primaryKey: string[] = [];
        try {
          const pkResult = await client.query({
            format: "JSONEachRow",
            query: `SELECT name FROM system.columns WHERE database = ${escVal(schema)} AND table = ${escVal(table)} AND is_in_primary_key = 1 ORDER BY position`,
          });
          const pkRows = (await pkResult.json()) as Array<{ name: string }>;
          primaryKey = pkRows.map((r) => r.name);
        } catch {
          // is_in_primary_key may not be available in older versions
        }

        const columns =
          rows.length > 0
            ? Object.keys(rows[0]).map((name) => ({
                name,
                type_name: "unknown",
              }))
            : [];

        return {
          columns,
          foreignKeys: [], // ClickHouse doesn't have foreign keys
          pageInfo: { page, pageSize },
          primaryKey,
          rows,
          totalEstimate,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`ClickHouse listRows error: ${msg}`);
      }
    },

    async renameColumn(connectionString, schema, table, oldName, newName) {
      const sql = `ALTER TABLE ${escId(schema)}.${escId(table)} RENAME COLUMN ${escId(oldName)} TO ${escId(newName)}`;
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

    async setColumnDefault(
      connectionString,
      schema,
      table,
      columnName,
      defaultExpr
    ) {
      const client = await getClickhouseClient(connectionString);
      // Get current type
      const colResult = await client.query({
        format: "JSONEachRow",
        query: `SELECT type FROM system.columns WHERE database = ${escVal(schema)} AND table = ${escVal(table)} AND name = ${escVal(columnName)}`,
      });
      const colRows = (await colResult.json()) as Array<{ type: string }>;
      const currentType = colRows[0]?.type ?? "String";

      const defaultClause = defaultExpr ? ` DEFAULT ${defaultExpr}` : "";
      const sql = `ALTER TABLE ${escId(schema)}.${escId(table)} MODIFY COLUMN ${escId(columnName)} ${currentType}${defaultClause}`;
      await client.exec({ query: sql });
      return sql;
    },

    async setColumnNullable(
      connectionString,
      schema,
      table,
      columnName,
      isNullable
    ) {
      // ClickHouse: need to know the current type to re-specify with/without Nullable
      const client = await getClickhouseClient(connectionString);
      const colResult = await client.query({
        format: "JSONEachRow",
        query: `SELECT type FROM system.columns WHERE database = ${escVal(schema)} AND table = ${escVal(table)} AND name = ${escVal(columnName)}`,
      });
      const colRows = (await colResult.json()) as Array<{ type: string }>;
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
    sslModes: ["disable", "require"] as SslMode[],

    async testConnection(config) {
      const connStr = this.buildConnectionString(config);
      // Close any cached client so a fresh one is created with the latest URL fix
      await closeClickhouseClient(connStr);
      const client = await getClickhouseClient(connStr);
      await client.query({ query: "SELECT 1" });
      return true;
    },
    type: DB_TYPE,

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
        `ClickHouse not ready after ${maxRetries * intervalMs}ms`
      );
    },
  };
}
