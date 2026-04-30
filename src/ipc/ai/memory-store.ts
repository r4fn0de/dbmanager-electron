/**
 * AI Memory Store — local SQLite storage with semantic embeddings.
 *
 * Stores conversation messages with vector embeddings for semantic search.
 * Uses Transformers.js for local embedding generation (100% offline, privacy-first).
 * Enables the AI to "remember" context from previous conversations.
 */
import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { app } from "electron";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemoryEntry {
  id: string;
  conversationId: string;
  messageId: string;
  connectionId?: string;
  role: "user" | "assistant";
  content: string;
  embedding?: Float32Array; // 384-dimensional vector
  timestamp: string;
  metadata?: string; // JSON string with extra context
}

export interface MemorySearchResult {
  entry: MemoryEntry;
  similarity: number; // Cosine similarity score 0-1
}

export interface MemoryContext {
  relevantMessages: MemoryEntry[];
  similarQueries: string[];
  schemaContext?: string;
}

// ---------------------------------------------------------------------------
// Database setup
// ---------------------------------------------------------------------------

const DB_FILENAME = "ai-memory.db";
const DB_DIR = "memory";
const MAX_MEMORY_ENTRIES_GLOBAL = 5_000;
const MAX_MEMORY_ENTRIES_PER_CONVERSATION = 200;

const runtimeRequire = createRequire(
  join(process.resourcesPath || process.cwd(), "package.json"),
);
const cwdRequire = createRequire(join(process.cwd(), "package.json"));

type BetterSqlite3Ctor = new (...args: any[]) => any;
let betterSqlite3Cached: BetterSqlite3Ctor | null = null;

