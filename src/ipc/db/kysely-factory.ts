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
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import Module from "node:module";
import { join } from "node:path";
import type { Pool as MysqlPool } from "mysql2/promise";
import type { ClickHouseClient } from "@clickhouse/client";
import type { PgDatabase } from "./kysely-types";
import type { MysqlDatabase } from "./kysely-types";
import { closeAllSqliteDbs } from "./sqlite-driver";

// ---------------------------------------------------------------------------
// Pool cache — one pool per connection string, per engine
// ---------------------------------------------------------------------------

const runtimeRequire = createRequire(
  join(process.resourcesPath || process.cwd(), "package.json"),
);

type PgPoolCtor = new (config: Record<string, unknown>) => any;
let pgPoolCtorCached: PgPoolCtor | null = null;

function ensureResourcesNodePath(): void {
  const base = process.resourcesPath;
  if (!base) return;

  const current = process.env.NODE_PATH || "";
  const segments = current
    .split(":")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!segments.includes(base)) {
    process.env.NODE_PATH = current ? `${base}:${current}` : base;
    Module._initPaths();
  }
}

function loadPgPoolCtor(): PgPoolCtor {
  ensureResourcesNodePath();
  if (pgPoolCtorCached) return pgPoolCtorCached;

  const base = process.resourcesPath;
  const cwd = process.cwd();
  const candidates = [
    "pg",
    join(cwd, "node_modules", "pg"),
    base ? join(base, "app.asar.unpacked", "node_modules", "pg") : null,
    base ? join(base, "node_modules", "pg") : null,
    base ? join(base, "pg") : null,
  ].filter(Boolean) as string[];

  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      let mod: { Pool?: PgPoolCtor };
      if (candidate === "pg") {
        mod = runtimeRequire(candidate) as { Pool?: PgPoolCtor };
      } else {
        const pkgJsonPath = join(candidate, "package.json");
        if (!existsSync(pkgJsonPath)) continue;
        mod = runtimeRequire(candidate) as { Pool?: PgPoolCtor };
      }

      if (!mod?.Pool) continue;
      pgPoolCtorCached = mod.Pool;
      return mod.Pool;
    } catch (err) {
      lastError = err;
    }
  }

  throw new Error(
    `Failed to load pg Pool constructor. Last error: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

const pgPools = new Map<string, any>();
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

export function getPgPool(connectionString: string): any {
  const existing = pgPools.get(connectionString);
  if (existing) return existing;

  const PgPool = loadPgPoolCtor();
  const pool = new PgPool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  });

  // Health check logging
  pool.on("error", (err) => {
    console.error("[pg:pool] error:", err.message);
  });
  pool.on("connect", () => {
    console.log("[pg:pool] new connection established");
  });
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

/** Close and evict cached PG resources for a single connection string. */
export async function closePgResources(connectionString: string): Promise<void> {
  const db = pgKyselyInstances.get(connectionString);
  if (db) {
    await db.destroy().catch(() => {});
    pgKyselyInstances.delete(connectionString);
  }

  const pool = pgPools.get(connectionString);
  if (pool) {
    await pool.end().catch(() => {});
    pgPools.delete(connectionString);
  }
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
    connectionLimit: 10,
    queueLimit: 0,
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
