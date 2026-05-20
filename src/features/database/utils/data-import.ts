import * as XLSX from "xlsx";

export type ImportFileFormat = "csv" | "json" | "excel";

export interface ParsedImportData {
  headers: string[];
  rows: Record<string, unknown>[];
}

export interface ColumnMappingResult {
  mapping: Record<string, string | null>;
  missingTargetColumns: string[];
  extraSourceColumns: string[];
}

const MAX_PREVIEW_ROWS = 200;

const normalizeName = (value: string): string => value.trim().toLowerCase();

const normalizeCell = (value: unknown): unknown => {
  if (value === "") return null;
  return value;
};

function parseCsvText(input: string): ParsedImportData {
  const rows: string[][] = [];
  let current = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    const next = input[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && ch === ",") {
      row.push(current);
      current = "";
      continue;
    }

    if (!inQuotes && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && next === "\n") i += 1;
      row.push(current);
      current = "";
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      continue;
    }

    current += ch;
  }

  if (current.length > 0 || row.length > 0) {
    row.push(current);
    if (row.some((value) => value.length > 0)) rows.push(row);
  }

  if (rows.length === 0) throw new Error("CSV file is empty");

  const headers = rows[0].map((header) => header.trim());
  if (headers.some((header) => header.length === 0)) {
    throw new Error("CSV header contains empty column names");
  }

  const dataRows: Record<string, unknown>[] = [];
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const sourceRow = rows[rowIndex];
    const nextRow: Record<string, unknown> = {};
    for (let colIndex = 0; colIndex < headers.length; colIndex += 1) {
      const sourceValue = sourceRow[colIndex] ?? "";
      nextRow[headers[colIndex]] = normalizeCell(sourceValue);
    }
    dataRows.push(nextRow);
  }

  return {
    headers,
    rows: dataRows,
  };
}

function parseJsonText(input: string): ParsedImportData {
  const parsed = JSON.parse(input) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("JSON deve ser um array de objetos");
  }

  const rows = parsed as Array<Record<string, unknown>>;
  if (rows.length === 0) {
    return { headers: [], rows: [] };
  }

  const headerSet = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) headerSet.add(key);
  }
  const headers = Array.from(headerSet);

  return {
    headers,
    rows: rows.map((row) => {
      const normalizedRow: Record<string, unknown> = {};
      for (const header of headers) {
        normalizedRow[header] = normalizeCell(row[header]);
      }
      return normalizedRow;
    }),
  };
}

function parseExcelBuffer(input: ArrayBuffer): ParsedImportData {
  const workbook = XLSX.read(input, { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) throw new Error("Planilha sem abas");
  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    raw: true,
  });
  if (rows.length === 0) return { headers: [], rows: [] };

  const headerSet = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) headerSet.add(key);
  }
  const headers = Array.from(headerSet);
  return {
    headers,
    rows: rows.map((row) => {
      const normalizedRow: Record<string, unknown> = {};
      for (const header of headers) {
        normalizedRow[header] = normalizeCell(row[header]);
      }
      return normalizedRow;
    }),
  };
}

export async function parseImportFile(file: File): Promise<ParsedImportData> {
  const fileName = file.name.toLowerCase();

  if (fileName.endsWith(".csv")) {
    return parseCsvText(await file.text());
  }

  if (fileName.endsWith(".json")) {
    return parseJsonText(await file.text());
  }

  if (fileName.endsWith(".xlsx") || fileName.endsWith(".xls")) {
    return parseExcelBuffer(await file.arrayBuffer());
  }

  throw new Error("Unsupported format. Use CSV, JSON, or Excel");
}

export function buildColumnMapping(
  sourceHeaders: string[],
  targetColumns: Array<{ name: string }>,
): ColumnMappingResult {
  const targetByNormalized = new Map<string, string>();
  for (const column of targetColumns) {
    targetByNormalized.set(normalizeName(column.name), column.name);
  }

  const mapping: Record<string, string | null> = {};
  for (const header of sourceHeaders) {
    mapping[header] = targetByNormalized.get(normalizeName(header)) ?? null;
  }

  const mappedTargets = new Set(
    Object.values(mapping).filter((target): target is string => Boolean(target)),
  );

  const missingTargetColumns = targetColumns
    .map((column) => column.name)
    .filter((columnName) => !mappedTargets.has(columnName));

  const extraSourceColumns = sourceHeaders.filter((header) => mapping[header] === null);

  return {
    mapping,
    missingTargetColumns,
    extraSourceColumns,
  };
}

export function applyColumnMapping(
  rows: Record<string, unknown>[],
  mapping: Record<string, string | null>,
): Record<string, unknown>[] {
  return rows.map((row) => {
    const nextRow: Record<string, unknown> = {};
    for (const [sourceColumn, targetColumn] of Object.entries(mapping)) {
      if (!targetColumn) continue;
      nextRow[targetColumn] = normalizeCell(row[sourceColumn]);
    }
    return nextRow;
  });
}

export function inferColumnsFromRows(rows: Record<string, unknown>[]): Array<{ name: string; dataType: string; isNullable: boolean }> {
  const valueByColumn = new Map<string, unknown[]>();
  for (const row of rows) {
    for (const [column, value] of Object.entries(row)) {
      if (!valueByColumn.has(column)) valueByColumn.set(column, []);
      valueByColumn.get(column)?.push(value);
    }
  }

  const inferred: Array<{ name: string; dataType: string; isNullable: boolean }> = [];
  for (const [name, values] of valueByColumn.entries()) {
    const nonNullValues = values.filter((value) => value !== null && value !== undefined);
    const isNullable = nonNullValues.length !== values.length;
    let dataType = "text";

    if (nonNullValues.length > 0) {
      const hasOnlyNumbers = nonNullValues.every((value) => typeof value === "number");
      const hasOnlyBooleans = nonNullValues.every((value) => typeof value === "boolean");
      const hasOnlyDateStrings = nonNullValues.every(
        (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value),
      );

      if (hasOnlyNumbers) {
        dataType = nonNullValues.every((value) => Number.isInteger(value)) ? "integer" : "numeric";
      } else if (hasOnlyBooleans) {
        dataType = "boolean";
      } else if (hasOnlyDateStrings) {
        dataType = "timestamp";
      }
    }

    inferred.push({
      name,
      dataType,
      isNullable,
    });
  }

  return inferred;
}

export function getPreviewRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.slice(0, MAX_PREVIEW_ROWS);
}
