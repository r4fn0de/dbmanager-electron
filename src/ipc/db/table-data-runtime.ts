import type mysql from "mysql2/promise";
import type {
  DatabaseType,
  FkLookupInput,
  FkLookupResponse,
  SaveChangesInput,
  SaveChangesResponse,
  SchemaForeignKey,
  TableRowsResponse,
} from "./types";
import { getMysqlPool, getPgPool } from "./kysely-factory";

function pgId(id: string): string {
  return `"${id.replace(/"/g, '""')}"`;
}

function myId(id: string): string {
  return `\`${id.replace(/`/g, "``")}\``;
}

function mysqlAffectedRows(result: unknown): number {
  const r = result as { affectedRows?: number };
  return Number(r.affectedRows ?? 0);
}

async function execMysql<T = unknown>(
  conn: mysql.PoolConnection,
  query: string,
  values: unknown[] = [],
): Promise<T> {
  const [rows] = await conn.query(query, values as never[]);
  return rows as T;
}

async function savePgChanges(connectionString: string, input: SaveChangesInput): Promise<SaveChangesResponse> {
  const pool = getPgPool(connectionString);
  const client = await pool.connect();

  let inserted = 0;
  let updated = 0;
  let deleted = 0;

  const tableRef = `${pgId(input.tableRef.schema)}.${pgId(input.tableRef.table)}`;

  try {
    await client.query("BEGIN");

    for (const row of input.inserts) {
      const cols = Object.keys(row);
      if (cols.length === 0) {
        const res = await client.query(`INSERT INTO ${tableRef} DEFAULT VALUES`);
        inserted += res.rowCount ?? 0;
        continue;
      }

      const values = cols.map((c) => row[c]);
      const colSql = cols.map(pgId).join(", ");
      const placeholders = cols.map((_, idx) => `$${idx + 1}`).join(", ");
      const res = await client.query(
        `INSERT INTO ${tableRef} (${colSql}) VALUES (${placeholders})`,
        values,
      );
      inserted += res.rowCount ?? 0;
    }

    for (const entry of input.updates) {
      const changes = Object.keys(entry.changes);
      if (changes.length === 0) continue;

      const pkCols = Object.keys(entry.primaryKey);
      if (pkCols.length === 0) {
        throw new Error("Update requires primary key values");
      }

      const changeValues = changes.map((c) => entry.changes[c]);
      const pkValues = pkCols.map((c) => entry.primaryKey[c]);

      const setSql = changes
        .map((c, idx) => `${pgId(c)} = $${idx + 1}`)
        .join(", ");
      const whereSql = pkCols
        .map((c, idx) => `${pgId(c)} = $${changes.length + idx + 1}`)
        .join(" AND ");

      const res = await client.query(
        `UPDATE ${tableRef} SET ${setSql} WHERE ${whereSql}`,
        [...changeValues, ...pkValues],
      );
      updated += res.rowCount ?? 0;
    }

    for (const entry of input.deletes) {
      const pkCols = Object.keys(entry.primaryKey);
      if (pkCols.length === 0) {
        throw new Error("Delete requires primary key values");
      }

      const pkValues = pkCols.map((c) => entry.primaryKey[c]);
      const whereSql = pkCols
        .map((c, idx) => `${pgId(c)} = $${idx + 1}`)
        .join(" AND ");

      const res = await client.query(`DELETE FROM ${tableRef} WHERE ${whereSql}`, pkValues);
      deleted += res.rowCount ?? 0;
    }

    await client.query("COMMIT");
    return { inserted, updated, deleted };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

async function saveMysqlChanges(connectionString: string, input: SaveChangesInput): Promise<SaveChangesResponse> {
  const pool = await getMysqlPool(connectionString);
  const conn = await pool.getConnection();

  let inserted = 0;
  let updated = 0;
  let deleted = 0;

  const tableRef = `${myId(input.tableRef.schema)}.${myId(input.tableRef.table)}`;

  try {
    await conn.beginTransaction();

    for (const row of input.inserts) {
      const cols = Object.keys(row);
      if (cols.length === 0) {
        const res = await execMysql(conn, `INSERT INTO ${tableRef} () VALUES ()`) as unknown;
        inserted += mysqlAffectedRows(res);
        continue;
      }

      const values = cols.map((c) => row[c]);
      const colSql = cols.map(myId).join(", ");
      const placeholders = cols.map(() => "?").join(", ");
      const res = await execMysql(conn, `INSERT INTO ${tableRef} (${colSql}) VALUES (${placeholders})`, values) as unknown;
      inserted += mysqlAffectedRows(res);
    }

    for (const entry of input.updates) {
      const changes = Object.keys(entry.changes);
      if (changes.length === 0) continue;

      const pkCols = Object.keys(entry.primaryKey);
      if (pkCols.length === 0) {
        throw new Error("Update requires primary key values");
      }

      const changeValues = changes.map((c) => entry.changes[c]);
      const pkValues = pkCols.map((c) => entry.primaryKey[c]);

      const setSql = changes.map((c) => `${myId(c)} = ?`).join(", ");
      const whereSql = pkCols.map((c) => `${myId(c)} = ?`).join(" AND ");

      const res = await execMysql(conn, `UPDATE ${tableRef} SET ${setSql} WHERE ${whereSql}`, [
        ...changeValues,
        ...pkValues,
      ]) as unknown;
      updated += mysqlAffectedRows(res);
    }

    for (const entry of input.deletes) {
      const pkCols = Object.keys(entry.primaryKey);
      if (pkCols.length === 0) {
        throw new Error("Delete requires primary key values");
      }

      const pkValues = pkCols.map((c) => entry.primaryKey[c]);
      const whereSql = pkCols.map((c) => `${myId(c)} = ?`).join(" AND ");

      const res = await execMysql(conn, `DELETE FROM ${tableRef} WHERE ${whereSql}`, pkValues) as unknown;
      deleted += mysqlAffectedRows(res);
    }

    await conn.commit();
    return { inserted, updated, deleted };
  } catch (err) {
    await conn.rollback().catch(() => undefined);
    throw err;
  } finally {
    conn.release();
  }
}

export async function tableSaveChangesRuntime(
  dbType: DatabaseType,
  connectionString: string,
  input: SaveChangesInput,
): Promise<SaveChangesResponse> {
  if (dbType === "postgresql") {
    return savePgChanges(connectionString, input);
  }
  if (dbType === "mysql" || dbType === "mariadb") {
    return saveMysqlChanges(connectionString, input);
  }
  throw new Error(`tableSaveChanges is not supported for ${dbType}`);
}

export async function tableTruncateRuntime(
  dbType: DatabaseType,
  connectionString: string,
  schema: string,
  table: string,
): Promise<void> {
  if (dbType === "postgresql") {
    const pool = getPgPool(connectionString);
    await pool.query(`TRUNCATE TABLE ${pgId(schema)}.${pgId(table)}`);
    return;
  }

  if (dbType === "mysql" || dbType === "mariadb") {
    const pool = await getMysqlPool(connectionString);
    const conn = await pool.getConnection();
    try {
      await execMysql(conn, `TRUNCATE TABLE ${myId(schema)}.${myId(table)}`);
    } finally {
      conn.release();
    }
    return;
  }

  throw new Error(`tableTruncate is not supported for ${dbType}`);
}

function pickLabelColumns(rows: Record<string, unknown>[], referencedColumn: string): string[] {
  const first = rows[0];
  if (!first) return [referencedColumn];
  const keys = Object.keys(first);
  const preferred = keys.filter((k) =>
    k === referencedColumn || /name|title|label|email|username/i.test(k),
  );
  const ordered = [...new Set([...preferred, ...keys])];
  return ordered.slice(0, 3);
}

function buildFkOptions(
  rowsResponse: TableRowsResponse,
  referencedColumn: string,
): FkLookupResponse {
  const labelCols = pickLabelColumns(rowsResponse.rows, referencedColumn);
  const options: FkLookupResponse["options"] = [];
  for (const row of rowsResponse.rows) {
    const value = row[referencedColumn];
    if (value === undefined) continue;
    const label = labelCols
      .map((col) => row[col])
      .filter((v) => v !== null && v !== undefined)
      .map((v) => String(v))
      .join(" · ") || String(value);
    options.push({ value, label });
  }

  return {
    options,
    hasMore:
      rowsResponse.totalEstimate >
      rowsResponse.pageInfo.page * rowsResponse.pageInfo.pageSize,
  };
}

export async function tableFkLookupRuntime(args: {
  dbType: DatabaseType;
  connectionString: string;
  input: FkLookupInput;
  getTableDetails: (connectionString: string, schema: string, table: string) => Promise<{
    foreign_keys: SchemaForeignKey[];
  }>;
  listRows: (
    connectionString: string,
    schema: string,
    table: string,
    page: number,
    pageSize: number,
    sort?: Array<{ column: string; direction: "asc" | "desc" }>,
    filters?: Array<{ column: string; operator: string; value?: unknown }>,
  ) => Promise<TableRowsResponse>;
}): Promise<FkLookupResponse> {
  const { dbType, connectionString, input, getTableDetails, listRows } = args;
  if (dbType === "clickhouse") {
    return { options: [], hasMore: false };
  }

  const details = await getTableDetails(
    connectionString,
    input.tableRef.schema,
    input.tableRef.table,
  );

  const fk = details.foreign_keys.find((f) => f.column_name === input.column);
  if (!fk) {
    return { options: [], hasMore: false };
  }

  const rowsResponse = await listRows(
    connectionString,
    fk.referenced_schema ?? input.tableRef.schema,
    fk.referenced_table,
    input.page + 1,
    input.pageSize,
    [{ column: fk.referenced_column, direction: "asc" }],
    input.query.trim().length
      ? [{ column: fk.referenced_column, operator: "contains", value: input.query }]
      : [],
  );

  return buildFkOptions(rowsResponse, fk.referenced_column);
}
