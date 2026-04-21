import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

const LOCAL_DBS_QUERY_KEY = ["local-databases"] as const;

export function useLocalDatabases(): UseLocalDatabasesReturn {
  const queryClient = useQueryClient();

  // ── Query: local databases list + storage estimate ────────────────
  // Replaces manual useState + useEffect + refresh(). Gets automatic
  // deduplication — multiple components calling useLocalDatabases()
  // share a single IPC request.
  const {
    data: queryData,
    isLoading,
    error: queryError,
    refetch: queryRefetch,
  } = useQuery({
    queryKey: LOCAL_DBS_QUERY_KEY,
    queryFn: async () => {
      const [dbs, est] = await Promise.all([
        ipc.client.db.listLocalDatabases(),
        navigator.storage?.estimate?.() ?? undefined,
      ]);
      return {
        databases: dbs,
        storage: {
          usage: est?.usage ?? null,
          quota: est?.quota ?? null,
        } satisfies LocalDbStorageInfo,
      };
    },
    staleTime: 15_000,
    gcTime: 5 * 60_000,
  });

  const databases = queryData?.databases ?? [];
  const storage = queryData?.storage ?? { usage: null, quota: null };
  const error = queryError instanceof Error ? queryError.message : null;

  // Wrap queryRefetch to match the () => Promise<void> contract — queryRefetch
  // returns QueryObserverResult but consumers expect void.
  const refresh = useCallback(async () => {
    await queryRefetch();
  }, [queryRefetch]);

  // ── Mutations ─────────────────────────────────────────────────────

  const { mutateAsync: createMutateAsync } = useMutation({
    mutationFn: (input: CreateLocalDbOptions) =>
      ipc.client.db.createLocalDatabase({
        name: input.name,
        databaseName: input.databaseName,
        username: input.username,
        password: input.password,
        port: input.port,
        postgresVersion: input.postgresVersion,
        autoStart: input.autoStart,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: LOCAL_DBS_QUERY_KEY });
    },
  });

  const { mutateAsync: removeMutateAsync } = useMutation({
    mutationFn: async ({
      id,
      refresh: shouldRefresh = true,
    }: {
      id: string;
      refresh?: boolean;
    }) => {
      await ipc.client.db.deleteLocalDatabase({ id });
      return shouldRefresh;
    },
    // Optimistic update: remove from cache immediately, rollback on error
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: LOCAL_DBS_QUERY_KEY });
      const previous = queryClient.getQueryData<{
        databases: LocalDbInfo[];
        storage: LocalDbStorageInfo;
      }>(LOCAL_DBS_QUERY_KEY);

      if (previous) {
        queryClient.setQueryData(LOCAL_DBS_QUERY_KEY, {
          ...previous,
          databases: previous.databases.filter((db) => db.id !== id),
        });
      }

      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(LOCAL_DBS_QUERY_KEY, context.previous);
      }
    },
    onSuccess: (shouldRefresh) => {
      if (shouldRefresh) {
        queryClient.invalidateQueries({ queryKey: LOCAL_DBS_QUERY_KEY });
      }
    },
  });

  const { mutateAsync: startMutateAsync } = useMutation({
    mutationFn: (id: string) => ipc.client.db.startLocalDatabase({ id }),
    // Optimistic update: mark as running immediately
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: LOCAL_DBS_QUERY_KEY });
      const previous = queryClient.getQueryData<{
        databases: LocalDbInfo[];
        storage: LocalDbStorageInfo;
      }>(LOCAL_DBS_QUERY_KEY);

      if (previous) {
        queryClient.setQueryData(LOCAL_DBS_QUERY_KEY, {
          ...previous,
          databases: previous.databases.map((db) =>
            db.id === id
              ? { ...db, running: true, externally_connectable: false }
              : db,
          ),
        });
      }

      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(LOCAL_DBS_QUERY_KEY, context.previous);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: LOCAL_DBS_QUERY_KEY });
    },
  });

  const { mutateAsync: pauseMutateAsync } = useMutation({
    mutationFn: (id: string) => ipc.client.db.stopLocalDatabase({ id }),
    // Optimistic update: mark as stopped immediately
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: LOCAL_DBS_QUERY_KEY });
      const previous = queryClient.getQueryData<{
        databases: LocalDbInfo[];
        storage: LocalDbStorageInfo;
      }>(LOCAL_DBS_QUERY_KEY);

      if (previous) {
        queryClient.setQueryData(LOCAL_DBS_QUERY_KEY, {
          ...previous,
          databases: previous.databases.map((db) =>
            db.id === id
              ? { ...db, running: false, externally_connectable: false }
              : db,
          ),
        });
      }

      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(LOCAL_DBS_QUERY_KEY, context.previous);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: LOCAL_DBS_QUERY_KEY });
    },
  });

  // ── Adapt mutation API to match existing consumer contracts ──────

  const create = useCallback(
    async (input: CreateLocalDbOptions): Promise<LocalDbInfo> => {
      const db = await createMutateAsync(input);
      return db;
    },
    [createMutateAsync],
  );

  const remove = useCallback(
    async (id: string, options?: { refresh?: boolean }): Promise<void> => {
      await removeMutateAsync({ id, refresh: options?.refresh });
    },
    [removeMutateAsync],
  );

  const start = useCallback(
    async (id: string): Promise<void> => {
      await startMutateAsync(id);
    },
    [startMutateAsync],
  );

  const pause = useCallback(
    async (id: string): Promise<void> => {
      await pauseMutateAsync(id);
    },
    [pauseMutateAsync],
  );

  // getStatus reads from the cached query data — no extra IPC call
  const getStatus = useCallback(
    async (id: string): Promise<LocalDbInfo | null> => {
      const data = queryClient.getQueryData<{
        databases: LocalDbInfo[];
        storage: LocalDbStorageInfo;
      }>(LOCAL_DBS_QUERY_KEY);
      const db = data?.databases.find((d) => d.id === id);
      return db ?? null;
    },
    [queryClient],
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
