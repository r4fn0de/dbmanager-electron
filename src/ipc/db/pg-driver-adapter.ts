/**
 * PostgresDriver — implements DatabaseDriver for PostgreSQL using Kysely.
 *
 * Uses memoized pg Pool via kysely-factory for all operations.
 * Data queries use Kysely query builder for type safety.
 * DDL uses shared builders (ddl-sql.ts) executed via pool.
 * Export/clone operations use the pool directly for complex SQL.
 */
import type { DatabaseType, SslMode } from "./types";
import type { DatabaseDriver, DriverConnectionConfig } from "./driver";
import { getPgPool } from "./kysely-factory";
import { buildConnectionString as buildPgConnectionString } from "./pg-client";
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
      const pool = getPgPool(connectionString);

      try {
        // Schemas — use raw pool for information_schema queries to avoid Kysely type complexity
        const schemasResult = await pool.query(
          `SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT LIKE 'pg_%' AND schema_name != 'information_schema' ORDER BY schema_name`,
        );

        // Columns
        const columnsResult = await pool.query(
          `SELECT table_schema, table_name, column_name, data_type, udt_name, is_nullable, column_default FROM information_schema.columns WHERE table_schema NOT LIKE 'pg_%' AND table_schema != 'information_schema' ORDER BY table_schema, table_name, ordinal_position`,
        );

        // Indexes
        const indexesResult = await pool.query(`
          SELECT schemaname, tablename, indexname, indexdef
          FROM pg_indexes
          WHERE schemaname NOT LIKE 'pg_%' AND schemaname != 'information_schema'
        `);

        // Foreign keys
        const foreignKeysResult = await pool.query(
          `SELECT tc.table_schema, tc.table_name, kcu.column_name, ccu.table_schema AS foreign_table_schema, ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name WHERE tc.constraint_type = 'FOREIGN KEY'`,
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

        for (const row of columnsResult.rows) {
          const key = `${row.table_schema}.${row.table_name}`;
          if (!tablesMap.has(key)) {
            tablesMap.set(key, {
              name: row.table_name as string,
              schema: row.table_schema as string,
              columns: [],
              indexes: [],
              foreign_keys: [],
              has_rls: false,
              rls_policies: [],
            });
          }
          tablesMap.get(key)!.columns.push({
            name: row.column_name as string,
            data_type: row.data_type as string,
            udt_name: (row.udt_name as string) ?? null,
            is_nullable: row.is_nullable === "YES",
            column_default: (row.column_default as string | null) ?? null,
          });
        }

        for (const row of indexesResult.rows) {
          const key = `${row.schemaname}.${row.tablename}`;
          const table = tablesMap.get(key);
          if (table) {
            const isUnique = row.indexdef.includes("UNIQUE");
            const isPrimary = row.indexdef.includes("PRIMARY KEY");
            const columnMatch = row.indexdef.match(/\(([^)]+)\)/);
            const columnNames = columnMatch
              ? columnMatch[1].split(",").map((c: string) => c.trim())
              : ([] as string[]);
            table.indexes.push({
              name: row.indexname,
              is_unique: isUnique,
              is_primary: isPrimary,
              column_names: columnNames,
            });
          }
        }

        for (const row of foreignKeysResult.rows) {
          const key = `${row.table_schema}.${row.table_name}`;
          const table = tablesMap.get(key);
          if (table) {
            table.foreign_keys.push({
              name: `${row.table_name}_${row.column_name}_fkey`,
              column_name: row.column_name as string,
              referenced_schema: row.foreign_table_schema as string | undefined,
              referenced_table: row.foreign_table_name as string,
              referenced_column: row.foreign_column_name as string,
            });
          }
        }

        return {
          schemas: schemasResult.rows.map((r: Record<string, unknown>) => r.schema_name as string),
          tables: Array.from(tablesMap.values()),
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`PostgreSQL schema error: ${msg}`);
      }
    },

    async getSchemaSummary(connectionString) {
      const pool = getPgPool(connectionString);

      const schemasResult = await pool.query(
        `SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT LIKE 'pg_%' AND schema_name != 'information_schema' ORDER BY schema_name`,
      );

      const tablesResult = await pool.query(
        `SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema NOT LIKE 'pg_%' AND table_schema != 'information_schema' ORDER BY table_schema, table_name`,
      );

      return {
        schemas: schemasResult.rows.map((r: Record<string, unknown>) => r.schema_name as string),
        tables: tablesResult.rows.map((t: Record<string, unknown>) => ({
          name: t.table_name as string,
          schema: t.table_schema as string,
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
      const pool = getPgPool(connectionString);
      const client = await pool.connect();
      try {
        const conditions: string[] = [];
        const params: unknown[] = [];

        if (filters) {
          for (const f of filters) {
            const col = `"${f.column.replaceAll('"', '""')}"`;
            const idx = params.length + 3; // $1=LIMIT, $2=OFFSET, filters start at $3

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
              case "gt": conditions.push(`${col} > $${idx}`); params.push(f.value); break;
              case "gte": conditions.push(`${col} >= $${idx}`); params.push(f.value); break;
              case "lt": conditions.push(`${col} < $${idx}`); params.push(f.value); break;
              case "lte": conditions.push(`${col} <= $${idx}`); params.push(f.value); break;
              case "is_null": conditions.push(`${col} IS NULL`); break;
              case "is_not_null": conditions.push(`${col} IS NOT NULL`); break;
              default:
                conditions.push(`${col}::text ILIKE $${idx}`);
                params.push(`%${String(f.value ?? "")}%`);
            }
          }
        }

        const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
        const orderBy = sort && sort.length > 0
          ? ` ORDER BY ${sort.map((s) => `"${s.column.replaceAll('"', '""')}" ${s.direction.toUpperCase()}`).join(", ")}`
          : "";
        const offset = (page - 1) * pageSize;

        const rowsResult = await client.query(
          `SELECT * FROM "${schema}"."${table}"${where}${orderBy} LIMIT $1 OFFSET $2`,
          [pageSize, offset, ...params],
        );

        // Count query — filters start at $1
        const countConditions: string[] = [];
        const countParams: unknown[] = [];
        if (filters) {
          for (const f of filters) {
            const col = `"${f.column.replaceAll('"', '""')}"`;
            const idx = countParams.length + 1;
            switch (f.operator) {
              case "eq":
                if (f.value == null) countConditions.push(`${col} IS NULL`);
                else { countConditions.push(`${col} = $${idx}`); countParams.push(f.value); }
                break;
              case "neq":
                if (f.value == null) countConditions.push(`${col} IS NOT NULL`);
                else { countConditions.push(`${col} != $${idx}`); countParams.push(f.value); }
                break;
              case "contains":
                countConditions.push(`${col}::text ILIKE $${idx}`);
                countParams.push(`%${String(f.value ?? "")}%`);
                break;
              case "starts_with":
                countConditions.push(`${col}::text ILIKE $${idx}`);
                countParams.push(`${String(f.value ?? "")}%`);
                break;
              case "ends_with":
                countConditions.push(`${col}::text ILIKE $${idx}`);
                countParams.push(`%${String(f.value ?? "")}`);
                break;
              case "gt": countConditions.push(`${col} > $${idx}`); countParams.push(f.value); break;
              case "gte": countConditions.push(`${col} >= $${idx}`); countParams.push(f.value); break;
              case "lt": countConditions.push(`${col} < $${idx}`); countParams.push(f.value); break;
              case "lte": countConditions.push(`${col} <= $${idx}`); countParams.push(f.value); break;
              case "is_null": countConditions.push(`${col} IS NULL`); break;
              case "is_not_null": countConditions.push(`${col} IS NOT NULL`); break;
              default:
                countConditions.push(`${col}::text ILIKE $${idx}`);
                countParams.push(`%${String(f.value ?? "")}%`);
            }
          }
        }
        const countWhere = countConditions.length > 0 ? ` WHERE ${countConditions.join(" AND ")}` : "";
        const countResult = await client.query(
          `SELECT COUNT(*) FROM "${schema}"."${table}"${countWhere}`,
          countParams,
        );
        const totalEstimate = parseInt(countResult.rows[0].count, 10);

        // Primary key
        const pkResult = await client.query(
          `SELECT kcu.column_name
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
           WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = $1 AND tc.table_name = $2`,
          [schema, table],
        );
        const primaryKey = pkResult.rows.map((r: { column_name: string }) => r.column_name);

        // Foreign keys
        const fkResult = await client.query(
          `SELECT tc.constraint_name as name, kcu.column_name,
                  ccu.table_schema as referenced_schema, ccu.table_name as referenced_table, ccu.column_name as referenced_column
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
           JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
           WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1 AND tc.table_name = $2`,
          [schema, table],
        );
        const foreignKeys = fkResult.rows.map((r: { name: string; column_name: string; referenced_schema: string; referenced_table: string; referenced_column: string }) => ({
          name: r.name,
          column_name: r.column_name,
          referenced_schema: r.referenced_schema,
          referenced_table: r.referenced_table,
          referenced_column: r.referenced_column,
        }));

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
      } finally {
        client.release();
      }
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
      // Import the existing implementation — it uses pg Client directly,
      // but we adapt it to use the pool.
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

function mapPgType(dataTypeID: number): string {
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
