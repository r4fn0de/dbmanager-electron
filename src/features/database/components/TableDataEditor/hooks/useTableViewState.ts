import {
  useState,
  useMemo,
  useDeferredValue,
  useRef,
  useCallback,
  useEffect,
} from "react";
import type { SchemaColumn, TableSort, TableFilter } from "@/ipc/db/types";

function getDefaultColumnWidth(column: SchemaColumn): number {
  const name = column.name.toLowerCase();
  const type = column.data_type.toLowerCase();
  const udt = (column.udt_name ?? "").toLowerCase();

  if (/(^|_)id$/.test(name) || /(^|_)id_/.test(name)) return 140;
  if (/(bool)/.test(type)) return 80;
  if (/(timestamp|timestamptz)/.test(type)) return 170;
  if (/(date)/.test(type)) return 100;
  if (/(time)/.test(type)) return 90;
  if (/(uuid)/.test(type)) return 220;
  if (/(json|jsonb)/.test(type)) return 200;
  if (/(int|serial|smallint)/.test(type)) return 90;
  if (/(bigint)/.test(type)) return 120;
  if (/(numeric|decimal)/.test(type)) return 120;
  if (/(double|real|float)/.test(type)) return 110;
  if (/(text|varchar|char)/.test(type)) return 150;
  if (/(bytea)/.test(type)) return 180;
  if (/(inet|cidr)/.test(type)) return 130;
  if (/(macaddr)/.test(type)) return 110;
  if (type === "array" || udt.startsWith("_") || type.endsWith("[]"))
    return 180;
  if (type === "user-defined" || type === "USER-DEFINED".toLowerCase())
    return 140;

  return 120;
}

type TableViewState = {
  page: number;
  pageSize: number;
  sort: TableSort[];
  filterColumn: string;
  filterValue: string;
  visibleColumns: string[];
  columnWidths: Record<string, number>;
};

interface UseTableViewStateOptions {
  onTableSwitch?: () => void;
}

export function useTableViewState(
  connectionId: string,
  table: { schema: string; name: string; columns: SchemaColumn[] },
  options?: UseTableViewStateOptions,
) {
  const tableKey = `${connectionId}::${table.schema}.${table.name}`;

  const defaultVisibleColumns = useMemo(
    () => table.columns.map((column) => column.name),
    [table.columns],
  );
  const defaultFilterColumn = table.columns[0]?.name ?? "";

  const viewStateByTableRef = useRef<Map<string, TableViewState>>(new Map());
  const previousTableKeyRef = useRef<string>(tableKey);

  const getInitialViewState = (): TableViewState => {
    const saved = viewStateByTableRef.current.get(tableKey);
    if (saved) return saved;
    return {
      page: 0,
      pageSize: 50,
      sort: [],
      filterColumn: defaultFilterColumn,
      filterValue: "",
      visibleColumns: defaultVisibleColumns,
      columnWidths: {},
    };
  };

  const [page, setPage] = useState<number>(() => getInitialViewState().page);
  const [pageSize, setPageSize] = useState<number>(
    () => getInitialViewState().pageSize,
  );
  const [sort, setSort] = useState<TableSort[]>(
    () => getInitialViewState().sort,
  );
  const [filterColumn, setFilterColumn] = useState<string>(
    () => getInitialViewState().filterColumn,
  );
  const [filterValue, setFilterValue] = useState<string>(
    () => getInitialViewState().filterValue,
  );
  const [showFilters, setShowFilters] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<string[]>(
    () => getInitialViewState().visibleColumns,
  );
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(
    () => getInitialViewState().columnWidths,
  );

  const liveViewStateRef = useRef({
    page,
    pageSize,
    sort,
    filterColumn,
    filterValue,
    visibleColumns,
    columnWidths,
  });
  liveViewStateRef.current = {
    page,
    pageSize,
    sort,
    filterColumn,
    filterValue,
    visibleColumns,
    columnWidths,
  };

  if (previousTableKeyRef.current !== tableKey) {
    viewStateByTableRef.current.set(
      previousTableKeyRef.current,
      liveViewStateRef.current,
    );

    const saved = viewStateByTableRef.current.get(tableKey);
    if (saved) {
      setPage(saved.page);
      setPageSize(saved.pageSize);
      setSort(saved.sort);
      setFilterColumn(saved.filterColumn);
      setFilterValue(saved.filterValue);
      setVisibleColumns(saved.visibleColumns);
      setColumnWidths(saved.columnWidths);
    } else {
      setPage(0);
      setPageSize(50);
      setSort([]);
      setFilterColumn(defaultFilterColumn);
      setFilterValue("");
      setVisibleColumns(defaultVisibleColumns);
      setColumnWidths({});
    }

    options?.onTableSwitch?.();

    previousTableKeyRef.current = tableKey;
  }

  const deferredFilterValue = useDeferredValue(filterValue);

  const serverFilters = useMemo<TableFilter[]>(() => {
    if (!deferredFilterValue.trim() || !filterColumn) return [];
    return [
      {
        column: filterColumn,
        operator: "contains",
        value: deferredFilterValue.trim(),
      },
    ];
  }, [filterColumn, deferredFilterValue]);

  useEffect(() => {
    setPage((current) => (current === 0 ? current : 0));
  }, [sort, filterColumn, deferredFilterValue]);

  const defaultColumnWidths = useMemo(() => {
    const map: Record<string, number> = {};
    for (const column of table.columns) {
      map[column.name] = getDefaultColumnWidth(column);
    }
    return map;
  }, [table.columns]);

  const resolveColumnWidth = useCallback(
    (columnName: string) =>
      columnWidths[columnName] ?? defaultColumnWidths[columnName] ?? 200,
    [columnWidths, defaultColumnWidths],
  );

  const resetViewStateForTable = useCallback(() => {
    setPage(0);
    setPageSize(50);
    setSort([]);
    setFilterColumn(defaultFilterColumn);
    setFilterValue("");
    setVisibleColumns(defaultVisibleColumns);
    setColumnWidths({});
  }, [defaultFilterColumn, defaultVisibleColumns]);

  return {
    page,
    setPage,
    pageSize,
    setPageSize,
    sort,
    setSort,
    filterColumn,
    setFilterColumn,
    filterValue,
    setFilterValue,
    showFilters,
    setShowFilters,
    visibleColumns,
    setVisibleColumns,
    serverFilters,
    columnWidths,
    setColumnWidths,
    resolveColumnWidth,
    resetViewStateForTable,
  };
}
