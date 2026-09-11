import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type StartedInlineStream,
  startInlineStream,
} from "@/renderer/lib/ai-streaming-client";
import type {
  AiInlineDonePayload,
  AiInlineErrorPayload,
  InlineGenerateStartInput,
} from "@/shared/ai/streaming-contracts";

export interface UseInlineSqlGenerationState {
  error: string | null;
  finishReason: string | null;
  isStreaming: boolean;
  reasoning: string;
  sql: string;
  status: "idle" | "streaming" | "done" | "error" | "aborted";
  usage: AiInlineDonePayload["usage"] | null;
}

export interface UseInlineSqlGenerationOptions {
  onDone?: (payload: AiInlineDonePayload, sql: string) => void;
  onError?: (payload: AiInlineErrorPayload) => void;
}

export interface UseInlineSqlGenerationResult
  extends UseInlineSqlGenerationState {
  abort: () => void;
  reset: () => void;
  setSql: React.Dispatch<React.SetStateAction<string>>;
  start: (input: InlineGenerateStartInput) => Promise<AiInlineDonePayload>;
}

const initialState: UseInlineSqlGenerationState = {
  error: null,
  finishReason: null,
  isStreaming: false,
  reasoning: "",
  sql: "",
  status: "idle",
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

export function useInlineSqlGeneration(
  options: UseInlineSqlGenerationOptions = {}
): UseInlineSqlGenerationResult {
  const streamRef = useRef<StartedInlineStream | null>(null);
  const mountedRef = useRef(true);

  const [status, setStatus] =
    useState<UseInlineSqlGenerationState["status"]>("idle");
  const [sql, setSql] = useState("");
  const [reasoning, setReasoning] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [finishReason, setFinishReason] = useState<string | null>(null);
  const [usage, setUsage] = useState<AiInlineDonePayload["usage"] | null>(null);

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
        onDone(payload, fullText) {
          if (!mountedRef.current) {
            return;
          }
          setStatus("done");
          setSql(fullText);
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
        onReasoning(reasoningDelta) {
          if (!mountedRef.current) {
            return;
          }
          setReasoning((prev) => prev + reasoningDelta);
        },
        onText(_delta, fullText) {
          if (!mountedRef.current) {
            return;
          }
          setSql(fullText);
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
      setSql,
      sql,
      start,
      status,
      usage,
    }),
    [status, sql, reasoning, error, finishReason, usage, start, abort, reset]
  );
}
