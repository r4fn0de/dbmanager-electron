/**
 * RedisDriver — implements DatabaseDriver for Redis key-value store.
 *
 * Redis is fundamentally different from SQL databases:
 * - No schemas/tables — we map Redis DB numbers (0-15) as "schemas"
 * - Keys become "tables" for browsing purposes
 * - Values vary by type (string, hash, list, set, zset, stream)
 *
 * Uses ioredis for connection handling with SCAN for safe iteration.
 */
import type { DatabaseDriver, DriverConnectionConfig } from "./driver";
import type {
  DatabaseType,
  DatabaseInfo,
  DatabaseSchema,
  SchemaSummary,
  SchemaTableDetails,
  QueryResult,
  ColumnMeta,
  SslMode,
  TableStats,
  TableSampleResult,
  TableRowsResponse,
} from "./types";
import type Redis from "ioredis";

const DB_TYPE = "redis" as DatabaseType;
const SCAN_COUNT = 100; // Keys per SCAN iteration
const MAX_PREVIEW_LENGTH = 100;
const MAX_VALUE_ITEMS = 100; // Max items for list/set/zset preview

// Redis client cache — keyed by connection string
const redisClients = new Map<string, Redis>();

interface RedisInfo {
  version: string;
  mode: string;
  os: string;
  uptime: number;
  connectedClients: number;
  usedMemoryHuman: string;
  totalKeys: number;
  databases: number;
}

async function getRedisClient(connectionString: string): Promise<Redis> {
  const existing = redisClients.get(connectionString);
  if (existing) return existing;

  const RedisModule = await import("ioredis");
  const client = new RedisModule.default(connectionString, {
    retryStrategy: (times) => Math.min(times * 50, 2000),
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
  });

  redisClients.set(connectionString, client);
  return client;
}

export function closeAllRedisClients(): void {
  for (const client of redisClients.values()) {
    client.disconnect();
  }
  redisClients.clear();
}

// Parse INFO command output into structured object
function parseInfo(infoStr: string): RedisInfo {
  const lines = infoStr.split("\r\n");
  const result: Partial<RedisInfo> = {};

  for (const line of lines) {
    if (!line || line.startsWith("#")) continue;
    const [key, value] = line.split(":");
    if (!key || !value) continue;

    switch (key) {
      case "redis_version":
        result.version = value;
        break;
      case "redis_mode":
        result.mode = value;
        break;
      case "os":
        result.os = value;
        break;
      case "uptime_in_seconds":
        result.uptime = parseInt(value, 10);
        break;
      case "connected_clients":
        result.connectedClients = parseInt(value, 10);
        break;
      case "used_memory_human":
        result.usedMemoryHuman = value;
        break;
    }
  }

  return {
    version: result.version ?? "unknown",
    mode: result.mode ?? "standalone",
    os: result.os ?? "unknown",
    uptime: result.uptime ?? 0,
    connectedClients: result.connectedClients ?? 0,
    usedMemoryHuman: result.usedMemoryHuman ?? "N/A",
    totalKeys: 0,
    databases: 16,
  };
}

// Get total key count from all databases
async function getTotalKeyCount(client: Redis): Promise<number> {
  try {
    const info = parseInfo(await client.info("keyspace"));
    let total = 0;
    const keyspaceInfo = await client.info("keyspace");
    const lines = keyspaceInfo.split("\r\n");

    for (const line of lines) {
      if (line.startsWith("db")) {
        const match = line.match(/keys=(\d+)/);
        if (match) total += parseInt(match[1], 10);
      }
    }

    return total;
  } catch {
    return 0;
  }
}

// Scan keys iteratively — production-safe alternative to KEYS *
async function* scanKeys(client: Redis, pattern: string = "*"): AsyncGenerator<string> {
  let cursor = "0";

  do {
    const result = await client.scan(cursor, "MATCH", pattern, "COUNT", SCAN_COUNT);
    cursor = result[0];
    const keys = result[1];

    for (const key of keys) {
      yield key;
    }
  } while (cursor !== "0");
}

// Collect all keys from scan (use with caution on large datasets)
async function collectKeys(client: Redis, pattern: string = "*", limit?: number): Promise<string[]> {
  const keys: string[] = [];

  for await (const key of scanKeys(client, pattern)) {
    keys.push(key);
    if (limit && keys.length >= limit) break;
  }

  return keys;
}

// Get type of a key with caching
async function getKeyType(client: Redis, key: string): Promise<string> {
  return await client.type(key);
}

