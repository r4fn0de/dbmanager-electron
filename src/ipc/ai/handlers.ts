/**
 * AI IPC Handlers — non-streaming AI operations and settings management.
 *
 * Streaming chat is handled separately in streaming.ts via Electron IPC events,
 * since ORPC doesn't natively support streaming responses over MessagePort.
 */
import { ORPCError, os } from "@orpc/server";
import { generateText } from "ai";
import { z } from "zod";
import {
  type AiProviderName,
  addCustomModel,
  addCustomProvider,
  checkProviderEndpoint,
  detectOllama,
  fetchProviderModels,
  getApiKey,
  getCurrentModel,
  getPrivacyPreset,
  getPrivacySettings,
  getProvidersInfo,
  isAiConfigured,
  removeCustomModel,
  removeCustomProvider,
  setApiKey,
  setCustomProviderApiKey,
  updateAiSettings,
  updateCustomProvider,
  updatePrivacySettings,
  validateApiKey,
} from "./config";

// Provider enum used in Zod schemas — keeps DRY across all provider inputs.
const PROVIDER_ENUM = z.enum([
  "openai",
  "anthropic",
  "google",
  "openai-compatible",
  "ollama",
]);

// ---------------------------------------------------------------------------
// Settings handlers
// ---------------------------------------------------------------------------

export const aiGetSettings = os.handler(async () => getProvidersInfo());

export const aiUpdateSettings = os
  .input(
    z.object({
      model: z.string().optional(),
      ollamaBaseURL: z.string().optional(),
      openaiCompatibleBaseURL: z.string().optional(),
      // Built-in name or `custom:<id>` — validated in config.
      provider: z.string().optional(),
    })
  )
  .handler(async ({ input }) => {
    try {
      return updateAiSettings(input);
    } catch (error) {
      throw new ORPCError("BAD_REQUEST", {
        message:
          error instanceof Error
            ? error.message
            : "Failed to update AI settings",
      });
    }
  });

export const aiSetApiKey = os
  .input(
    z.object({
      key: z.string(),
      provider: PROVIDER_ENUM,
    })
  )
  .handler(async ({ input }) => {
    try {
      // Validate API key format before persisting
      const validation = validateApiKey(
        input.provider as AiProviderName,
        input.key
      );
      if (!validation.valid) {
        throw new ORPCError("BAD_REQUEST", {
          message: validation.error ?? "Invalid API key format",
        });
      }
      setApiKey(input.provider as AiProviderName, input.key);
      return { success: true };
    } catch (error) {
      if (error instanceof ORPCError) {
        throw error;
      }
      throw new ORPCError("BAD_REQUEST", {
        message:
          error instanceof Error ? error.message : "Failed to save AI API key",
      });
    }
  });

export const aiGetApiKey = os
  .input(
    z.object({
      provider: PROVIDER_ENUM,
    })
  )
  .handler(async ({ input }) => {
    try {
      const key = getApiKey(input.provider as AiProviderName);
      // Return masked key for security — only show last 4 chars
      const masked =
        key.length > 4 ? `••••${key.slice(-4)}` : key ? "••••" : "";
      return { hasKey: key.length > 0, masked, provider: input.provider };
    } catch (error) {
      throw new ORPCError("BAD_REQUEST", {
        message:
          error instanceof Error ? error.message : "Failed to read AI API key",
      });
    }
  });

export const aiIsConfigured = os.handler(async () => isAiConfigured());

// ---------------------------------------------------------------------------
// Model discovery — fetch available models from a provider's API
// ---------------------------------------------------------------------------

export const aiFetchModels = os
  .input(
    z.object({
      apiKey: z.string().optional(),
      baseURL: z.string().optional(),
      provider: PROVIDER_ENUM,
    })
  )
  .handler(async ({ input }) => {
    try {
      const models = await fetchProviderModels(
        input.provider as AiProviderName,
        input.apiKey,
        input.baseURL
      );
      return { models };
    } catch (error) {
      throw new ORPCError("BAD_REQUEST", {
        message:
          error instanceof Error ? error.message : "Failed to fetch models",
      });
    }
  });

// ---------------------------------------------------------------------------
// Fix SQL — takes broken SQL + error message, returns corrected SQL
// ---------------------------------------------------------------------------

export const aiFixSql = os
  .input(
    z.object({
      dbType: z
        .enum(["postgresql", "mysql", "mariadb", "clickhouse", "sqlite"])
        .describe("The database engine type"),
      error: z.string().describe("The error message from execution"),
      sql: z.string().describe("The SQL query that failed"),
    })
  )
  .handler(async ({ input }) => {
    const model = getCurrentModel();

    const { text } = await generateText({
      model,
      prompt: `Fix this SQL query that produced an error:\n\nSQL:\n${input.sql}\n\nError:\n${input.error}`,
      system: `You are an expert SQL troubleshooter for ${input.dbType}.
Fix the provided SQL to ensure it is valid for ${input.dbType}.
Maintain the original query's format and styling.
Return ONLY the corrected SQL — no explanations, no markdown formatting, no greetings.
If the SQL is already valid, return it unchanged.`,
    });

    return { sql: text.trim() };
  });

