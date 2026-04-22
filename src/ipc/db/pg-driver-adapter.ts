/**
 * PostgresDriver — implements DatabaseDriver for PostgreSQL using Kysely.
 *
 * Uses memoized pg Pool via kysely-factory for all operations.
 * Schema introspection (getSchema, getSchemaSummary) uses Kysely query builder
 * for type safety against known information_schema tables.
 * listRows uses raw pool for data/count queries (dynamic table names need
 * proper identifier quoting, and we need result.fields for column type info),
 * but uses Kysely for PK/FK introspection queries.
 * DDL uses shared builders (ddl-sql.ts) executed via pool.
 * Export/clone operations use the pool directly for complex SQL.
 */
import type { DatabaseType, SslMode, TableFilter } from "./types";
import type { DatabaseDriver, DriverConnectionConfig } from "./driver";
import { getPgPool, getPgKysely } from "./kysely-factory";
import { buildConnectionString as buildPgConnectionString } from "./pg-client";
// Kysely imports are used via getPgKysely() for schema introspection queries
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

const DB_TYPE = "postgresql" as DatabaseType;

/** Escape a PostgreSQL identifier (double-quote). */
export function pgEscId(id: string): string {
  return `"${id.replace(/"/g, '""')}"`;
}

/**
 * Build PostgreSQL WHERE clause from filters with positional parameter placeholders.
 * Returns conditions array and params array — caller prepends LIMIT/OFFSET params
 * and adjusts `startIdx` accordingly (data query: startIdx=3, count query: startIdx=1).
 */
export function buildPgWhereClause(
  filters: Array<{ column: string; operator: string; value?: unknown }>,
  startIdx: number,
): { conditions: string[]; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  for (const rawF of filters) {
    const f = rawF as TableFilter;
    const col = pgEscId(f.column);
    const idx = params.length + startIdx;

    switch (f.operator) {
      case "eq":
        if (f.value == null) conditions.push(`${col} IS NULL`);
        else { conditions.push(`${col} = $${idx}`); params.push(f.value); }
        break;
      case "neq":
        if (f.value == null) conditions.push(`${col} IS NOT NULL`);
        else { conditions.push(`${col} != $${idx}`); params.push(f.value); }
        break;
      case "contains":
        conditions.push(`${col}::text ILIKE $${idx}`);
        params.push(`%${String(f.value ?? "")}%`);
        break;
      case "starts_with":
        conditions.push(`${col}::text ILIKE $${idx}`);
        params.push(`${String(f.value ?? "")}%`);
        break;
      case "ends_with":
        conditions.push(`${col}::text ILIKE $${idx}`);
        params.push(`%${String(f.value ?? "")}`);
        break;
      case "gt":
        conditions.push(`${col} > $${idx}`); params.push(f.value); break;
      case "gte":
        conditions.push(`${col} >= $${idx}`); params.push(f.value); break;
      case "lt":
        conditions.push(`${col} < $${idx}`); params.push(f.value); break;
      case "lte":
        conditions.push(`${col} <= $${idx}`); params.push(f.value); break;
      case "is_null":
        conditions.push(`${col} IS NULL`); break;
      case "is_not_null":
        conditions.push(`${col} IS NOT NULL`); break;
      default:
        conditions.push(`${col}::text ILIKE $${idx}`);
        params.push(`%${String(f.value ?? "")}%`);
    }
  }

  return { conditions, params };
}

