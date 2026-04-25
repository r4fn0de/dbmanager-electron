/**
 * kysely-factory.ts — Factory for memoized database pools and Kysely instances.
 *
 * Each engine gets:
 *   - Raw pool/client cached by connection string (for DDL, export, raw queries)
 *   - Kysely instance cached by connection string (for type-safe schema introspection + listRows)
 *
 * PostgreSQL and MySQL use Kysely's built-in dialects.
 * ClickHouse keeps raw @clickhouse/client (no built-in Kysely dialect —
 * all ClickHouse queries stay raw since Kysely doesn't support it natively).
 */
import { Kysely, PostgresDialect, MysqlDialect } from "kysely";
import { Pool as PgPool } from "pg";
import type { Pool as MysqlPool } from "mysql2/promise";
import type { ClickHouseClient } from "@clickhouse/client";
import type { PgDatabase } from "./kysely-types";
import type { MysqlDatabase } from "./kysely-types";
import { closeAllSqliteDbs } from "./sqlite-driver";

// ---------------------------------------------------------------------------
// Pool cache — one pool per connection string, per engine
// ---------------------------------------------------------------------------

const pgPools = new Map<string, PgPool>();
const mysqlPools = new Map<string, MysqlPool>();
const clickhouseClients = new Map<string, ClickHouseClient>();

// ---------------------------------------------------------------------------
// Kysely instance cache
// ---------------------------------------------------------------------------

const pgKyselyInstances = new Map<string, Kysely<PgDatabase>>();
const mysqlKyselyInstances = new Map<string, Kysely<MysqlDatabase>>();

// ---------------------------------------------------------------------------
// PostgreSQL — raw pool + Kysely instance
// ---------------------------------------------------------------------------

export function getPgPool(connectionString: string): PgPool {
  const existing = pgPools.get(connectionString);
  if (existing) return existing;

  const pool = new PgPool({ connectionString, max: 2 });
  pgPools.set(connectionString, pool);
  return pool;
}

/** Get a memoized Kysely instance for PostgreSQL schema introspection queries. */
export function getPgKysely(connectionString: string): Kysely<PgDatabase> {
  const existing = pgKyselyInstances.get(connectionString);
  if (existing) return existing;

  const pool = getPgPool(connectionString);
  const db = new Kysely<PgDatabase>({
    dialect: new PostgresDialect({ pool }),
  });
  pgKyselyInstances.set(connectionString, db);
  return db;
}

// ---------------------------------------------------------------------------
// MySQL / MariaDB — raw pool + Kysely instance
// ---------------------------------------------------------------------------

export async function getMysqlPool(
  connectionString: string,
): Promise<MysqlPool> {
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

/** Get a memoized Kysely instance for MySQL/MariaDB schema introspection queries. */
export async function getMysqlKysely(connectionString: string): Promise<Kysely<MysqlDatabase>> {
  const existing = mysqlKyselyInstances.get(connectionString);
  if (existing) return existing;

  const pool = await getMysqlPool(connectionString);
  const db = new Kysely<MysqlDatabase>({
    dialect: new MysqlDialect({ pool }),
  });
  mysqlKyselyInstances.set(connectionString, db);
  return db;
}

// ---------------------------------------------------------------------------
// ClickHouse — raw client only (no Kysely dialect)
// ClickHouse uses HTTP-based protocol. We use the raw client for all
// queries. Kysely doesn't have a built-in ClickHouse dialect, and the
// HTTP-based protocol doesn't fit Kysely's streaming/connection model.
// ---------------------------------------------------------------------------

export async function getClickhouseClient(
  connectionString: string,
): Promise<ClickHouseClient> {
  const existing = clickhouseClients.get(connectionString);
  if (existing) return existing;

  const ch = await import("@clickhouse/client");
  let url = connectionString;
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
// Cleanup — close all cached pools and Kysely instances on process exit
// ---------------------------------------------------------------------------

export async function closeAllPools(): Promise<void> {
  // Close Kysely instances — they own the underlying pools, so db.destroy()
  // closes the pool too. Track which connection strings had Kysely instances
  // so we don't double-close those raw pools.
  const pgKyselyKeys = new Set(pgKyselyInstances.keys());
  for (const db of pgKyselyInstances.values()) {
    await db.destroy().catch(() => {});
  }
  pgKyselyInstances.clear();

  // Close any raw PG pools that weren't wrapped by a Kysely instance
  for (const [key, pool] of pgPools.entries()) {
    if (!pgKyselyKeys.has(key)) await pool.end().catch(() => {});
  }
  pgPools.clear();

  const mysqlKyselyKeys = new Set(mysqlKyselyInstances.keys());
  for (const db of mysqlKyselyInstances.values()) {
    await db.destroy().catch(() => {});
  }
  mysqlKyselyInstances.clear();

  // Close any raw MySQL pools that weren't wrapped by a Kysely instance
  for (const [key, pool] of mysqlPools.entries()) {
    if (!mysqlKyselyKeys.has(key)) await pool.end().catch(() => {});
  }
  mysqlPools.clear();

  // ClickHouse has no Kysely instance — close raw clients directly
  for (const client of clickhouseClients.values()) {
    await client.close().catch(() => {});
  }
  clickhouseClients.clear();

  // SQLite — close all cached better-sqlite3 handles
  closeAllSqliteDbs();

  // Redis — close all cached clients
  const { closeAllRedisClients } = await import("./redis-driver");
  closeAllRedisClients();
}
