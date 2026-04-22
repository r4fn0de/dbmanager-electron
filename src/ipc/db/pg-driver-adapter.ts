/**
 * PostgresDriver — implements DatabaseDriver for PostgreSQL using Kysely.
 *
 * Uses memoized pg Pool via kysely-factory for Kysely introspection queries.
 * Schema introspection (getSchema, getSchemaSummary) uses Kysely query builder
 * for type safety against known information_schema tables.
 * listRows uses pg-runtime raw helpers for data/count queries (dynamic table
 * names and result.fields type mapping), plus Kysely for PK/FK introspection.
 * DDL and clone/export operations are delegated to pg-runtime helpers.
 */
import type { DatabaseType, SslMode } from "./types";
import type { DatabaseDriver, DriverConnectionConfig } from "./driver";
import { getPgKysely } from "./kysely-factory";
import {
  buildPgConnectionString,
  buildPgWhereClause,
  executeBatchDdl as executePgBatchDdl,
  executePgQuery,
  executePgSql,
  exportSchemaDdl as exportPgSchemaDdl,
  exportTableData as exportPgTableData,
  getPgDatabaseInfo,
  importTableRows as importPgTableRows,
  listPgRowsRaw,
  mapPgType,
  pgEscId,
  testPgConnection,
  waitForDatabase as waitForPgDatabase,
} from "./pg-runtime";
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

