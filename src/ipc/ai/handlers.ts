/**
 * AI IPC Handlers — non-streaming AI operations and settings management.
 *
 * Streaming chat is handled separately in streaming.ts via Electron IPC events,
 * since ORPC doesn't natively support streaming responses over MessagePort.
 */
import { os } from "@orpc/server";
import { z } from "zod";
import { generateText } from "ai";
import {
  getAiSettings,
  updateAiSettings,
  setApiKey,
  getApiKey,
  isAiConfigured,
  getProvidersInfo,
  getCurrentModel,
  type AiProviderName,
} from "./config";
import type { DatabaseType } from "@/ipc/db/types";

// ---------------------------------------------------------------------------
// Settings handlers
// ---------------------------------------------------------------------------

export const aiGetSettings = os.handler(async () => {
  return getProvidersInfo();
});

export const aiUpdateSettings = os
  .input(
    z.object({
      provider: z.enum(["openai", "anthropic", "google", "openai-compatible"]).optional(),
      model: z.string().optional(),
      openaiCompatibleBaseURL: z.string().optional(),
    }),
  )
  .handler(async ({ input }) => {
    return updateAiSettings(input);
  });

export const aiSetApiKey = os
  .input(
    z.object({
      provider: z.enum(["openai", "anthropic", "google", "openai-compatible"]),
      key: z.string(),
    }),
  )
  .handler(async ({ input }) => {
    setApiKey(input.provider as AiProviderName, input.key);
    return { success: true };
  });

export const aiGetApiKey = os
  .input(
    z.object({
      provider: z.enum(["openai", "anthropic", "google", "openai-compatible"]),
    }),
  )
  .handler(async ({ input }) => {
    const key = getApiKey(input.provider as AiProviderName);
    // Return masked key for security — only show last 4 chars
    const masked = key.length > 4 ? `••••${key.slice(-4)}` : key ? "••••" : "";
    return { provider: input.provider, masked, hasKey: key.length > 0 };
  });

export const aiIsConfigured = os.handler(async () => {
  return isAiConfigured();
});

// ---------------------------------------------------------------------------
// Fix SQL — takes broken SQL + error message, returns corrected SQL
// ---------------------------------------------------------------------------

export const aiFixSql = os
  .input(
    z.object({
      sql: z.string().describe("The SQL query that failed"),
      error: z.string().describe("The error message from execution"),
      dbType: z
        .enum(["postgresql", "mysql", "mariadb", "clickhouse", "sqlite"])
        .describe("The database engine type"),
    }),
  )
  .handler(async ({ input }) => {
    const model = getCurrentModel();

    const { text } = await generateText({
      model,
      system: `You are an expert SQL troubleshooter for ${input.dbType}.
Fix the provided SQL to ensure it is valid for ${input.dbType}.
Maintain the original query's format and styling.
Return ONLY the corrected SQL — no explanations, no markdown formatting, no greetings.
If the SQL is already valid, return it unchanged.`,
      prompt: `Fix this SQL query that produced an error:\n\nSQL:\n${input.sql}\n\nError:\n${input.error}`,
    });

    return { sql: text.trim() };
  });

// ---------------------------------------------------------------------------
// Update SQL — modify SQL based on natural language instruction
// ---------------------------------------------------------------------------

