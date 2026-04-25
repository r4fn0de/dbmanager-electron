import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { startChatStream, type StartedChatStream } from "@/renderer/lib/ai-streaming-client";
import type {
  AiChatChunkPayload,
  AiChatDonePayload,
  AiChatErrorPayload,
  ChatStartInput,
} from "@/shared/ai/streaming-contracts";

export interface AiToolEvent {
  kind: "call" | "result";
  timestamp: number;
  payload: AiChatChunkPayload;
}

export interface UseAiChatStreamState {
  status: "idle" | "streaming" | "done" | "error" | "aborted";
  text: string;
  reasoning: string;
  error: string | null;
  finishReason: string | null;
  usage: AiChatDonePayload["usage"] | null;
  toolEvents: AiToolEvent[];
  isStreaming: boolean;
}

export interface UseAiChatStreamOptions {
  onChunk?: (chunk: AiChatChunkPayload) => void;
  onDone?: (payload: AiChatDonePayload, fullText: string) => void;
  onError?: (payload: AiChatErrorPayload) => void;
}

export interface UseAiChatStreamResult extends UseAiChatStreamState {
  start: (input: ChatStartInput) => Promise<AiChatDonePayload>;
  abort: () => void;
  reset: () => void;
  setText: React.Dispatch<React.SetStateAction<string>>;
}

const initialState: UseAiChatStreamState = {
  status: "idle",
  text: "",
  reasoning: "",
  error: null,
  finishReason: null,
  usage: null,
  toolEvents: [],
  isStreaming: false,
};

function isAbortLikeError(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof Error && error.name === "AbortError") return true;
  return String(error).toLowerCase().includes("abort");
}

export function useAiChatStream(
  options: UseAiChatStreamOptions = {},
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

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      streamRef.current?.abort();
      streamRef.current?.dispose();
      streamRef.current = null;
    };
  }, []);

  const abort = useCallback(() => {
    const current = streamRef.current;
    if (!current) return;

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

    if (!mountedRef.current) return;

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
          if (!mountedRef.current) return;
          options.onChunk?.(chunk);

          if (
            chunk.type === "tool-call" ||
            chunk.type === "tool-call-streaming-start" ||
            chunk.type === "tool-call-delta"
          ) {
            setToolEvents((prev) => [
              ...prev,
              { kind: "call", timestamp: Date.now(), payload: chunk },
            ]);
            return;
          }

          if (chunk.type === "tool-result") {
            setToolEvents((prev) => [
              ...prev,
              { kind: "result", timestamp: Date.now(), payload: chunk },
            ]);
          }
        },
        onText(_delta, fullText) {
          if (!mountedRef.current) return;
          setText(fullText);
        },
        onReasoning(fullReasoningDelta) {
          if (!mountedRef.current) return;
          setReasoning((prev) => prev + fullReasoningDelta);
        },
        onDone(payload, fullText) {
          if (!mountedRef.current) return;
          setStatus("done");
          setText(fullText);
          setFinishReason(payload.finishReason ?? null);
          setUsage(payload.usage ?? null);
          options.onDone?.(payload, fullText);
        },
        onError(payload) {
          if (!mountedRef.current) return;
          setStatus("error");
          setError(payload.message);
          options.onError?.(payload);
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
    [abort, options],
  );

  return useMemo(
    () => ({
      status,
      text,
      reasoning,
      error,
      finishReason,
      usage,
      toolEvents,
      isStreaming: status === "streaming",
      start,
      abort,
      reset,
      setText,
    }),
    [status, text, reasoning, error, finishReason, usage, toolEvents, start, abort, reset],
  );
}
