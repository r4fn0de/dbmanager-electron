import { useCallback, useEffect, useState } from "react";
import { ipc } from "@/ipc/manager";
import type { LocalDbInfo } from "@/ipc/db/types";

interface CreateLocalDbOptions {
  name: string;
  databaseName?: string;
  username?: string;
  password?: string;
  port?: number;
  postgresVersion?: string;
  autoStart?: boolean;
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
  getStatus: (id: string) => Promise<LocalDbInfo | null>;
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
        databaseName: input.databaseName,
        username: input.username,
        password: input.password,
        port: input.port,
        postgresVersion: input.postgresVersion,
        autoStart: input.autoStart,
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

  const getStatus = useCallback(
    async (id: string): Promise<LocalDbInfo | null> => {
      const db = databases.find((d) => d.id === id);
      return db ?? null;
    },
    [databases],
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
    getStatus,
  };
}
