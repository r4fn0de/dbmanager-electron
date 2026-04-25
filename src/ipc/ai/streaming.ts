/**
 * AI Streaming Chat — Electron IPC event-based streaming.
 *
 * Since ORPC over MessagePort doesn't support streaming responses,
 * AI chat uses direct Electron IPC events instead:
 *
 * 1. Renderer sends 'ai:chat:start' event with messages + connectionId
 * 2. Main process calls streamText() and forwards chunks via 'ai:chat:chunk' events
 * 3. Main process sends 'ai:chat:done' when streaming completes
 * 4. Main process sends 'ai:chat:error' on failure
 *
 * This mirrors Conar's streaming architecture but uses Electron IPC
 * instead of HTTP SSE.
 */
import { ipcMain, type IpcMainEvent, type BrowserWindow } from "electron";
import { streamText, type ModelMessage, stepCountIs, smoothStream } from "ai";
import { getCurrentModel } from "./config";
import { createAiTools } from "./tools";
import { ipcContext } from "@/ipc/context";
import { AI_IPC_CHANNELS } from "@/constants";
import type { DatabaseType } from "@/ipc/db/types";
import { saveMemory, searchSimilarMemories, getRecentMemories } from "./memory-store";
import { generateEmbedding, getEmbeddingStatus, optimizeQueryForSearch } from "./embedding-service";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatStartInput {
  /** Unique ID for this chat session (used to correlate events) */
  chatId: string;
  /** Connection ID for the active database (optional in global mode) */
  connectionId: string | null;
  /** Database type (postgresql, mysql, etc.) */
  dbType: DatabaseType;
  /** Optional schema context to inject into system prompt */
  schemaContext?: string;
  /** Optional connection metadata so the AI knows host/port/local-vs-remote */
  connectionInfo?: {
    name: string;
    host: string;
    port: number;
    database: string;
    isLocal?: boolean;
  };
  /** Chat messages in ModelMessage format */
  messages: ModelMessage[];
}

interface InlineGenerateStartInput {
  /** Unique ID for this inline generation request */
  requestId: string;
  /** Database type (postgresql, mysql, etc.) */
  dbType: DatabaseType;
  /** Natural language instruction */
  prompt: string;
  /** Existing SQL to update (optional) */
  sql?: string;
  /** Optional schema context */
  schemaContext?: string;
}

// ---------------------------------------------------------------------------
// Active streams tracking — allows aborting in-progress streams
// ---------------------------------------------------------------------------

const activeAbortControllers = new Map<string, AbortController>();
const activeInlineAbortControllers = new Map<string, AbortController>();

function abortStream(chatId: string) {
  const controller = activeAbortControllers.get(chatId);
  if (controller) {
    controller.abort();
    activeAbortControllers.delete(chatId);
  }
}

function abortInlineStream(requestId: string) {
  const controller = activeInlineAbortControllers.get(requestId);
  if (controller) {
    controller.abort();
    activeInlineAbortControllers.delete(requestId);
  }
}

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------

interface MemoryContextData {
  recentMessages: Array<{ role: "user" | "assistant"; content: string }>;
  similarQueries: Array<{ query: string; response: string; similarity: number }>;
}