// ---------------------------------------------------------------------------
// Update SQL — modify SQL based on natural language instruction
// ---------------------------------------------------------------------------

export const aiUpdateSql = os
  .input(
    z.object({
      context: z.string().optional().describe("Database schema context"),
      dbType: z
        .enum(["postgresql", "mysql", "mariadb", "clickhouse", "sqlite"])
        .describe("The database engine type"),
      prompt: z.string().describe("What to change in the SQL"),
      sql: z.string().describe("The original SQL query"),
    })
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
      prompt: `Original SQL:\n${input.sql}\n\nChange instruction: ${input.prompt}`,
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
    })
  )
  .handler(async ({ input }) => {
    const model = getCurrentModel();

    const { text } = await generateText({
      model,
      prompt: input.prompt,
      system: `Refine the given prompt into a clearer, more actionable instruction.
Fix grammar/typos while maintaining the original intent.
Keep it concise and actionable — no explanations or greetings.
Do not add information not provided by the user.
The prompt may be related to SQL or database operations.`,
    });

    return { prompt: text.trim() };
  });

// ---------------------------------------------------------------------------
// Generate Title — create a short title from chat messages
// ---------------------------------------------------------------------------

export const aiGenerateTitle = os
  .input(
    z.object({
      message: z
        .string()
        .describe("The first user message to generate a title from"),
    })
  )
  .handler(async ({ input }) => {
    const model = getCurrentModel();

    const { text } = await generateText({
      model,
      prompt: input.message,
      system: `Generate a concise title for a chat conversation based on the user's first message.
Rules:
- Maximum 30 characters
- No punctuation (dots, commas, etc.)
- Use proper capitalization
- Output ONLY the title text, nothing else
- Use the same language as the user's message`,
    });

    return { title: text.trim() };
  });

// ---------------------------------------------------------------------------
// AI Filters — convert natural language to structured filters
// ---------------------------------------------------------------------------

const SQL_OPERATORS = [
  "eq",
  "neq",
  "contains",
  "starts_with",
  "ends_with",
  "gt",
  "gte",
  "lt",
  "lte",
  "is_null",
  "is_not_null",
] as const;

export const aiFilters = os
  .input(
    z.object({
      context: z.string().describe("Table schema/column context"),
      prompt: z
        .string()
        .describe("Natural language description of desired filters"),
    })
  )
  .handler(async ({ input }) => {
    const model = getCurrentModel();

    const { text } = await generateText({
      model,
      prompt: input.prompt,
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
    });

    try {
      // Try to parse the JSON response
      const cleaned = text
        .replace(/^```json?\s*/m, "")
        .replace(/\s*```$/m, "")
        .trim();
      const parsed = JSON.parse(cleaned);
      return {
        filters: Array.isArray(parsed.filters) ? parsed.filters : [],
        orderBy: Array.isArray(parsed.orderBy) ? parsed.orderBy : [],
      };
    } catch {
      return { filters: [], orderBy: [] };
    }
  });

// ---------------------------------------------------------------------------
// AI Table Search — find tables by natural language description
// ---------------------------------------------------------------------------

export const aiTableSearch = os
  .input(
    z.object({
      query: z.string().describe("Natural language search query from the user"),
      schemaContext: z
        .string()
        .optional()
        .describe("Optional schema context with column details"),
      tables: z
        .array(z.string())
        .describe("List of available table names to search within"),
    })
  )
  .handler(async ({ input }) => {
    if (input.tables.length === 0) {
      return { matches: [] };
    }

    const model = getCurrentModel();

    const contextSection = input.schemaContext
      ? `\n\nAdditional context:\n${input.schemaContext}`
      : "";

    const { text } = await generateText({
      model,
      prompt: input.query,
      system: `You are a database table search assistant. Given a list of table names and a user's search query, return the tables that best match the user's intent.

Rules:
- Return ONLY a JSON array of table name strings from the provided list
- Match by semantic meaning (e.g. "vendas" → orders, sales, invoices; "usuários" → users, accounts, profiles)
- Match by partial name similarity (e.g. "prod" → products, product_categories)
- Match by domain/purpose (e.g. "authentication" → users, sessions, tokens)
- If nothing matches, return an empty array
- Do NOT invent table names — only return names from the provided list
- Return at most 20 matches, ordered by relevance

Available tables:
${input.tables.join(", ")}${contextSection}`,
    });

    try {
      const cleaned = text
        .replace(/^```json?\s*/m, "")
        .replace(/\s*```$/m, "")
        .trim();
      const parsed = JSON.parse(cleaned);
      if (!Array.isArray(parsed)) {
        return { matches: [] };
      }
      // Validate that all returned names actually exist in the input list
      const tableSet = new Set(input.tables);
      const matches = parsed.filter(
        (name: unknown) => typeof name === "string" && tableSet.has(name)
      );
      return { matches: matches.slice(0, 20) as string[] };
    } catch {
      return { matches: [] };
    }
  });

