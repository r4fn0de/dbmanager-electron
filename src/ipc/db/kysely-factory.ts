/**
 * kysely-factory.ts — Factory for creating memoized database pools and clients.
 *
 * Each engine (PostgreSQL, MySQL, ClickHouse) gets its own pool/client
 * cached by connection string so we don't create a new connection per query.
 */
import { Pool as PgPool } from "pg";

// ---------------------------------------------------------------------------
// Pool cache — one pool per connection string, per engine
// ---------------------------------------------------------------------------

const pgPools = new Map<string, PgPool>();
const mysqlPools = new Map<string, import("mysql2/promise").Pool>();
const clickhouseClients = new Map<string, import("@clickhouse/client").ClickHouseClient>();

// ---------------------------------------------------------------------------
// PostgreSQL
// ---------------------------------------------------------------------------

export function getPgPool(connectionString: string): PgPool {
  const existing = pgPools.get(connectionString);
  if (existing) return existing;

  const pool = new PgPool({ connectionString, max: 2 });
  pgPools.set(connectionString, pool);
  return pool;
}

// ---------------------------------------------------------------------------
// MySQL / MariaDB
// ---------------------------------------------------------------------------

export async function getMysqlPool(
  connectionString: string,
): Promise<import("mysql2/promise").Pool> {
  const existing = mysqlPools.get(connectionString);
  if (existing) return existing;

  const mysql = await import("mysql2/promise");
  const pool = mysql.createPool({
    uri: connectionString,
    connectionLimit: 2,
    dateStrings: true,
  });
  mysqlPools.set(connectionString, pool);
  return pool;
}

// ---------------------------------------------------------------------------
// ClickHouse — uses @clickhouse/client directly (no Kysely dialect available)
// ---------------------------------------------------------------------------

export async function getClickhouseClient(
  connectionString: string,
): Promise<import("@clickhouse/client").ClickHouseClient> {
  const existing = clickhouseClients.get(connectionString);
  if (existing) return existing;

  const ch = await import("@clickhouse/client");
  let url = connectionString;
  // Normalize protocol: clickhouses:// → https://, clickhouse:// → http://
  if (url.startsWith("clickhouses://")) {
    url = url.replace("clickhouses", "https");
  } else if (url.startsWith("clickhouse://")) {
    url = url.replace("clickhouse", "http");
  }
  const client = ch.createClient({
    url,
    clickhouse_settings: {
      date_time_output_format: "iso",
    },
  });
  clickhouseClients.set(connectionString, client);
  return client;
}

// ---------------------------------------------------------------------------
// Cleanup — close all cached pools on process exit
// ---------------------------------------------------------------------------

export async function closeAllPools(): Promise<void> {
  for (const pool of pgPools.values()) {
    await pool.end().catch(() => {});
  }
  pgPools.clear();

  for (const pool of mysqlPools.values()) {
    await pool.end().catch(() => {});
  }
  mysqlPools.clear();

  for (const client of clickhouseClients.values()) {
    await client.close().catch(() => {});
  }
  clickhouseClients.clear();
}
