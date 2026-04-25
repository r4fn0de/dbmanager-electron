import { lazy } from "react";

// ── Lazy-loaded components ──────────────────────────────────────────
// Heavy components (~2MB Monaco + ~150KB xyflow/dagre) and rarely-used
// DDL dialogs are deferred via React.lazy() to reduce initial bundle size.
// All use named exports → re-export as default for React.lazy().

export const SqlEditor = lazy(() => import("@/features/database/components/SqlEditor").then((m) => ({ default: m.SqlEditor })));
export const SchemaVisualizer = lazy(() => import("@/features/database/components/SchemaVisualizer").then((m) => ({ default: m.SchemaVisualizer })));

export const CreateTableDialog = lazy(() => import("@/features/database/components/TableDdlDialogs").then((m) => ({ default: m.CreateTableDialog })));
export const DropTableDialog = lazy(() => import("@/features/database/components/TableDdlDialogs").then((m) => ({ default: m.DropTableDialog })));
export const RenameTableDialog = lazy(() => import("@/features/database/components/TableDdlDialogs").then((m) => ({ default: m.RenameTableDialog })));
export const AddColumnDialog = lazy(() => import("@/features/database/components/TableDdlDialogs").then((m) => ({ default: m.AddColumnDialog })));
export const DropColumnDialog = lazy(() => import("@/features/database/components/TableDdlDialogs").then((m) => ({ default: m.DropColumnDialog })));
export const RenameColumnDialog = lazy(() => import("@/features/database/components/TableDdlDialogs").then((m) => ({ default: m.RenameColumnDialog })));
export const AlterColumnTypeDialog = lazy(() => import("@/features/database/components/TableDdlDialogs").then((m) => ({ default: m.AlterColumnTypeDialog })));
export const SetColumnDefaultDialog = lazy(() => import("@/features/database/components/TableDdlDialogs").then((m) => ({ default: m.SetColumnDefaultDialog })));
export const SetColumnNullableDialog = lazy(() => import("@/features/database/components/TableDdlDialogs").then((m) => ({ default: m.SetColumnNullableDialog })));
export const CreateSchemaDialog = lazy(() => import("@/features/database/components/TableDdlDialogs").then((m) => ({ default: m.CreateSchemaDialog })));
export const CreateIndexDialog = lazy(() => import("@/features/database/components/TableDdlDialogs").then((m) => ({ default: m.CreateIndexDialog })));
export const ImportCsvDialog = lazy(() => import("@/features/database/components/TableDdlDialogs").then((m) => ({ default: m.ImportCsvDialog })));
export const RlsPoliciesDialog = lazy(() => import("@/features/database/components/RlsPoliciesDialog").then((m) => ({ default: m.RlsPoliciesDialog })));
export const ViewDdlDialog = lazy(() => import("@/features/database/components/TableDdlDialogs").then((m) => ({ default: m.ViewDdlDialog })));
export const SchemaExportDialog = lazy(() => import("@/features/database/components/SchemaExportDialog").then((m) => ({ default: m.SchemaExportDialog })));
export const DefinitionsBrowserPanel = lazy(() => import("@/features/database/components/DefinitionsBrowserPanel").then((m) => ({ default: m.DefinitionsBrowserPanel })));
