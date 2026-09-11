import type { Connection, DatabaseType, QueryResult } from "@/ipc/db/types";
import type { SchemaCompletionData } from "@/lib/monaco-sql-setup";

export interface SqlDocument {
  id: string | null;
  sql: string;
  title: string;
  updatedAt: string;
}

export interface SqlRunResult {
  durationMs: number;
  error: string | null;
  id: string;
  query: string;
  result: QueryResult | null;
  rowCount: number;
  status: "success" | "error";
}

export interface SqlTab {
  doc: SqlDocument;
  id: string;
  lastSavedSql: string;
}

export interface SqlEditorProps {
  connections: Connection[];
  dbType?: DatabaseType;
  executeQuery: (
    connectionId: string,
    sql: string,
    requestId?: string
  ) => Promise<QueryResult>;
  insertRequest?: {
    key: string;
    text: string;
  } | null;
  isRouteActive?: boolean;
  loadRequest?: {
    key: string;
    title: string;
    sql: string;
    connectionId: null | string;
  } | null;
  onSelectConnection: (id: string) => void;
  onWorkspaceSidebarResize?: (widthPx: number) => void;
  schemaCompletionData?: SchemaCompletionData;
  schemaContext?: string;
  selectedConnection: string | null;
  showWorkspaceSidebar?: boolean;
}