export function createPostgresDriver(): DatabaseDriver {
  return {
    type: DB_TYPE,
    defaultPort: 5432,
    defaultDatabase: "postgres",
    defaultUsername: "postgres",
    sslModes: ["disable", "prefer", "require", "verify_ca", "verify_full"] as SslMode[],

    buildConnectionString(config: DriverConnectionConfig): string {
      return buildPgConnectionString(config);
    },

    async testConnection(config) {
      const connStr = buildPgConnectionString(config);
      try {
        const pool = getPgPool(connStr);
        const client = await pool.connect();
        try {
          await client.query("SELECT 1");
          return true;
        } finally {
          client.release();
        }
      } catch {
        return false;
      }
    },

    async executeQuery(connectionString, sqlQuery) {
      const pool = getPgPool(connectionString);
      const result = await pool.query(sqlQuery);

      // Non-SELECT result (INSERT, UPDATE, DELETE, DDL)
      if (!Array.isArray(result.rows) || result.rows.length === 0 && result.command !== "SELECT") {
        return {
          columns: [],
          rows: [],
          row_count: result.rowCount ?? 0,
        };
      }

      // SELECT result
      const columns = result.fields.map((f) => ({
        name: f.name,
        type_name: mapPgType(f.dataTypeID),
      }));

      return {
        columns,
        rows: result.rows.map((row) => Object.values(row)),
        row_count: result.rowCount ?? 0,
      };
    },

    async getDatabaseInfo(connectionString) {
      const pool = getPgPool(connectionString);
      const client = await pool.connect();
      try {
        const versionResult = await client.query("SELECT version()");
        const encodingResult = await client.query(
          "SELECT pg_encoding_to_char(encoding) FROM pg_database WHERE datname = current_database()",
        );
        const timezoneResult = await client.query("SHOW timezone");
        const sizeResult = await client.query(
          "SELECT pg_size_pretty(pg_database_size(current_database()))",
        );
        return {
          version: versionResult.rows[0]?.version || "",
          encoding: encodingResult.rows[0]?.pg_encoding_to_char || "",
          timezone: timezoneResult.rows[0]?.TimeZone || "",
          size: sizeResult.rows[0]?.pg_size_pretty || "",
        };
      } finally {
        client.release();
      }
    },

    async getSchema(connectionString) {
      const db = getPgKysely(connectionString);

      try {
        // 1. Schemas — Kysely query against information_schema.schemata
        const schemas = await db
          .selectFrom("schemata")
          .select("schema_name")
          .where("schema_name", "not like", "pg_%")
          .where("schema_name", "!=", "information_schema")
          .orderBy("schema_name")
          .execute();

        // 2. Columns — Kysely query against information_schema.columns
        const columns = await db
          .selectFrom("columns")
          .select([
            "table_schema",
            "table_name",
            "column_name",
            "data_type",
            "udt_name",
            "is_nullable",
            "column_default",
          ])
          .where("table_schema", "not like", "pg_%")
          .where("table_schema", "!=", "information_schema")
          .orderBy("table_schema")
          .orderBy("table_name")
          .orderBy("ordinal_position")
          .execute();

        // 3. Indexes — Kysely query against pg_indexes
        const indexes = await db
          .selectFrom("pg_indexes")
          .select(["schemaname", "tablename", "indexname", "indexdef"])
          .where("schemaname", "not like", "pg_%")
          .where("schemaname", "!=", "information_schema")
          .execute();

        // 4. Foreign keys — Kysely query with schema-qualified joins
        // Note: include constraint_schema in joins to avoid cross-schema name collisions
        // Also filter out system schemas so we don't return FKs from pg_catalog etc.
        const foreignKeys = await db
          .selectFrom("table_constraints as tc")
          .innerJoin("key_column_usage as kcu", (join) =>
            join
              .onRef("tc.constraint_name", "=", "kcu.constraint_name")
              .onRef("tc.constraint_schema", "=", "kcu.constraint_schema"),
          )
          .innerJoin("constraint_column_usage as ccu", (join) =>
            join
              .onRef("ccu.constraint_name", "=", "tc.constraint_name")
              .onRef("ccu.constraint_schema", "=", "tc.constraint_schema"),
          )
          .select([
            "tc.table_schema",
            "tc.table_name",
            "kcu.column_name",
            "ccu.table_schema as foreign_table_schema",
            "ccu.table_name as foreign_table_name",
            "ccu.column_name as foreign_column_name",
          ])
          .where("tc.constraint_type", "=", "FOREIGN KEY")
          .where("tc.table_schema", "not like", "pg_%")
          .where("tc.table_schema", "!=", "information_schema")
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

        for (const row of columns) {
          const key = `${row.table_schema}.${row.table_name}`;
          if (!tablesMap.has(key)) {
            tablesMap.set(key, {
              name: row.table_name,
              schema: row.table_schema,
              columns: [],
              indexes: [],
              foreign_keys: [],
              has_rls: false,
              rls_policies: [],
            });
          }
          tablesMap.get(key)!.columns.push({
            name: row.column_name,
            data_type: row.data_type,
            udt_name: row.udt_name ?? null,
            is_nullable: row.is_nullable === "YES",
            column_default: row.column_default ?? null,
          });
        }

        for (const row of indexes) {
          const key = `${row.schemaname}.${row.tablename}`;
          const table = tablesMap.get(key);
          if (table) {
            const isUnique = row.indexdef.includes("UNIQUE");
            const isPrimary = row.indexdef.includes("PRIMARY KEY");
            const columnMatch = row.indexdef.match(/\(([^)]+)\)/);
            const columnNames = columnMatch
              ? columnMatch[1].split(",").map((c: string) => c.trim())
              : [];
            table.indexes.push({
              name: row.indexname,
              is_unique: isUnique,
              is_primary: isPrimary,
              column_names: columnNames,
            });
          }
        }

        for (const row of foreignKeys) {
          const key = `${row.table_schema}.${row.table_name}`;
          const table = tablesMap.get(key);
          if (table) {
            table.foreign_keys.push({
              name: `${row.table_name}_${row.column_name}_fkey`,
              column_name: row.column_name,
              referenced_schema: row.foreign_table_schema ?? undefined,
              referenced_table: row.foreign_table_name,
              referenced_column: row.foreign_column_name,
            });
          }
        }

        return {
          schemas: schemas.map((r) => r.schema_name),
          tables: Array.from(tablesMap.values()),
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`PostgreSQL schema error: ${msg}`);
      }
    },

    async getSchemaSummary(connectionString) {
      const db = getPgKysely(connectionString);

      const schemas = await db
        .selectFrom("schemata")
        .select("schema_name")
        .where("schema_name", "not like", "pg_%")
        .where("schema_name", "!=", "information_schema")
        .orderBy("schema_name")
        .execute();

      const tables = await db
        .selectFrom("tables")
        .select(["table_schema", "table_name"])
        .where("table_schema", "not like", "pg_%")
        .where("table_schema", "!=", "information_schema")
        .orderBy("table_schema")
        .orderBy("table_name")
        .execute();

      return {
        schemas: schemas.map((r) => r.schema_name),
        tables: tables.map((t) => ({
          name: t.table_name,
          schema: t.table_schema,
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
      const db = getPgKysely(connectionString);
      const pool = getPgPool(connectionString);
      const offset = (page - 1) * pageSize;

      // ── Data query ──────────────────────────────────────────────────
      // Use raw pool for data queries because:
      // 1. Table names are dynamic and need proper identifier quoting (pgEscId)
      // 2. We need result.fields with dataTypeID for accurate column type mapping
      const { conditions, params } = buildPgWhereClause(filters ?? [], 3); // $1=LIMIT, $2=OFFSET, filters start at $3
      const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
      const orderBy = sort && sort.length > 0
        ? ` ORDER BY ${sort.map((s) => `${pgEscId(s.column)} ${s.direction.toUpperCase()}`).join(", ")}`
        : "";

      const rowsResult = await pool.query(
        `SELECT * FROM ${pgEscId(schema)}.${pgEscId(table)}${where}${orderBy} LIMIT $1 OFFSET $2`,
        [pageSize, offset, ...params],
      );

      // ── Count query ────────────────────────────────────────────────
      const countClause = buildPgWhereClause(filters ?? [], 1); // No LIMIT/OFFSET, filters start at $1
      const countWhere = countClause.conditions.length > 0 ? ` WHERE ${countClause.conditions.join(" AND ")}` : "";
      const countResult = await pool.query(
        `SELECT COUNT(*) FROM ${pgEscId(schema)}.${pgEscId(table)}${countWhere}`,
        countClause.params,
      );
      const totalEstimate = parseInt(countResult.rows[0].count, 10);

      // ── PK/FK introspection — Kysely queries against information_schema ──
      const pkRows = await db
        .selectFrom("table_constraints as tc")
        .innerJoin("key_column_usage as kcu", (join) =>
          join
            .onRef("tc.constraint_name", "=", "kcu.constraint_name")
            .onRef("tc.constraint_schema", "=", "kcu.constraint_schema"),
        )
        .select("kcu.column_name")
        .where("tc.constraint_type", "=", "PRIMARY KEY")
        .where("tc.table_schema", "=", schema)
        .where("tc.table_name", "=", table)
        .execute();
      const primaryKey = pkRows.map((r) => r.column_name);

      const fkRows = await db
        .selectFrom("table_constraints as tc")
        .innerJoin("key_column_usage as kcu", (join) =>
          join
            .onRef("tc.constraint_name", "=", "kcu.constraint_name")
            .onRef("tc.constraint_schema", "=", "kcu.constraint_schema"),
        )
        .innerJoin("constraint_column_usage as ccu", (join) =>
          join
            .onRef("ccu.constraint_name", "=", "tc.constraint_name")
            .onRef("ccu.constraint_schema", "=", "tc.constraint_schema"),
        )
        .select([
          "tc.constraint_name as name",
          "kcu.column_name",
          "ccu.table_schema as referenced_schema",
          "ccu.table_name as referenced_table",
          "ccu.column_name as referenced_column",
        ])
        .where("tc.constraint_type", "=", "FOREIGN KEY")
        .where("tc.table_schema", "=", schema)
        .where("tc.table_name", "=", table)
        .execute();
      const foreignKeys = fkRows.map((r) => ({
        name: r.name,
        column_name: r.column_name,
        referenced_schema: r.referenced_schema,
        referenced_table: r.referenced_table,
        referenced_column: r.referenced_column,
      }));

      // ── Column metadata — from pg result fields (accurate type mapping) ──
      const columns = rowsResult.fields.map((f) => ({
        name: f.name,
        type_name: mapPgType(f.dataTypeID),
      }));

      return {
        columns,
        rows: rowsResult.rows,
        primaryKey,
        foreignKeys,
        pageInfo: { page, pageSize },
        totalEstimate,
      };
    },

    // ── DDL ─────────────────────────────────────────────────────────

    async createTable(connectionString, schema, tableName, columns, primaryKeyColumns, ifNotExists) {
      const sql = buildCreateTableSql(DB_TYPE, schema, tableName, columns, primaryKeyColumns ?? [], ifNotExists ?? false);
      const pool = getPgPool(connectionString);
      await pool.query(sql);
      return sql;
    },

    async dropTable(connectionString, schema, tableName, cascade, ifExists) {
      const sql = buildDropTableSql(DB_TYPE, schema, tableName, cascade ?? false, ifExists ?? false);
      const pool = getPgPool(connectionString);
      await pool.query(sql);
      return sql;
    },

    async renameTable(connectionString, schema, oldName, newName) {
      const sql = buildRenameTableSql(DB_TYPE, schema, oldName, newName);
      const pool = getPgPool(connectionString);
      await pool.query(sql);
      return sql;
    },

    async addColumn(connectionString, schema, table, columnName, dataType, isNullable, defaultExpr, ifNotExists) {
      const sql = buildAddColumnSql(DB_TYPE, schema, table, columnName, dataType, isNullable ?? true, defaultExpr, ifNotExists ?? false);
      const pool = getPgPool(connectionString);
      await pool.query(sql);
      return sql;
    },

    async dropColumn(connectionString, schema, table, columnName, cascade, ifExists) {
      const sql = buildDropColumnSql(DB_TYPE, schema, table, columnName, cascade ?? false, ifExists ?? false);
      const pool = getPgPool(connectionString);
      await pool.query(sql);
      return sql;
    },

    async renameColumn(connectionString, schema, table, oldName, newName) {
      const sql = buildRenameColumnSql(DB_TYPE, schema, table, oldName, newName);
      const pool = getPgPool(connectionString);
      await pool.query(sql);
      return sql;
    },

    async alterColumnType(connectionString, schema, table, columnName, newType, usingExpr) {
      const sql = buildAlterColumnTypeSql(DB_TYPE, schema, table, columnName, newType, usingExpr);
      const pool = getPgPool(connectionString);
      await pool.query(sql);
      return sql;
    },

    async setColumnNullable(connectionString, schema, table, columnName, isNullable) {
      const sql = buildSetColumnNullableSql(DB_TYPE, schema, table, columnName, isNullable);
      const pool = getPgPool(connectionString);
      await pool.query(sql);
      return sql;
    },

    async setColumnDefault(connectionString, schema, table, columnName, defaultExpr) {
      const sql = buildSetColumnDefaultSql(DB_TYPE, schema, table, columnName, defaultExpr);
      const pool = getPgPool(connectionString);
      await pool.query(sql);
      return sql;
    },

    async createIndex(connectionString, schema, table, indexName, columns, unique, ifNotExists) {
      const sql = buildCreateIndexSql(DB_TYPE, schema, table, indexName, columns, unique ?? false, ifNotExists ?? false);
      const pool = getPgPool(connectionString);
      await pool.query(sql);
      return sql;
    },

    async dropIndex(connectionString, schema, indexName, cascade, ifExists) {
      const sql = buildDropIndexSql(DB_TYPE, schema, indexName, cascade ?? false, ifExists ?? false);
      const pool = getPgPool(connectionString);
      await pool.query(sql);
      return sql;
    },

    async createSchema(connectionString, schemaName, ifNotExists) {
      const sql = buildCreateSchemaSql(DB_TYPE, schemaName, ifNotExists ?? false);
      const pool = getPgPool(connectionString);
      await pool.query(sql);
      return sql;
    },

    // ── Clone / Export ──────────────────────────────────────────────
    // These use the pool directly for complex SQL that Kysely doesn't help with.

    async exportSchemaDdl(connectionString) {
      const { exportSchemaDdl: pgExport } = await import("./pg-client");
      return pgExport(connectionString);
    },

    async exportTableData(connectionString, schema, table, batchSize, offset) {
      const { exportTableData: pgExport } = await import("./pg-client");
      return pgExport(connectionString, schema, table, batchSize, offset);
    },

    async executeBatchDdl(connectionString, statements, throwOnError) {
      const { executeBatchDdl: pgBatch } = await import("./pg-client");
      return pgBatch(connectionString, statements, throwOnError);
    },

    async waitForDatabase(connectionString, maxRetries, intervalMs) {
      const { waitForDatabase: pgWait } = await import("./pg-client");
      return pgWait(connectionString, maxRetries, intervalMs);
    },

    async importTableRows(connectionString, schema, table, columns, rows) {
      const { importTableRows: pgImport } = await import("./pg-client");
      return pgImport(connectionString, schema, table, columns, rows);
    },
  };
}

// ---------------------------------------------------------------------------
// Type mapping — pg dataTypeID → display type
// ---------------------------------------------------------------------------

export function mapPgType(dataTypeID: number): string {
  const typeMap: Record<number, string> = {
    16: "boolean",      // bool
    17: "binary",       // bytea
    20: "number",       // int8
    21: "number",       // int2
    23: "number",       // int4
    25: "string",       // text
    114: "json",        // json
    199: "json",        // json[]
    700: "number",      // float4
    701: "number",      // float8
    1043: "string",     // varchar
    1082: "date",       // date
    1083: "time",       // time
    1114: "datetime",   // timestamp
    1184: "datetime",   // timestamptz
    1231: "number",     // numeric[]
    1266: "time",       // timetz
    1700: "number",     // numeric
    2950: "uuid",       // uuid
    3802: "json",       // jsonb
  };
  return typeMap[dataTypeID] || "unknown";
}
