/**
 * PostgresDriver — adapts the existing pg-client.ts functions
 * to the DatabaseDriver interface.
 *
 * DDL methods build SQL via shared builders (ddl-sql.ts),
 * execute via executePgDdl, then return the same SQL string.
 */
import type { DatabaseType, SslMode } from "./types";
import type { DatabaseDriver, DriverConnectionConfig } from "./driver";
import * as pg from "./pg-client";
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
      return pg.buildConnectionString(config);
    },

    async testConnection(config) {
      return pg.testConnection(config);
    },

    async executeQuery(connectionString, sql) {
      return pg.executeQuery(connectionString, sql);
    },

    async getDatabaseInfo(connectionString) {
      return pg.getDatabaseInfo(connectionString);
    },

    async getSchema(connectionString) {
      return pg.getSchema(connectionString);
    },

    async getSchemaSummary(connectionString) {
      return pg.getSchemaSummary(connectionString);
    },

    async getTableDetails(connectionString, schema, table) {
      return pg.getTableDetails(connectionString, schema, table);
    },

    async listRows(connectionString, schema, table, page, pageSize, sort, filters) {
      return pg.listRows(
        connectionString,
        schema,
        table,
        page,
        pageSize,
        sort,
        filters,
      );
    },

    // ── DDL ─────────────────────────────────────────────────────────

    async createTable(connectionString, schema, tableName, columns, primaryKeyColumns, ifNotExists) {
      const sql = buildCreateTableSql(DB_TYPE, schema, tableName, columns, primaryKeyColumns ?? [], ifNotExists ?? false);
      await pg.executePgDdl(connectionString, sql);
      return sql;
    },

    async dropTable(connectionString, schema, tableName, cascade, ifExists) {
      const sql = buildDropTableSql(DB_TYPE, schema, tableName, cascade ?? false, ifExists ?? false);
      await pg.executePgDdl(connectionString, sql);
      return sql;
    },

    async renameTable(connectionString, schema, oldName, newName) {
      const sql = buildRenameTableSql(DB_TYPE, schema, oldName, newName);
      await pg.executePgDdl(connectionString, sql);
      return sql;
    },

    async addColumn(connectionString, schema, table, columnName, dataType, isNullable, defaultExpr, ifNotExists) {
      const sql = buildAddColumnSql(DB_TYPE, schema, table, columnName, dataType, isNullable ?? true, defaultExpr, ifNotExists ?? false);
      await pg.executePgDdl(connectionString, sql);
      return sql;
    },

    async dropColumn(connectionString, schema, table, columnName, cascade, ifExists) {
      const sql = buildDropColumnSql(DB_TYPE, schema, table, columnName, cascade ?? false, ifExists ?? false);
      await pg.executePgDdl(connectionString, sql);
      return sql;
    },

    async renameColumn(connectionString, schema, table, oldName, newName) {
      const sql = buildRenameColumnSql(DB_TYPE, schema, table, oldName, newName);
      await pg.executePgDdl(connectionString, sql);
      return sql;
    },

    async alterColumnType(connectionString, schema, table, columnName, newType, usingExpr) {
      const sql = buildAlterColumnTypeSql(DB_TYPE, schema, table, columnName, newType, usingExpr);
      await pg.executePgDdl(connectionString, sql);
      return sql;
    },

    async setColumnNullable(connectionString, schema, table, columnName, isNullable) {
      const sql = buildSetColumnNullableSql(DB_TYPE, schema, table, columnName, isNullable);
      await pg.executePgDdl(connectionString, sql);
      return sql;
    },

    async setColumnDefault(connectionString, schema, table, columnName, defaultExpr) {
      const sql = buildSetColumnDefaultSql(DB_TYPE, schema, table, columnName, defaultExpr);
      await pg.executePgDdl(connectionString, sql);
      return sql;
    },

    async createIndex(connectionString, schema, table, indexName, columns, unique, ifNotExists) {
      const sql = buildCreateIndexSql(DB_TYPE, schema, table, indexName, columns, unique ?? false, ifNotExists ?? false);
      await pg.executePgDdl(connectionString, sql);
      return sql;
    },

    async dropIndex(connectionString, schema, indexName, cascade, ifExists) {
      const sql = buildDropIndexSql(DB_TYPE, schema, indexName, cascade ?? false, ifExists ?? false);
      await pg.executePgDdl(connectionString, sql);
      return sql;
    },

    async createSchema(connectionString, schemaName, ifNotExists) {
      const sql = buildCreateSchemaSql(DB_TYPE, schemaName, ifNotExists ?? false);
      await pg.executePgDdl(connectionString, sql);
      return sql;
    },

    // ── Clone / Export ──────────────────────────────────────────────

    async exportSchemaDdl(connectionString) {
      return pg.exportSchemaDdl(connectionString);
    },

    async exportTableData(connectionString, schema, table, batchSize, offset) {
      return pg.exportTableData(connectionString, schema, table, batchSize, offset);
    },

    async executeBatchDdl(connectionString, statements, throwOnError) {
      return pg.executeBatchDdl(connectionString, statements, throwOnError);
    },

    async waitForDatabase(connectionString, maxRetries, intervalMs) {
      return pg.waitForDatabase(connectionString, maxRetries, intervalMs);
    },

    async importTableRows(connectionString, schema, table, columns, rows) {
      return pg.importTableRows(connectionString, schema, table, columns, rows);
    },
  };
}
