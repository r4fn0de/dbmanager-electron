/**
 * React Query hook for the connections list + CRUD mutations.
 *
 * Use this hook when you need the connections data or the ability to
 * save/delete connections (which invalidate the list cache).
 *
 * For all other database operations (executeQuery, getSchemaSummary,
 * createTable, etc.) use the module-level functions from `db-actions`
 * — they cause zero re-renders since they have no React state.
 */
import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ipc } from "@/ipc/manager";
import type { Connection, ConnectionInput } from "@/ipc/db/types";

export const CONNECTIONS_QUERY_KEY = ["connections"] as const;

interface UseConnectionsListReturn {
  connections: Connection[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  saveConnection: (connection: ConnectionInput) => Promise<void>;
  deleteConnection: (
    id: string,
    options?: { refresh?: boolean },
  ) => Promise<void>;
}

export function useConnectionsList(): UseConnectionsListReturn {
  const queryClient = useQueryClient();

  const {
    data: connections = [],
    isLoading,
    error: queryError,
    refetch: queryRefetch,
  } = useQuery({
    queryKey: CONNECTIONS_QUERY_KEY,
    queryFn: () => ipc.client.db.listConnections(),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });

  const error = queryError instanceof Error ? queryError.message : null;

  const refetch = useCallback(async () => {
    await queryRefetch();
  }, [queryRefetch]);

  // Mutations invalidate the connections cache on success
  const { mutateAsync: saveMutateAsync } = useMutation({
    mutationFn: (connection: ConnectionInput) =>
      ipc.client.db.saveConnection({ ...connection }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CONNECTIONS_QUERY_KEY });
    },
  });

  const { mutateAsync: deleteMutateAsync } = useMutation({
    mutationFn: async ({
      id,
      refresh = true,
    }: {
      id: string;
      refresh?: boolean;
    }) => {
      await ipc.client.db.deleteConnection({ id });
      return refresh;
    },
    onSuccess: (refresh) => {
      if (refresh) {
        queryClient.invalidateQueries({ queryKey: CONNECTIONS_QUERY_KEY });
      }
    },
  });

  const saveConnection = useCallback(
    async (connection: ConnectionInput): Promise<void> => {
      try {
        await saveMutateAsync(connection);
      } catch (err) {
        throw new Error(
          err instanceof Error ? err.message : "Failed to save connection",
        );
      }
    },
    [saveMutateAsync],
  );

  const deleteConnection = useCallback(
    async (id: string, options?: { refresh?: boolean }): Promise<void> => {
      try {
        await deleteMutateAsync({
          id,
          refresh: options?.refresh,
        });
      } catch (err) {
        throw new Error(
          err instanceof Error ? err.message : "Failed to delete connection",
        );
      }
    },
    [deleteMutateAsync],
  );

  return {
    connections,
    isLoading,
    error,
    refetch,
    saveConnection,
    deleteConnection,
  };
}
