import { Client, type QueryResult as PgQueryResult } from "pg";
import type {
  ColumnMeta,
  DatabaseInfo,
  DatabaseSchema,
  QueryResult,
  SchemaColumn,
  SchemaForeignKey,
  SchemaIndex,
  SchemaPolicy,
  SchemaSummary,
  SchemaTable,
  SchemaTableDetails,
  SchemaTableSummary,
  TableForeignKeyMeta,
  TableRowsResponse,
} from "./types";

function mapPgType(udtName: string, dataType: string): string {
  const typeMap: Record<string, string> = {
    varchar: "string",
    text: "string",
    bpchar: "string",
    int2: "number",
    int4: "number",
    int8: "number",
    float4: "number",
    float8: "number",
    numeric: "number",
    bool: "boolean",
    date: "date",
    timestamp: "datetime",
    timestamptz: "datetime",
    json: "json",
    jsonb: "json",
    uuid: "uuid",
  };
  return typeMap[udtName] || typeMap[dataType.toLowerCase()] || "unknown";
}

export function buildConnectionString(config: {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl_mode: string;
  url?: string;
}): string {
  if (config.url) {
    return config.url;
  }
  const sslMode = config.ssl_mode || "prefer";
  return `postgresql://${encodeURIComponent(config.username)}:${encodeURIComponent(config.password)}@${config.host}:${config.port}/${config.database}?sslmode=${sslMode}`;
}

export async function testConnection(config: {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl_mode: string;
  url?: string;
}): Promise<boolean> {
  const client = new Client({
    connectionString: buildConnectionString(config),
    connectionTimeoutMillis: 5000,
  });
  try {
    await client.connect();
    await client.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function executeQuery(
  connectionString: string,
  sql: string,
): Promise<QueryResult> {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    const result: PgQueryResult = await client.query(sql);
    const columns: ColumnMeta[] = result.fields.map((f) => ({
      name: f.name,
      type_name: mapPgType(f.dataTypeID.toString(), f.dataTypeID.toString()),
    }));
    return {
      columns,
      rows: result.rows.map((row) => Object.values(row)),
      row_count: result.rowCount || 0,
    };
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function getDatabaseInfo(
  connectionString: string,
): Promise<DatabaseInfo> {
  const client = new Client({ connectionString });
  try {
    await client.connect();
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
    await client.end().catch(() => undefined);
  }
}

export async function getSchema(connectionString: string): Promise<DatabaseSchema> {
  const client = new Client({ connectionString });
  try {
    await client.connect();

    const schemasResult = await client.query(
      "SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT LIKE 'pg_%' AND schema_name != 'information_schema' ORDER BY schema_name",
    );
    const schemas = schemasResult.rows.map((r) => r.schema_name as string);

    const tablesResult = await client.query(`
      SELECT 
        c.table_schema,
        c.table_name,
        c.column_name,
        c.data_type,
        c.udt_name,
        c.is_nullable,
        c.column_default
      FROM information_schema.columns c
      WHERE c.table_schema NOT LIKE 'pg_%' AND c.table_schema != 'information_schema'
      ORDER BY c.table_schema, c.table_name, c.ordinal_position
    `);

    const indexesResult = await client.query(`
      SELECT 
        schemaname,
        tablename,
        indexname,
        indexdef
      FROM pg_indexes
      WHERE schemaname NOT LIKE 'pg_%' AND schemaname != 'information_schema'
    `);

    const foreignKeysResult = await client.query(`
      SELECT
        tc.table_schema,
        tc.table_name,
        kcu.column_name,
        ccu.table_schema AS foreign_table_schema,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage AS ccu ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
    `);

    const tablesMap = new Map<string, SchemaTable>();

    for (const row of tablesResult.rows) {
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
      const table = tablesMap.get(key)!;
      table.columns.push({
        name: row.column_name,
        data_type: row.data_type,
        udt_name: row.udt_name,
        is_nullable: row.is_nullable === "YES",
        column_default: row.column_default,
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
          ? columnMatch[1].split(",").map((c) => c.trim())
          : [];
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
          column_name: row.column_name,
          referenced_schema: row.foreign_table_schema,
          referenced_table: row.foreign_table_name,
          referenced_column: row.foreign_column_name,
        });
      }
    }

    return {
      schemas,
      tables: Array.from(tablesMap.values()),
    };
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function getSchemaSummary(
  connectionString: string,
): Promise<SchemaSummary> {
  const schema = await getSchema(connectionString);
  return {
    schemas: schema.schemas,
    tables: schema.tables.map((t) => ({
      name: t.name,
      schema: t.schema,
      has_rls: t.has_rls,
    })),
  };
}

export async function getTableDetails(
  connectionString: string,
  schema: string,
  table: string,
): Promise<SchemaTableDetails> {
  const fullSchema = await getSchema(connectionString);
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
}

export async function listRows(
  connectionString: string,
  schema: string,
  table: string,
  page: number,
  pageSize: number,
): Promise<TableRowsResponse> {
  const client = new Client({ connectionString });
  try {
    await client.connect();

    const offset = (page - 1) * pageSize;
    const rowsResult = await client.query(
      `SELECT * FROM "${schema}"."${table}" LIMIT $1 OFFSET $2`,
      [pageSize, offset],
    );

    const countResult = await client.query(
      `SELECT COUNT(*) FROM "${schema}"."${table}"`,
    );
    const totalEstimate = parseInt(countResult.rows[0].count, 10);

    const pkResult = await client.query(
      `
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_schema = $1
        AND tc.table_name = $2
    `,
      [schema, table],
    );
    const primaryKey = pkResult.rows.map((r) => r.column_name);

    const fkResult = await client.query(
      `
      SELECT
        tc.constraint_name as name,
        kcu.column_name,
        ccu.table_schema as referenced_schema,
        ccu.table_name as referenced_table,
        ccu.column_name as referenced_column
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = $1
        AND tc.table_name = $2
    `,
      [schema, table],
    );
    const foreignKeys: TableForeignKeyMeta[] = fkResult.rows.map((r) => ({
      name: r.name,
      column_name: r.column_name,
      referenced_schema: r.referenced_schema,
      referenced_table: r.referenced_table,
      referenced_column: r.referenced_column,
    }));

    const columns: ColumnMeta[] = rowsResult.fields.map((f) => ({
      name: f.name,
      type_name: mapPgType(f.dataTypeID.toString(), f.dataTypeID.toString()),
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
    await client.end().catch(() => undefined);
  }
}
