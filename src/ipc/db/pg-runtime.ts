import { Client } from "pg";
import type {
  ColumnMeta,
  DatabaseInfo,
  QueryResult,
  TableFilter,
} from "./types";
import type { DriverConnectionConfig } from "./driver";
import { getPgPool } from "./kysely-factory";

export function pgEscId(id: string): string {
  return `"${id.replace(/"/g, '""')}"`;
}

export function mapPgType(dataTypeID: number): string {
  const typeMap: Record<number, string> = {
    16: "boolean",
    17: "binary",
    20: "number",
    21: "number",
    23: "number",
    25: "string",
    114: "json",
    199: "json",
    700: "number",
    701: "number",
    1043: "string",
    1082: "date",
    1083: "time",
    1114: "datetime",
    1184: "datetime",
    1231: "number",
    1266: "time",
    1700: "number",
    2950: "uuid",
    3802: "json",
  };
  return typeMap[dataTypeID] || "unknown";
}

export function buildPgConnectionString(config: DriverConnectionConfig): string {
  if (config.url) return config.url;
  const sslMode = config.ssl_mode || "prefer";
  return `postgresql://${encodeURIComponent(config.username)}:${encodeURIComponent(config.password)}@${config.host}:${config.port}/${config.database}?sslmode=${sslMode}`;
}

export async function testPgConnection(connectionString: string): Promise<boolean> {
  try {
    const pool = getPgPool(connectionString);
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
}

export async function executePgQuery(connectionString: string, sqlQuery: string, signal?: AbortSignal): Promise<QueryResult> {
  const pool = getPgPool(connectionString);
  const client = await pool.connect();
  try {
    // pg client.query supports AbortSignal natively — when aborted, the
    // underlying socket is destroyed and the query rejects with an error.
    // The @types/pg doesn't include `signal` in QueryConfig yet, so we cast.
    const result = await client.query({ text: sqlQuery, signal } as unknown as string);

    if (!Array.isArray(result.rows) || (result.rows.length === 0 && result.command !== "SELECT")) {
      return {
        columns: [],
        rows: [],
        row_count: result.rowCount ?? 0,
      };
    }

    const columns: ColumnMeta[] = result.fields.map((f) => ({
      name: f.name,
      type_name: mapPgType(f.dataTypeID),
    }));

    return {
      columns,
      rows: result.rows.map((row) => Object.values(row)),
      row_count: result.rowCount ?? 0,
    };
  } finally {
    client.release();
  }
}

export async function getPgDatabaseInfo(connectionString: string): Promise<DatabaseInfo> {
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
}

export async function executePgSql(connectionString: string, sql: string): Promise<void> {
  const pool = getPgPool(connectionString);
  await pool.query(sql);
}

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
        else {
          conditions.push(`${col} = $${idx}`);
          params.push(f.value);
        }
        break;
      case "neq":
        if (f.value == null) conditions.push(`${col} IS NOT NULL`);
        else {
          conditions.push(`${col} != $${idx}`);
          params.push(f.value);
        }
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
        conditions.push(`${col} > $${idx}`);
        params.push(f.value);
        break;
      case "gte":
        conditions.push(`${col} >= $${idx}`);
        params.push(f.value);
        break;
      case "lt":
        conditions.push(`${col} < $${idx}`);
        params.push(f.value);
        break;
      case "lte":
        conditions.push(`${col} <= $${idx}`);
        params.push(f.value);
        break;
      case "is_null":
        conditions.push(`${col} IS NULL`);
        break;
      case "is_not_null":
        conditions.push(`${col} IS NOT NULL`);
        break;
      default:
        conditions.push(`${col}::text ILIKE $${idx}`);
        params.push(`%${String(f.value ?? "")}%`);
    }
  }

  return { conditions, params };
}

