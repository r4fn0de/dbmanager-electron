/**
 * query-client.ts — Singleton QueryClient for the renderer process.
 *
 * Exported so that non-React code (e.g. db-actions) can call
 * `queryClient.invalidateQueries()` without needing `useQueryClient()`.
 *
 * Schema-related queries are persisted to IndexedDB so they survive
 * page reloads and app restarts — eliminates the "loading flash" on
 * re-opening a database tab.
 */
import { QueryClient } from "@tanstack/react-query";
import { persistQueryClientSave } from "@tanstack/react-query-persist-client";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// ---------------------------------------------------------------------------
// Persist schema-related queries to IndexedDB
// ---------------------------------------------------------------------------

const PERSIST_PREFIX = "tarsdb-query-cache";

/** Simple IndexedDB storage adapter for react-query-persist-client */
function createIdbStorage() {
  const DB_NAME = "tarsdb-query-persist";
  const STORE_NAME = "queries";

  function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  return {
    getItem: async (key: string): Promise<string | null> => {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => reject(req.error);
      });
    },
    setItem: async (key: string, value: string): Promise<void> => {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        store.put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },
    removeItem: async (key: string): Promise<void> => {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        store.delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },
  };
}

// Only persist schema-related queries (not table-rows which can be large)
const persistFilter = (key: readonly unknown[]) => {
  const str = String(key[0]);
  return str === "schema-summary" || str === "table-details" || str === "db-info";
};

persistQueryClientSave({
  queryClient,
  persister: {
    persistClient: async (client) => {
      // Filter to only schema-related queries before persisting
      const filtered = {
        ...client,
        clientState: {
          ...client.clientState,
          queries: client.clientState.queries.filter((q) =>
            persistFilter(q.queryKey as readonly unknown[]),
          ),
        },
      };
      const storage = createIdbStorage();
      await storage.setItem(PERSIST_PREFIX, JSON.stringify(filtered));
    },
    restoreClient: async () => {
      const storage = createIdbStorage();
      const stored = await storage.getItem(PERSIST_PREFIX);
      if (!stored) return undefined;
      try {
        return JSON.parse(stored);
      } catch {
        return undefined;
      }
    },
    removeClient: async () => {
      const storage = createIdbStorage();
      await storage.removeItem(PERSIST_PREFIX);
    },
  },
});