function buildSystemPrompt(
  dbType: DatabaseType,
  schemaContext?: string,
  hasConnection = true,
  memoryContext?: MemoryContextData,
  connectionInfo?: ChatStartInput["connectionInfo"],
): string {
  const now = new Date().toISOString();

  let prompt = `You are an AI SQL assistant for ${dbType}. Your primary role is to help users write, optimize, and debug SQL queries.

Current date/time: ${now}`;

  if (connectionInfo) {
    const locality = connectionInfo.isLocal ? "local" : "remote";
    prompt += `\n\n## Connection Info\n- Name: ${connectionInfo.name}\n- Host: ${connectionInfo.host}\n- Port: ${connectionInfo.port}\n- Database: ${connectionInfo.database}\n- Type: ${locality} database`;
  }

  if (memoryContext && (memoryContext.recentMessages.length > 0 || memoryContext.similarQueries.length > 0)) {
    prompt += `

## Memory Context (Previous Conversations)
The following information is from your previous conversations with this user. Use it to provide more relevant and personalized assistance.`;

    if (memoryContext.recentMessages.length > 0) {
      prompt += `

### Recent Conversation History:
${memoryContext.recentMessages.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content.slice(0, 200)}${m.content.length > 200 ? "..." : ""}`).join("\n")}`;
    }

    if (memoryContext.similarQueries.length > 0) {
      prompt += `

### Similar Past Queries (may provide helpful context):
${memoryContext.similarQueries.map((q, i) => `
Query ${i + 1} (similarity: ${Math.round(q.similarity * 100)}%):
User: ${q.query.slice(0, 150)}${q.query.length > 150 ? "..." : ""}
Assistant: ${q.response.slice(0, 300)}${q.response.length > 300 ? "..." : ""}`).join("\n")}`;
    }
  }

  prompt += `

## Rules
- Always use quoted identifiers to avoid case-sensitivity issues
- Generate optimized, valid SQL for ${dbType}
- Use the provided tools (tables, columns, select) when available to inspect the database before writing queries
- When tools are available and user asks about their data, use the select tool to query it
- For schema changes, generate appropriate DDL statements
- Respond in markdown with SQL in code blocks
- If you're unsure about column names or types, use the columns tool first
- Prefer incremental/specific changes over rewriting entire queries
- When the user mentions multiple related tables, prefer a single query with explicit JOINs over separate SELECTs
- Never drop or truncate data unless the user explicitly requests it`;

  if (!hasConnection) {
    prompt += `

## Runtime mode
- There is no active database connection in this chat session.
- Do not claim execution results from the user's database.
- Provide SQL, reasoning, and guidance only.`;
  }

  prompt += `

## Output policy (important)
- If the user asks to generate/fix/modify SQL, your FIRST output must be executable SQL in a \`\`\`sql code block.
- Do NOT answer with only prose like "this query does...". Always provide the final SQL.
- Keep explanations short and only after the SQL block.
- If the user asks only for explanation (without asking to generate/modify), explanation-only is allowed.

## Safety for sensitive tables/columns
- For auth/security-like tables (tokens, passwords, secrets), avoid SELECT * by default.
- Prefer explicit safe projection unless the user explicitly asks for full raw data.
- If user explicitly requests SELECT *, still comply, but add a short warning after SQL.`;

  if (schemaContext) {
    prompt += `\n\n## Database Context\n${schemaContext}`;
  }

  return prompt;
}

function buildInlineSystemPrompt(dbType: DatabaseType, schemaContext?: string): string {
  const contextSection = schemaContext
    ? `\n\nDatabase context:\n${schemaContext}`
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

  return `You are a senior SQL assistant for ${dbType}.
Output ONLY raw SQL (no explanations, no markdown, no comments).

Generation rules:
- If the user references multiple related tables, prefer ONE query with explicit JOINs instead of separate SELECTs.
- Infer common relationships from context and naming (e.g., <table>_id -> <table>.id) when schema context supports it.
- Preserve existing SQL intent when editing; apply only requested changes.
- Use explicit table aliases and explicit JOIN conditions.
- Prefer a single, runnable query unless the user explicitly asks for multiple queries.
- Avoid SELECT * when a focused projection is obvious; if the user asks to "see content", SELECT * is acceptable.

If no reliable relationship exists, then use separate queries.
${fewShotExamples}
${contextSection}`;
}

// ---------------------------------------------------------------------------
// Message content helper
// ---------------------------------------------------------------------------

function extractMessageContent(content: string | { type: string; text?: string }[]): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter((part) => part.type === "text" && part.text)
      .map((part) => part.text)
      .join("\n");
  }
  return "";
}

// ---------------------------------------------------------------------------
// Memory context builder
// ---------------------------------------------------------------------------

async function fetchMemoryContext(
  userMessage: string,
  connectionId: string | null,
): Promise<MemoryContextData> {
  const context: MemoryContextData = {
    recentMessages: [],
    similarQueries: [],
  };

  try {
    // Get recent messages from this connection
    const recentMemories = getRecentMemories({
      connectionId: connectionId ?? undefined,
      limit: 6,
      hours: 24,
    });

    context.recentMessages = recentMemories.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // Get semantically similar queries if model is ready
    if (getEmbeddingStatus() === "ready") {
      try {
        const queryEmbedding = await generateEmbedding(
          optimizeQueryForSearch(userMessage),
        );

        const similarResults = searchSimilarMemories(queryEmbedding, {
          connectionId: connectionId ?? undefined,
          limit: 10,
          minSimilarity: 0.75,
          lookbackHours: 168, // 7 days
        });

        // Pair user-assistant messages from similar conversations
        const seenConversations = new Set<string>();
        for (const result of similarResults) {
          const convId = result.entry.conversationId;
          if (seenConversations.has(convId)) continue;

          // Get conversation context
          const conversationMemories = getRecentMemories({
            conversationId: convId,
            limit: 6,
          });

          // Find user query and assistant response pairs
          for (let i = 0; i < conversationMemories.length - 1; i++) {
            const userMsg = conversationMemories[i];
            const assistantMsg = conversationMemories[i + 1];

            if (userMsg?.role === "user" && assistantMsg?.role === "assistant") {
              context.similarQueries.push({
                query: userMsg.content,
                response: assistantMsg.content,
                similarity: result.similarity,
              });
              break;
            }
          }

          seenConversations.add(convId);
          if (context.similarQueries.length >= 3) break;
        }
      } catch (err) {
        console.warn("[ai:memory] Failed to get similar queries:", err);
      }
    }
  } catch (err) {
    console.warn("[ai:memory] Failed to fetch memory context:", err);
  }

  return context;
}

