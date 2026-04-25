/**
 * RedisDriver — implements DatabaseDriver for Redis key-value store.
 *
 * Redis is fundamentally different from SQL databases:
 * - No schemas/tables — we map Redis DB numbers (0-15) as "schemas"
 * - Keys become "tables" for browsing purposes
 * - Values vary by type (string, hash, list, set, zset)
 *
 * Uses ioredis for connection handling.
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
} from "./types";
import type Redis from "ioredis";

const DB_TYPE = "redis" as DatabaseType;

// Redis client cache
const redisClients = new Map<string, Redis>();

async function getRedisClient(connectionString: string): Promise<Redis> {
  const existing = redisClients.get(connectionString);
  if (existing) return existing;

  const RedisModule = await import("ioredis");
  const client = new RedisModule.default(connectionString, {
    retryStrategy: (times) => Math.min(times * 50, 2000),
    maxRetriesPerRequest: 3,
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

// Helper: Get type of a key
async function getKeyType(client: Redis, key: string): Promise<string> {
  return await client.type(key);
}

// Helper: Get value preview based on type
async function getValuePreview(client: Redis, key: string, type: string): Promise<string> {
  switch (type) {
    case "string":
      const str = await client.get(key);
      return str?.substring(0, 100) ?? "(nil)";
    case "hash":
      const hlen = await client.hlen(key);
      return `Hash (${hlen} fields)`;
    case "list":
      const llen = await client.llen(key);
      return `List (${llen} items)`;
    case "set":
      const scard = await client.scard(key);
      return `Set (${scard} members)`;
    case "zset":
      const zcard = await client.zcard(key);
      return `Sorted Set (${zcard} members)`;
    default:
      return type;
  }
}

// Helper: Get full value for a key (limited)
async function getKeyValue(client: Redis, key: string, type: string): Promise<unknown> {
  switch (type) {
    case "string":
      return await client.get(key);
    case "hash":
      return await client.hgetall(key);
    case "list":
      return await client.lrange(key, 0, 99); // First 100 items
    case "set":
      return await client.smembers(key);
    case "zset":
      return await client.zrange(key, 0, 99, "WITHSCORES");
    default:
      return null;
  }
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
        const info = await client.info("server");
        const version = info.match(/redis_version:(.+)/)?.[1]?.trim() ?? "unknown";
        const mode = info.match(/redis_mode:(.+)/)?.[1]?.trim() ?? "standalone";

        // Get memory info
        const memInfo = await client.info("memory");
        const usedMemory = memInfo.match(/used_memory_human:(.+)/)?.[1]?.trim();

        return {
          version: `Redis ${version} (${mode})`,
          encoding: "utf-8",
          timezone: "UTC",
          size: usedMemory,
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
        // Get all keys (use SCAN for production safety, but KEYS for simplicity in dev)
        const keys = await client.keys("*");
        const schemas = new Set<string>(["default"]);

        // Group keys by pattern (e.g., "user:123" -> "user")
        const keyGroups = new Map<string, string[]>();

        for (const key of keys) {
          const colonIndex = key.indexOf(":");
          const group = colonIndex > 0 ? key.substring(0, colonIndex) : "(no prefix)";
          if (!keyGroups.has(group)) {
            keyGroups.set(group, []);
          }
          keyGroups.get(group)!.push(key);
        }

        const tables: DatabaseSchema["tables"] = [];

        for (const [group, groupKeys] of keyGroups) {
          // Sample first few keys for column info
          const sampleKeys = groupKeys.slice(0, 3);
          const columns: SchemaTableDetails["columns"] = [];

          for (const key of sampleKeys) {
            const type = await getKeyType(client, key);
            columns.push({
              name: "key",
              data_type: "string",
              udt_name: null,
              is_nullable: false,
              column_default: null,
            });
            columns.push({
              name: "type",
              data_type: "string",
              udt_name: null,
              is_nullable: false,
              column_default: type,
            });
            columns.push({
              name: "value_preview",
              data_type: "string",
              udt_name: null,
              is_nullable: true,
              column_default: null,
            });
          }

          tables.push({
            name: group,
            schema: "default",
            columns,
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
        // Group keys by prefix
        const keys = await client.keys("*");
        const groups = new Map<string, number>();

        for (const key of keys) {
          const colonIndex = key.indexOf(":");
          const group = colonIndex > 0 ? key.substring(0, colonIndex) : "(no prefix)";
          groups.set(group, (groups.get(group) ?? 0) + 1);
        }

        const tables = Array.from(groups.entries()).map(([name, count]) => ({
          name,
          schema: "default",
          has_rls: false,
          estimated_row_count: count,
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
        const keys = await client.keys(pattern);
        const sampleKeys = keys.slice(0, sampleSize);

        const rows: Record<string, unknown>[] = [];
        for (const key of sampleKeys) {
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
        const allKeys = await client.keys(pattern);

        const start = (page - 1) * pageSize;
        const end = start + pageSize;
        const keys = allKeys.slice(start, end);

        const rows: Record<string, unknown>[] = [];
        for (const key of keys) {
          const type = await getKeyType(client, key);
          const ttl = await client.ttl(key);
          const size = await (client as unknown as { memory: (subcommand: string, key: string) => Promise<number | null> }).memory("USAGE", key);

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
