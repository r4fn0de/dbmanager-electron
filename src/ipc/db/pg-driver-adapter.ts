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
import type { DatabaseType, SslMode, ConstraintInfo, SchemaEnum, SchemaFunction, SchemaTrigger } from "./types";
import type { DatabaseDriver, DriverConnectionConfig } from "./driver";
import { getPgKysely, getPgPool } from "./kysely-factory";
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

      // Raw query joining information_schema.tables with pg_class for row counts & RLS.
      // LEFT JOIN ensures partitioned parents, foreign tables, etc. are not dropped.
      // IMPORTANT: Use pool.query() directly — NOT executePgQuery() — because
      // executePgQuery() converts rows to value arrays (Object.values), which
      // breaks property-name access. Pool.query() returns rows as objects.
      const pool = getPgPool(connectionString);
      const tablesResult = await pool.query(`
        SELECT
          t.table_schema,
          t.table_name,
          COALESCE(c.relrowsecurity, false) AS has_rls,
          COALESCE(c.reltuples::bigint, 0) AS estimated_row_count
        FROM information_schema.tables t
        LEFT JOIN pg_catalog.pg_class c
          ON c.relname = t.table_name AND c.relkind = 'r'
        LEFT JOIN pg_catalog.pg_namespace n
          ON n.oid = c.relnamespace AND n.nspname = t.table_schema
        WHERE t.table_schema NOT LIKE 'pg_%'
          AND t.table_schema != 'information_schema'
          AND t.table_type = 'BASE TABLE'
        ORDER BY t.table_schema, t.table_name
      `);

      return {
        schemas: schemas.map((r) => r.schema_name),
        tables: tablesResult.rows.map((row: Record<string, unknown>) => ({
          name: String(row.table_name),
          schema: String(row.table_schema),
          has_rls: Boolean(row.has_rls),
          estimated_row_count: Math.max(0, Math.round(Number(row.estimated_row_count ?? 0))),
        })),
      };
    },

    async getTableDetails(connectionString, schema, table) {
      const db = getPgKysely(connectionString);

      try {
        // 1. Columns for this specific table only
        const columns = await db
          .withSchema("information_schema")
          .selectFrom("columns")
          .select([
            "column_name",
            "data_type",
            "udt_name",
            "is_nullable",
            "column_default",
          ])
          .where("table_schema", "=", schema)
          .where("table_name", "=", table)
          .orderBy("ordinal_position")
          .execute();

        // 2. Indexes for this specific table
        const indexes = await db
          .withSchema("pg_catalog")
          .selectFrom("pg_indexes")
          .select(["indexname", "indexdef"])
          .where("schemaname", "=", schema)
          .where("tablename", "=", table)
          .execute();

        // 3. Foreign keys for this specific table
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
            "kcu.column_name",
            "ccu.table_schema as foreign_table_schema",
            "ccu.table_name as foreign_table_name",
            "ccu.column_name as foreign_column_name",
          ])
          .where("tc.constraint_type", "=", "FOREIGN KEY")
          .where("tc.table_schema", "=", schema)
          .where("tc.table_name", "=", table)
          .execute();

        // 4. RLS check
        const rlsRow = await db
          .withSchema("pg_catalog")
          .selectFrom("pg_class as c")
          .innerJoin("pg_namespace as n", "c.relnamespace", "n.oid")
          .select("c.relrowsecurity as has_rls")
          .where("n.nspname", "=", schema)
          .where("c.relname", "=", table)
          .executeTakeFirst();
        const hasRls = rlsRow?.has_rls === true;

        // 5. RLS policies — only if RLS is enabled
        let rlsPolicies: Array<{ name: string; kind: string; roles: string[]; using_expr: string | null; with_check_expr: string | null }> = [];
        if (hasRls) {
          const policyRows = await db
            .withSchema("pg_catalog")
            .selectFrom("pg_policy as p")
            .innerJoin("pg_class as c", "p.polrelid", "c.oid")
            .innerJoin("pg_namespace as n", "c.relnamespace", "n.oid")
            .select([
              "p.polname as policy_name",
              "p.polcmd as policy_cmd",
              "p.polpermissive as is_permissive",
            ])
            .where("n.nspname", "=", schema)
            .where("c.relname", "=", table)
            .execute();

          const cmdMap: Record<string, string> = { r: "SELECT", a: "INSERT", w: "UPDATE", d: "DELETE", "*": "ALL" };
          rlsPolicies = policyRows.map((row) => ({
            name: String(row.policy_name),
            kind: cmdMap[String(row.policy_cmd)] ?? "UNKNOWN",
            roles: [],
            using_expr: null,
            with_check_expr: null,
          }));
        }

        // Build structured result — indexes are already typed from pg_indexes query
        const indexResults = indexes.map((row) => {
          const indexdef = (row as unknown as { indexdef: string }).indexdef;
          const isUnique = indexdef.includes("UNIQUE");
          const isPrimary = indexdef.includes("PRIMARY KEY");
          const columnMatch = indexdef.match(/\(([^)]+)\)/);
          const columnNames = columnMatch
            ? columnMatch[1].split(",").map((c: string) => c.trim())
            : [];
          return {
            name: (row as unknown as { indexname: string }).indexname,
            is_unique: isUnique,
            is_primary: isPrimary,
            column_names: columnNames,
          };
        });

        return {
          name: table,
          schema,
          has_rls: hasRls,
          columns: columns.map((c) => ({
            name: c.column_name,
            data_type: c.data_type,
            udt_name: c.udt_name ?? null,
            is_nullable: c.is_nullable === "YES",
            column_default: c.column_default ?? null,
          })),
          indexes: indexResults,
          foreign_keys: foreignKeys.map((fk) => ({
            name: `${table}_${fk.column_name}_fkey`,
            column_name: fk.column_name,
            referenced_schema: fk.foreign_table_schema ?? undefined,
            referenced_table: fk.foreign_table_name,
            referenced_column: fk.foreign_column_name,
          })),
          rls_policies: rlsPolicies,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`PostgreSQL table details error for ${schema}.${table}: ${msg}`);
      }
    },

    async getIndexes(connectionString, schema, table) {
      const db = getPgKysely(connectionString);

      try {
        // Query pg_catalog for detailed index information
        const indexRows = await db
          .withSchema("pg_catalog")
          .selectFrom("pg_indexes as pi")
          .innerJoin("pg_class as c", (join) =>
            join.onRef("c.relname", "=", "pi.indexname"),
          )
          .innerJoin("pg_namespace as n", (join) =>
            join.onRef("n.oid", "=", "c.relnamespace").on("n.nspname", "=", schema),
          )
          .select(["pi.indexname", "pi.indexdef"])
          .where("pi.schemaname", "=", schema)
          .where("pi.tablename", "=", table)
          .execute();

        return indexRows.map((row) => {
          const indexdef = row.indexdef;
          const isUnique = indexdef.includes("UNIQUE");
          const isPrimary = indexdef.includes("PRIMARY KEY");
          const typeMatch = indexdef.match(/USING\s+(\w+)/);
          const type = typeMatch ? typeMatch[1] : "btree";
          const columnMatch = indexdef.match(/\(([^)]+)\)/);
          const columns = columnMatch
            ? columnMatch[1].split(",").map((c: string) => c.trim())
            : [];

          return {
            name: row.indexname,
            schema,
            table,
            columns,
            isUnique,
            isPrimary,
            type,
          };
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`PostgreSQL getIndexes error for ${schema}.${table}: ${msg}`);
      }
    },

    async getConstraints(connectionString, schema, table) {
      const db = getPgKysely(connectionString);

      try {
        // Query information_schema for all constraints
        const constraintRows = await db
          .withSchema("information_schema")
          .selectFrom("table_constraints as tc")
          .innerJoin("key_column_usage as kcu", (join) =>
            join
              .onRef("tc.constraint_name", "=", "kcu.constraint_name")
              .onRef("tc.constraint_schema", "=", "kcu.constraint_schema"),
          )
          .leftJoin("referential_constraints as rc", (join) =>
            join
              .onRef("tc.constraint_name", "=", "rc.constraint_name")
              .onRef("tc.constraint_schema", "=", "rc.constraint_schema"),
          )
          .select([
            "tc.constraint_name",
            "tc.constraint_type",
            "kcu.column_name",
            "rc.unique_constraint_schema as referenced_schema",
            "rc.unique_constraint_name",
            "rc.update_rule",
            "rc.delete_rule",
          ])
          .where("tc.table_schema", "=", schema)
          .where("tc.table_name", "=", table)
          .execute();

        // Group by constraint name
        const constraintMap = new Map<string, ConstraintInfo>();

        for (const row of constraintRows) {
          const typeMap: Record<string, import("./types").ConstraintType> = {
            "PRIMARY KEY": "primary_key",
            "UNIQUE": "unique",
            "FOREIGN KEY": "foreign_key",
            "CHECK": "check",
          };

          const constraintType = typeMap[row.constraint_type] ?? "check";

          if (!constraintMap.has(row.constraint_name)) {
            constraintMap.set(row.constraint_name, {
              name: row.constraint_name,
              schema,
              table,
              type: constraintType,
              columns: [],
              referencedSchema: row.referenced_schema ?? undefined,
              updateRule: row.update_rule ?? undefined,
              deleteRule: row.delete_rule ?? undefined,
            });
          }

          const constraint = constraintMap.get(row.constraint_name)!;
          if (row.column_name && !constraint.columns.includes(row.column_name)) {
            constraint.columns.push(row.column_name);
          }
        }

        return Array.from(constraintMap.values());
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`PostgreSQL getConstraints error for ${schema}.${table}: ${msg}`);
      }
    },

    async getEnums(connectionString, schema): Promise<SchemaEnum[]> {
      const pool = getPgPool(connectionString);
      try {
        const result = await pool.query(
          `SELECT t.typname   AS name,
                  n.nspname   AS schema,
                  array_agg(e.enumlabel ORDER BY e.enumsortorder) AS values
           FROM pg_type t
           JOIN pg_enum e        ON t.oid = e.enumtypid
           JOIN pg_namespace n   ON t.typnamespace = n.oid
           WHERE n.nspname = $1
           GROUP BY t.typname, n.nspname
           ORDER BY t.typname`,
          [schema],
        );

        // Parse PostgreSQL array_agg result — may come as a string like "{val1,val2}"
        // or as an actual array depending on pg driver version/settings
        const parsePgArray = (val: unknown): string[] => {
          if (Array.isArray(val)) return val.map(String);
          if (typeof val === "string") {
            // PostgreSQL arrays are formatted as {val1,val2,...}
            // Strip braces and split by comma, handling quoted values
            const inner = val.replace(/^\{|\}$/g, "");
            if (!inner) return [];
            // Handle quoted values (e.g., {"value with space"})
            const match = inner.match(/("[^"]+"|'[^']+'|[^,]+)/g);
            if (!match) return [];
            return match.map((v) => {
              const trimmed = v.trim();
              // Remove surrounding quotes if present
              if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
                  (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
                return trimmed.slice(1, -1);
              }
              return trimmed;
            });
          }
          return [];
        };

        return result.rows.map((row: Record<string, unknown>) => ({
          name: String(row.name),
          schema: String(row.schema),
          values: parsePgArray(row.values),
        }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`PostgreSQL getEnums error for ${schema}: ${msg}`);
      }
    },

    async getFunctions(connectionString, schema): Promise<SchemaFunction[]> {
      const pool = getPgPool(connectionString);
      try {
        const result = await pool.query(
          `SELECT p.proname            AS name,
                  n.nspname            AS schema,
                  CASE p.prokind
                    WHEN 'f' THEN 'function'
                    WHEN 'p' THEN 'procedure'
                    ELSE 'function'
                  END                AS type,
                  l.lanname            AS language,
                  pg_get_function_result(p.oid) AS return_type,
                  p.pronargs           AS argument_count,
                  pg_get_function_arguments(p.oid) AS arguments,
                  pg_get_functiondef(p.oid)    AS definition
           FROM pg_proc p
           JOIN pg_namespace n ON p.pronamespace = n.oid
           LEFT JOIN pg_language l ON p.prolang = l.oid
           WHERE n.nspname = $1
             AND p.prokind IN ('f', 'p')
           ORDER BY p.proname`,
          [schema],
        );
        return result.rows.map((row: Record<string, unknown>) => ({
          name: String(row.name),
          schema: String(row.schema),
          type: String(row.type) as "function" | "procedure",
          language: row.language ? String(row.language) : null,
          return_type: row.return_type ? String(row.return_type) : null,
          argument_count: Number(row.argument_count ?? 0),
          arguments: row.arguments ? String(row.arguments) : null,
          definition: row.definition ? String(row.definition) : null,
        }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`PostgreSQL getFunctions error for ${schema}: ${msg}`);
      }
    },

    async getTriggers(connectionString, schema): Promise<SchemaTrigger[]> {
      const pool = getPgPool(connectionString);
      try {
        const result = await pool.query(
          `SELECT t.tgname            AS name,
                  n.nspname            AS schema,
                  c.relname            AS table,
                  CASE
                    WHEN t.tgtype & 4 = 4 THEN 'INSERT'
                    WHEN t.tgtype & 8 = 8 THEN 'DELETE'
                    WHEN t.tgtype & 16 = 16 THEN 'UPDATE'
                    ELSE 'UNKNOWN'
                  END                AS event,
                  CASE
                    WHEN t.tgtype & 2 = 2 THEN 'AFTER'
                    WHEN t.tgtype & 1 = 1 THEN 'BEFORE'
                    WHEN t.tgtype & 64 = 64 THEN 'INSTEAD OF'
                    ELSE 'UNKNOWN'
                  END                AS timing,
                  NOT t.tgenabled      AS enabled,
                  p.proname            AS function_name,
                  pg_get_triggerdef(t.oid) AS definition
           FROM pg_trigger t
           JOIN pg_class c     ON t.tgrelid = c.oid
           JOIN pg_namespace n ON c.relnamespace = n.oid
           LEFT JOIN pg_proc p ON t.tgfoid = p.oid
           WHERE n.nspname = $1
             AND NOT t.tgisinternal
           ORDER BY c.relname, t.tgname`,
          [schema],
        );
        return result.rows.map((row: Record<string, unknown>) => ({
          name: String(row.name),
          schema: String(row.schema),
          table: String(row.table),
          event: String(row.event),
          timing: String(row.timing),
          enabled: !row.enabled, // tgenabled=false means disabled, NOT tgenabled = enabled
          function_name: row.function_name ? String(row.function_name) : null,
          definition: row.definition ? String(row.definition) : null,
        }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`PostgreSQL getTriggers error for ${schema}: ${msg}`);
      }
    },

    async getTableStats(connectionString, schema, table) {
      try {
        // Use raw query for stats to avoid Kysely type issues with pg_stat_user_tables
        const statsSql = `
          SELECT
            c.reltuples::bigint as row_estimate,
            c.relpages::bigint as pages,
            s.n_live_tup::bigint as live_tuples,
            s.last_vacuum::text,
            s.last_autovacuum::text,
            s.last_analyze::text,
            s.last_autoanalyze::text,
            pg_total_relation_size(c.oid)::bigint as total_bytes
          FROM pg_catalog.pg_class c
          JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          LEFT JOIN pg_catalog.pg_stat_user_tables s ON s.relid = c.oid
          WHERE n.nspname = $1
            AND c.relname = $2
            AND c.relkind = 'r'
        `;

        const pool = getPgPool(connectionString);
        const statsResult = await pool.query(statsSql, [schema, table]);
        const row = statsResult.rows[0] as Record<string, unknown> | undefined;

        const sizeBytes = Number(row?.total_bytes ?? 0);

        // Format size string
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

        // Use live tuple count if available, otherwise use estimate
        const rowCount = row?.live_tuples
          ? Number(row.live_tuples)
          : Math.round(Number(row?.row_estimate ?? 0));

        return {
          schema,
          table,
          rowCount,
          sizeBytes,
          sizeFormatted,
          lastVacuum: row?.last_vacuum?.toString() ?? null,
          lastAnalyze: row?.last_analyze?.toString() ?? null,
          lastAutoanalyze: row?.last_autoanalyze?.toString() ?? null,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`PostgreSQL getTableStats error for ${schema}.${table}: ${msg}`);
      }
    },

    async explainQuery(connectionString, sql, analyze = false) {
      const pool = getPgPool(connectionString);
      const client = await pool.connect();
      try {
        // Use JSON format for easier parsing
        const explainSql = analyze
          ? `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`
          : `EXPLAIN (FORMAT JSON) ${sql}`;

        const result = await client.query(explainSql);

        // PostgreSQL returns JSON array with plan info
        const planJson = result.rows[0]?.["QUERY PLAN"] ?? result.rows[0];
        const planText = JSON.stringify(planJson, null, 2);

        // Try to extract cost and row estimates from the plan
        let totalCost: number | undefined;
        let estimatedRows: number | undefined;
        let executionTimeMs: number | undefined;

        if (Array.isArray(planJson) && planJson.length > 0) {
          const plan = planJson[0].Plan ?? planJson[0];
          totalCost = plan["Total Cost"] ?? plan["Total Cost"];
          estimatedRows = plan["Plan Rows"] ?? plan["Actual Rows"];
          if (plan["Execution Time"]) {
            executionTimeMs = plan["Execution Time"];
          }
        }

        return {
          plan: planText,
          hasExecutionStats: analyze,
          totalCost,
          estimatedRows,
          executionTimeMs,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`PostgreSQL explainQuery error: ${msg}`);
      } finally {
        client.release();
      }
    },

    async getTableSample(connectionString, schema, table, sampleSize = 100) {
      const pool = getPgPool(connectionString);
      const client = await pool.connect();
      try {
        // Get total row count
        const countResult = await client.query(
          `SELECT COUNT(*) as cnt FROM ${pgEscId(schema)}.${pgEscId(table)}`,
        );
        const totalRows = Number.parseInt(countResult.rows[0].cnt as string, 10);

        // Get sample rows using TABLESAMPLE for large tables, or random for small
        let sampleQuery: string;
        const safeSampleSize = Math.max(1, Math.min(sampleSize, 10000));
        if (totalRows > 10000) {
          // Use TABLESAMPLE for large tables (if available)
          sampleQuery = `
            SELECT * FROM ${pgEscId(schema)}.${pgEscId(table)}
            TABLESAMPLE BERNOULLI (LEAST((${safeSampleSize}::float / ${totalRows}) * 100, 100))
            LIMIT ${safeSampleSize}
          `;
        } else {
          // Use ORDER BY random() for smaller tables
          sampleQuery = `
            SELECT * FROM ${pgEscId(schema)}.${pgEscId(table)}
            ORDER BY RANDOM()
            LIMIT ${safeSampleSize}
          `;
        }

        const sampleResult = await client.query(sampleQuery);
        const rows = sampleResult.rows;

        // Get column statistics from information_schema and pg_stats
        const columnStatsQuery = `
          SELECT
            c.column_name,
            c.data_type,
            c.is_nullable
          FROM information_schema.columns c
          WHERE c.table_schema = $1 AND c.table_name = $2
          ORDER BY c.ordinal_position
        `;
        const columnResult = await client.query(columnStatsQuery, [schema, table]);

        // Build column statistics
        const columnStats = await Promise.all(
          columnResult.rows.map(async (col) => {
            const colName = col.column_name as string;
            const dataType = col.data_type as string;
            const isNullable = col.is_nullable === "YES";

            const stat: import("./types").ColumnStat = {
              columnName: colName,
              dataType: dataType,
            };

            // Try to get min/max/avg for numeric types
            if (
              dataType.includes("int") ||
              dataType.includes("float") ||
              dataType.includes("numeric") ||
              dataType.includes("decimal") ||
              dataType.includes("double") ||
              dataType.includes("real")
            ) {
              try {
                const statsResult = await client.query(
                  `SELECT
                    MIN("${colName}") as min_val,
                    MAX("${colName}") as max_val,
                    AVG("${colName}"::float) as avg_val,
                    COUNT(DISTINCT "${colName}") as unique_count,
                    COUNT(*) FILTER (WHERE "${colName}" IS NULL) * 100.0 / NULLIF(COUNT(*), 0) as null_pct
                  FROM "${schema}"."${table}"`
                );
                const row = statsResult.rows[0];
                stat.min = row.min_val;
                stat.max = row.max_val;
                stat.avg = row.avg_val ? Number.parseFloat(row.avg_val as string) : undefined;
                stat.uniqueCount = Number.parseInt(row.unique_count as string, 10);
                stat.nullPercentage = row.null_pct ? Number.parseFloat(row.null_pct as string) : isNullable ? 0 : 0;
              } catch {
                // Ignore stats errors
              }
            } else {
              // For string/categorical columns, get top values
              try {
                const topValuesResult = await client.query(
                  `SELECT
                    "${colName}" as value,
                    COUNT(*) as count
                  FROM "${schema}"."${table}"
                  WHERE "${colName}" IS NOT NULL
                  GROUP BY "${colName}"
                  ORDER BY count DESC
                  LIMIT 5`
                );
                stat.topValues = topValuesResult.rows.map((r) => ({
                  value: String(r.value),
                  count: Number.parseInt(r.count as string, 10),
                }));

                // Get null percentage and unique count
                const uniqueResult = await client.query(
                  `SELECT
                    COUNT(DISTINCT "${colName}") as unique_count,
                    COUNT(*) FILTER (WHERE "${colName}" IS NULL) * 100.0 / NULLIF(COUNT(*), 0) as null_pct
                  FROM "${schema}"."${table}"`
                );
                stat.uniqueCount = Number.parseInt(uniqueResult.rows[0].unique_count as string, 10);
                stat.nullPercentage = uniqueResult.rows[0].null_pct
                  ? Number.parseFloat(uniqueResult.rows[0].null_pct as string)
                  : 0;
              } catch {
                // Ignore stats errors
              }
            }

            return stat;
          })
        );

        return {
          rows,
          columnStats,
          totalRows,
          sampleSize: rows.length,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`PostgreSQL getTableSample error: ${msg}`);
      } finally {
        client.release();
      }
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