// ---------------------------------------------------------------------------
// Stream handler — runs in main process, sends chunks to renderer
// ---------------------------------------------------------------------------

async function handleChatStart(
  window: BrowserWindow,
  input: ChatStartInput,
): Promise<void> {
  const { chatId, connectionId, dbType, schemaContext, messages } = input;

  // Abort any existing stream for this chat
  abortStream(chatId);

  const abortController = new AbortController();
  activeAbortControllers.set(chatId, abortController);

  // Get the last user message for memory context
  const lastUserMessage = messages.findLast((m) => m.role === "user");
  const userContentRaw = lastUserMessage?.content ?? "";
  const userContent = extractMessageContent(userContentRaw);

  // Collect assistant response for memory storage
  let assistantResponse = "";

  try {
    const model = getCurrentModel();

    // Fetch memory context before starting the stream
    const memoryContext = await fetchMemoryContext(userContent, connectionId);

    // Use the factory pattern to create tools with connectionId in closure.
    // The AI SDK does NOT forward experimental_context to tool execute functions.
    const tools = connectionId ? createAiTools(connectionId) : undefined;

    // streamText() is SYNCHRONOUS — it returns a StreamTextResult immediately,
    // NOT a Promise. Do NOT await it before accessing .textStream etc.
    const result = streamText({
      model,
      system: buildSystemPrompt(dbType, schemaContext, Boolean(connectionId), memoryContext, input.connectionInfo),
      messages,
      ...(tools ? { tools } : {}),
      abortSignal: abortController.signal,
      // AI SDK v6: maxSteps replaced by stopWhen + stepCountIs
      stopWhen: stepCountIs(5),
      experimental_transform: smoothStream({ chunking: "word" }),
      onChunk(event) {
        // Forward chunks to renderer
        // AI SDK v6 chunk types: 'text-delta' (not 'text'), 'tool-call', 'tool-result'
        if (event.chunk.type === "text-delta") {
          assistantResponse += event.chunk.text;
          window.webContents.send(AI_IPC_CHANNELS.CHAT_CHUNK, {
            chatId,
            type: "text",
            // AI SDK v6: text-delta chunk uses 'text' field for the content
            text: event.chunk.text,
          });
        } else if (event.chunk.type === "tool-call") {
          window.webContents.send(AI_IPC_CHANNELS.CHAT_CHUNK, {
            chatId,
            type: "tool-call",
            toolCallId: event.chunk.toolCallId,
            toolName: event.chunk.toolName,
            input: event.chunk.input,
          });
        } else if (event.chunk.type === "tool-result") {
          window.webContents.send(AI_IPC_CHANNELS.CHAT_CHUNK, {
            chatId,
            type: "tool-result",
            toolCallId: event.chunk.toolCallId,
            toolName: event.chunk.toolName,
            // AI SDK v6: tool result uses 'output'
            result: event.chunk.output,
          });
        }
      },
    });

    // Consume the text stream to trigger onChunk callbacks.
    // textStream is an async iterable on the result object directly.
    for await (const _ of result.textStream) {
      // Stream is consumed by the for-await loop; chunks are sent via onChunk
    }

    // After stream is consumed, await the promises for finish metadata.
    // finishReason and usage are Promise properties on StreamTextResult.
    const finishReason = await result.finishReason;
    const usage = await result.usage;

    // Send completion event with metadata
    window.webContents.send(AI_IPC_CHANNELS.CHAT_DONE, {
      chatId,
      finishReason,
      usage,
    });

    // Save to memory after successful completion
    if (userContent && assistantResponse) {
      try {
        // Generate embedding for user message if model is ready
        let userEmbedding: Float32Array | undefined;
        if (getEmbeddingStatus() === "ready") {
          try {
            userEmbedding = await generateEmbedding(
              optimizeQueryForSearch(userContent),
            );
          } catch (embErr) {
            console.warn("[ai:memory] Failed to generate embedding:", embErr);
          }
        }

        // Save user message
        saveMemory({
          conversationId: chatId,
          messageId: `${chatId}_user`,
          connectionId: connectionId ?? undefined,
          role: "user",
          content: userContent,
          embedding: userEmbedding,
        });

        // Save assistant response (no embedding needed)
        saveMemory({
          conversationId: chatId,
          messageId: `${chatId}_assistant`,
          connectionId: connectionId ?? undefined,
          role: "assistant",
          content: assistantResponse,
        });
      } catch (memErr) {
        console.warn("[ai:memory] Failed to save memory:", memErr);
        // Don't fail the chat if memory save fails
      }
    }
  } catch (err) {
    if (abortController.signal.aborted) {
      // Stream was aborted — don't send error
      return;
    }

    const message =
      err instanceof Error ? err.message : "An unexpected error occurred during AI chat.";

    window.webContents.send(AI_IPC_CHANNELS.CHAT_ERROR, {
      chatId,
      message,
    });
  } finally {
    activeAbortControllers.delete(chatId);
  }
}

