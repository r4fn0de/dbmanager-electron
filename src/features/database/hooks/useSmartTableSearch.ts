/**
 * useSmartTableSearch — hybrid fuzzy + AI table search hook.
 *
 * Provides two search layers:
 * 1. Instant fuzzy matching (local, zero-latency, every keystroke)
 * 2. AI semantic matching (debounced LLM call, runs for descriptive queries)
 *
 * Results are merged: fuzzy matches shown immediately, AI-only matches
 * tagged with `aiMatch: true` and appended after a brief loading indicator.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SchemaTableSummary } from "@/ipc/db/types";
import { getAiTableSearchMatches } from "@/features/ai/hooks/ai-actions";
import { fuzzySearchTables, isDescriptiveQuery } from "@/features/database/utils/table-search";

export interface SmartTableSearchResult {
  /** Filtered tables (fuzzy + AI merged, deduplicated) */
  filteredTables: SchemaTableSummary[];
  /** Whether the AI search is currently in progress */
  isAiSearching: boolean;
  /** Set of table names that were matched by AI (not fuzzy) */
  aiMatchedNames: Set<string>;
}

/** Debounce delay for AI search calls (ms). */
const AI_DEBOUNCE_MS = 500;
/** Timeout for AI search calls (ms). */
const AI_TIMEOUT_MS = 3000;

export function useSmartTableSearch(
  query: string,
  allTables: SchemaTableSummary[],
  aiEnabled: boolean,
  schemaContext?: string,
): SmartTableSearchResult {
  const [aiMatches, setAiMatches] = useState<Set<string>>(new Set());
  const [isAiSearching, setIsAiSearching] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tableNamesRef = useRef<string[]>([]);

  const clearAiState = useCallback(() => {
    setAiMatches((prev) => (prev.size === 0 ? prev : new Set()));
    setIsAiSearching((prev) => (prev ? false : prev));
  }, []);

  // Table names for the current schema
  const tableNames = useMemo(
    () => allTables.map((t) => t.name),
    [allTables],
  );
  const tableNamesKey = useMemo(() => tableNames.join("\u0001"), [tableNames]);
  tableNamesRef.current = tableNames;

  // ── Fuzzy matching (instant, every keystroke) ──
  const fuzzyMatches = useMemo(() => {
    if (!query.trim()) return allTables;
    const results = fuzzySearchTables(tableNames, query);
    if (results.length === 0) return [];

    const matchSet = new Set(results.map((r) => r.name));
    // Preserve original sort order from allTables for fuzzy matches
    return allTables.filter((t) => matchSet.has(t.name));
  }, [query, tableNames, allTables]);

  // ── AI search (debounced, only for descriptive queries) ──
  const triggerAiSearch = useCallback(
    (searchQuery: string) => {
      // Cancel any in-flight request
      if (abortRef.current) {
        abortRef.current.abort();
      }

      if (!searchQuery.trim() || !aiEnabled) {
        clearAiState();
        return;
      }

      // Only call AI for descriptive queries
      const tableNamesSnapshot = tableNamesRef.current;
      if (!isDescriptiveQuery(searchQuery, tableNamesSnapshot)) {
        // Clear AI matches if query is no longer descriptive
        clearAiState();
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;
      setIsAiSearching(true);

      const timeout = setTimeout(() => {
        controller.abort();
      }, AI_TIMEOUT_MS);

      getAiTableSearchMatches(searchQuery, tableNamesSnapshot, schemaContext)
        .then((result) => {
          if (!controller.signal.aborted) {
            setAiMatches(new Set(result.matches));
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            // On error, just keep fuzzy results — no AI matches
            setAiMatches((prev) => (prev.size === 0 ? prev : new Set()));
          }
        })
        .finally(() => {
          clearTimeout(timeout);
          if (abortRef.current === controller) {
            setIsAiSearching(false);
          }
        });
    },
    [aiEnabled, schemaContext, clearAiState, tableNamesKey],
  );

  // Debounce AI search on query change
  useEffect(() => {
    // Clear previous timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (!query.trim() || !aiEnabled) {
      clearAiState();
      return;
    }

    // Don't call AI if query isn't descriptive
    if (!isDescriptiveQuery(query, tableNamesRef.current)) {
      clearAiState();
      return;
    }

    debounceTimerRef.current = setTimeout(() => {
      triggerAiSearch(query);
    }, AI_DEBOUNCE_MS);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [query, aiEnabled, tableNamesKey, triggerAiSearch, clearAiState]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // ── Merge fuzzy + AI results ──
  const mergedResults = useMemo(() => {
    if (!query.trim()) return allTables;

    const fuzzyNameSet = new Set(fuzzyMatches.map((t) => t.name));

    // AI-only matches: tables found by AI but not by fuzzy
    const aiOnlyTables = allTables.filter(
      (t) => aiMatches.has(t.name) && !fuzzyNameSet.has(t.name),
    );

    // Tag AI-only matches
    const taggedAiOnly = aiOnlyTables.map((t) => ({
      ...t,
      aiMatch: true as const,
    }));

    // Fuzzy results first, then AI-only results
    return [...fuzzyMatches, ...taggedAiOnly];
  }, [query, allTables, fuzzyMatches, aiMatches]);

  return {
    filteredTables: mergedResults,
    isAiSearching,
    aiMatchedNames: aiMatches,
  };
}
