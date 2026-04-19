import { useCallback, useEffect, useState } from "react";
import { ipc } from "@/ipc/manager";
import type { LocalDbInfo } from "@/ipc/db/types";

interface CreateLocalDbOptions {
  name: string;
  postgresVersion?: string;
}

export interface LocalDbStorageInfo {
  usage: number | null;
  quota: number | null;
}

interface UseLocalDatabasesReturn {
  databases: LocalDbInfo[];
  storage: LocalDbStorageInfo;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  create: (input: CreateLocalDbOptions) => Promise<LocalDbInfo>;
  remove: (id: string, options?: { refresh?: boolean }) => Promise<void>;
  start: (id: string) => Promise<void>;
  pause: (id: string) => Promise<void>;
}

function upsertDb(list: LocalDbInfo[], db: LocalDbInfo): LocalDbInfo[] {
  const idx = list.findIndex((item) => item.id === db.id);
  if (idx === -1) return [...list, db];
  const next = [...list];
  next[idx] = db;
  return next;
}

export function useLocalDatabases(): UseLocalDatabasesReturn {
  const [databases, setDatabases] = useState<LocalDbInfo[]>([]);
  const [storage, setStorage] = useState<LocalDbStorageInfo>({
    usage: null,
    quota: null,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const dbs = await ipc.client.db.listLocalDatabases();
      setDatabases(dbs);
      if (navigator.storage?.estimate) {
        const est = await navigator.storage.estimate();
        setStorage({ usage: est.usage ?? null, quota: est.quota ?? null });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const create = useCallback(
    async (input: CreateLocalDbOptions): Promise<LocalDbInfo> => {
      const db = await ipc.client.db.createLocalDatabase({
        name: input.name,
        postgresVersion: input.postgresVersion,
      });
      setDatabases((current) => upsertDb(current, db));
      await refresh();
      return db;
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string, options?: { refresh?: boolean }): Promise<void> => {
      const previousDatabases = databases;
      setDatabases((current) => current.filter((db) => db.id !== id));
      try {
        await ipc.client.db.deleteLocalDatabase({ id });
        if (options?.refresh ?? true) {
          await refresh();
        }
      } catch (err) {
        setDatabases(previousDatabases);
        throw err;
      }
    },
    [databases, refresh],
  );

  const start = useCallback(
    async (id: string): Promise<void> => {
      setDatabases((current) =>
        current.map((db) =>
          db.id === id
            ? { ...db, running: true, externally_connectable: false }
            : db,
        ),
      );
      await ipc.client.db.startLocalDatabase({ id });
      await refresh();
    },
    [refresh],
  );

  const pause = useCallback(
    async (id: string): Promise<void> => {
      setDatabases((current) =>
        current.map((db) =>
          db.id === id
            ? { ...db, running: false, externally_connectable: false }
            : db,
        ),
      );
      await ipc.client.db.stopLocalDatabase({ id });
      await refresh();
    },
    [refresh],
  );

  return {
    databases,
    storage,
    isLoading,
    error,
    refresh,
    create,
    remove,
    start,
    pause,
  };
}
