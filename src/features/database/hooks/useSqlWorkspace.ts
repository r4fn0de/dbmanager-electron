import { useCallback, useEffect, useState } from "react";

export interface SqlSavedQuery {
  id: string;
  title: string;
  sql: string;
  connectionId: string;
  updatedAt: string;
}

export interface SqlHistoryEntry {
  id: string;
  connectionId: string;
  sqlPreview: string;
  executedSql: string;
  status: "success" | "error";
  rowCount: number;
  durationMs: number;
  createdAt: string;
  errorMessage?: string;
  resultPreview?: {
    columns: { name: string; type_name: string }[];
    rows: unknown[][];
    row_count: number;
  };
}

export interface SqlExecutionLog {
  id: string;
  level: "info" | "success" | "error";
  message: string;
  createdAt: string;
  durationMs?: number;
  rowCount?: number;
}

const STORAGE_KEY = "sql-workspace-v1";
const HISTORY_LIMIT = 200;
const WORKSPACE_UPDATED_EVENT = "sql-workspace-updated";

type WorkspaceStorage = {
  version: 1;
  savedByConnection: Record<string, SqlSavedQuery[]>;
  historyByConnection: Record<string, SqlHistoryEntry[]>;
};

const EMPTY_STORAGE: WorkspaceStorage = {
  version: 1,
  savedByConnection: {},
  historyByConnection: {},
};

function readStorage(): WorkspaceStorage {
  if (typeof window === "undefined") return EMPTY_STORAGE;

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return EMPTY_STORAGE;

  try {
    const parsed = JSON.parse(raw) as Partial<WorkspaceStorage>;
    if (parsed.version !== 1) return EMPTY_STORAGE;

    return {
      version: 1,
      savedByConnection: parsed.savedByConnection ?? {},
      historyByConnection: parsed.historyByConnection ?? {},
    };
  } catch {
    return EMPTY_STORAGE;
  }
}

function writeStorage(storage: WorkspaceStorage) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(storage));
  window.dispatchEvent(new CustomEvent(WORKSPACE_UPDATED_EVENT));
}

function makeId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function useSqlWorkspace(connectionId: null | string) {
  const [savedQueries, setSavedQueries] = useState<SqlSavedQuery[]>([]);
  const [history, setHistory] = useState<SqlHistoryEntry[]>([]);

  const loadSaved = useCallback(async () => {
    const storage = readStorage();
    if (!connectionId) {
      setSavedQueries([]);
      return;
    }

    setSavedQueries(storage.savedByConnection[connectionId] ?? []);
  }, [connectionId]);

  const loadHistory = useCallback(async () => {
    const storage = readStorage();
    if (!connectionId) {
      setHistory([]);
      return;
    }

    setHistory(storage.historyByConnection[connectionId] ?? []);
  }, [connectionId]);

  useEffect(() => {
    void Promise.all([loadSaved(), loadHistory()]);
  }, [loadHistory, loadSaved]);

  useEffect(() => {
    const onWorkspaceUpdated = () => {
      void Promise.all([loadSaved(), loadHistory()]);
    };
    window.addEventListener(WORKSPACE_UPDATED_EVENT, onWorkspaceUpdated);
    return () => window.removeEventListener(WORKSPACE_UPDATED_EVENT, onWorkspaceUpdated);
  }, [loadHistory, loadSaved]);

  const saveQuery = useCallback(
    async (query: Omit<SqlSavedQuery, "id" | "updatedAt"> & { id?: string }) => {
      if (!query.connectionId) return null;

      const storage = readStorage();
      const current = storage.savedByConnection[query.connectionId] ?? [];
      const now = new Date().toISOString();

      const nextId = query.id ?? makeId();
      const nextEntry: SqlSavedQuery = {
        id: nextId,
        title: query.title,
        sql: query.sql,
        connectionId: query.connectionId,
        updatedAt: now,
      };

      const next = [
        nextEntry,
        ...current.filter((entry) => entry.id !== nextId),
      ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

      storage.savedByConnection[query.connectionId] = next;
      writeStorage(storage);

      if (query.connectionId === connectionId) {
        setSavedQueries(next);
      }

      return nextEntry;
    },
    [connectionId],
  );

  const deleteQuery = useCallback(
    async (id: string) => {
      if (!connectionId) return;
      const storage = readStorage();
      const current = storage.savedByConnection[connectionId] ?? [];
      const next = current.filter((entry) => entry.id !== id);
      storage.savedByConnection[connectionId] = next;
      writeStorage(storage);
      setSavedQueries(next);
    },
    [connectionId],
  );

  const renameQuery = useCallback(
    async (id: string, title: string) => {
      if (!connectionId) return;
      const normalizedTitle = title.trim();
      if (!normalizedTitle) return;

      const storage = readStorage();
      const current = storage.savedByConnection[connectionId] ?? [];
      const now = new Date().toISOString();
      const next = current.map((entry) =>
        entry.id === id ? { ...entry, title: normalizedTitle, updatedAt: now } : entry,
      );
      storage.savedByConnection[connectionId] = next;
      writeStorage(storage);
      setSavedQueries(next);
    },
    [connectionId],
  );

  const appendHistory = useCallback(
    async (entry: Omit<SqlHistoryEntry, "id">) => {
      if (!entry.connectionId) return;

      const storage = readStorage();
      const current = storage.historyByConnection[entry.connectionId] ?? [];
      const next: SqlHistoryEntry[] = [{ ...entry, id: makeId() }, ...current].slice(
        0,
        HISTORY_LIMIT,
      );

      storage.historyByConnection[entry.connectionId] = next;
      writeStorage(storage);

      if (entry.connectionId === connectionId) {
        setHistory(next);
      }
    },
    [connectionId],
  );

  return {
    savedQueries,
    history,
    loadSaved,
    loadHistory,
    saveQuery,
    deleteQuery,
    renameQuery,
    appendHistory,
  };
}
