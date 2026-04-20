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

// Clone to Local - Schema Export Functions

export async function exportSchemaDdl(
  connectionString: string,
): Promise<{ scripts: Array<{ type: string; schema: string; name: string; sql: string; dependsOn?: string[] }>; tableRowCounts: Array<{ schema: string; table: string; rowCount: number }> }> {
  const client = new Client({ connectionString });
  try {
    await client.connect();

    const scripts: Array<{ type: string; schema: string; name: string; sql: string; dependsOn?: string[] }> = [];

    // 1. Get schemas (excluding system schemas)
    const schemasResult = await client.query(`
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

    // 2. Get sequences (for serial/identity columns)
    const seqResult = await client.query(`
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

    const sequenceScripts: Map<string, { schema: string; name: string; table: string; column: string }> = new Map();
    for (const row of seqResult.rows) {
      const key = `${row.sequence_schema}.${row.sequence_name}`;
      sequenceScripts.set(key, {
        schema: row.sequence_schema,
        name: row.sequence_name,
        table: row.table_name,
        column: row.column_name,
      });
    }

    // Generate CREATE SEQUENCE statements
    for (const [, seq] of sequenceScripts) {
      scripts.push({
        type: "sequence",
        schema: seq.schema,
        name: seq.name,
        sql: `CREATE SEQUENCE IF NOT EXISTS "${seq.schema}"."${seq.name}";`,
        dependsOn: [],
      });
    }

    // 3. Get tables with columns
    const tablesResult = await client.query(`
      SELECT
        c.table_schema,
        c.table_name,
        c.column_name,
        c.data_type,
        c.udt_name,
        c.is_nullable,
        c.column_default,
        c.ordinal_position
      FROM information_schema.columns c
      WHERE c.table_schema NOT LIKE 'pg_%'
        AND c.table_schema != 'information_schema'
        AND c.table_schema NOT LIKE 'pg_catalog'
      ORDER BY c.table_schema, c.table_name, c.ordinal_position
    `);

    // Group columns by table
    const tableColumns = new Map<string, Array<{
      name: string;
      data_type: string;
      udt_name: string;
      is_nullable: string;
      column_default: string | null;
    }>>();

    for (const row of tablesResult.rows) {
      const key = `${row.table_schema}.${row.table_name}`;
      if (!tableColumns.has(key)) {
        tableColumns.set(key, []);
      }
      tableColumns.get(key)!.push(row);
    }

    // 4. Get primary keys
    const pkResult = await client.query(`
      SELECT
        tc.table_schema,
        tc.table_name,
        kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_schema NOT LIKE 'pg_%'
        AND tc.table_schema != 'information_schema'
    `);

    const tablePrimaryKeys = new Map<string, string[]>();
    for (const row of pkResult.rows) {
      const key = `${row.table_schema}.${row.table_name}`;
      if (!tablePrimaryKeys.has(key)) {
        tablePrimaryKeys.set(key, []);
      }
      tablePrimaryKeys.get(key)!.push(row.column_name);
    }

    // 5. Build CREATE TABLE statements
    for (const [tableKey, columns] of tableColumns) {
      const [schema, tableName] = tableKey.split(".");
      const pkCols = tablePrimaryKeys.get(tableKey) || [];

      const columnDefs: string[] = [];
      for (const col of columns) {
        let def = `  "${col.name}" ${col.data_type}`;
        if (col.is_nullable === "NO") def += " NOT NULL";
        if (col.column_default) {
          // Skip nextval defaults for serial types (will handle separately)
          if (!col.column_default.includes("nextval")) {
            def += ` DEFAULT ${col.column_default}`;
          }
        }
        columnDefs.push(def);
      }

      // Add primary key constraint
      if (pkCols.length > 0) {
        const pkDef = pkCols.map(c => `"${c}"`).join(", ");
        columnDefs.push(`  PRIMARY KEY (${pkDef})`);
      }

      const createTableSql = `CREATE TABLE IF NOT EXISTS "${schema}"."${tableName}" (\n${columnDefs.join(",\n")}\n);`;

      scripts.push({
        type: "table",
        schema,
        name: tableName,
        sql: createTableSql,
      });
    }

    // 6. Get indexes (excluding primary key and unique indexes that are constraints)
    const indexesResult = await client.query(`
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
      // Clean up indexdef to make it idempotent
      let sql = row.indexdef;
      // Add IF NOT EXISTS if not present
      if (!sql.includes("IF NOT EXISTS")) {
        sql = sql.replace("CREATE INDEX", "CREATE INDEX IF NOT EXISTS");
        sql = sql.replace("CREATE UNIQUE INDEX", "CREATE UNIQUE INDEX IF NOT EXISTS");
      }

      scripts.push({
        type: "index",
        schema: row.schemaname,
        name: row.indexname,
        sql: `${sql};`,
      });
    }

    // 7. Get foreign key constraints
    const fkResult = await client.query(`
      SELECT
        tc.table_schema,
        tc.table_name,
        tc.constraint_name,
        kcu.column_name,
        ccu.table_schema AS foreign_table_schema,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage AS ccu ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema NOT LIKE 'pg_%'
        AND tc.table_schema != 'information_schema'
    `);

    const tableForeignKeys = new Map<string, Array<{
      constraint_name: string;
      column_name: string;
      foreign_table_schema: string;
      foreign_table_name: string;
      foreign_column_name: string;
    }>>();

    for (const row of fkResult.rows) {
      const key = `${row.table_schema}.${row.table_name}`;
      if (!tableForeignKeys.has(key)) {
        tableForeignKeys.set(key, []);
      }
      tableForeignKeys.get(key)!.push(row);
    }

    // Build ALTER TABLE ADD CONSTRAINT for foreign keys
    for (const [tableKey, fks] of tableForeignKeys) {
      const [schema, tableName] = tableKey.split(".");
      for (const fk of fks) {
        const sql = `ALTER TABLE "${schema}"."${tableName}" ADD CONSTRAINT "${fk.constraint_name}" FOREIGN KEY ("${fk.column_name}") REFERENCES "${fk.foreign_table_schema}"."${fk.foreign_table_name}" ("${fk.foreign_column_name}");`;
        scripts.push({
          type: "constraint",
          schema,
          name: fk.constraint_name,
          sql,
          dependsOn: [`${fk.foreign_table_schema}.${fk.foreign_table_name}`],
        });
      }
    }

    // 8. Get row counts for all tables
    const tableRowCounts: Array<{ schema: string; table: string; rowCount: number }> = [];
    for (const tableKey of tableColumns.keys()) {
      const [schema, tableName] = tableKey.split(".");
      try {
        const countResult = await client.query(
          `SELECT COUNT(*) FROM "${schema}"."${tableName}"`
        );
        tableRowCounts.push({
          schema,
          table: tableName,
          rowCount: parseInt(countResult.rows[0].count, 10),
        });
      } catch {
        // Skip if unable to count
        tableRowCounts.push({
          schema,
          table: tableName,
          rowCount: 0,
        });
      }
    }

    return { scripts, tableRowCounts };
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function exportTableData(
  connectionString: string,
  schema: string,
  table: string,
  batchSize: number,
  offset: number,
): Promise<{ rows: Record<string, unknown>[]; columns: string[]; hasMore: boolean; totalExported: number }> {
  const client = new Client({ connectionString });
  try {
    await client.connect();

    const result = await client.query(
      `SELECT * FROM "${schema}"."${table}" LIMIT $1 OFFSET $2`,
      [batchSize + 1, offset] // Fetch one extra to check if there are more
    );

    const hasMore = result.rows.length > batchSize;
    const rows = hasMore ? result.rows.slice(0, batchSize) : result.rows;

    const columns = result.fields.map(f => f.name);

    return {
      rows,
      columns,
      hasMore,
      totalExported: offset + rows.length,
    };
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function executeBatchDdl(
  connectionString: string,
  statements: string[],
  throwOnError: boolean = false,
): Promise<{ errors: Array<{ sql: string; error: string }> }> {
  const client = new Client({ connectionString });
  const errors: Array<{ sql: string; error: string }> = [];
  try {
    await client.connect();

    for (const sql of statements) {
      try {
        await client.query(sql);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`Failed to execute DDL: ${sql}`, err);
        errors.push({ sql, error: errMsg });
        if (throwOnError) {
          throw new Error(`DDL execution failed: ${errMsg}\nSQL: ${sql}`);
        }
      }
    }
  } finally {
    await client.end().catch(() => undefined);
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

  const client = new Client({ connectionString });
  try {
    await client.connect();

    const quotedCols = columns.map((c) => `"${c}"`).join(", ");
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
    const insertSql = `INSERT INTO "${schema}"."${table}" (${quotedCols}) VALUES (${placeholders})`;

    for (const row of rows) {
      const values = columns.map((col) => row[col]);
      await client.query(insertSql, values);
    }

    return rows.length;
  } finally {
    await client.end().catch(() => undefined);
  }
}
