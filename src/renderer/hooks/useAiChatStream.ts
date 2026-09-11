import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type StartedChatStream,
  startChatStream,
} from "@/renderer/lib/ai-streaming-client";
import type {
  AiChatChunkPayload,
  AiChatDonePayload,
  AiChatErrorPayload,
  ChatStartInput,
} from "@/shared/ai/streaming-contracts";

export interface AiToolEvent {
  kind: "call" | "result";
  payload: AiChatChunkPayload;
  timestamp: number;
}

export interface UseAiChatStreamState {
  error: string | null;
  finishReason: string | null;
  isStreaming: boolean;
  reasoning: string;
  status: "idle" | "streaming" | "done" | "error" | "aborted";
  text: string;
  toolEvents: AiToolEvent[];
  usage: AiChatDonePayload["usage"] | null;
}

export interface UseAiChatStreamOptions {
  onChunk?: (chunk: AiChatChunkPayload) => void;
  onDone?: (payload: AiChatDonePayload, fullText: string) => void;
  onError?: (payload: AiChatErrorPayload) => void;
}

export interface UseAiChatStreamResult extends UseAiChatStreamState {
  abort: () => void;
  reset: () => void;
  setText: React.Dispatch<React.SetStateAction<string>>;
  start: (input: ChatStartInput) => Promise<AiChatDonePayload>;
}

const initialState: UseAiChatStreamState = {
  error: null,
  finishReason: null,
  isStreaming: false,
  reasoning: "",
  status: "idle",
  text: "",
  toolEvents: [],
  usage: null,
};

function isAbortLikeError(error: unknown): boolean {
  if (!error) {
    return false;
  }
  if (error instanceof Error && error.name === "AbortError") {
    return true;
  }
  return String(error).toLowerCase().includes("abort");
}

export function useAiChatStream(
  options: UseAiChatStreamOptions = {}
): UseAiChatStreamResult {
  const streamRef = useRef<StartedChatStream | null>(null);
  const mountedRef = useRef(true);

  const [status, setStatus] = useState<UseAiChatStreamState["status"]>("idle");
  const [text, setText] = useState("");
  const [reasoning, setReasoning] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [finishReason, setFinishReason] = useState<string | null>(null);
  const [usage, setUsage] = useState<AiChatDonePayload["usage"] | null>(null);
  const [toolEvents, setToolEvents] = useState<AiToolEvent[]>([]);

  useEffect(
    () => () => {
      mountedRef.current = false;
      streamRef.current?.abort();
      streamRef.current?.dispose();
      streamRef.current = null;
    },
    []
  );

  const abort = useCallback(() => {
    const current = streamRef.current;
    if (!current) {
      return;
    }

    current.abort();
    current.dispose();
    streamRef.current = null;

    if (mountedRef.current) {
      setStatus("aborted");
    }
  }, []);

  const reset = useCallback(() => {
    streamRef.current?.dispose();
    streamRef.current = null;

    if (!mountedRef.current) {
      return;
    }

    setStatus(initialState.status);
    setText(initialState.text);
    setReasoning(initialState.reasoning);
    setError(initialState.error);
    setFinishReason(initialState.finishReason);
    setUsage(initialState.usage);
    setToolEvents(initialState.toolEvents);
  }, []);

  const start = useCallback(
    async (input: ChatStartInput): Promise<AiChatDonePayload> => {
      abort();

      if (mountedRef.current) {
        setStatus("streaming");
        setText("");
        setReasoning("");
        setError(null);
        setFinishReason(null);
        setUsage(null);
        setToolEvents([]);
      }

      const stream = startChatStream({
        input,
        onChunk(chunk) {
          if (!mountedRef.current) {
            return;
          }
          options.onChunk?.(chunk);

          if (
            chunk.type === "tool-call" ||
            chunk.type === "tool-call-streaming-start" ||
            chunk.type === "tool-call-delta"
          ) {
            setToolEvents((prev) => [
              ...prev,
              { kind: "call", payload: chunk, timestamp: Date.now() },
            ]);
            return;
          }

          if (chunk.type === "tool-result") {
            setToolEvents((prev) => [
              ...prev,
              { kind: "result", payload: chunk, timestamp: Date.now() },
            ]);
          }
        },
        onDone(payload, fullText) {
          if (!mountedRef.current) {
            return;
          }
          setStatus("done");
          setText(fullText);
          setFinishReason(payload.finishReason ?? null);
          setUsage(payload.usage ?? null);
          options.onDone?.(payload, fullText);
        },
        onError(payload) {
          if (!mountedRef.current) {
            return;
          }
          setStatus("error");
          setError(payload.message);
          options.onError?.(payload);
        },
        onReasoning(fullReasoningDelta) {
          if (!mountedRef.current) {
            return;
          }
          setReasoning((prev) => prev + fullReasoningDelta);
        },
        onText(_delta, fullText) {
          if (!mountedRef.current) {
            return;
          }
          setText(fullText);
        },
      });

      streamRef.current = stream;

      try {
        const done = await stream.done;

        if (streamRef.current === stream) {
          streamRef.current = null;
        }

        return done;
      } catch (err) {
        if (streamRef.current === stream) {
          streamRef.current = null;
        }

        if (mountedRef.current && isAbortLikeError(err)) {
          setStatus("aborted");
          setError(null);
        }

        throw err;
      } finally {
        stream.dispose();
      }
    },
    [abort, options]
  );

  return useMemo(
    () => ({
      abort,
      error,
      finishReason,
      isStreaming: status === "streaming",
      reasoning,
      reset,
      setText,
      start,
      status,
      text,
      toolEvents,
      usage,
    }),
    [
      status,
      text,
      reasoning,
      error,
      finishReason,
      usage,
      toolEvents,
      start,
      abort,
      reset,
    ]
  );
}
