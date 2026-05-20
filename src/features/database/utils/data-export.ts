import type { DdlScript } from "@/ipc/db/types";

export type ExportFormat = "sql" | "csv" | "json" | "markdown";

export interface ExportLayerPayload {
  metadata: {
    scope: "table" | "schema";
    schema: string;
    table?: string;
    generatedAt: string;
  };
  layers: {
    schema: DdlScript[];
    indexes: DdlScript[];
    data: Array<{
      schema: string;
      table: string;
      columns: string[];
      rows: Record<string, unknown>[];
    }>;
  };
}

export function buildExportFileName(payload: ExportLayerPayload, format: ExportFormat): string {
  const suffix = payload.metadata.scope === "table" ? `${payload.metadata.schema}.${payload.metadata.table}` : payload.metadata.schema;
  return `db-export-${suffix}.${format === "markdown" ? "md" : format}`;
}

function toSqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function toCsvValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  const raw = String(value);
  if (raw.includes(",") || raw.includes('"') || raw.includes("\n")) {
    return `"${raw.replaceAll('"', '""')}"`;
  }
  return raw;
}

export function serializeExport(payload: ExportLayerPayload, format: ExportFormat): string {
  if (format === "json") {
    return JSON.stringify(payload, null, 2);
  }

  if (format === "sql") {
    const chunks: string[] = [];
    for (const script of payload.layers.schema) chunks.push(script.sql.endsWith(";") ? script.sql : `${script.sql};`);
    for (const script of payload.layers.indexes) chunks.push(script.sql.endsWith(";") ? script.sql : `${script.sql};`);

    for (const dataSet of payload.layers.data) {
      for (const row of dataSet.rows) {
        const columns = dataSet.columns.map((column) => `"${column}"`).join(", ");
        const values = dataSet.columns.map((column) => toSqlLiteral(row[column])).join(", ");
        chunks.push(`INSERT INTO "${dataSet.schema}"."${dataSet.table}" (${columns}) VALUES (${values});`);
      }
    }

    return chunks.join("\n");
  }

  if (format === "csv") {
    const chunks: string[] = [];
    for (const dataSet of payload.layers.data) {
      chunks.push(`# ${dataSet.schema}.${dataSet.table}`);
      chunks.push(dataSet.columns.join(","));
      for (const row of dataSet.rows) {
        chunks.push(dataSet.columns.map((column) => toCsvValue(row[column])).join(","));
      }
      chunks.push("");
    }
    return chunks.join("\n");
  }

  const lines: string[] = [
    `# Database export`,
    ``,
    `- Scope: ${payload.metadata.scope}`,
    `- Schema: ${payload.metadata.schema}`,
    payload.metadata.table ? `- Table: ${payload.metadata.table}` : "- Table: all",
    `- Generated at: ${payload.metadata.generatedAt}`,
    "",
    "## Schema",
  ];

  for (const script of payload.layers.schema) {
    lines.push(`### ${script.schema}.${script.name}`);
    lines.push("```sql");
    lines.push(script.sql);
    lines.push("```");
  }

  lines.push("", "## Indexes");
  for (const script of payload.layers.indexes) {
    lines.push(`### ${script.schema}.${script.name}`);
    lines.push("```sql");
    lines.push(script.sql);
    lines.push("```");
  }

  lines.push("", "## Data");
  for (const dataSet of payload.layers.data) {
    lines.push(`### ${dataSet.schema}.${dataSet.table}`);
    lines.push(`Rows: ${dataSet.rows.length}`);
  }

  return lines.join("\n");
}
