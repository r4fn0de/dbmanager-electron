/**
 * Schema Cache — in-memory caching for database schema introspection.
 *
 * Caches schema metadata to avoid repeated queries to the database.
 * - TTL: 5 minutes for automatic refresh
 * - Invalidation: automatic on DDL operations detected
 * - Scope: per connection, per schema/table
 */
import type { DatabaseSchema, SchemaTableDetails, IndexInfo, ConstraintInfo, TableStats } from "@/ipc/db/types";

// ---------------------------------------------------------------------------
// Cache entry types
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  key: string;
}

interface SchemaCache {
  fullSchema?: CacheEntry<DatabaseSchema>;
  tableDetails: Map<string, CacheEntry<SchemaTableDetails>>;
  indexes: Map<string, CacheEntry<IndexInfo[]>>;
  constraints: Map<string, CacheEntry<ConstraintInfo[]>>;
  tableStats: Map<string, CacheEntry<TableStats>>;
}

// ---------------------------------------------------------------------------
// Cache configuration
// ---------------------------------------------------------------------------

const TTL_MS = 5 * 60 * 1000; // 5 minutes

// Global cache: connectionId -> SchemaCache
const cache = new Map<string, SchemaCache>();

// Track recent DDL operations for invalidation
const recentDdlOps = new Map<string, number>();

// ---------------------------------------------------------------------------
// Key builders
// ---------------------------------------------------------------------------

function buildTableKey(schema: string, table: string): string {
  return `${schema}.${table}`;
}

// ---------------------------------------------------------------------------
// Cache management
// ---------------------------------------------------------------------------

function getOrCreateConnectionCache(connectionId: string): SchemaCache {
  if (!cache.has(connectionId)) {
    cache.set(connectionId, {
      tableDetails: new Map(),
      indexes: new Map(),
      constraints: new Map(),
      tableStats: new Map(),
    });
  }
  return cache.get(connectionId)!;
}

function isExpired(entry: CacheEntry<unknown>): boolean {
  return Date.now() - entry.timestamp > TTL_MS;
}

