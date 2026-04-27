/**
 * query-options.ts — Centralized queryOption factories for TanStack Query.
 */
import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import {
  getSchemaSummary, getTableDetails, getSchemaConstraints,
  getSchemaIndexes, getEnums, getFunctions, getTriggers,
  tableListRows, getDatabaseInfo,
} from "@/features/database/hooks/db-actions";
import type { TableSort, TableFilter } from "@/ipc/db/types";

export const dbQueryKeys = {
  schemaSummary: (c: string) => ["schema-summary", c] as const,
  databaseInfo: (c: string) => ["db-info", c] as const,
  tableDetails: (c: string, s: string, t: string) => ["table-details", c, s, t] as const,
  tableDetailsAll: (c: string) => ["table-details", c] as const,
  tableRows: (c: string, s: string, t: string, p: number, ps: number, sort: TableSort[], f: TableFilter[]) =>
    ["table-rows", c, s, t, p, ps, sort, f] as const,
  tableRowsPrefix: (c: string, s: string, t: string) => ["table-rows", c, s, t] as const,
  selectedSchemaDetails: (c: string, s: string, n: number) => ["selected-schema-details", c, s, n] as const,
  selectedSchemaDetailsPrefix: (c: string) => ["selected-schema-details", c] as const,
  schemaConstraints: (c: string, s: string) => ["schema-constraints", c, s] as const,
  schemaEnums: (c: string, s: string) => ["schema-enums", c, s] as const,
  schemaFunctions: (c: string, s: string) => ["schema-functions", c, s] as const,
  schemaIndexes: (c: string, s: string) => ["schema-indexes", c, s] as const,
  schemaTriggers: (c: string, s: string) => ["schema-triggers", c, s] as const,
  connections: () => ["connections"] as const,
  localDatabases: () => ["local-databases"] as const,
};

export const dbQueryOptions = {
  schemaSummary: (c: string, enabled = true) => queryOptions({
    queryKey: dbQueryKeys.schemaSummary(c), queryFn: () => getSchemaSummary(c),
    enabled, staleTime: 5 * 60_000, gcTime: 30 * 60_000,
  }),
  databaseInfo: (c: string) => queryOptions({
    queryKey: dbQueryKeys.databaseInfo(c), queryFn: () => getDatabaseInfo(c),
    staleTime: 60_000, gcTime: 5 * 60_000,
  }),
  tableDetails: (c: string, s: string, t: string, enabled = true) => queryOptions({
    queryKey: dbQueryKeys.tableDetails(c, s, t), queryFn: () => getTableDetails(c, s, t),
    enabled, staleTime: 2 * 60_000, gcTime: 15 * 60_000,
  }),
  tableRows: (c: string, s: string, t: string, p: number, ps: number, sort: TableSort[], f: TableFilter[]) => queryOptions({
    queryKey: dbQueryKeys.tableRows(c, s, t, p, ps, sort, f),
    queryFn: () => tableListRows({ tableRef: { connectionId: c, schema: s, table: t }, page: p + 1, pageSize: ps, sort, filters: f }),
    staleTime: 5 * 60_000, gcTime: 10 * 60_000, placeholderData: keepPreviousData,
  }),
  schemaConstraints: (c: string, s: string, enabled = true) => queryOptions({
    queryKey: dbQueryKeys.schemaConstraints(c, s), queryFn: () => getSchemaConstraints(c, s),
    enabled, staleTime: 10 * 60_000, gcTime: 15 * 60_000, placeholderData: keepPreviousData,
  }),
  schemaEnums: (c: string, s: string, enabled = true) => queryOptions({
    queryKey: dbQueryKeys.schemaEnums(c, s), queryFn: () => getEnums(c, s),
    enabled, staleTime: 10 * 60_000, gcTime: 15 * 60_000, placeholderData: keepPreviousData,
  }),
  schemaFunctions: (c: string, s: string, enabled = true) => queryOptions({
    queryKey: dbQueryKeys.schemaFunctions(c, s), queryFn: () => getFunctions(c, s),
    enabled, staleTime: 10 * 60_000, gcTime: 15 * 60_000, placeholderData: keepPreviousData,
  }),
  schemaIndexes: (c: string, s: string, enabled = true) => queryOptions({
    queryKey: dbQueryKeys.schemaIndexes(c, s), queryFn: () => getSchemaIndexes(c, s),
    enabled, staleTime: 10 * 60_000, gcTime: 15 * 60_000, placeholderData: keepPreviousData,
  }),
  schemaTriggers: (c: string, s: string, enabled = true) => queryOptions({
    queryKey: dbQueryKeys.schemaTriggers(c, s), queryFn: () => getTriggers(c, s),
    enabled, staleTime: 10 * 60_000, gcTime: 15 * 60_000, placeholderData: keepPreviousData,
  }),
};