export async function listPgRowsRaw(
  connectionString: string,
  schema: string,
  table: string,
  page: number,
  pageSize: number,
  sort: Array<{ column: string; direction: "asc" | "desc" }>,
  filters: Array<{ column: string; operator: string; value?: unknown }>,
): Promise<{ rows: Record<string, unknown>[]; totalEstimate: number; columns: ColumnMeta[] }> {
  const pool = getPgPool(connectionString);
  const offset = (page - 1) * pageSize;

  const { conditions, params } = buildPgWhereClause(filters ?? [], 3);
  const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
  const orderBy = sort && sort.length > 0
    ? ` ORDER BY ${sort.map((s) => `${pgEscId(s.column)} ${s.direction.toUpperCase()}`).join(", ")}`
    : "";

  const rowsResult = await pool.query(
    `SELECT * FROM ${pgEscId(schema)}.${pgEscId(table)}${where}${orderBy} LIMIT $1 OFFSET $2`,
    [pageSize, offset, ...params],
  );

  const countClause = buildPgWhereClause(filters ?? [], 1);
  const countWhere = countClause.conditions.length > 0
    ? ` WHERE ${countClause.conditions.join(" AND ")}`
    : "";
  const countResult = await pool.query(
    `SELECT COUNT(*) FROM ${pgEscId(schema)}.${pgEscId(table)}${countWhere}`,
    countClause.params,
  );

  const columns = rowsResult.fields.map((f) => ({
    name: f.name,
    type_name: mapPgType(f.dataTypeID),
  }));

  return {
    rows: rowsResult.rows,
    totalEstimate: parseInt(countResult.rows[0].count, 10),
    columns,
  };
}

