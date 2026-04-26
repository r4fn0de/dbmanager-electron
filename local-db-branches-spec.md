# Local DB Branches — Feature Spec

> PlanetScale-style database branching for embedded PostgreSQL local databases,
> enabling safe schema experimentation and data mutation without risking the main branch.

---

## 1. Overview

### 1.1 Problem

Users working with local databases have no safe way to experiment with schema changes
or risky data mutations. If an `ALTER TABLE` goes wrong or a bulk `UPDATE` breaks data,
the only recovery path is manual undo or recreating the entire database.

### 1.2 Solution

Add **git-like branching** to local PostgreSQL databases. Users can create lightweight
branches from any existing branch, make changes in isolation, and either merge back
to the parent via schema diff or discard the branch entirely.

### 1.3 Target User

Developers who use the local PostgreSQL feature for prototyping, testing migrations,
or exploring data changes before applying them to a real database.

---

## 2. Core Concepts

| Term | Definition |
|------|-----------|
| **Main branch** | The default branch created when a local DB is first created. Always exists. Cannot be deleted while the DB exists. |
| **Branch** | A copy of a parent branch (schema + optional data) stored as a PostgreSQL template database. Has a name, parent, and creation timestamp. |
| **Parent branch** | The branch from which this branch was created. Any branch can be a parent (full tree). |
| **Active branch** | The branch currently connected and being operated on. Only one per local DB at a time. |
| **Merge** | Applying the schema diff between a branch and its parent back to the parent, with conflict resolution. |
| **Schema diff** | The set of DDL statements (ALTER, DROP, CREATE) needed to reconcile two schemas. |

---

## 3. Storage Architecture

### 3.1 PostgreSQL Template Databases

Each branch is stored as a **separate PostgreSQL database** within the same embedded
PostgreSQL instance, created via the `CREATE DATABASE ... TEMPLATE` mechanism:

```sql
-- Creating a branch "feature-add-uuid" from parent "main"
CREATE DATABASE "mydb_feature-add-uuid" TEMPLATE "mydb_main";
```

**Why template databases?**
- **Fast creation**: PostgreSQL copies the template's data files at the filesystem level
  (copy-on-write where supported), making branch creation near-instantaneous for
  schema-only branches.
- **Full isolation**: Each branch is a completely independent database. Changes in one
  branch do not affect any other.
- **Standard PostgreSQL**: No custom extensions or non-standard features required.

### 3.2 Naming Convention

- **Main branch database name**: Uses the existing `LocalDbMeta.database_name` (e.g., `mydb`).
- **Branch database name**: `{main_db_name}__{branch_name}` (e.g., `mydb__feature-add-uuid`).
  - Double underscore (`__`) separates the base name from the branch name.
  - Branch names must be valid PostgreSQL identifiers (letters, digits, underscores,
    must start with a letter or underscore). Invalid characters are replaced with `_`.
  - Maximum length: 63 characters (PostgreSQL identifier limit) minus the base name
    and `__` prefix. If truncated, append a short hash for uniqueness.

### 3.3 Branch Metadata

Branch metadata is stored alongside the existing `LocalDbMeta` in `local-databases.json`:

```typescript
interface BranchMeta {
  /** Unique ID for this branch (UUID) */
  id: string;
  /** User-chosen branch name (e.g., "feature/add-uuid") */
  name: string;
  /** Sanitized branch name used in the PostgreSQL database name */
  dbName: string;
  /** The parent branch ID — "main" for branches off the main branch */
  parentId: string;
  /** ISO timestamp of branch creation */
  createdAt: string;
  /** ISO timestamp of last merge into this branch (if any) */
  lastMergedAt?: string;
  /** Whether this branch is the main/default branch */
  isMain: boolean;
  /** Description/notes for this branch (optional, user-editable) */
  description?: string;
  /** Disk usage in bytes (computed on demand) */
  diskUsageBytes?: number;
}
```

