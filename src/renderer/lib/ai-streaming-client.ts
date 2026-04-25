import type {
  AiChatChunkPayload,
  AiChatDonePayload,
  AiChatErrorPayload,
  AiInlineChunkPayload,
  AiInlineDonePayload,
  AiInlineErrorPayload,
  ChatStartInput,
  InlineGenerateStartInput,
  Unsubscribe,
} from "@/shared/ai/streaming-contracts";

function assertAiApi() {
  if (!window.ai) {
    throw new Error("window.ai is not available. Did preload load correctly?");
  }

  return window.ai;
}

function createAbortError(): Error {
  try {
    return new DOMException("The operation was aborted.", "AbortError");
  } catch {
    const error = new Error("The operation was aborted.");
    error.name = "AbortError";
    return error;
  }
}

export interface StartChatStreamOptions {
  input: ChatStartInput;
  onChunk?: (chunk: AiChatChunkPayload) => void;
  onText?: (text: string, fullText: string) => void;
  onReasoning?: (text: string) => void;
  onToolCall?: (chunk: AiChatChunkPayload) => void;
  onToolResult?: (chunk: AiChatChunkPayload) => void;
  onDone?: (payload: AiChatDonePayload, fullText: string) => void;
  onError?: (payload: AiChatErrorPayload) => void;
}

export interface StartedChatStream {
  abort: () => void;
  dispose: () => void;
  done: Promise<AiChatDonePayload>;
  getText: () => string;
}

export function startChatStream(
  options: StartChatStreamOptions,
): StartedChatStream {
  const api = assertAiApi();
  const { input } = options;
  const { chatId } = input;

  let fullText = "";
  let settled = false;

  let resolveDone!: (value: AiChatDonePayload) => void;
  let rejectDone!: (reason?: unknown) => void;

  const done = new Promise<AiChatDonePayload>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });

  const unsubscribers: Unsubscribe[] = [];

  const cleanup = () => {
    while (unsubscribers.length > 0) {
      const unsubscribe = unsubscribers.pop();
      try {
        unsubscribe?.();
      } catch {
        // ignore cleanup failures
      }
    }
  };

  unsubscribers.push(
    api.chat.onChunk((payload) => {
      if (payload.chatId !== chatId) return;

      options.onChunk?.(payload);

      if (payload.type === "text") {
        fullText += payload.text;
        options.onText?.(payload.text, fullText);
        return;
      }

      if (payload.type === "reasoning") {
        options.onReasoning?.(payload.text);
        return;
      }

      if (
        payload.type === "tool-call" ||
        payload.type === "tool-call-streaming-start" ||
        payload.type === "tool-call-delta"
      ) {
        options.onToolCall?.(payload);
        return;
      }

      if (payload.type === "tool-result") {
        options.onToolResult?.(payload);
      }
    }),
  );

  unsubscribers.push(
    api.chat.onDone((payload) => {
      if (payload.chatId !== chatId || settled) return;

      settled = true;
      cleanup();
      options.onDone?.(payload, fullText);
      resolveDone(payload);
    }),
  );

  unsubscribers.push(
    api.chat.onError((payload) => {
      if (payload.chatId !== chatId || settled) return;

      settled = true;
      cleanup();
      options.onError?.(payload);
      rejectDone(new Error(payload.message));
    }),
  );

  api.chat.start(input);

  return {
    abort() {
      if (settled) return;

      settled = true;
      api.chat.abort(chatId);
      cleanup();
      rejectDone(createAbortError());
    },

    dispose() {
      cleanup();
    },

    done,
    getText() {
      return fullText;
    },
  };
}

export interface StartInlineStreamOptions {
  input: InlineGenerateStartInput;
  onChunk?: (chunk: AiInlineChunkPayload) => void;
  onText?: (text: string, fullText: string) => void;
  onReasoning?: (text: string) => void;
  onDone?: (payload: AiInlineDonePayload, fullText: string) => void;
  onError?: (payload: AiInlineErrorPayload) => void;
}

export interface StartedInlineStream {
  abort: () => void;
  dispose: () => void;
  done: Promise<AiInlineDonePayload>;
  getText: () => string;
}

export function startInlineStream(
  options: StartInlineStreamOptions,
): StartedInlineStream {
  const api = assertAiApi();
  const { input } = options;
  const { requestId } = input;

  let fullText = "";
  let settled = false;

  let resolveDone!: (value: AiInlineDonePayload) => void;
  let rejectDone!: (reason?: unknown) => void;

  const done = new Promise<AiInlineDonePayload>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });

  const unsubscribers: Unsubscribe[] = [];

  const cleanup = () => {
    while (unsubscribers.length > 0) {
      const unsubscribe = unsubscribers.pop();
      try {
        unsubscribe?.();
      } catch {
        // ignore cleanup failures
      }
    }
  };

  unsubscribers.push(
    api.inline.onChunk((payload) => {
      if (payload.requestId !== requestId) return;

      options.onChunk?.(payload);

      if (payload.type === "text") {
        fullText += payload.text;
        options.onText?.(payload.text, fullText);
        return;
      }

      if (payload.type === "reasoning") {
        options.onReasoning?.(payload.text);
      }
    }),
  );

  unsubscribers.push(
    api.inline.onDone((payload) => {
      if (payload.requestId !== requestId || settled) return;

      settled = true;
      cleanup();
      options.onDone?.(payload, fullText);
      resolveDone(payload);
    }),
  );

  unsubscribers.push(
    api.inline.onError((payload) => {
      if (payload.requestId !== requestId || settled) return;

      settled = true;
      cleanup();
      options.onError?.(payload);
      rejectDone(new Error(payload.message));
    }),
  );

  api.inline.start(input);

  return {
    abort() {
      if (settled) return;

      settled = true;
      api.inline.abort(requestId);
      cleanup();
      rejectDone(createAbortError());
    },

    dispose() {
      cleanup();
    },

    done,
    getText() {
      return fullText;
    },
  };
}
