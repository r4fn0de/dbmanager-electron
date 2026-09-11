import type { TableSort } from "./types";

export interface TableCursor {
  sort: TableSort[];
  values: unknown[];
}

export function encodeTableCursor(
  sort: TableSort[] | undefined,
  row: Record<string, unknown> | undefined
): string | undefined {
  if (!(sort?.length && row && sort.every((item) => item.column in row))) {
    return;
  }

  const payload: TableCursor = {
    sort,
    values: sort.map((item) => row[item.column]),
  };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

export function decodeTableCursor(
  cursor: string | undefined
): TableCursor | null {
  if (!cursor) {
    return null;
  }

  try {
    const decoded = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8")
    ) as Partial<TableCursor>;
    if (
      !Array.isArray(decoded.sort) ||
      decoded.sort.length === 0 ||
      !decoded.sort.every(
        (item) =>
          typeof item?.column === "string" &&
          (item.direction === "asc" || item.direction === "desc")
      ) ||
      !Array.isArray(decoded.values) ||
      decoded.values.length !== decoded.sort.length
    ) {
      return null;
    }
    return decoded as TableCursor;
  } catch {
    return null;
  }
}