function shouldInvalidate(connectionId: string, schema: string, table?: string): boolean {
  const ddlKey = table
    ? `${connectionId}:${schema}.${table}:ddl`
    : `${connectionId}:${schema}:ddl`;
  const lastDdl = recentDdlOps.get(ddlKey);
  if (!lastDdl) return false;
  // Invalidate if DDL happened in last 5 minutes
  return Date.now() - lastDdl < TTL_MS;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get cached full schema for a connection.
 * Returns null if not cached or expired.
 */
export function getCachedSchema(connectionId: string): DatabaseSchema | null {
  const connCache = cache.get(connectionId);
  if (!connCache?.fullSchema) return null;
  if (isExpired(connCache.fullSchema)) {
    connCache.fullSchema = undefined;
    return null;
  }
  return connCache.fullSchema.data;
}

/**
 * Set cached full schema for a connection.
 */
export function setCachedSchema(connectionId: string, schema: DatabaseSchema): void {
  const connCache = getOrCreateConnectionCache(connectionId);
  connCache.fullSchema = {
    data: schema,
    timestamp: Date.now(),
    key: "fullSchema",
  };
}

/**
 * Get cached table details.
 */
export function getCachedTableDetails(
  connectionId: string,
  schema: string,
  table: string,
): SchemaTableDetails | null {
  const connCache = cache.get(connectionId);
  if (!connCache) return null;

  const key = buildTableKey(schema, table);
  const entry = connCache.tableDetails.get(key);

  if (!entry) return null;
  if (isExpired(entry) || shouldInvalidate(connectionId, schema, table)) {
    connCache.tableDetails.delete(key);
    return null;
  }

  return entry.data;
}

/**
 * Set cached table details.
 */
export function setCachedTableDetails(
  connectionId: string,
  schema: string,
  table: string,
  details: SchemaTableDetails,
): void {
  const connCache = getOrCreateConnectionCache(connectionId);
  const key = buildTableKey(schema, table);
  connCache.tableDetails.set(key, {
    data: details,
    timestamp: Date.now(),
    key,
  });
}

/**
 * Get cached indexes.
 */
export function getCachedIndexes(
  connectionId: string,
  schema: string,
  table: string,
): IndexInfo[] | null {
  const connCache = cache.get(connectionId);
  if (!connCache) return null;

  const key = buildTableKey(schema, table);
  const entry = connCache.indexes.get(key);

  if (!entry) return null;
  if (isExpired(entry) || shouldInvalidate(connectionId, schema, table)) {
    connCache.indexes.delete(key);
    return null;
  }

  return entry.data;
}

/**
 * Set cached indexes.
 */
export function setCachedIndexes(
  connectionId: string,
  schema: string,
  table: string,
  indexes: IndexInfo[],
): void {
  const connCache = getOrCreateConnectionCache(connectionId);
  const key = buildTableKey(schema, table);
  connCache.indexes.set(key, {
    data: indexes,
    timestamp: Date.now(),
    key,
  });
}

/**
 * Get cached constraints.
 */
export function getCachedConstraints(
  connectionId: string,
  schema: string,
  table: string,
): ConstraintInfo[] | null {
  const connCache = cache.get(connectionId);
  if (!connCache) return null;

  const key = buildTableKey(schema, table);
  const entry = connCache.constraints.get(key);

  if (!entry) return null;
  if (isExpired(entry) || shouldInvalidate(connectionId, schema, table)) {
    connCache.constraints.delete(key);
    return null;
  }

  return entry.data;
}

/**
 * Set cached constraints.
 */
export function setCachedConstraints(
  connectionId: string,
  schema: string,
  table: string,
  constraints: ConstraintInfo[],
): void {
  const connCache = getOrCreateConnectionCache(connectionId);
  const key = buildTableKey(schema, table);
  connCache.constraints.set(key, {
    data: constraints,
    timestamp: Date.now(),
    key,
  });
}

/**
 * Get cached table stats.
 */
export function getCachedTableStats(
  connectionId: string,
  schema: string,
  table: string,
): TableStats | null {
  const connCache = cache.get(connectionId);
  if (!connCache) return null;

  const key = buildTableKey(schema, table);
  const entry = connCache.tableStats.get(key);

  if (!entry) return null;
  if (isExpired(entry) || shouldInvalidate(connectionId, schema, table)) {
    connCache.tableStats.delete(key);
    return null;
  }

  return entry.data;
}

/**
 * Set cached table stats.
 */
export function setCachedTableStats(
  connectionId: string,
  schema: string,
  table: string,
  stats: TableStats,
): void {
  const connCache = getOrCreateConnectionCache(connectionId);
  const key = buildTableKey(schema, table);
  connCache.tableStats.set(key, {
    data: stats,
    timestamp: Date.now(),
    key,
  });
}

// ---------------------------------------------------------------------------
// Invalidation
// ---------------------------------------------------------------------------

/**
 * Invalidate all cached data for a connection.
 * Called when connection is closed or refreshed.
 */
export function invalidateConnectionCache(connectionId: string): void {
  cache.delete(connectionId);
  // Clean up DDL tracking for this connection
  for (const key of recentDdlOps.keys()) {
    if (key.startsWith(`${connectionId}:`)) {
      recentDdlOps.delete(key);
    }
  }
}

/**
 * Invalidate cached data for a specific table.
 * Called when DDL is detected on that table.
 */
export function invalidateTableCache(
  connectionId: string,
  schema: string,
  table: string,
): void {
  const connCache = cache.get(connectionId);
  if (!connCache) return;

  const key = buildTableKey(schema, table);
  connCache.tableDetails.delete(key);
  connCache.indexes.delete(key);
  connCache.constraints.delete(key);
  connCache.tableStats.delete(key);

  // Mark DDL operation
  const ddlKey = `${connectionId}:${schema}.${table}:ddl`;
  recentDdlOps.set(ddlKey, Date.now());
}

/**
 * Invalidate schema-level cache.
 * Called when schema-level DDL is detected.
 */
export function invalidateSchemaCache(connectionId: string, schema: string): void {
  const connCache = cache.get(connectionId);
  if (!connCache) return;

  // Invalidate full schema
  connCache.fullSchema = undefined;

  // Invalidate all tables in this schema
  const prefix = `${schema}.`;
  for (const key of connCache.tableDetails.keys()) {
    if (key.startsWith(prefix)) {
      connCache.tableDetails.delete(key);
      connCache.indexes.delete(key);
      connCache.constraints.delete(key);
      connCache.tableStats.delete(key);
    }
  }

  // Mark DDL operation
  const ddlKey = `${connectionId}:${schema}:ddl`;
  recentDdlOps.set(ddlKey, Date.now());
}

/**
 * Record a DDL operation for invalidation tracking.
 * Should be called after any DDL operation (CREATE, ALTER, DROP, etc.)
 */
export function recordDdlOperation(
  connectionId: string,
  schema: string,
  table?: string,
): void {
  const ddlKey = table
    ? `${connectionId}:${schema}.${table}:ddl`
    : `${connectionId}:${schema}:ddl`;
  recentDdlOps.set(ddlKey, Date.now());

  // Also invalidate immediately
  if (table) {
    invalidateTableCache(connectionId, schema, table);
  } else {
    invalidateSchemaCache(connectionId, schema);
  }
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/**
 * Clean up expired entries across all caches.
 * Can be called periodically to free memory.
 */
export function cleanupExpiredCache(): void {
  const now = Date.now();

  for (const [connectionId, connCache] of cache.entries()) {
    // Check full schema
    if (connCache.fullSchema && isExpired(connCache.fullSchema)) {
      connCache.fullSchema = undefined;
    }

    // Clean up table-level caches
    for (const [key, entry] of connCache.tableDetails.entries()) {
      if (isExpired(entry)) {
        connCache.tableDetails.delete(key);
        connCache.indexes.delete(key);
        connCache.constraints.delete(key);
        connCache.tableStats.delete(key);
      }
    }

    // Remove empty connection caches
    if (
      !connCache.fullSchema &&
      connCache.tableDetails.size === 0 &&
      connCache.indexes.size === 0 &&
      connCache.constraints.size === 0 &&
      connCache.tableStats.size === 0
    ) {
      cache.delete(connectionId);
    }
  }

  // Clean up old DDL tracking entries
  for (const [key, timestamp] of recentDdlOps.entries()) {
    if (now - timestamp > TTL_MS) {
      recentDdlOps.delete(key);
    }
  }
}

// Run cleanup every 10 minutes
setInterval(cleanupExpiredCache, 10 * 60 * 1000);
