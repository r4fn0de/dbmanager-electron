/**
 * active-queries.ts — Registry of in-flight database queries.
 *
 * Used by the cancellation flow: when the user presses "Cancel" in the UI,
 * the renderer sends a cancel request, and this registry maps the requestId
 * to the AbortController that can abort the underlying driver query.
 */

interface ActiveQuery {
  requestId: string;
  abortController: AbortController;
  startedAt: number;
}

const activeQueries = new Map<string, ActiveQuery>();

/** Register a new query and return its AbortController. */
export function registerQuery(requestId: string): AbortController {
  const abortController = new AbortController();
  activeQueries.set(requestId, {
    requestId,
    abortController,
    startedAt: Date.now(),
  });
  return abortController;
}

/** Cancel a running query by requestId. Returns true if found and aborted. */
export function cancelQuery(requestId: string): boolean {
  const query = activeQueries.get(requestId);
  if (!query) return false;
  query.abortController.abort();
  activeQueries.delete(requestId);
  return true;
}

/** Unregister a query after it completes (success or error). */
export function unregisterQuery(requestId: string): void {
  activeQueries.delete(requestId);
}

/** Get the number of active queries (for diagnostics). */
export function getActiveQueryCount(): number {
  return activeQueries.size;
}