// ---------------------------------------------------------------------------
// Custom models — add / remove user-defined model IDs per provider
// ---------------------------------------------------------------------------

export const aiAddCustomModel = os
  .input(
    z.object({
      modelId: z.string().min(1),
      // Built-in name or `custom:<id>` — validated in config.
      provider: z.string().min(1),
    })
  )
  .handler(async ({ input }) => {
    try {
      addCustomModel(input.provider, input.modelId);
    } catch (error) {
      throw new ORPCError("BAD_REQUEST", {
        message:
          error instanceof Error ? error.message : "Failed to add custom model",
      });
    }
    return getProvidersInfo();
  });

export const aiRemoveCustomModel = os
  .input(
    z.object({
      modelId: z.string().min(1),
      // Built-in name or `custom:<id>` — validated in config.
      provider: z.string().min(1),
    })
  )
  .handler(async ({ input }) => {
    try {
      removeCustomModel(input.provider, input.modelId);
    } catch (error) {
      throw new ORPCError("BAD_REQUEST", {
        message:
          error instanceof Error
            ? error.message
            : "Failed to remove custom model",
      });
    }
    return getProvidersInfo();
  });

// ---------------------------------------------------------------------------
// Custom providers — user-saved named endpoints
// ---------------------------------------------------------------------------

const CUSTOM_PROVIDER_INPUT = z.object({
  apiKey: z.string().optional(),
  baseURL: z.string().min(1),
  defaultModel: z.string().optional(),
  label: z.string().min(1).max(60),
});

export const aiAddCustomProvider = os
  .input(CUSTOM_PROVIDER_INPUT)
  .handler(async ({ input }) => {
    try {
      addCustomProvider(input);
      return getProvidersInfo();
    } catch (error) {
      throw new ORPCError("BAD_REQUEST", {
        message:
          error instanceof Error
            ? error.message
            : "Failed to save custom provider",
      });
    }
  });

export const aiUpdateCustomProvider = os
  .input(
    z.object({
      baseURL: z.string().min(1).optional(),
      defaultModel: z.string().optional(),
      id: z.string().min(1),
      label: z.string().min(1).max(60).optional(),
    })
  )
  .handler(async ({ input }) => {
    try {
      updateCustomProvider(input);
      return getProvidersInfo();
    } catch (error) {
      throw new ORPCError("BAD_REQUEST", {
        message:
          error instanceof Error
            ? error.message
            : "Failed to update custom provider",
      });
    }
  });

export const aiRemoveCustomProvider = os
  .input(z.object({ id: z.string().min(1) }))
  .handler(async ({ input }) => {
    try {
      removeCustomProvider(input.id);
      return getProvidersInfo();
    } catch (error) {
      throw new ORPCError("BAD_REQUEST", {
        message:
          error instanceof Error
            ? error.message
            : "Failed to remove custom provider",
      });
    }
  });

export const aiSetCustomProviderApiKey = os
  .input(z.object({ id: z.string().min(1), key: z.string() }))
  .handler(async ({ input }) => {
    try {
      setCustomProviderApiKey(input.id, input.key);
      return getProvidersInfo();
    } catch (error) {
      throw new ORPCError("BAD_REQUEST", {
        message:
          error instanceof Error
            ? error.message
            : "Failed to save custom provider key",
      });
    }
  });

// ---------------------------------------------------------------------------
// Endpoint reachability — is a (local) provider running?
// ---------------------------------------------------------------------------

export const aiCheckProviderEndpoint = os
  .input(z.object({ baseURL: z.string().min(1) }))
  .handler(async ({ input }) => {
    try {
      return await checkProviderEndpoint(input.baseURL);
    } catch (error) {
      throw new ORPCError("BAD_REQUEST", {
        message:
          error instanceof Error ? error.message : "Failed to check endpoint",
      });
    }
  });

// ---------------------------------------------------------------------------
// Ollama detection
// ---------------------------------------------------------------------------

export const aiDetectOllama = os.handler(async () => detectOllama());

// ---------------------------------------------------------------------------
// Privacy settings
// ---------------------------------------------------------------------------

export const aiGetPrivacySettings = os.handler(async () => ({
  preset: getPrivacyPreset(),
  settings: getPrivacySettings(),
}));

export const aiUpdatePrivacySettings = os
  .input(
    z.object({
      preset: z.enum(["full", "minimal", "private"]).nullable().optional(),
      settings: z
        .object({
          connectionInfo: z.boolean().optional(),
          connectionsList: z.boolean().optional(),
          memory: z.boolean().optional(),
          schema: z.boolean().optional(),
        })
        .optional(),
    })
  )
  .handler(async ({ input }) =>
    updatePrivacySettings(
      input.settings ?? {},
      input.preset as "full" | "minimal" | "private" | null | undefined
    )
  );
