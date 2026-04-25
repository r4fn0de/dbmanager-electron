import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { startInlineStream, type StartedInlineStream } from "@/renderer/lib/ai-streaming-client";
import type {
  AiInlineDonePayload,
  AiInlineErrorPayload,
  InlineGenerateStartInput,
} from "@/shared/ai/streaming-contracts";

export interface UseInlineSqlGenerationState {
  status: "idle" | "streaming" | "done" | "error" | "aborted";
  sql: string;
  reasoning: string;
  error: string | null;
  finishReason: string | null;
  usage: AiInlineDonePayload["usage"] | null;
  isStreaming: boolean;
}

export interface UseInlineSqlGenerationOptions {
  onDone?: (payload: AiInlineDonePayload, sql: string) => void;
  onError?: (payload: AiInlineErrorPayload) => void;
}

export interface UseInlineSqlGenerationResult extends UseInlineSqlGenerationState {
  start: (input: InlineGenerateStartInput) => Promise<AiInlineDonePayload>;
  abort: () => void;
  reset: () => void;
  setSql: React.Dispatch<React.SetStateAction<string>>;
}

const initialState: UseInlineSqlGenerationState = {
  status: "idle",
  sql: "",
  reasoning: "",
  error: null,
  finishReason: null,
  usage: null,
  isStreaming: false,
};

function isAbortLikeError(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof Error && error.name === "AbortError") return true;
  return String(error).toLowerCase().includes("abort");
}

export function useInlineSqlGeneration(
  options: UseInlineSqlGenerationOptions = {},
): UseInlineSqlGenerationResult {
  const streamRef = useRef<StartedInlineStream | null>(null);
  const mountedRef = useRef(true);

  const [status, setStatus] = useState<UseInlineSqlGenerationState["status"]>("idle");
  const [sql, setSql] = useState("");
  const [reasoning, setReasoning] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [finishReason, setFinishReason] = useState<string | null>(null);
  const [usage, setUsage] = useState<AiInlineDonePayload["usage"] | null>(null);

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
    setSql(initialState.sql);
    setReasoning(initialState.reasoning);
    setError(initialState.error);
    setFinishReason(initialState.finishReason);
    setUsage(initialState.usage);
  }, []);

  const start = useCallback(
    async (input: InlineGenerateStartInput): Promise<AiInlineDonePayload> => {
      abort();

      if (mountedRef.current) {
        setStatus("streaming");
        setSql("");
        setReasoning("");
        setError(null);
        setFinishReason(null);
        setUsage(null);
      }

      const stream = startInlineStream({
        input,
        onText(_delta, fullText) {
          if (!mountedRef.current) return;
          setSql(fullText);
        },
        onReasoning(reasoningDelta) {
          if (!mountedRef.current) return;
          setReasoning((prev) => prev + reasoningDelta);
        },
        onDone(payload, fullText) {
          if (!mountedRef.current) return;
          setStatus("done");
          setSql(fullText);
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
      sql,
      reasoning,
      error,
      finishReason,
      usage,
      isStreaming: status === "streaming",
      start,
      abort,
      reset,
      setSql,
    }),
    [status, sql, reasoning, error, finishReason, usage, start, abort, reset],
  );
}