export async function exportSchemaDdl(
  connectionString: string,
): Promise<{
  scripts: Array<{
    type: string;
    schema: string;
    name: string;
    sql: string;
    dependsOn?: string[];
  }>;
  tableRowCounts: Array<{ schema: string; table: string; rowCount: number }>;
}> {
  const pool = getPgPool(connectionString);

  const scripts: Array<{ type: string; schema: string; name: string; sql: string; dependsOn?: string[] }> = [];

  const schemasResult = await pool.query(`
    SELECT schema_name
    FROM information_schema.schemata
    WHERE schema_name NOT LIKE 'pg_%'
      AND schema_name != 'information_schema'
      AND schema_name NOT LIKE 'pg_catalog'
    ORDER BY schema_name
  `);

  for (const row of schemasResult.rows) {
    scripts.push({
      type: "schema",
      schema: row.schema_name,
      name: row.schema_name,
      sql: `CREATE SCHEMA IF NOT EXISTS "${row.schema_name}";`,
    });
  }

  const enumResult = await pool.query(`
    SELECT
      n.nspname AS enum_schema,
      t.typname AS enum_name,
      e.enumlabel,
      e.enumsortorder
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname NOT LIKE 'pg_%'
      AND n.nspname != 'information_schema'
    ORDER BY n.nspname, t.typname, e.enumsortorder
  `);

  const enumValuesByType = new Map<string, string[]>();
  for (const row of enumResult.rows) {
    const key = `${row.enum_schema}.${row.enum_name}`;
    if (!enumValuesByType.has(key)) enumValuesByType.set(key, []);
    enumValuesByType.get(key)!.push(row.enumlabel);
  }

  for (const [enumKey, labels] of enumValuesByType) {
    const [enumSchema, enumName] = enumKey.split(".");
    const values = labels.map((label) => `'${String(label).replaceAll("'", "''")}'`).join(", ");
    scripts.push({
      type: "type",
      schema: enumSchema,
      name: enumName,
      sql: `DO $$ BEGIN CREATE TYPE "${enumSchema}"."${enumName}" AS ENUM (${values}); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    });
  }

  const seqResult = await pool.query(`
    SELECT
      nc.nspname AS sequence_schema,
      obj.relname AS sequence_name,
      ref_cls.relname AS table_name,
      attr.attname AS column_name
    FROM pg_depend dep
    JOIN pg_class obj ON obj.oid = dep.objid
    JOIN pg_namespace nc ON nc.oid = obj.relnamespace
    JOIN pg_class ref_cls ON ref_cls.oid = dep.refobjid
    JOIN pg_attribute attr ON attr.attrelid = dep.refobjid AND attr.attnum = dep.refobjsubid
    WHERE obj.relkind = 'S'
      AND nc.nspname NOT LIKE 'pg_%'
      AND nc.nspname != 'information_schema'
    ORDER BY nc.nspname, obj.relname
  `);

  const sequenceScripts = new Map<string, { schema: string; name: string }>();
  for (const row of seqResult.rows) {
    const key = `${row.sequence_schema}.${row.sequence_name}`;
    sequenceScripts.set(key, { schema: row.sequence_schema, name: row.sequence_name });
  }

  for (const seq of sequenceScripts.values()) {
    scripts.push({
      type: "sequence",
      schema: seq.schema,
      name: seq.name,
      sql: `CREATE SEQUENCE IF NOT EXISTS "${seq.schema}"."${seq.name}";`,
      dependsOn: [],
    });
  }

  const tablesResult = await pool.query(`
    SELECT
      c.table_schema,
      c.table_name,
      c.column_name,
      c.data_type,
      c.udt_name,
      c.udt_schema,
      c.is_nullable,
      c.column_default,
      c.ordinal_position,
      pg_catalog.format_type(a.atttypid, a.atttypmod) AS sql_type
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema
      AND t.table_name = c.table_name
    JOIN pg_catalog.pg_namespace ns
      ON ns.nspname = c.table_schema
    JOIN pg_catalog.pg_class cls
      ON cls.relname = c.table_name
      AND cls.relnamespace = ns.oid
      AND cls.relkind IN ('r', 'p')
    JOIN pg_catalog.pg_attribute a
      ON a.attrelid = cls.oid
      AND a.attname = c.column_name
      AND a.attnum > 0
      AND NOT a.attisdropped
    WHERE c.table_schema NOT LIKE 'pg_%'
      AND c.table_schema != 'information_schema'
      AND c.table_schema NOT LIKE 'pg_catalog'
      AND t.table_type = 'BASE TABLE'
    ORDER BY c.table_schema, c.table_name, c.ordinal_position
  `);

  const tableColumns = new Map<string, Array<{
    name: string;
    is_nullable: string;
    column_default: string | null;
    sql_type: string;
  }>>();

  for (const row of tablesResult.rows) {
    const key = `${row.table_schema}.${row.table_name}`;
    if (!tableColumns.has(key)) tableColumns.set(key, []);
    tableColumns.get(key)!.push({
      name: row.column_name,
      is_nullable: row.is_nullable,
      column_default: row.column_default,
      sql_type: row.sql_type,
    });
  }

  const pkResult = await pool.query(`
    SELECT
      tc.table_schema,
      tc.table_name,
      kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
      AND tc.table_name = kcu.table_name
    WHERE tc.constraint_type = 'PRIMARY KEY'
      AND tc.table_schema NOT LIKE 'pg_%'
      AND tc.table_schema != 'information_schema'
    ORDER BY tc.table_schema, tc.table_name, kcu.ordinal_position
  `);

  const tablePrimaryKeys = new Map<string, string[]>();
  for (const row of pkResult.rows) {
    const key = `${row.table_schema}.${row.table_name}`;
    if (!tablePrimaryKeys.has(key)) tablePrimaryKeys.set(key, []);
    tablePrimaryKeys.get(key)!.push(row.column_name);
  }

  for (const [tableKey, columns] of tableColumns) {
    const [schema, tableName] = tableKey.split(".");
    const pkCols = tablePrimaryKeys.get(tableKey) || [];

    const columnDefs: string[] = [];
    for (const col of columns) {
      let def = `  "${col.name}" ${col.sql_type}`;
      if (col.is_nullable === "NO") def += " NOT NULL";
      if (col.column_default && !col.column_default.includes("nextval")) {
        def += ` DEFAULT ${col.column_default}`;
      }
      columnDefs.push(def);
    }

    if (pkCols.length > 0) {
      const pkDef = pkCols.map((c) => `"${c}"`).join(", ");
      columnDefs.push(`  PRIMARY KEY (${pkDef})`);
    }

    scripts.push({
      type: "table",
      schema,
      name: tableName,
      sql: `CREATE TABLE IF NOT EXISTS "${schema}"."${tableName}" (\n${columnDefs.join(",\n")}\n);`,
    });
  }

  const indexesResult = await pool.query(`
    SELECT
      schemaname,
      tablename,
      indexname,
      indexdef
    FROM pg_indexes
    WHERE schemaname NOT LIKE 'pg_%'
      AND schemaname != 'information_schema'
      AND indexname NOT LIKE '%_pkey'
      AND indexdef NOT LIKE '%PRIMARY KEY%'
    ORDER BY schemaname, tablename, indexname
  `);

  for (const row of indexesResult.rows) {
    let sql = row.indexdef;
    if (!sql.includes("IF NOT EXISTS")) {
      sql = sql.replace("CREATE UNIQUE INDEX", "CREATE UNIQUE INDEX IF NOT EXISTS");
      sql = sql.replace("CREATE INDEX", "CREATE INDEX IF NOT EXISTS");
    }

    scripts.push({
      type: "index",
      schema: row.schemaname,
      name: row.indexname,
      sql: `${sql};`,
    });
  }

  const fkResult = await pool.query(`
    SELECT
      tc.table_schema,
      tc.table_name,
      tc.constraint_name,
      kcu.column_name,
      ccu.table_schema AS foreign_table_schema,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
      AND tc.table_name = kcu.table_name
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.constraint_schema = tc.constraint_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema NOT LIKE 'pg_%'
      AND tc.table_schema != 'information_schema'
  `);

  for (const row of fkResult.rows) {
    scripts.push({
      type: "constraint",
      schema: row.table_schema,
      name: row.constraint_name,
      sql: `ALTER TABLE "${row.table_schema}"."${row.table_name}" ADD CONSTRAINT "${row.constraint_name}" FOREIGN KEY ("${row.column_name}") REFERENCES "${row.foreign_table_schema}"."${row.foreign_table_name}" ("${row.foreign_column_name}");`,
      dependsOn: [`${row.foreign_table_schema}.${row.foreign_table_name}`],
    });
  }

  const tableRowCounts: Array<{ schema: string; table: string; rowCount: number }> = [];
  for (const tableKey of tableColumns.keys()) {
    const [schema, tableName] = tableKey.split(".");
    try {
      const countResult = await pool.query(`SELECT COUNT(*) FROM "${schema}"."${tableName}"`);
      tableRowCounts.push({
        schema,
        table: tableName,
        rowCount: parseInt(countResult.rows[0].count, 10),
      });
    } catch {
      tableRowCounts.push({ schema, table: tableName, rowCount: 0 });
    }
  }

  return { scripts, tableRowCounts };
}

export async function exportTableData(
  connectionString: string,
  schema: string,
  table: string,
  batchSize: number,
  offset: number,
): Promise<{ rows: Record<string, unknown>[]; columns: string[]; hasMore: boolean; totalExported: number }> {
  const pool = getPgPool(connectionString);

  const result = await pool.query(
    `SELECT * FROM "${schema}"."${table}" LIMIT $1 OFFSET $2`,
    [batchSize + 1, offset],
  );

  const hasMore = result.rows.length > batchSize;
  const rows = hasMore ? result.rows.slice(0, batchSize) : result.rows;

  return {
    rows,
    columns: result.fields.map((f) => f.name),
    hasMore,
    totalExported: offset + rows.length,
  };
}

export async function executeBatchDdl(
  connectionString: string,
  statements: string[],
  throwOnError: boolean = false,
): Promise<{ errors: Array<{ sql: string; error: string }> }> {
  const pool = getPgPool(connectionString);
  const errors: Array<{ sql: string; error: string }> = [];

  for (const sql of statements) {
    try {
      await pool.query(sql);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      errors.push({ sql, error: errMsg });
      if (throwOnError) {
        throw new Error(`DDL execution failed: ${errMsg}\nSQL: ${sql}`);
      }
    }
  }

  return { errors };
}

export async function waitForDatabase(
  connectionString: string,
  maxRetries: number = 20,
  intervalMs: number = 250,
): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const client = new Client({
        connectionString,
        connectionTimeoutMillis: 2000,
      });
      await client.connect();
      await client.query("SELECT 1");
      await client.end();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  throw new Error(
    `Database not ready after ${maxRetries * intervalMs}ms. Connection string: ${connectionString.replace(/:[^:@]+@/, ":****@")}`,
  );
}

export async function importTableRows(
  connectionString: string,
  schema: string,
  table: string,
  columns: string[],
  rows: Record<string, unknown>[],
): Promise<number> {
  if (rows.length === 0) return 0;

  const pool = getPgPool(connectionString);
  const quotedCols = columns.map((c) => `"${c}"`).join(", ");
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
  const insertSql = `INSERT INTO "${schema}"."${table}" (${quotedCols}) VALUES (${placeholders})`;

  for (const row of rows) {
    const values = columns.map((col) => row[col]);
    await pool.query(insertSql, values);
  }

  return rows.length;
}
