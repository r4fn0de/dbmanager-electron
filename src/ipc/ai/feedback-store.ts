/**
 * AI Feedback Store — local SQLite storage for AI response feedback.
 *
 * Stores user feedback (thumbs up/down) on AI responses for quality tracking
 * and future model improvement. Data stays local (privacy-first).
 */
import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { app } from "electron";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FeedbackRating = "positive" | "negative" | null;

export interface AiFeedbackEntry {
  id: string;
  conversationId: string;
  messageId: string;
  connectionId?: string;
  schemaName?: string;
  tableName?: string;
  prompt: string;
  response: string;
  rating: "positive" | "negative";
  category?: string; // e.g., "sql_generation", "explanation", "optimization"
  comment?: string; // optional user comment
  timestamp: string;
}

export interface FeedbackStats {
  total: number;
  positive: number;
  negative: number;
  positiveRate: number;
}

// ---------------------------------------------------------------------------
// Database setup
// ---------------------------------------------------------------------------

const DB_FILENAME = "ai-feedback.db";
const DB_DIR = "feedback";

const runtimeRequire = createRequire(
  join(process.resourcesPath || process.cwd(), "package.json"),
);

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

  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      const loaded = runtimeRequire(candidate) as BetterSqlite3Ctor;
      betterSqlite3Cached = loaded;
      return loaded;
    } catch (err) {
      lastError = err;
    }
  }

  throw new Error(
    `Failed to load better-sqlite3 in feedback-store. Last error: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

let cachedDbPath: string | null = null;

function getDbPath(): string {
  if (cachedDbPath) return cachedDbPath;

  // Lazy check for app availability
  if (!app) {
    throw new Error("Electron app not available - cannot initialize feedback database");
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

  database.exec(`
    CREATE TABLE IF NOT EXISTS ai_feedback (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      connection_id TEXT,
      schema_name TEXT,
      table_name TEXT,
      prompt TEXT NOT NULL,
      response TEXT NOT NULL,
      rating TEXT NOT NULL CHECK(rating IN ('positive', 'negative')),
      category TEXT,
      comment TEXT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(conversation_id, message_id)
    );

    CREATE INDEX IF NOT EXISTS idx_feedback_conversation
      ON ai_feedback(conversation_id);

    CREATE INDEX IF NOT EXISTS idx_feedback_timestamp
      ON ai_feedback(timestamp);

    CREATE INDEX IF NOT EXISTS idx_feedback_connection
      ON ai_feedback(connection_id);

    CREATE INDEX IF NOT EXISTS idx_feedback_category
      ON ai_feedback(category);
  `);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Save or update feedback for an AI response.
 */
export function saveFeedback(entry: Omit<AiFeedbackEntry, "id" | "timestamp">): AiFeedbackEntry {
  const database = getDb();
  const id = `${entry.conversationId}_${entry.messageId}`;

  const stmt = database.prepare(`
    INSERT INTO ai_feedback (
      id, conversation_id, message_id, connection_id, schema_name, table_name,
      prompt, response, rating, category, comment
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(conversation_id, message_id) DO UPDATE SET
      rating = excluded.rating,
      comment = COALESCE(excluded.comment, ai_feedback.comment),
      timestamp = datetime('now')
    RETURNING *
  `);

  const row = stmt.get(
    id,
    entry.conversationId,
    entry.messageId,
    entry.connectionId ?? null,
    entry.schemaName ?? null,
    entry.tableName ?? null,
    entry.prompt,
    entry.response,
    entry.rating,
    entry.category ?? null,
    entry.comment ?? null,
  ) as AiFeedbackEntry;

  return row;
}

/**
 * Remove feedback for a specific message.
 */
export function removeFeedback(conversationId: string, messageId: string): boolean {
  const database = getDb();
  const stmt = database.prepare(
    "DELETE FROM ai_feedback WHERE conversation_id = ? AND message_id = ?"
  );
  const result = stmt.run(conversationId, messageId);
  return result.changes > 0;
}

/**
 * Get feedback for a specific message.
 */
export function getFeedback(conversationId: string, messageId: string): AiFeedbackEntry | null {
  const database = getDb();
  const stmt = database.prepare(
    "SELECT * FROM ai_feedback WHERE conversation_id = ? AND message_id = ?"
  );
  return (stmt.get(conversationId, messageId) as AiFeedbackEntry | undefined) ?? null;
}

/**
 * Get feedback rating for a specific message (lightweight).
 */
export function getFeedbackRating(conversationId: string, messageId: string): FeedbackRating {
  const database = getDb();
  const stmt = database.prepare(
    "SELECT rating FROM ai_feedback WHERE conversation_id = ? AND message_id = ?"
  );
  const row = stmt.get(conversationId, messageId) as { rating: string } | undefined;
  return row ? (row.rating as FeedbackRating) : null;
}

/**
 * List all feedback with optional filters.
 */
export function listFeedback(options?: {
  conversationId?: string;
  connectionId?: string;
  category?: string;
  rating?: "positive" | "negative";
  limit?: number;
  offset?: number;
}): AiFeedbackEntry[] {
  const database = getDb();

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options?.conversationId) {
    conditions.push("conversation_id = ?");
    params.push(options.conversationId);
  }
  if (options?.connectionId) {
    conditions.push("connection_id = ?");
    params.push(options.connectionId);
  }
  if (options?.category) {
    conditions.push("category = ?");
    params.push(options.category);
  }
  if (options?.rating) {
    conditions.push("rating = ?");
    params.push(options.rating);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limitClause = options?.limit ? `LIMIT ? OFFSET ?` : "";
  if (options?.limit) {
    params.push(options.limit);
    params.push(options.offset ?? 0);
  }

  const stmt = database.prepare(
    `SELECT * FROM ai_feedback ${whereClause} ORDER BY timestamp DESC ${limitClause}`
  );
  return stmt.all(...params) as AiFeedbackEntry[];
}

/**
 * Get overall feedback statistics.
 */
export function getFeedbackStats(options?: {
  connectionId?: string;
  category?: string;
  since?: string; // ISO date string
}): FeedbackStats {
  const database = getDb();

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options?.connectionId) {
    conditions.push("connection_id = ?");
    params.push(options.connectionId);
  }
  if (options?.category) {
    conditions.push("category = ?");
    params.push(options.category);
  }
  if (options?.since) {
    conditions.push("timestamp >= ?");
    params.push(options.since);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const stmt = database.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN rating = 'positive' THEN 1 ELSE 0 END) as positive,
      SUM(CASE WHEN rating = 'negative' THEN 1 ELSE 0 END) as negative
    FROM ai_feedback
    ${whereClause}
  `);

  const row = stmt.get(...params) as {
    total: number;
    positive: number;
    negative: number;
  };

  const total = row.total ?? 0;
  const positive = row.positive ?? 0;
  const negative = row.negative ?? 0;

  return {
    total,
    positive,
    negative,
    positiveRate: total > 0 ? Math.round((positive / total) * 100) : 0,
  };
}

/**
 * Get recent feedback with low ratings for review.
 */
export function getNegativeFeedback(limit = 20): AiFeedbackEntry[] {
  const database = getDb();
  const stmt = database.prepare(
    `SELECT * FROM ai_feedback
     WHERE rating = 'negative'
     ORDER BY timestamp DESC
     LIMIT ?`
  );
  return stmt.all(limit) as AiFeedbackEntry[];
}

/**
 * Delete old feedback entries.
 */
export function cleanupOldFeedback(olderThanDays: number): number {
  const database = getDb();
  const stmt = database.prepare(
    `DELETE FROM ai_feedback WHERE timestamp < datetime('now', '-${olderThanDays} days')`
  );
  const result = stmt.run();
  return result.changes;
}

/**
 * Export all feedback to JSON (for backup or analysis).
 */
export function exportFeedbackToJson(): string {
  const database = getDb();
  const stmt = database.prepare("SELECT * FROM ai_feedback ORDER BY timestamp DESC");
  const rows = stmt.all() as AiFeedbackEntry[];
  return JSON.stringify(rows, null, 2);
}

/**
 * Close the database connection.
 * Should be called on app shutdown.
 */
export function closeFeedbackDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