// Get value preview based on type (truncated for display)
async function getValuePreview(client: Redis, key: string, type: string): Promise<string> {
  try {
    switch (type) {
      case "string": {
        const str = await client.get(key);
        if (str === null) return "(nil)";
        if (str.length > MAX_PREVIEW_LENGTH) {
          return str.substring(0, MAX_PREVIEW_LENGTH) + "...";
        }
        // Check if looks like JSON
        if (str.startsWith("{") || str.startsWith("[")) {
          try {
            const parsed = JSON.parse(str);
            return JSON.stringify(parsed, null, 2).substring(0, MAX_PREVIEW_LENGTH);
          } catch {
            return str;
          }
        }
        return str;
      }
      case "hash": {
        const hlen = await client.hlen(key);
        if (hlen === 0) return "Hash (empty)";
        const sample = await client.hgetall(key);
        const keys = Object.keys(sample);
        if (keys.length > 3) {
          return `Hash (${hlen} fields: ${keys.slice(0, 3).join(", ")}...)`;
        }
        return `Hash (${hlen} fields: ${keys.join(", ")})`;
      }
      case "list": {
        const llen = await client.llen(key);
        if (llen === 0) return "List (empty)";
        const items = await client.lrange(key, 0, 2);
        const preview = items.join(", ");
        return llen > 3 ? `List (${llen} items: ${preview}...)` : `List (${llen} items: ${preview})`;
      }
      case "set": {
        const scard = await client.scard(key);
        if (scard === 0) return "Set (empty)";
        const members = await client.smembers(key);
        const preview = members.slice(0, 3).join(", ");
        return scard > 3 ? `Set (${scard} members: ${preview}...)` : `Set (${scard} members: ${preview})`;
      }
      case "zset": {
        const zcard = await client.zcard(key);
        if (zcard === 0) return "Sorted Set (empty)";
        const items = await client.zrange(key, 0, 2, "WITHSCORES");
        return `Sorted Set (${zcard} members)`;
      }
      case "stream":
        const xlen = await client.xlen(key);
        return `Stream (${xlen} entries)`;
      case "bitmap":
        return "Bitmap";
      case "none":
        return "(expired)";
      default:
        return type;
    }
  } catch {
    return `(error getting preview)`;
  }
}

