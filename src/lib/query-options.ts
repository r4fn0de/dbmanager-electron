/**
 * query-options.ts — Centralized queryOption factories for TanStack Query.
 */
import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import {
  getDatabaseInfo,
  getEnums,
  getFunctions,
  getSchemaConstraints,
  getSchemaIndexes,
  getSchemaSummary,
  getTableDetails,
  getTriggers,
  tableListRows,
} from "@/features/database/hooks/db-actions";
import type { TableFilter, TableSort } from "@/ipc/db/types";

export const dbQueryKeys = {
  connections: () => ["connections"] as const,
  databaseInfo: (c: string) => ["db-info", c] as const,
  localDatabases: () => ["local-databases"] as const,
  schemaConstraints: (c: string, s: string) =>
    ["schema-constraints", c, s] as const,
  schemaEnums: (c: string, s: string) => ["schema-enums", c, s] as const,
  schemaFunctions: (c: string, s: string) =>
    ["schema-functions", c, s] as const,
  schemaIndexes: (c: string, s: string) => ["schema-indexes", c, s] as const,
  schemaSummary: (c: string) => ["schema-summary", c] as const,
  schemaTriggers: (c: string, s: string) => ["schema-triggers", c, s] as const,
  selectedSchemaDetails: (c: string, s: string, n: number) =>
    ["selected-schema-details", c, s, n] as const,
  selectedSchemaDetailsPrefix: (c: string) =>
    ["selected-schema-details", c] as const,
  tableDetails: (c: string, s: string, t: string) =>
    ["table-details", c, s, t] as const,
  tableDetailsAll: (c: string) => ["table-details", c] as const,
  tableRows: (
    c: string,
    s: string,
    t: string,
    p: number,
    ps: number,
    sort: TableSort[],
    f: TableFilter[],
    exact = false
  ) => ["table-rows", c, s, t, p, ps, sort, f, exact] as const,
  tableRowsPrefix: (c: string, s: string, t: string) =>
    ["table-rows", c, s, t] as const,
};

export const dbQueryOptions = {
  databaseInfo: (c: string) =>
    queryOptions({
      gcTime: 30 * 60_000,
      queryFn: () => getDatabaseInfo(c),
      queryKey: dbQueryKeys.databaseInfo(c),
      staleTime: 5 * 60_000,
    }),
  schemaConstraints: (c: string, s: string, enabled = true) =>
    queryOptions({
      enabled,
      gcTime: 15 * 60_000,
      placeholderData: keepPreviousData,
      queryFn: () => getSchemaConstraints(c, s),
      queryKey: dbQueryKeys.schemaConstraints(c, s),
      staleTime: 10 * 60_000,
    }),
  schemaEnums: (c: string, s: string, enabled = true) =>
    queryOptions({
      enabled,
      gcTime: 15 * 60_000,
      placeholderData: keepPreviousData,
      queryFn: () => getEnums(c, s),
      queryKey: dbQueryKeys.schemaEnums(c, s),
      staleTime: 10 * 60_000,
    }),
  schemaFunctions: (c: string, s: string, enabled = true) =>
    queryOptions({
      enabled,
      gcTime: 15 * 60_000,
      placeholderData: keepPreviousData,
      queryFn: () => getFunctions(c, s),
      queryKey: dbQueryKeys.schemaFunctions(c, s),
      staleTime: 10 * 60_000,
    }),
  schemaIndexes: (c: string, s: string, enabled = true) =>
    queryOptions({
      enabled,
      gcTime: 15 * 60_000,
      placeholderData: keepPreviousData,
      queryFn: () => getSchemaIndexes(c, s),
      queryKey: dbQueryKeys.schemaIndexes(c, s),
      staleTime: 10 * 60_000,
    }),
  schemaSummary: (c: string, enabled = true) =>
    queryOptions({
      enabled,
      gcTime: 30 * 60_000,
      queryFn: () => getSchemaSummary(c),
      queryKey: dbQueryKeys.schemaSummary(c),
      refetchOnWindowFocus: false,
      retry: 0,
      staleTime: 5 * 60_000,
    }),
  schemaTriggers: (c: string, s: string, enabled = true) =>
    queryOptions({
      enabled,
      gcTime: 15 * 60_000,
      placeholderData: keepPreviousData,
      queryFn: () => getTriggers(c, s),
      queryKey: dbQueryKeys.schemaTriggers(c, s),
      staleTime: 10 * 60_000,
    }),
  tableDetails: (c: string, s: string, t: string, enabled = true) =>
    queryOptions({
      enabled,
      gcTime: 15 * 60_000,
      queryFn: () => getTableDetails(c, s, t),
      queryKey: dbQueryKeys.tableDetails(c, s, t),
      staleTime: 2 * 60_000,
    }),
  tableRows: (
    c: string,
    s: string,
    t: string,
    p: number,
    ps: number,
    sort: TableSort[],
    f: TableFilter[],
    exact = false
  ) =>
    queryOptions({
      gcTime: 10 * 60_000,
      placeholderData: keepPreviousData,
      queryFn: () =>
        tableListRows({
          exact,
          filters: f,
          page: p + 1,
          pageSize: ps,
          sort,
          tableRef: { connectionId: c, schema: s, table: t },
        }),
      queryKey: dbQueryKeys.tableRows(c, s, t, p, ps, sort, f, exact),
      staleTime: 5 * 60_000,
    }),
};
