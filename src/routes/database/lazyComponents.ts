import { lazy } from "react";

// ── Lazy-loaded components ──────────────────────────────────────────
// Heavy components (~2MB Monaco + ~150KB xyflow/dagre) and rarely-used
// DDL dialogs are deferred via React.lazy() to reduce initial bundle size.
// All use named exports → re-export as default for React.lazy().

export const SqlEditor = lazy(() => import("@/components/SqlEditor").then((m) => ({ default: m.SqlEditor })));
export const SchemaVisualizer = lazy(() => import("@/components/SchemaVisualizer").then((m) => ({ default: m.SchemaVisualizer })));

export const CreateTableDialog = lazy(() => import("@/components/TableDdlDialogs").then((m) => ({ default: m.CreateTableDialog })));
export const DropTableDialog = lazy(() => import("@/components/TableDdlDialogs").then((m) => ({ default: m.DropTableDialog })));
export const RenameTableDialog = lazy(() => import("@/components/TableDdlDialogs").then((m) => ({ default: m.RenameTableDialog })));
export const AddColumnDialog = lazy(() => import("@/components/TableDdlDialogs").then((m) => ({ default: m.AddColumnDialog })));
export const DropColumnDialog = lazy(() => import("@/components/TableDdlDialogs").then((m) => ({ default: m.DropColumnDialog })));
export const RenameColumnDialog = lazy(() => import("@/components/TableDdlDialogs").then((m) => ({ default: m.RenameColumnDialog })));
export const AlterColumnTypeDialog = lazy(() => import("@/components/TableDdlDialogs").then((m) => ({ default: m.AlterColumnTypeDialog })));
export const SetColumnDefaultDialog = lazy(() => import("@/components/TableDdlDialogs").then((m) => ({ default: m.SetColumnDefaultDialog })));
export const SetColumnNullableDialog = lazy(() => import("@/components/TableDdlDialogs").then((m) => ({ default: m.SetColumnNullableDialog })));
export const CreateSchemaDialog = lazy(() => import("@/components/TableDdlDialogs").then((m) => ({ default: m.CreateSchemaDialog })));
export const CreateIndexDialog = lazy(() => import("@/components/TableDdlDialogs").then((m) => ({ default: m.CreateIndexDialog })));
export const ImportCsvDialog = lazy(() => import("@/components/TableDdlDialogs").then((m) => ({ default: m.ImportCsvDialog })));
export const RlsPoliciesDialog = lazy(() => import("@/components/RlsPoliciesDialog").then((m) => ({ default: m.RlsPoliciesDialog })));
export const ViewDdlDialog = lazy(() => import("@/components/TableDdlDialogs").then((m) => ({ default: m.ViewDdlDialog })));
export const SchemaExportDialog = lazy(() => import("@/components/SchemaExportDialog").then((m) => ({ default: m.SchemaExportDialog })));
export const DefinitionsBrowserPanel = lazy(() => import("@/components/DefinitionsBrowserPanel").then((m) => ({ default: m.DefinitionsBrowserPanel })));
