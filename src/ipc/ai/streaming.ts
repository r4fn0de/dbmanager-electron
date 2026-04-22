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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatStartInput {
  /** Unique ID for this chat session (used to correlate events) */
  chatId: string;
  /** Connection ID for the active database */
  connectionId: string;
  /** Database type (postgresql, mysql, etc.) */
  dbType: DatabaseType;
  /** Optional schema context to inject into system prompt */
  schemaContext?: string;
  /** Chat messages in ModelMessage format */
  messages: ModelMessage[];
}

// ---------------------------------------------------------------------------
// Active streams tracking — allows aborting in-progress streams
// ---------------------------------------------------------------------------

const activeAbortControllers = new Map<string, AbortController>();

function abortStream(chatId: string) {
  const controller = activeAbortControllers.get(chatId);
  if (controller) {
    controller.abort();
    activeAbortControllers.delete(chatId);
  }
}

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------

function buildSystemPrompt(dbType: DatabaseType, schemaContext?: string): string {
  const now = new Date().toISOString();

  let prompt = `You are an AI SQL assistant for ${dbType}. Your primary role is to help users write, optimize, and debug SQL queries.

Current date/time: ${now}

## Rules
- Always use quoted identifiers to avoid case-sensitivity issues
- Generate optimized, valid SQL for ${dbType}
- Use the provided tools (tables, columns, select) to inspect the database before writing queries
- When the user asks a question about their data, use the select tool to query it
- For schema changes, generate appropriate DDL statements
- Respond in markdown with SQL in code blocks
- If you're unsure about column names or types, use the columns tool first
- Prefer incremental/specific changes over rewriting entire queries
- Never drop or truncate data unless the user explicitly requests it`;

  if (schemaContext) {
    prompt += `\n\n## Database Context\n${schemaContext}`;
  }

  return prompt;
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

  try {
    const model = getCurrentModel();

    // Use the factory pattern to create tools with connectionId in closure.
    // The AI SDK does NOT forward experimental_context to tool execute functions.
    const tools = createAiTools(connectionId);

    // streamText() is SYNCHRONOUS — it returns a StreamTextResult immediately,
    // NOT a Promise. Do NOT await it before accessing .textStream etc.
    const result = streamText({
      model,
      system: buildSystemPrompt(dbType, schemaContext),
      messages,
      tools,
      abortSignal: abortController.signal,
      // AI SDK v6: maxSteps replaced by stopWhen + stepCountIs
      stopWhen: stepCountIs(5),
      experimental_transform: smoothStream({ chunking: "word" }),
      onChunk(event) {
        // Forward chunks to renderer
        // AI SDK v6 chunk types: 'text-delta' (not 'text'), 'tool-call', 'tool-result'
        if (event.chunk.type === "text-delta") {
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

  console.log("[ai] Streaming chat handlers registered");
}
