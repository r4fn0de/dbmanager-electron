import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { LocalDbEngine, LocalDbInfo } from "@/ipc/db/types";
import { ipc } from "@/ipc/manager";

interface CreateLocalDbOptions {
  autoStart?: boolean;
  databaseName?: string;
  engine?: LocalDbEngine;
  name: string;
  password?: string;
  port?: number;
  postgresVersion?: string;
  username?: string;
}

export interface LocalDbStorageInfo {
  quota: number | null;
  usage: number | null;
}

interface UseLocalDatabasesReturn {
  create: (input: CreateLocalDbOptions) => Promise<LocalDbInfo>;
  databases: LocalDbInfo[];
  error: string | null;
  /** Invalidate the local databases cache so all consumers get fresh data */
  invalidateCache: () => void;
  isLoading: boolean;
  pause: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
  remove: (id: string, options?: { refresh?: boolean }) => Promise<void>;
  start: (id: string) => Promise<void>;
  storage: LocalDbStorageInfo;
}

import { dbQueryKeys } from "@/lib/query-options";

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
    gcTime: 5 * 60_000,
    queryFn: async () => {
      const [dbs, est] = await Promise.all([
        ipc.client.db.listLocalDatabases(),
        navigator.storage?.estimate?.() ?? undefined,
      ]);
      return {
        databases: dbs,
        storage: {
          quota: est?.quota ?? null,
          usage: est?.usage ?? null,
        } satisfies LocalDbStorageInfo,
      };
    },
    queryKey: dbQueryKeys.localDatabases(),
    staleTime: 15_000,
  });

  const databases = queryData?.databases ?? [];
  const storage = queryData?.storage ?? { quota: null, usage: null };
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
        autoStart: input.autoStart,
        databaseName: input.databaseName,
        engine: input.engine,
        name: input.name,
        password: input.password,
        port: input.port,
        postgresVersion: input.postgresVersion,
        username: input.username,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: dbQueryKeys.localDatabases() });
    },
  });

  const { mutateAsync: removeMutateAsync } = useMutation(
    // biome-ignore assist/source/useSortedKeys: TanStack Query infers the mutation context type from `onMutate`, so `onError` must not be hoisted above it.
    {
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
        await queryClient.cancelQueries({
          queryKey: dbQueryKeys.localDatabases(),
        });
        const previous = queryClient.getQueryData<{
          databases: LocalDbInfo[];
          storage: LocalDbStorageInfo;
        }>(dbQueryKeys.localDatabases());

        if (previous) {
          queryClient.setQueryData(dbQueryKeys.localDatabases(), {
            ...previous,
            databases: previous.databases.filter((db) => db.id !== id),
          });
        }

        return { previous };
      },
      onError: (_err, _vars, context) => {
        if (context?.previous) {
          queryClient.setQueryData(
            dbQueryKeys.localDatabases(),
            context.previous
          );
        }
      },
      onSuccess: (shouldRefresh) => {
        if (shouldRefresh) {
          queryClient.invalidateQueries({
            queryKey: dbQueryKeys.localDatabases(),
          });
        }
      },
    }
  );

  const { mutateAsync: startMutateAsync } = useMutation(
    // biome-ignore assist/source/useSortedKeys: TanStack Query infers the mutation context type from `onMutate`, so `onError` must not be hoisted above it.
    {
      mutationFn: (id: string) => ipc.client.db.startLocalDatabase({ id }),
      // Optimistic update: mark as running immediately
      onMutate: async (id) => {
        await queryClient.cancelQueries({
          queryKey: dbQueryKeys.localDatabases(),
        });
        const previous = queryClient.getQueryData<{
          databases: LocalDbInfo[];
          storage: LocalDbStorageInfo;
        }>(dbQueryKeys.localDatabases());

        if (previous) {
          queryClient.setQueryData(dbQueryKeys.localDatabases(), {
            ...previous,
            databases: previous.databases.map((db) =>
              db.id === id
                ? { ...db, externally_connectable: false, running: true }
                : db
            ),
          });
        }

        return { previous };
      },
      onError: (_err, _vars, context) => {
        if (context?.previous) {
          queryClient.setQueryData(
            dbQueryKeys.localDatabases(),
            context.previous
          );
        }
      },
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: dbQueryKeys.localDatabases(),
        });
      },
    }
  );

  const { mutateAsync: pauseMutateAsync } = useMutation(
    // biome-ignore assist/source/useSortedKeys: TanStack Query infers the mutation context type from `onMutate`, so `onError` must not be hoisted above it.
    {
      mutationFn: (id: string) => ipc.client.db.stopLocalDatabase({ id }),
      // Optimistic update: mark as stopped immediately
      onMutate: async (id) => {
        await queryClient.cancelQueries({
          queryKey: dbQueryKeys.localDatabases(),
        });
        const previous = queryClient.getQueryData<{
          databases: LocalDbInfo[];
          storage: LocalDbStorageInfo;
        }>(dbQueryKeys.localDatabases());

        if (previous) {
          queryClient.setQueryData(dbQueryKeys.localDatabases(), {
            ...previous,
            databases: previous.databases.map((db) =>
              db.id === id
                ? { ...db, externally_connectable: false, running: false }
                : db
            ),
          });
        }

        return { previous };
      },
      onError: (_err, _vars, context) => {
        if (context?.previous) {
          queryClient.setQueryData(
            dbQueryKeys.localDatabases(),
            context.previous
          );
        }
      },
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: dbQueryKeys.localDatabases(),
        });
      },
    }
  );

  // ── Adapt mutation API to match existing consumer contracts ──────

  const create = useCallback(
    async (input: CreateLocalDbOptions): Promise<LocalDbInfo> => {
      const db = await createMutateAsync(input);
      return db;
    },
    [createMutateAsync]
  );

  const remove = useCallback(
    async (id: string, options?: { refresh?: boolean }): Promise<void> => {
      await removeMutateAsync({ id, refresh: options?.refresh });
    },
    [removeMutateAsync]
  );

  const start = useCallback(
    async (id: string): Promise<void> => {
      await startMutateAsync(id);
    },
    [startMutateAsync]
  );

  const pause = useCallback(
    async (id: string): Promise<void> => {
      await pauseMutateAsync(id);
    },
    [pauseMutateAsync]
  );

  // invalidateCache marks the local databases query as stale so all
  // consumers (including background tabs) get fresh data on next render.
  const invalidateCache = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: dbQueryKeys.localDatabases() });
  }, [queryClient]);

  return {
    create,
    databases,
    error,
    invalidateCache,
    isLoading,
    pause,
    refresh,
    remove,
    start,
    storage,
  };
}