export { buildPgWhereClause, mapPgType, pgEscId };

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
      return testPgConnection(connStr);
    },

    async executeQuery(connectionString, sqlQuery) {
      return executePgQuery(connectionString, sqlQuery);
    },

    async getDatabaseInfo(connectionString) {
      return getPgDatabaseInfo(connectionString);
    },

    async getSchema(connectionString) {
      const db = getPgKysely(connectionString);

      try {
        // 1. Schemas — Kysely query against information_schema.schemata
        const schemas = await db
          .withSchema("information_schema")
          .selectFrom("schemata")
          .select("schema_name")
          .where("schema_name", "not like", "pg_%")
          .where("schema_name", "!=", "information_schema")
          .orderBy("schema_name")
          .execute();

        // 2. Columns — Kysely query against information_schema.columns
        const columns = await db
          .withSchema("information_schema")
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
          .withSchema("pg_catalog")
          .selectFrom("pg_indexes")
          .select(["schemaname", "tablename", "indexname", "indexdef"])
          .where("schemaname", "not like", "pg_%")
          .where("schemaname", "!=", "information_schema")
          .execute();

        // 4. Foreign keys — Kysely query with schema-qualified joins
        // Note: include constraint_schema in joins to avoid cross-schema name collisions
        // Also filter out system schemas so we don't return FKs from pg_catalog etc.
        const foreignKeys = await db
          .withSchema("information_schema")
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
        .withSchema("information_schema")
        .selectFrom("schemata")
        .select("schema_name")
        .where("schema_name", "not like", "pg_%")
        .where("schema_name", "!=", "information_schema")
        .orderBy("schema_name")
        .execute();

      const tables = await db
        .withSchema("information_schema")
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
      const rawRows = await listPgRowsRaw(
        connectionString,
        schema,
        table,
        page,
        pageSize,
        sort ?? [],
        filters ?? [],
      );

      // ── PK/FK introspection — Kysely queries against information_schema ──
      const pkRows = await db
        .withSchema("information_schema")
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
        .withSchema("information_schema")
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
      return {
        columns: rawRows.columns,
        rows: rawRows.rows,
        primaryKey,
        foreignKeys,
        pageInfo: { page, pageSize },
        totalEstimate: rawRows.totalEstimate,
      };
    },

    // ── DDL ─────────────────────────────────────────────────────────

    async createTable(connectionString, schema, tableName, columns, primaryKeyColumns, ifNotExists) {
      const sql = buildCreateTableSql(DB_TYPE, schema, tableName, columns, primaryKeyColumns ?? [], ifNotExists ?? false);
      await executePgSql(connectionString, sql);
      return sql;
    },

    async dropTable(connectionString, schema, tableName, cascade, ifExists) {
      const sql = buildDropTableSql(DB_TYPE, schema, tableName, cascade ?? false, ifExists ?? false);
      await executePgSql(connectionString, sql);
      return sql;
    },

    async renameTable(connectionString, schema, oldName, newName) {
      const sql = buildRenameTableSql(DB_TYPE, schema, oldName, newName);
      await executePgSql(connectionString, sql);
      return sql;
    },

    async addColumn(connectionString, schema, table, columnName, dataType, isNullable, defaultExpr, ifNotExists) {
      const sql = buildAddColumnSql(DB_TYPE, schema, table, columnName, dataType, isNullable ?? true, defaultExpr, ifNotExists ?? false);
      await executePgSql(connectionString, sql);
      return sql;
    },

    async dropColumn(connectionString, schema, table, columnName, cascade, ifExists) {
      const sql = buildDropColumnSql(DB_TYPE, schema, table, columnName, cascade ?? false, ifExists ?? false);
      await executePgSql(connectionString, sql);
      return sql;
    },

    async renameColumn(connectionString, schema, table, oldName, newName) {
      const sql = buildRenameColumnSql(DB_TYPE, schema, table, oldName, newName);
      await executePgSql(connectionString, sql);
      return sql;
    },

    async alterColumnType(connectionString, schema, table, columnName, newType, usingExpr) {
      const sql = buildAlterColumnTypeSql(DB_TYPE, schema, table, columnName, newType, usingExpr);
      await executePgSql(connectionString, sql);
      return sql;
    },

    async setColumnNullable(connectionString, schema, table, columnName, isNullable) {
      const sql = buildSetColumnNullableSql(DB_TYPE, schema, table, columnName, isNullable);
      await executePgSql(connectionString, sql);
      return sql;
    },

    async setColumnDefault(connectionString, schema, table, columnName, defaultExpr) {
      const sql = buildSetColumnDefaultSql(DB_TYPE, schema, table, columnName, defaultExpr);
      await executePgSql(connectionString, sql);
      return sql;
    },

    async createIndex(connectionString, schema, table, indexName, columns, unique, ifNotExists) {
      const sql = buildCreateIndexSql(DB_TYPE, schema, table, indexName, columns, unique ?? false, ifNotExists ?? false);
      await executePgSql(connectionString, sql);
      return sql;
    },

    async dropIndex(connectionString, schema, indexName, cascade, ifExists) {
      const sql = buildDropIndexSql(DB_TYPE, schema, indexName, cascade ?? false, ifExists ?? false);
      await executePgSql(connectionString, sql);
      return sql;
    },

    async createSchema(connectionString, schemaName, ifNotExists) {
      const sql = buildCreateSchemaSql(DB_TYPE, schemaName, ifNotExists ?? false);
      await executePgSql(connectionString, sql);
      return sql;
    },

    // ── Clone / Export ──────────────────────────────────────────────
    // These use the pool directly for complex SQL that Kysely doesn't help with.

    async exportSchemaDdl(connectionString) {
      return exportPgSchemaDdl(connectionString);
    },

    async exportTableData(connectionString, schema, table, batchSize, offset) {
      return exportPgTableData(connectionString, schema, table, batchSize, offset);
    },

    async executeBatchDdl(connectionString, statements, throwOnError) {
      return executePgBatchDdl(connectionString, statements, throwOnError);
    },

    async waitForDatabase(connectionString, maxRetries, intervalMs) {
      return waitForPgDatabase(connectionString, maxRetries, intervalMs);
    },

    async importTableRows(connectionString, schema, table, columns, rows) {
      return importPgTableRows(connectionString, schema, table, columns, rows);
    },
  };
}
