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

export async function createTable(
  connectionString: string,
  schema: string,
  tableName: string,
  columns: {
    name: string;
    dataType: string;
    isNullable: boolean;
    isPrimaryKey?: boolean;
    isUnique?: boolean;
    defaultExpr?: string;
  }[],
  primaryKeyColumns?: string[],
  ifNotExists: boolean = false,
): Promise<string> {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    const columnDefs: string[] = [];

    for (const col of columns) {
      let def = `"${col.name}" ${col.dataType}`;
      if (!col.isNullable) def += " NOT NULL";
      if (col.defaultExpr) def += ` DEFAULT ${col.defaultExpr}`;
      columnDefs.push(def);
    }

    if (primaryKeyColumns && primaryKeyColumns.length > 0) {
      const pkCols = primaryKeyColumns.map((c) => `"${c}"`).join(", ");
      columnDefs.push(`PRIMARY KEY (${pkCols})`);
    }

    const ifNotExistsClause = ifNotExists ? "IF NOT EXISTS" : "";
    const fullTableName = `"${schema}"."${tableName}"`;
    const sql = `CREATE TABLE ${ifNotExistsClause} ${fullTableName} (${columnDefs.join(", ")})`;

    await client.query(sql);
    return sql;
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function dropTable(
  connectionString: string,
  schema: string,
  tableName: string,
  cascade: boolean = false,
  ifExists: boolean = false,
): Promise<void> {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    const cascadeClause = cascade ? "CASCADE" : "";
    const ifExistsClause = ifExists ? "IF EXISTS" : "";
    await client.query(`DROP TABLE ${ifExistsClause} "${schema}"."${tableName}" ${cascadeClause}`);
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function renameTable(
  connectionString: string,
  schema: string,
  oldName: string,
  newName: string,
): Promise<void> {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    await client.query(`ALTER TABLE "${schema}"."${oldName}" RENAME TO "${newName}"`);
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function addColumn(
  connectionString: string,
  schema: string,
  table: string,
  columnName: string,
  dataType: string,
  isNullable: boolean = true,
  defaultExpr?: string,
  ifNotExists: boolean = false,
): Promise<void> {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    let def = `"${columnName}" ${dataType}`;
    if (!isNullable) def += " NOT NULL";
    if (defaultExpr) def += ` DEFAULT ${defaultExpr}`;

    const ifNotExistsClause = ifNotExists ? "IF NOT EXISTS" : "";
    await client.query(`ALTER TABLE "${schema}"."${table}" ADD COLUMN ${ifNotExistsClause} ${def}`);
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function dropColumn(
  connectionString: string,
  schema: string,
  table: string,
  columnName: string,
  cascade: boolean = false,
  ifExists: boolean = false,
): Promise<void> {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    const cascadeClause = cascade ? "CASCADE" : "";
    const ifExistsClause = ifExists ? "IF EXISTS" : "";
    await client.query(
      `ALTER TABLE "${schema}"."${table}" DROP COLUMN ${ifExistsClause} "${columnName}" ${cascadeClause}`,
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function renameColumn(
  connectionString: string,
  schema: string,
  table: string,
  oldName: string,
  newName: string,
): Promise<void> {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    await client.query(
      `ALTER TABLE "${schema}"."${table}" RENAME COLUMN "${oldName}" TO "${newName}"`,
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function alterColumnType(
  connectionString: string,
  schema: string,
  table: string,
  columnName: string,
  newType: string,
  usingExpr?: string,
): Promise<void> {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    const usingClause = usingExpr ? ` USING ${usingExpr}` : "";
    await client.query(
      `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${columnName}" TYPE ${newType}${usingClause}`,
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function setColumnNullable(
  connectionString: string,
  schema: string,
  table: string,
  columnName: string,
  isNullable: boolean,
): Promise<void> {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    const action = isNullable ? "DROP NOT NULL" : "SET NOT NULL";
    await client.query(
      `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${columnName}" ${action}`,
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function setColumnDefault(
  connectionString: string,
  schema: string,
  table: string,
  columnName: string,
  defaultExpr?: string,
): Promise<void> {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    if (defaultExpr) {
      await client.query(
        `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${columnName}" SET DEFAULT ${defaultExpr}`,
      );
    } else {
      await client.query(
        `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${columnName}" DROP DEFAULT`,
      );
    }
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function createIndex(
  connectionString: string,
  schema: string,
  table: string,
  indexName: string,
  columns: string[],
  unique: boolean = false,
  ifNotExists: boolean = false,
): Promise<void> {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    const uniqueKeyword = unique ? "UNIQUE" : "";
    const ifNotExistsClause = ifNotExists ? "IF NOT EXISTS" : "";
    const cols = columns.map((c) => `"${c}"`).join(", ");
    await client.query(
      `CREATE ${uniqueKeyword} INDEX ${ifNotExistsClause} "${indexName}" ON "${schema}"."${table}" (${cols})`,
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function dropIndex(
  connectionString: string,
  schema: string,
  indexName: string,
  cascade: boolean = false,
  ifExists: boolean = false,
): Promise<void> {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    const cascadeClause = cascade ? "CASCADE" : "";
    const ifExistsClause = ifExists ? "IF EXISTS" : "";
    await client.query(
      `DROP INDEX ${ifExistsClause} "${schema}"."${indexName}" ${cascadeClause}`,
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function createSchema(
  connectionString: string,
  schemaName: string,
  ifNotExists: boolean = false,
): Promise<void> {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    const ifNotExistsClause = ifNotExists ? "IF NOT EXISTS" : "";
    await client.query(`CREATE SCHEMA ${ifNotExistsClause} "${schemaName}"`);
  } finally {
    await client.end().catch(() => undefined);
  }
}