function loadBetterSqlite3(): BetterSqlite3Ctor {
  if (betterSqlite3Cached) return betterSqlite3Cached;

  const base = process.resourcesPath;
  const candidates = [
    "better-sqlite3",
    base ? join(base, "node_modules", "better-sqlite3") : null,
    base ? join(base, "app.asar.unpacked", "node_modules", "better-sqlite3") : null,
    base ? join(base, "better-sqlite3") : null,
  ].filter(Boolean) as string[];

  const requireFns = [runtimeRequire, cwdRequire];
  let lastError: unknown;
  for (const req of requireFns) {
    for (const candidate of candidates) {
      try {
        const loaded = req(candidate) as BetterSqlite3Ctor;
        betterSqlite3Cached = loaded;
        return loaded;
      } catch (err) {
        lastError = err;
      }
    }
  }

  throw new Error(
    `Failed to load better-sqlite3 in memory-store. Last error: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

let cachedDbPath: string | null = null;

function getDbPath(): string {
  if (cachedDbPath) return cachedDbPath;

  if (!app) {
    throw new Error("Electron app not available - cannot initialize memory database");
  }

  const userData = app.getPath("userData");
  const dbDir = join(userData, DB_DIR);
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }
  cachedDbPath = join(dbDir, DB_FILENAME);
  return cachedDbPath;
}

let db: any = null;
let isInitialized = false;

function getDb(): any {
  if (!isInitialized) {
    const BetterSqlite3 = loadBetterSqlite3();
    db = new BetterSqlite3(getDbPath());
    db.pragma("journal_mode = WAL");
    initTables(db);
    isInitialized = true;
  }
  if (!db) {
    throw new Error("Database failed to initialize");
  }
  return db;
}

function initTables(database: any): void {
  // Main memory table with vector embeddings
  database.exec(`
    CREATE TABLE IF NOT EXISTS ai_memory (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      connection_id TEXT,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      embedding BLOB, -- Float32Array stored as binary
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      metadata TEXT, -- JSON with context like schema/table references
      UNIQUE(conversation_id, message_id, role)
    );

    CREATE INDEX IF NOT EXISTS idx_memory_conversation
      ON ai_memory(conversation_id);

    CREATE INDEX IF NOT EXISTS idx_memory_timestamp
      ON ai_memory(timestamp);

    CREATE INDEX IF NOT EXISTS idx_memory_connection
      ON ai_memory(connection_id);

    -- Virtual table for full-text search (fallback)
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
      content,
      conversation_id UNINDEXED,
      content_rowid=rowid
    );

    -- Trigger to sync FTS index
    CREATE TRIGGER IF NOT EXISTS memory_fts_insert
    AFTER INSERT ON ai_memory
    BEGIN
      INSERT INTO memory_fts(content, conversation_id)
      VALUES (NEW.content, NEW.conversation_id);
    END;

    CREATE TRIGGER IF NOT EXISTS memory_fts_delete
    AFTER DELETE ON ai_memory
    BEGIN
      DELETE FROM memory_fts WHERE rowid = OLD.rowid;
    END;
  `);
}

// ---------------------------------------------------------------------------
// Embedding functions (cosine similarity)
// ---------------------------------------------------------------------------

/**
 * Calculate cosine similarity between two vectors.
 * Returns value between -1 and 1 (1 = identical, 0 = orthogonal).
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Convert Float32Array to Buffer for SQLite storage.
 */
function embeddingToBuffer(embedding: Float32Array): Buffer {
  return Buffer.from(embedding.buffer);
}

/**
 * Convert Buffer from SQLite to Float32Array.
 */
function bufferToEmbedding(buffer: Buffer): Float32Array {
  return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Save a memory entry with optional embedding.
 */
export function saveMemory(
  entry: Omit<MemoryEntry, "id" | "timestamp" | "embedding"> & { embedding?: Float32Array }
): MemoryEntry {
  const database = getDb();
  const id = `${entry.conversationId}_${entry.messageId}_${entry.role}`;

  const stmt = database.prepare(`
    INSERT INTO ai_memory (
      id, conversation_id, message_id, connection_id, role,
      content, embedding, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(conversation_id, message_id, role) DO UPDATE SET
      content = excluded.content,
      embedding = excluded.embedding,
      metadata = excluded.metadata,
      timestamp = datetime('now')
    RETURNING *
  `);

  const row = stmt.get(
    id,
    entry.conversationId,
    entry.messageId,
    entry.connectionId ?? null,
    entry.role,
    entry.content,
    entry.embedding ? embeddingToBuffer(entry.embedding) : null,
    entry.metadata ?? null
  ) as {
    id: string;
    conversation_id: string;
    message_id: string;
    connection_id: string | null;
    role: "user" | "assistant";
    content: string;
    embedding: Buffer | null;
    timestamp: string;
    metadata: string | null;
  };

  enforceMemoryRetention(database);

  return {
    id: row.id,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    connectionId: row.connection_id ?? undefined,
    role: row.role,
    content: row.content,
    embedding: row.embedding ? bufferToEmbedding(row.embedding) : undefined,
    timestamp: row.timestamp,
    metadata: row.metadata ?? undefined,
  };
}

function enforceMemoryRetention(database: any): void {
  database.exec(`
    DELETE FROM ai_memory
    WHERE rowid IN (
      SELECT rowid FROM ai_memory
      WHERE conversation_id IN (
        SELECT conversation_id
        FROM ai_memory
        GROUP BY conversation_id
        HAVING COUNT(*) > ${MAX_MEMORY_ENTRIES_PER_CONVERSATION}
      )
      AND rowid NOT IN (
        SELECT rowid
        FROM ai_memory AS keep
        WHERE keep.conversation_id = ai_memory.conversation_id
        ORDER BY timestamp DESC, rowid DESC
        LIMIT ${MAX_MEMORY_ENTRIES_PER_CONVERSATION}
      )
    );
  `);

  database.exec(`
    DELETE FROM ai_memory
    WHERE rowid NOT IN (
      SELECT rowid
      FROM ai_memory
      ORDER BY timestamp DESC, rowid DESC
      LIMIT ${MAX_MEMORY_ENTRIES_GLOBAL}
    );
  `);
}

/**
 * Find semantically similar memories using vector search.
 * Falls back to FTS if no embedding provided.
 */
export function searchSimilarMemories(
  queryEmbedding: Float32Array,
  options?: {
    connectionId?: string;
    conversationId?: string;
    limit?: number;
    minSimilarity?: number; // Default 0.7
    lookbackHours?: number; // Only search recent memories
  }
): MemorySearchResult[] {
  const database = getDb();
  const limit = options?.limit ?? 5;
  const minSimilarity = options?.minSimilarity ?? 0.7;

  // Build query
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options?.connectionId) {
    conditions.push("connection_id = ?");
    params.push(options.connectionId);
  }

  if (options?.conversationId) {
    conditions.push("conversation_id = ?");
    params.push(options.conversationId);
  }

  if (options?.lookbackHours) {
    // Hours interpolated into SQL - safe since it's a number
    conditions.push(`timestamp >= datetime('now', '-${options.lookbackHours} hours')`);
  }

  conditions.push("embedding IS NOT NULL");

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Get all entries with embeddings
  const stmt = database.prepare(`
    SELECT * FROM ai_memory
    ${whereClause}
    ORDER BY timestamp DESC
    LIMIT 1000 -- Safety limit for in-memory search
  `);

  const rows = stmt.all(...params) as Array<{
    id: string;
    conversation_id: string;
    message_id: string;
    connection_id: string | null;
    role: "user" | "assistant";
    content: string;
    embedding: Buffer | null;
    timestamp: string;
    metadata: string | null;
  }>;

  // Calculate similarities and filter
  const results: MemorySearchResult[] = rows
    .filter((row) => row.embedding !== null)
    .map((row) => {
      const embedding = bufferToEmbedding(row.embedding!);
      const similarity = cosineSimilarity(queryEmbedding, embedding);

      return {
        entry: {
          id: row.id,
          conversationId: row.conversation_id,
          messageId: row.message_id,
          connectionId: row.connection_id ?? undefined,
          role: row.role,
          content: row.content,
          embedding,
          timestamp: row.timestamp,
          metadata: row.metadata ?? undefined,
        },
        similarity,
      };
    })
    .filter((r) => r.similarity >= minSimilarity)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);

  return results;
}

/**
 * Full-text search fallback when embeddings not available.
 */
export function searchMemoriesByText(
  query: string,
  options?: {
    connectionId?: string;
    limit?: number;
  }
): MemoryEntry[] {
  const database = getDb();
  const limit = options?.limit ?? 5;

  // Use FTS for text search
  const stmt = database.prepare(`
    SELECT m.* FROM ai_memory m
    JOIN memory_fts fts ON m.rowid = fts.rowid
    WHERE memory_fts MATCH ?
    ${options?.connectionId ? "AND m.connection_id = ?" : ""}
    ORDER BY rank
    LIMIT ?
  `);

  const params: unknown[] = [query];
  if (options?.connectionId) params.push(options.connectionId);
  params.push(limit);

  const rows = stmt.all(...params) as Array<{
    id: string;
    conversation_id: string;
    message_id: string;
    connection_id: string | null;
    role: "user" | "assistant";
    content: string;
    embedding: Buffer | null;
    timestamp: string;
    metadata: string | null;
  }>;

  return rows.map((row) => ({
    id: row.id,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    connectionId: row.connection_id ?? undefined,
    role: row.role,
    content: row.content,
    embedding: row.embedding ? bufferToEmbedding(row.embedding) : undefined,
    timestamp: row.timestamp,
    metadata: row.metadata ?? undefined,
  }));
}

/**
 * Get recent conversation history for a connection.
 */
export function getRecentMemories(
  options: {
    connectionId?: string;
    conversationId?: string;
    limit?: number;
    hours?: number;
  }
): MemoryEntry[] {
  const database = getDb();
  const limit = options.limit ?? 10;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.connectionId) {
    conditions.push("connection_id = ?");
    params.push(options.connectionId);
  }

  if (options.conversationId) {
    conditions.push("conversation_id = ?");
    params.push(options.conversationId);
  }

  if (options.hours) {
    // Hours must be interpolated into SQL since SQLite datetime function
    // doesn't accept parameterized intervals. This is safe since hours is a number.
    conditions.push(`timestamp >= datetime('now', '-${options.hours} hours')`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const stmt = database.prepare(`
    SELECT * FROM ai_memory
    ${whereClause}
    ORDER BY timestamp DESC
    LIMIT ?
  `);

  params.push(limit);

  const rows = stmt.all(...params) as Array<{
    id: string;
    conversation_id: string;
    message_id: string;
    connection_id: string | null;
    role: "user" | "assistant";
    content: string;
    embedding: Buffer | null;
    timestamp: string;
    metadata: string | null;
  }>;

  return rows
    .map((row) => ({
      id: row.id,
      conversationId: row.conversation_id,
      messageId: row.message_id,
      connectionId: row.connection_id ?? undefined,
      role: row.role,
      content: row.content,
      embedding: row.embedding ? bufferToEmbedding(row.embedding) : undefined,
      timestamp: row.timestamp,
      metadata: row.metadata ?? undefined,
    }))
    .reverse(); // Oldest first
}

/**
 * Delete old memories to manage storage.
 */
export function cleanupOldMemories(olderThanDays: number): number {
  const database = getDb();

  // First delete from FTS (virtual table doesn't cascade)
  const ftsStmt = database.prepare(`
    DELETE FROM memory_fts
    WHERE rowid IN (
      SELECT rowid FROM ai_memory
      WHERE timestamp < datetime('now', '-${olderThanDays} days')
    )
  `);
  ftsStmt.run();

  // Then delete from main table
  const stmt = database.prepare(
    `DELETE FROM ai_memory WHERE timestamp < datetime('now', '-${olderThanDays} days')`
  );
  const result = stmt.run();
  return result.changes;
}

/**
 * Clear all memories for a connection.
 */
export function clearConnectionMemories(connectionId: string): number {
  const database = getDb();

  // Clear FTS first
  const ftsStmt = database.prepare(`
    DELETE FROM memory_fts
    WHERE rowid IN (
      SELECT rowid FROM ai_memory WHERE connection_id = ?
    )
  `);
  ftsStmt.run(connectionId);

  // Clear main table
  const stmt = database.prepare("DELETE FROM ai_memory WHERE connection_id = ?");
  const result = stmt.run(connectionId);
  return result.changes;
}

/**
 * Get memory statistics.
 */
export function getMemoryStats(): {
  totalEntries: number;
  withEmbeddings: number;
  conversations: number;
  oldestEntry: string | null;
} {
  const database = getDb();

  const totalStmt = database.prepare("SELECT COUNT(*) as count FROM ai_memory");
  const withEmbeddingsStmt = database.prepare(
    "SELECT COUNT(*) as count FROM ai_memory WHERE embedding IS NOT NULL"
  );
  const conversationsStmt = database.prepare(
    "SELECT COUNT(DISTINCT conversation_id) as count FROM ai_memory"
  );
  const oldestStmt = database.prepare(
    "SELECT timestamp FROM ai_memory ORDER BY timestamp ASC LIMIT 1"
  );

  return {
    totalEntries: (totalStmt.get() as { count: number }).count,
    withEmbeddings: (withEmbeddingsStmt.get() as { count: number }).count,
    conversations: (conversationsStmt.get() as { count: number }).count,
    oldestEntry: (oldestStmt.get() as { timestamp: string } | undefined)?.timestamp ?? null,
  };
}

/**
 * Close the database connection.
 */
export function closeMemoryDb(): void {
  if (db) {
    db.close();
    db = null;
    isInitialized = false;
  }
}