The existing `LocalDbMeta` is extended with:

```typescript
interface LocalDbMeta {
  // ... existing fields ...
  /** Branch metadata for this local DB. Always has at least a "main" entry. */
  branches: BranchMeta[];
  /** The branch ID currently marked as active */
  activeBranchId: string;
}
```

### 3.4 Connection String Resolution

When a user connects to a local DB, the connection string is resolved based on the
active branch:

```
Main branch:    postgresql://user:pass@localhost:PORT/mydb
Feature branch:  postgresql://user:pass@localhost:PORT/mydb__feature-add-uuid
```

All branches share the same PostgreSQL instance (same port, same credentials).
Only the database name in the connection string differs.

---

## 4. Engine Scope

### 4.1 Phase 1: PostgreSQL Only

Branching is implemented exclusively for embedded PostgreSQL local databases in the
first phase. Rationale:

- PostgreSQL has native `CREATE DATABASE ... TEMPLATE` for fast cloning.
- PostgreSQL has `information_schema` for reliable schema diff computation.
- SQLite lacks `CREATE SCHEMA`, has limited `ALTER TABLE` support, and requires
  file-level copies (no copy-on-write).

### 4.2 Phase 2: SQLite (Future)

SQLite branching will be implemented as a simplified variant:

- Branches are full file copies (no copy-on-write available).
- No merge support (manual SQL diff only).
- No schema diff tool (SQLite's `sqlite_master` is harder to diff).
- Creation is slower due to full file copy.
- Only flat branches off main (no tree).

This phase is **not** in scope for the initial implementation.

---

## 5. Branch Lifecycle

### 5.1 Create Branch

**Trigger**: User clicks "New Branch" in the connection list or context menu.

**Flow**:
1. User selects a parent branch (defaults to the currently active branch).
2. User enters a branch name (free-form, validated as a PostgreSQL identifier).
3. User selects which tables should include data (like the Clone dialog):
   - Show a table list with checkboxes and row counts.
   - Unchecked tables get schema-only (empty tables with the same structure).
   - Checked tables get their data copied.
   - Default: all tables schema-only, none with data (fastest creation).
4. System creates the branch database via `CREATE DATABASE ... TEMPLATE`.
5. If selective data was chosen:
   a. Create the branch from template (all data copied).
   b. Truncate tables the user didn't select for data inclusion.
6. Branch metadata is persisted.
7. Connection list updates to show the new branch.

**Validation**:
- Branch name must be unique within this local DB.
- Branch name must be a valid PostgreSQL identifier (or sanitizable to one).
- Parent branch must exist and be running.
- Sufficient disk space must be available.

**Creation speed estimate**:
- Schema-only (no data): < 1 second (template copy + TRUNCATE).
- With data: Proportional to data size (template copy is file-level).

### 5.2 Switch Branch

**Trigger**: User clicks a branch name in the connection list.

**Flow**:
1. If the active branch has unsaved changes (open SQL editor with uncommitted queries),
   show a confirmation dialog:
   - "Switch to branch '{target}'?" with two options:
     - **Switch** — Disconnect from current branch, reconnect to target.
       Unsaved SQL editor content is preserved (editor state is per-connection, not per-branch).
     - **Open in new tab** — Keep current branch connection open, open target branch
       as a new connection tab.
2. If no unsaved changes, switch immediately.
3. The `activeBranchId` is updated in metadata.
4. The connection string is re-resolved to point to the new branch database.

**Implementation detail**: Switching branches is effectively switching the database
name in the connection. The embedded PostgreSQL instance stays running — only the
client connection changes.

### 5.3 Merge Branch

**Trigger**: User clicks "Merge into parent" on a branch.

**Flow**:
1. Compute schema diff between the branch and its parent:
   a. Connect to both databases.
   b. Run schema introspection on both (`getSchema()`).
   c. Compare table structures, columns, indexes, constraints, enums, triggers.
2. Generate DDL migration script:
   - **Added tables**: `CREATE TABLE ...`
   - **Dropped tables**: `DROP TABLE ...` (with confirmation)
   - **Added columns**: `ALTER TABLE ... ADD COLUMN ...`
   - **Dropped columns**: `ALTER TABLE ... DROP COLUMN ...`
   - **Modified columns** (type change, nullable change): `ALTER TABLE ... ALTER COLUMN ...`
   - **Added indexes/constraints**: `CREATE INDEX ...` / `ALTER TABLE ... ADD CONSTRAINT ...`
   - **Dropped indexes/constraints**: `DROP INDEX ...` / `ALTER TABLE ... DROP CONSTRAINT ...`
   - **Added enums**: `CREATE TYPE ...`
   - **Dropped enums**: `DROP TYPE ...`
3. Present the migration script to the user in a **Merge Preview Dialog**:
   - Show each DDL statement with its category (add/drop/modify).
   - Color-code: green for additions, red for removals, yellow for modifications.
   - Allow the user to **uncheck** individual statements to skip them.
4. **Conflict detection**:
   - If the parent has also changed since the branch was created, detect conflicts:
     - Both renamed the same column differently → conflict.
     - Both modified the same column's type → conflict.
     - Branch dropped a column that the parent modified → conflict.
   - Show conflicts in the preview dialog with a warning icon.
   - **Require manual resolution**: The user must choose which version wins for each
     conflict before proceeding. Options: "Use branch version", "Keep parent version",
     or "Custom SQL".
5. User confirms → DDL is executed on the parent branch.
6. Branch is optionally deleted after successful merge (user choice).

### 5.4 Delete Branch

**Trigger**: User clicks "Delete branch" in the branch context menu.

**Flow**:
1. Confirm deletion with the user.
2. If the branch is currently active, switch to main first.
3. Drop the branch database: `DROP DATABASE "mydb__branch-name"`.
4. Remove branch metadata from `LocalDbMeta.branches`.
5. Update the connection list.

**Constraints**:
- The main branch cannot be deleted.
- If the branch has child branches, show a warning and offer to either:
  - Delete all child branches too (cascading).
  - Re-parent child branches to the main branch.

### 5.5 Delete Local DB (with branches)

When deleting a local DB that has branches:

1. All branches are dropped along with the parent PostgreSQL instance.
2. No special prompting — cascading delete is the default (like deleting a git repo).
3. The PostgreSQL instance is stopped and its data directory is removed.
4. Branch metadata is removed along with the `LocalDbMeta`.

---

## 6. UI Design

### 6.1 Connection List (Home Page)

Branches appear as **expandable sub-items** under the local DB connection:

```
▼ 🐘 my-local-db (main)            ● running
    ● main                          [active]
    ○ feature/add-uuid              2h ago
    ○ experiment/new-index          1d ago
    ▼ experiment/new-index
      ○ sub-experiment              3h ago
  ▶ 🐀 other-local-db (main)       ● running
```

- **Expand/collapse**: Click the arrow or the connection name to expand/collapse branches.
- **Active indicator**: The active branch shows a filled dot (●) and "[active]" label.
- **Non-active branches**: Show an empty dot (○) and relative creation time.
- **Tree indentation**: Child branches are indented under their parent.
- **Click action**: Clicking a non-active branch triggers the switch flow (see 5.2).
- **Context menu**: Right-click on a branch shows:
  - New Branch (from this branch)
  - Merge into Parent
  - Rename Branch
  - Delete Branch
  - Copy Connection String
- **Branch badge**: The connection row shows the active branch name as a badge
  (e.g., `main` or `feature/add-uuid`).

### 6.2 Create Branch Dialog

A dialog similar to the existing `CloneToLocalDialog`:

- **Parent branch**: Dropdown showing all branches (default: active branch).
- **Branch name**: Free-form text input with validation.
- **Data inclusion**: Table selection list with checkboxes (like Clone dialog):
  - "Schema only (fastest)" — default radio option.
  - "Include data for selected tables" — shows table list.
- **Description** (optional): A text input for branch notes.
- **Create** button.

### 6.3 Merge Preview Dialog

A dialog showing the schema diff and migration script:

- **Header**: "Merge 'feature/add-uuid' into 'main'"
- **Summary**: "3 additions, 1 modification, 0 removals"
- **DDL script preview**: Scrollable list of DDL statements with:
  - Checkbox to include/exclude each statement.
  - Color-coded category (add/modify/drop).
  - Expandable to show full SQL.
- **Conflicts section** (if any): List of conflicts requiring resolution.
  - Each conflict shows branch vs parent side-by-side.
  - Radio buttons: "Use branch", "Keep parent", "Custom SQL".
- **Action buttons**: "Merge" (confirm), "Cancel".

### 6.4 Branch Switch Confirmation

A small dialog:

- "You have unsaved changes in the SQL editor."
- Two buttons:
  - **Switch** — Disconnect and reconnect to the target branch.
  - **Open in new tab** — Keep current, open target in new tab.

### 6.5 Disk Usage Warning

When creating a branch or when disk usage is high:

- Show estimated disk usage per branch.
- Warn when total local DB disk usage exceeds a configurable threshold
  (default: 500 MB per branch, or 2 GB total for all branches of one local DB).
- Warning is non-blocking (informational only, doesn't prevent creation).

---

## 7. AI Integration

### 7.1 Branch Context in System Prompt

When the user is connected to a branch (not main), the AI system prompt includes:

```
You are currently connected to branch "feature/add-uuid" of local database "my-local-db".
The parent branch is "main". Changes you make here only affect this branch.

If the user asks to apply changes to the main/production database, remind them that
they are on a development branch and suggest merging back to main when ready.
```

### 7.2 Branch-Aware Tool Behavior

- When on a non-main branch, the AI can mention the branch name in its responses
  for clarity (e.g., "I've created the `uuid` column on branch `feature/add-uuid`.").
- When on the main branch, the AI should warn before destructive operations
  (this is already implemented via the tool approval flow).
- Future enhancement: branch-level approval rules (auto-approve on dev branches,
  require approval on main). **Not in scope for Phase 1.**

---

## 8. Schema Diff Algorithm

### 8.1 Diff Computation

The schema diff is computed by comparing the output of `getSchema()` (or
`getSchemaSummary()` for performance) between the branch and its parent:

```
branchSchema = getSchema(branchConnectionString)
parentSchema = getSchema(parentConnectionString)
diff = computeSchemaDiff(parentSchema, branchSchema)
```

### 8.2 Diff Categories

| Category | Detection Logic | Generated DDL |
|----------|----------------|---------------|
| Table added | Table exists in branch but not parent | `CREATE TABLE ...` |
| Table dropped | Table exists in parent but not branch | `DROP TABLE ...` |
| Table renamed | Same table structure, different name | `ALTER TABLE ... RENAME TO ...` |
| Column added | Column exists in branch table but not parent | `ALTER TABLE ... ADD COLUMN ...` |
| Column dropped | Column exists in parent table but not branch | `ALTER TABLE ... DROP COLUMN ...` |
| Column type changed | Same column name, different data type | `ALTER TABLE ... ALTER COLUMN ... TYPE ...` |
| Column nullable changed | Same column, different `is_nullable` | `ALTER TABLE ... ALTER COLUMN ... SET/DROP NOT NULL` |
| Column default changed | Same column, different `column_default` | `ALTER TABLE ... ALTER COLUMN ... SET/DROP DEFAULT` |
| Index added | Index exists in branch but not parent | `CREATE INDEX ...` |
| Index dropped | Index exists in parent but not branch | `DROP INDEX ...` |
| Constraint added | Constraint exists in branch but not parent | `ALTER TABLE ... ADD CONSTRAINT ...` |
| Constraint dropped | Constraint exists in parent but not branch | `ALTER TABLE ... DROP CONSTRAINT ...` |
| Enum added | Enum type exists in branch but not parent | `CREATE TYPE ...` |
| Enum dropped | Enum type exists in parent but not branch | `DROP TYPE ...` |
| Enum modified | Same enum name, different values | Add new values / rename (PostgreSQL doesn't support removing enum values) |

### 8.3 Conflict Detection

A **conflict** occurs when both the branch and the parent have modified the same
schema element in different ways since the branch was created:

| Conflict | Detection | Resolution options |
|----------|-----------|-------------------|
| Column type changed in both | Same column, both changed type | Use branch type / Keep parent type / Custom SQL |
| Column renamed in both | Same column position, different names | Use branch name / Keep parent name / Custom SQL |
| Column dropped in branch, modified in parent | Column missing in branch, changed in parent | Drop column (branch intent) / Keep with parent changes / Custom |
| Column added in branch, same name added differently in parent | Same column name, different definition in both | Use branch definition / Keep parent definition / Custom SQL |

Conflict detection requires tracking what changed since branch creation. For Phase 1,
we use a **simplified approach**: compare the current state of both schemas directly.
If the same element differs from the branch AND the parent has also changed relative
to the branch creation snapshot, it's a conflict.

**Phase 1 limitation**: Without storing the schema at branch creation time, we cannot
reliably detect "parent changed since branch was created". We approximate by:
1. Storing a schema hash at branch creation time.
2. Comparing current parent schema hash vs stored hash.
3. If parent hash changed, compute what changed and check for overlaps with branch changes.

---

## 9. IPC API

### 9.1 New oRPC Endpoints

Add the following endpoints to `src/ipc/db/` router:

```typescript
// Branch CRUD
db.createBranch({ localDbId, parentBranchId, name, dataTables, description })
db.deleteBranch({ localDbId, branchId })
db.renameBranch({ localDbId, branchId, newName })
db.switchBranch({ localDbId, branchId })  // Updates activeBranchId

// Branch info
db.listBranches({ localDbId }): BranchInfo[]
db.getBranchInfo({ localDbId, branchId }): BranchInfo
db.getBranchDiskUsage({ localDbId, branchId }): { bytes: number, formatted: string }

// Merge
db.computeSchemaDiff({ localDbId, sourceBranchId, targetBranchId }): SchemaDiffResult
db.mergeBranch({ localDbId, sourceBranchId, targetBranchId, selectedStatements, conflictResolutions }): MergeResult
```

### 9.2 Types

```typescript
interface BranchInfo {
  id: string;
  name: string;
  parentId: string;
  isMain: boolean;
  isActive: boolean;
  createdAt: string;
  lastMergedAt?: string;
  description?: string;
  databaseName: string;  // The PostgreSQL database name for this branch
  connectionString: string;
  diskUsageBytes?: number;
}

interface SchemaDiffResult {
  statements: DiffStatement[];
  conflicts: SchemaConflict[];
  summary: { added: number; modified: number; removed: number };
}

interface DiffStatement {
  id: string;
  category: "table" | "column" | "index" | "constraint" | "enum";
  operation: "add" | "drop" | "modify";
  sql: string;
  description: string;  // Human-readable, e.g., "Add column 'uuid' to table 'users'"
  isConflict: boolean;
  conflictId?: string;
}

interface SchemaConflict {
  id: string;
  elementName: string;
  elementType: "column" | "index" | "constraint" | "enum";
  description: string;
  branchChange: string;
  parentChange: string;
  suggestedResolution?: "use_branch" | "use_parent";
}

interface MergeResult {
  success: boolean;
  appliedStatements: number;
  errors: Array<{ sql: string; error: string }>;
}
```

---

## 10. Implementation Phases

### Phase 1 — Core Branching (MVP)

**Goal**: Create, switch, and delete branches. No merge yet.

- [ ] Extend `LocalDbMeta` with `branches` and `activeBranchId` fields.
- [ ] Implement `createBranch` in `LocalDbManager` using `CREATE DATABASE ... TEMPLATE`.
- [ ] Implement `deleteBranch` in `LocalDbManager`.
- [ ] Implement `switchBranch` in `LocalDbManager` (update active branch + reconnect).
- [ ] Implement `listBranches`, `getBranchInfo` in `LocalDbManager`.
- [ ] Add oRPC endpoints for branch CRUD.
- [ ] Add branch UI to the connection list (expandable sub-items).
- [ ] Add "Create Branch" dialog with table selection for data.
- [ ] Add branch switching confirmation dialog.
- [ ] Update `metaToInfo` to resolve connection string based on active branch.
- [ ] Update `connection-store.ts` to handle branch-specific connection strings.
- [ ] Add AI system prompt branch context.
- [ ] Add branch name validation and sanitization.
- [ ] Write unit tests for `LocalDbManager` branch operations.
- [ ] Write E2E tests for branch creation/switching UI.

### Phase 2 — Merge & Schema Diff

**Goal**: Merge branches back to parent via schema diff.

- [ ] Implement `computeSchemaDiff` — diff two schemas and generate DDL.
- [ ] Implement `mergeBranch` — execute selected DDL statements on target branch.
- [ ] Implement conflict detection algorithm.
- [ ] Add Merge Preview Dialog UI.
- [ ] Add conflict resolution UI in Merge Preview.
- [ ] Store schema hash at branch creation time for conflict detection.
- [ ] Add disk usage tracking per branch.
- [ ] Write unit tests for schema diff algorithm.
- [ ] Write integration tests for merge flow.

### Phase 3 — Polish & Advanced Features

**Goal**: Refinements and power-user features.

- [ ] Branch-level AI approval rules (auto-approve on dev branches).
- [ ] SQLite branch support (full file copy, no merge).
- [ ] Branch comparison view (side-by-side schema browser).
- [ ] Branch activity log (track schema changes over time).
- [ ] Export branch as SQL dump.
- [ ] Re-parent branches (move a branch to a different parent).

---

## 11. Edge Cases & Constraints

### 11.1 PostgreSQL Template Database Limitations

- **Template databases must not have active connections** when being used as a template.
  Solution: Close all connections to the parent branch before creating the branch,
  then reconnect.
- **`datistemplate` flag**: The source database must be marked as a template
  (`ALTER DATABASE ... IS_TEMPLATE true`) or the user must have the `CREATEDB` privilege.
  We mark all branch databases as templates.
- **Concurrent branch creation**: Only one `CREATE DATABASE ... TEMPLATE` can run
  at a time per PostgreSQL instance. Serialize branch creation requests.

### 11.2 Connection Management

- When switching branches, **all cached Kysely instances and driver connections**
  for the old branch must be closed before the switch and re-created for the new branch.
- The `connection-store` must resolve the correct database name based on the active
  branch when constructing connection strings.
- Multiple tabs may be connected to different branches of the same local DB simultaneously
  (if user chose "Open in new tab"). Each tab has its own connection.

### 11.3 Backward Compatibility

- Existing local databases (created before branching was added) automatically get
  a `main` branch on first access. Migration happens in `normalizeMetaList()`.
- The `branches` array defaults to `[{ id: "main", name: "main", isMain: true, ... }]`
  if not present in the stored metadata.
- The `activeBranchId` defaults to `"main"` if not present.

### 11.4 Disk Space

- Each branch is a full database copy. Large databases (100MB+) can quickly consume
  disk space with multiple branches.
- Show disk usage per branch and total in the connection list.
- Warn (non-blocking) when creating a branch from a large database.
- Future: explore PostgreSQL tablespace features for shared storage optimization.

### 11.5 PostgreSQL Instance Lifecycle

- The embedded PostgreSQL instance is shared across all branches of the same local DB.
- Starting the local DB starts the PostgreSQL instance once; all branch databases
  become accessible immediately.
- Stopping the local DB stops the instance; all branch connections are lost.
- Deleting the local DB drops all branch databases and removes the data directory.

---

## 12. Naming Validation

Branch names must be valid PostgreSQL identifiers after sanitization:

```
Valid:   feature-add-uuid, experiment, v2_schema, _private
Invalid: 123abc (starts with digit), my branch (space), drop-table (hyphen → underscore)
```

**Sanitization rules**:
1. Replace hyphens (`-`) with underscores (`_`).
2. Replace spaces and special characters with underscores.
3. If the name starts with a digit, prepend `_`.
4. Truncate to fit within the 63-char PostgreSQL limit minus the base name and `__` prefix.
5. If truncation causes a name collision, append a 4-char hash.

---

## 13. File Changes Summary

### New Files

| File | Purpose |
|------|---------|
| `src/features/localDb/components/BranchList.tsx` | Branch sub-items in connection list |
| `src/features/localDb/components/CreateBranchDialog.tsx` | Dialog for creating a new branch |
| `src/features/localDb/components/MergePreviewDialog.tsx` | Dialog for merge preview + conflict resolution |
| `src/features/localDb/components/BranchSwitchConfirmDialog.tsx` | Confirmation dialog for switching branches |
| `src/features/localDb/hooks/useBranches.ts` | React hook for branch CRUD operations |
| `src/features/localDb/hooks/useSchemaDiff.ts` | React hook for computing schema diffs |
| `src/ipc/db/branch-manager.ts` | Core branch management logic in LocalDbManager |
| `src/ipc/db/schema-diff.ts` | Schema diff computation algorithm |
| `src/ipc/db/schemas.ts` (extend) | Zod schemas for branch IPC endpoints |
| `src/tests/unit/branch-manager.test.ts` | Unit tests for branch operations |
| `src/tests/unit/schema-diff.test.ts` | Unit tests for schema diff algorithm |

### Modified Files

| File | Changes |
|------|---------|
| `src/ipc/db/local-db-manager.ts` | Add branch CRUD methods, extend `LocalDbMeta` with `branches` |
| `src/ipc/db/types.ts` | Add `BranchMeta`, `BranchInfo`, schema diff types |
| `src/ipc/db/handlers.ts` | Add oRPC handlers for branch endpoints |
| `src/ipc/db/schemas.ts` | Add Zod schemas for branch input/output validation |
| `src/features/localDb/hooks/useLocalDatabases.ts` | Integrate branch operations |
| `src/features/localDb/index.ts` | Export new components and hooks |
| `src/features/connection/components/ConnectionList.tsx` | Add branch sub-items UI |
| `src/features/connection/components/ConnectionTabs.tsx` | Handle branch connections in tabs |
| `src/components/TitleBar.tsx` | Show active branch in title bar |
| `src/ipc/ai/streaming.ts` | Add branch context to AI system prompt |
| `src/routes/index.tsx` | Wire up branch UI to home page |
| `src/components/icons/Branch.tsx` | May need styling updates for branch UI |

---

## 14. Open Questions

1. **Should we store a schema snapshot at branch creation time?** This enables accurate
   conflict detection but adds storage overhead. Alternative: only store a hash and
   recompute the diff on demand.

2. **Should branches support "squash merge"** (collapse all branch changes into a single
   migration)? Or only "rebase merge" (apply individual changes)?

3. **How should the branch tree be visualized in the connection list for deep nesting?**
   Indentation can become unwieldy with 3+ levels.

4. **Should we support "cherry-picking" specific changes from a branch** without merging
   the entire branch? This is a common git workflow but adds significant UI complexity.

5. **What about data merge?** Phase 1 only handles schema merge. Data merge (syncing
   row changes between branches) is much harder and may be out of scope entirely.