async function handleInlineGenerateStart(
  window: BrowserWindow,
  input: InlineGenerateStartInput,
): Promise<void> {
  const { requestId, dbType, prompt, sql, schemaContext } = input;

  abortInlineStream(requestId);
  const abortController = new AbortController();
  activeInlineAbortControllers.set(requestId, abortController);

  try {
    const model = getCurrentModel();
    const sourceSql = sql?.trim() ?? "";
    const finalPrompt = sourceSql
      ? `Original SQL:\n${sourceSql}\n\nChange instruction: ${prompt}`
      : `Generate a SQL query for this instruction: ${prompt}`;

    const result = streamText({
      model,
      system: buildInlineSystemPrompt(dbType, schemaContext),
      prompt: finalPrompt,
      abortSignal: abortController.signal,
      experimental_transform: smoothStream({ chunking: "word" }),
      onChunk(event) {
        if (event.chunk.type === "text-delta") {
          window.webContents.send(AI_IPC_CHANNELS.INLINE_CHUNK, {
            requestId,
            type: "text",
            text: event.chunk.text,
          });
        }
      },
    });

    for await (const _ of result.textStream) {
      // consumed by loop; chunks are emitted in onChunk
    }

    const finishReason = await result.finishReason;
    const usage = await result.usage;
    window.webContents.send(AI_IPC_CHANNELS.INLINE_DONE, {
      requestId,
      finishReason,
      usage,
    });
  } catch (err) {
    if (abortController.signal.aborted) {
      return;
    }
    const message =
      err instanceof Error
        ? err.message
        : "An unexpected error occurred during inline SQL generation.";
    window.webContents.send(AI_IPC_CHANNELS.INLINE_ERROR, {
      requestId,
      message,
    });
  } finally {
    activeInlineAbortControllers.delete(requestId);
  }
}

// ---------------------------------------------------------------------------
// Register IPC listeners — call once from main.ts
// ---------------------------------------------------------------------------

export function registerAiStreamingHandlers(): void {
  ipcMain.on(AI_IPC_CHANNELS.CHAT_START, (event: IpcMainEvent, input: ChatStartInput) => {
    const window = ipcContext.mainWindow;
    if (!window) {
      // Send error back to the sender — renderer never hangs waiting
      event.sender.send(AI_IPC_CHANNELS.CHAT_ERROR, {
        chatId: input.chatId,
        message: "Main window not available — cannot start AI chat.",
      });
      return;
    }

    // Run async — don't block the IPC handler
    handleChatStart(window, input).catch((err) => {
      console.error("[ai] Chat stream error:", err);
    });
  });

  ipcMain.on(AI_IPC_CHANNELS.CHAT_ABORT, (_event, chatId: string) => {
    abortStream(chatId);
  });

  ipcMain.on(
    AI_IPC_CHANNELS.INLINE_START,
    (event: IpcMainEvent, input: InlineGenerateStartInput) => {
      const window = ipcContext.mainWindow;
      if (!window) {
        event.sender.send(AI_IPC_CHANNELS.INLINE_ERROR, {
          requestId: input.requestId,
          message: "Main window not available — cannot start inline generation.",
        });
        return;
      }

      handleInlineGenerateStart(window, input).catch((err) => {
        console.error("[ai] Inline generation stream error:", err);
      });
    },
  );

  ipcMain.on(AI_IPC_CHANNELS.INLINE_ABORT, (_event, requestId: string) => {
    abortInlineStream(requestId);
  });

  console.log("[ai] Streaming chat handlers registered");
}