export const aiUpdateSql = os
  .input(
    z.object({
      sql: z.string().describe("The original SQL query"),
      prompt: z.string().describe("What to change in the SQL"),
      dbType: z
        .enum(["postgresql", "mysql", "mariadb", "clickhouse", "sqlite"])
        .describe("The database engine type"),
      context: z.string().optional().describe("Database schema context"),
    }),
  )
  .handler(async ({ input }) => {
    const model = getCurrentModel();

    const contextSection = input.context
      ? `\n\nDatabase context:\n${input.context}`
      : "";
    const fewShotExamples = `

Examples:
User: "quero ver account e user"
SQL:
SELECT a.*, u.name, u.email
FROM "account" a
JOIN "user" u ON a.user_id = u.id;

User: "liste pedidos com nome do cliente"
SQL:
SELECT o.id, o.created_at, o.total, c.name AS customer_name
FROM "orders" o
JOIN "customers" c ON o.customer_id = c.id;

User: "mostre account e user separadamente"
SQL:
SELECT * FROM "account";
SELECT * FROM "user";`;

    const { text } = await generateText({
      model,
      system: `You are a senior SQL assistant for ${input.dbType}.
Output ONLY raw SQL (no explanations, no markdown, no comments).

Generation rules:
- If the user references multiple related tables, prefer ONE query with explicit JOINs instead of separate SELECTs.
- Infer common relationships from context and naming (e.g., <table>_id -> <table>.id) when schema context supports it.
- Preserve existing SQL intent when editing; apply only requested changes.
- Use explicit table aliases and explicit JOIN conditions.
- Prefer a single, runnable query unless the user explicitly asks for multiple queries.
- Avoid SELECT * when a focused projection is obvious; if the user asks to "see content", SELECT * is acceptable.

If no reliable relationship exists, then use separate queries.
${fewShotExamples}${contextSection}`,
      prompt: `Original SQL:\n${input.sql}\n\nChange instruction: ${input.prompt}`,
    });

    return { sql: text.trim() };
  });

// ---------------------------------------------------------------------------
// Enhance Prompt — refine user's natural language into clearer instruction
// ---------------------------------------------------------------------------

export const aiEnhancePrompt = os
  .input(
    z.object({
      prompt: z.string().describe("The user's rough prompt to refine"),
    }),
  )
  .handler(async ({ input }) => {
    const model = getCurrentModel();

    const { text } = await generateText({
      model,
      system: `Refine the given prompt into a clearer, more actionable instruction.
Fix grammar/typos while maintaining the original intent.
Keep it concise and actionable — no explanations or greetings.
Do not add information not provided by the user.
The prompt may be related to SQL or database operations.`,
      prompt: input.prompt,
    });

    return { prompt: text.trim() };
  });

// ---------------------------------------------------------------------------
// Generate Title — create a short title from chat messages
// ---------------------------------------------------------------------------

export const aiGenerateTitle = os
  .input(
    z.object({
      message: z.string().describe("The first user message to generate a title from"),
    }),
  )
  .handler(async ({ input }) => {
    const model = getCurrentModel();

    const { text } = await generateText({
      model,
      system: `Generate a concise title for a chat conversation based on the user's first message.
Rules:
- Maximum 30 characters
- No punctuation (dots, commas, etc.)
- Use proper capitalization
- Output ONLY the title text, nothing else
- Use the same language as the user's message`,
      prompt: input.message,
    });

    return { title: text.trim() };
  });

// ---------------------------------------------------------------------------
// AI Filters — convert natural language to structured filters
// ---------------------------------------------------------------------------

const SQL_OPERATORS = [
  "eq", "neq", "contains", "starts_with", "ends_with",
  "gt", "gte", "lt", "lte", "is_null", "is_not_null",
] as const;

export const aiFilters = os
  .input(
    z.object({
      prompt: z.string().describe("Natural language description of desired filters"),
      context: z.string().describe("Table schema/column context"),
    }),
  )
  .handler(async ({ input }) => {
    const model = getCurrentModel();

    const { text } = await generateText({
      model,
      system: `You are a filter generator. Convert the user's natural language request into structured database filters.

Available operators: ${SQL_OPERATORS.join(", ")}

Return a JSON object with:
- "filters": Array of { column: string, operator: string, value?: string }
- "orderBy": Array of { column: string, direction: "asc" | "desc" }

Rules:
- Use only columns mentioned in the context
- Use only the available operators
- For "is_null"/"is_not_null", omit the value field
- Return ONLY the JSON, no markdown or explanation

Table context:
${input.context}`,
      prompt: input.prompt,
    });

    try {
      // Try to parse the JSON response
      const cleaned = text.replace(/^```json?\s*/m, "").replace(/\s*```$/m, "").trim();
      const parsed = JSON.parse(cleaned);
      return {
        filters: Array.isArray(parsed.filters) ? parsed.filters : [],
        orderBy: Array.isArray(parsed.orderBy) ? parsed.orderBy : [],
      };
    } catch {
      return { filters: [], orderBy: [] };
    }
  });
