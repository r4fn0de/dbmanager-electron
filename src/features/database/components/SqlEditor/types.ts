import type { QueryResult, Connection, DatabaseType } from "@/ipc/db/types";
import type { SchemaCompletionData } from "@/lib/monaco-sql-setup";

export interface SqlDocument {
  id: string | null;
  title: string;
  sql: string;
  updatedAt: string;
}

export interface SqlRunResult {
  id: string;
  query: string;
  status: "success" | "error";
  result: QueryResult | null;
  error: string | null;
  durationMs: number;
  rowCount: number;
}

export interface SqlEditorProps {
  connections: Connection[];
  selectedConnection: string | null;
  onSelectConnection: (id: string) => void;
  executeQuery: (connectionId: string, sql: string) => Promise<QueryResult>;
  showWorkspaceSidebar?: boolean;
  onWorkspaceSidebarResize?: (widthPx: number) => void;
  loadRequest?: {
    key: string;
    title: string;
    sql: string;
    connectionId: null | string;
  } | null;
  dbType?: DatabaseType;
  schemaContext?: string;
  schemaCompletionData?: SchemaCompletionData;
  isRouteActive?: boolean;
}