// Get full value for a key (with limits to prevent memory issues)
async function getKeyValue(client: Redis, key: string, type: string): Promise<unknown> {
  try {
    switch (type) {
      case "string":
        return await client.get(key);
      case "hash":
        return await client.hgetall(key);
      case "list":
        return await client.lrange(key, 0, MAX_VALUE_ITEMS - 1);
      case "set":
        return await client.smembers(key);
      case "zset":
        return await client.zrange(key, 0, MAX_VALUE_ITEMS - 1, "WITHSCORES");
      case "stream": {
        const entries = await client.xrange(key, "-", "+", "COUNT", 100);
        return entries;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

// Get memory usage for a key
async function getKeyMemory(client: Redis, key: string): Promise<number | null> {
  try {
    const usage = await (client as unknown as { memory: (subcommand: string, key: string) => Promise<number | null> }).memory("USAGE", key);
    return usage;
  } catch {
    return null;
  }
}

// Group keys by prefix (everything before first colon)
function groupKeysByPrefix(keys: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();

  for (const key of keys) {
    const colonIndex = key.indexOf(":");
    const prefix = colonIndex > 0 ? key.substring(0, colonIndex) : "(no prefix)";

    if (!groups.has(prefix)) {
      groups.set(prefix, []);
    }
    groups.get(prefix)!.push(key);
  }

  return groups;
}

export function createRedisDriver(): DatabaseDriver {
  return {
    type: DB_TYPE,
    defaultPort: 6379,
    defaultDatabase: "0",
    defaultUsername: "",
    sslModes: ["disable", "require"] as SslMode[],

    buildConnectionString(config: DriverConnectionConfig): string {
      if (config.url) return config.url;

      const auth = config.password
        ? `${encodeURIComponent(config.username || "default")}:${encodeURIComponent(config.password)}@`
        : "";
      const ssl = config.ssl_mode === "require" ? "rediss://" : "redis://";
      return `${ssl}${auth}${config.host}:${config.port}/${config.database}`;
    },

    async testConnection(config) {
      try {
        const connStr = this.buildConnectionString(config);
        const client = await getRedisClient(connStr);
        await client.ping();
        return true;
      } catch {
        return false;
      }
    },

    async executeQuery(connectionString, command) {
      const client = await getRedisClient(connectionString);

      try {
        // Parse command: COMMAND arg1 arg2 ...
        const parts = command.trim().split(/\s+/);
        const [cmd, ...args] = parts;

        if (!cmd) {
          throw new Error("Empty command");
        }

        // Execute raw command
        const result = await client.call(cmd, ...args);

        // Format result as tabular data
        const columns: ColumnMeta[] = [{ name: "result", type_name: "string" }];
        let rows: unknown[][] = [];

        if (result === null || result === undefined) {
          rows = [["(nil)"]];
        } else if (Array.isArray(result)) {
          rows = result.map((item) => [String(item)]);
        } else if (typeof result === "object") {
          rows = Object.entries(result).map(([k, v]) => [`${k}: ${v}`]);
        } else {
          rows = [[String(result)]];
        }

        return {
          columns,
          rows,
          row_count: rows.length,
        };
      } catch (err) {
        throw new Error(`Redis command error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    async getDatabaseInfo(connectionString) {
      const client = await getRedisClient(connectionString);

      try {
        const info = parseInfo(await client.info("all"));
        const totalKeys = await getTotalKeyCount(client);
        const dbsize = await client.dbsize();

        return {
          version: `Redis ${info.version} (${info.mode})`,
          encoding: "utf-8",
          timezone: "UTC",
          size: `${info.usedMemoryHuman} — ${totalKeys.toLocaleString()} keys total (DB: ${dbsize.toLocaleString()})`,
        };
      } catch {
        return {
          version: "Redis unknown",
          encoding: "utf-8",
          timezone: "UTC",
        };
      }
    },

    async getSchema(connectionString) {
      const client = await getRedisClient(connectionString);

      try {
        // Use SCAN to get keys iteratively (production-safe)
        const keys = await collectKeys(client, "*", 10000); // Limit to prevent memory issues
        const schemas = new Set<string>(["default"]);

        // Group keys by prefix
        const keyGroups = groupKeysByPrefix(keys);
        const tables: DatabaseSchema["tables"] = [];

        for (const [group] of keyGroups) {
          // Fixed schema for key-value browsing
          tables.push({
            name: group,
            schema: "default",
            columns: [
              { name: "key", data_type: "string", udt_name: null, is_nullable: false, column_default: null },
              { name: "type", data_type: "string", udt_name: null, is_nullable: false, column_default: null },
              { name: "ttl", data_type: "number", udt_name: null, is_nullable: true, column_default: null },
              { name: "size", data_type: "string", udt_name: null, is_nullable: false, column_default: null },
              { name: "value_preview", data_type: "string", udt_name: null, is_nullable: true, column_default: null },
            ],
            indexes: [],
            foreign_keys: [],
            has_rls: false,
            rls_policies: [],
          });
        }

        return {
          schemas: Array.from(schemas),
          tables,
        };
      } catch (err) {
        throw new Error(`Failed to get Redis schema: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    async getSchemaSummary(connectionString) {
      const client = await getRedisClient(connectionString);

      try {
        // Use SCAN to get keys iteratively
        const keys = await collectKeys(client, "*", 10000);
        const groups = groupKeysByPrefix(keys);

        const tables = Array.from(groups.entries()).map(([name, groupKeys]) => ({
          name,
          schema: "default",
          has_rls: false,
          estimated_row_count: groupKeys.length,
        }));

        return {
          schemas: ["default"],
          tables,
        };
      } catch (err) {
        throw new Error(`Failed to get Redis summary: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    async getTableDetails(connectionString, _schema, table) {
      const client = await getRedisClient(connectionString);

      try {
        // Find keys matching this "table" (prefix)
        const pattern = table === "(no prefix)" ? "*" : `${table}:*`;
        const keys = await client.keys(pattern);

        const columns: SchemaTableDetails["columns"] = [
          { name: "key", data_type: "string", udt_name: null, is_nullable: false, column_default: null },
          { name: "type", data_type: "string", udt_name: null, is_nullable: false, column_default: null },
          { name: "ttl", data_type: "number", udt_name: null, is_nullable: true, column_default: null },
          { name: "size", data_type: "string", udt_name: null, is_nullable: false, column_default: null },
        ];

        // Sample first key for additional columns based on type
        if (keys.length > 0) {
          const type = await getKeyType(client, keys[0]);
          if (type === "hash") {
            columns.push({ name: "field", data_type: "string", udt_name: null, is_nullable: false, column_default: null });
            columns.push({ name: "value", data_type: "string", udt_name: null, is_nullable: true, column_default: null });
          }
        }

        return {
          name: table,
          schema: "default",
          has_rls: false,
          columns,
          indexes: [],
          foreign_keys: [],
          rls_policies: [],
        };
      } catch (err) {
        throw new Error(`Failed to get Redis table details: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    // Redis doesn't have traditional indexes
    async getIndexes() {
      return [];
    },

    // Redis doesn't have constraints
    async getConstraints() {
      return [];
    },

    // Redis doesn't have enums
    async getEnums() {
      return [];
    },

    // Redis doesn't have functions/procedures
    async getFunctions() {
      return [];
    },

    // Redis doesn't have triggers
    async getTriggers() {
      return [];
    },

    // Redis doesn't have traditional table stats
    async getTableStats() {
      return {
        schema: "default",
        table: "",
        rowCount: 0,
        sizeBytes: 0,
        sizeFormatted: "N/A",
      };
    },

    // Redis doesn't support EXPLAIN
    async explainQuery() {
      return {
        plan: "Redis does not support EXPLAIN",
        hasExecutionStats: false,
      };
    },

    // Sample keys from a "table" (prefix group)
    async getTableSample(connectionString, _schema, table, sampleSize = 10) {
      const client = await getRedisClient(connectionString);

      try {
        const pattern = table === "(no prefix)" ? "*" : `${table}:*`;
        const keys = await collectKeys(client, pattern, sampleSize);

        const rows: Record<string, unknown>[] = [];
        for (const key of keys) {
          const type = await getKeyType(client, key);
          const value = await getKeyValue(client, key, type);
          const ttl = await client.ttl(key);

          rows.push({
            key,
            type,
            value_preview: await getValuePreview(client, key, type),
            ttl: ttl > 0 ? ttl : null,
            value: type === "string" ? value : JSON.stringify(value),
          });
        }

        return {
          rows,
          columnStats: [
            { columnName: "key", dataType: "string" },
            { columnName: "type", dataType: "string" },
            { columnName: "ttl", dataType: "number" },
          ],
          totalRows: keys.length,
          sampleSize: rows.length,
        };
      } catch (err) {
        throw new Error(`Failed to get Redis sample: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    // List "rows" from a "table" (keys matching prefix)
    async listRows(connectionString, _schema, table, page, pageSize) {
      const client = await getRedisClient(connectionString);

      try {
        const pattern = table === "(no prefix)" ? "*" : `${table}:*`;
        // For pagination with SCAN, we need to collect keys up to the page we need
        // This is not efficient for large pages but SCAN doesn't support offset
        const targetCount = page * pageSize;
        const allKeys = await collectKeys(client, pattern, targetCount);

        const start = (page - 1) * pageSize;
        const end = start + pageSize;
        const keys = allKeys.slice(start, end);

        const rows: Record<string, unknown>[] = [];
        for (const key of keys) {
          const type = await getKeyType(client, key);
          const ttl = await client.ttl(key);
          const size = await getKeyMemory(client, key);

          rows.push({
            key,
            type,
            ttl: ttl > 0 ? ttl : null,
            size: size ? `${Math.round(size / 1024 * 100) / 100} KB` : "N/A",
            value_preview: await getValuePreview(client, key, type),
          });
        }

        return {
          columns: [
            { name: "key", type_name: "string" },
            { name: "type", type_name: "string" },
            { name: "ttl", type_name: "number" },
            { name: "size", type_name: "string" },
            { name: "value_preview", type_name: "string" },
          ],
          rows,
          primaryKey: ["key"],
          foreignKeys: [],
          pageInfo: { page, pageSize },
          totalEstimate: allKeys.length,
        };
      } catch (err) {
        throw new Error(`Failed to list Redis rows: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    // Redis DDL stubs - these don't apply to Redis
    async createTable() {
      return "-- Redis does not support CREATE TABLE";
    },

    async dropTable() {
      return "-- Redis does not support DROP TABLE";
    },

    async renameTable() {
      return "-- Redis does not support RENAME TABLE";
    },

    async addColumn() {
      return "-- Redis does not support ADD COLUMN";
    },

    async dropColumn() {
      return "-- Redis does not support DROP COLUMN";
    },

    async renameColumn() {
      return "-- Redis does not support RENAME COLUMN";
    },

    async alterColumnType() {
      return "-- Redis does not support ALTER COLUMN";
    },

    async setColumnNullable() {
      return "-- Redis does not support SET NULLABLE";
    },

    async setColumnDefault() {
      return "-- Redis does not support SET DEFAULT";
    },

    async createIndex() {
      return "-- Redis does not support CREATE INDEX";
    },

    async dropIndex() {
      return "-- Redis does not support DROP INDEX";
    },

    async createSchema() {
      return "-- Redis does not support CREATE SCHEMA";
    },

    // Export stubs
    async exportSchemaDdl() {
      return { scripts: [], tableRowCounts: [] };
    },

    async exportTableData() {
      return { rows: [], columns: [], hasMore: false, totalExported: 0 };
    },

    async executeBatchDdl() {
      return { errors: [] };
    },

    async waitForDatabase() {
      // Redis is always ready
    },

    async importTableRows() {
      // Redis doesn't support table row imports
      return 0;
    },
  };
}
