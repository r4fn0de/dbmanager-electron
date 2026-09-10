# SQL Workspace Upgrade — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade the existing SQL workspace (saved queries + history) from a localStorage-only renderer feature into a main-process-persisted workspace, and close the feature gaps: deduplicated history, favoriting straight from history, "run now"/"open in new tab"/"copy" row actions, an "all connections" view, snippet variables, and export/import/clear management.

**Current state (exists today, keep as base):**
- `src/features/database/hooks/useSqlWorkspace.ts` persists `SqlSavedQuery[]` and `SqlHistoryEntry[]` per connection in localStorage under `sql-workspace-v1` (HISTORY_LIMIT = 200). The SqlEditor sidebar already has Saved / History / Items tabs, search, rename/delete saved queries, and hydrating history (with cached result preview) into the active tab.

**Architecture:** Move persistence to an `electron-store` JSON file in the main process (same pattern as `src/ipc/ai/connections-store.ts` and `src/ipc/ai/config.ts`), exposed through a new oRPC `workspace` module aggregated in `src/ipc/router.ts` (same pattern as `src/ipc/ai/index.ts`). The renderer keeps a thin typed actions module (`workspace-actions.ts`, mirroring `src/features/ai/hooks/ai-actions.ts`) and `useSqlWorkspace` is rewritten to call oRPC while preserving its current return API so `SqlEditor.tsx` churn stays minimal. One-time migration imports the existing localStorage payload into the store, then removes the localStorage key.

**Tech Stack:** Electron 41 (main process), electron-store (already a dependency), oRPC + Zod 4 (existing conventions), React 19 + TanStack Query where helpful, Vitest + jsdom with `vi.mock("electron-store")`, Playwright, Biome/Ultracite, `bun` only.

**Scope decisions:**
- Snippet variable syntax: `{{name:default}}` (e.g. `{{limit:100}}`). Extracted on save; filled via a dialog before Run / Open in new tab / Insert when variables exist.
- "Favorite" = starred history entry upserts into saved queries and marks it `isFavorite`; unstarring removes the flag (and the saved entry if it was auto-created).
- Dedup rule: appending a history entry whose `executedSql` + `status` match the most recent entry for the same connection updates that entry in place instead of inserting a duplicate.
- Global view lists entries across all connections; each entry keeps its `connectionId` so hydrating switches the active connection.
- No new major dependencies. No changes to `src/features/shell/preload.ts`.

---

### Task 1: Define workspace contracts and shared types

**Files:**
- Create: `src/shared/workspace/workspace-contracts.ts`
- Test: `src/tests/unit/shared/workspace/workspace-contracts.test.ts`

**Step 1: Write the failing schema/type tests**

Cover:
- `SqlSavedQuery` with id, title, sql, connectionId, `isFavorite` (default false), `variables` (derived, optional), updatedAt;
- `SqlHistoryEntry` with id, connectionId, sqlPreview, executedSql, status (`success` | `error`), rowCount, durationMs, createdAt, optional errorMessage and resultPreview (columns/rows/row_count);
- `WorkspaceStorage` versioned at 2 with `savedByConnection` and `historyByConnection` records;
- variable extraction for `{{name}}`, `{{name:default}}`, whitespace inside braces, and rejection of invalid names;
- rejection of empty ids, unknown statuses, negative rowCount/durationMs, and SQL longer than a sane cap.

Run: `bun run test:unit -- src/tests/unit/shared/workspace/workspace-contracts.test.ts`

Expected: FAIL because the module does not exist yet.

**Step 2: Implement the contracts**

Add canonical TypeScript interfaces and Zod 4 schemas. Keep field names compatible with the existing `SqlSavedQuery`/`SqlHistoryEntry` shapes in `useSqlWorkspace.ts` (id, title, sql, connectionId, updatedAt, sqlPreview, executedSql, status, rowCount, durationMs, createdAt, errorMessage?, resultPreview?) and extend with `isFavorite` and `variables` without making old fields required.

**Step 3: Run the focused tests**

Run: `bun run test:unit -- src/tests/unit/shared/workspace/workspace-contracts.test.ts`

Expected: PASS.

**Step 4: Commit**

```bash
git add src/shared/workspace/workspace-contracts.ts src/tests/unit/shared/workspace/workspace-contracts.test.ts
git commit -m "feat: define SQL workspace contracts"
```

---

### Task 2: Add the main-process workspace store with migration and dedup

**Files:**
- Create: `src/ipc/workspace/workspace-store.ts`
- Test: `src/tests/unit/ipc/workspace/workspace-store.test.ts`

**Step 1: Write the failing store tests**

Mock `electron-store` (same fixture pattern as `src/tests/unit/ipc/ai/connections-store.test.ts`) and test:
- empty storage returns empty lists for any connection;
- `saveQuery` upserts by id, sorts by updatedAt desc, and strips empty titles to "Untitled";
- `deleteQuery` / `renameQuery` only affect the target connection;
- `appendHistory` prepends, caps at 200, and **dedups**: an identical `executedSql` + `status` as the latest entry bumps createdAt/durationMs/rowCount/resultPreview instead of duplicating;
- `setHistoryFavorite(connectionId, historyId, true)` upserts the starred entry into saved queries with `isFavorite: true`; `false` removes the flag and removes the saved entry when it was auto-created;
- `clearHistory(connectionId)` and `clearAllHistory()`;
- `importWorkspace` replaces all data and validates it through the contracts;
- migration is idempotent and only imports when the store is empty.

**Step 2: Implement the store**

Use a single `new Store<WorkspaceStorage>()` with schema version 2. Provide:
- `listSaved(connectionId: string | null)`, `listHistory(connectionId: string | null)` (null = all connections, entries keep their `connectionId`);
- `saveQuery(input)`, `deleteQuery(id, connectionId)`, `renameQuery(id, title, connectionId)`;
- `appendHistory(input)` with the dedup rule above;
- `setHistoryFavorite(...)`, `clearHistory(connectionId?)`, `exportWorkspace()`, `importWorkspace(payload)`, `migrateFromLocalStorage(payload)`.

Keep mutation helpers private (`readStorage`/`writeStorage`-style) so every write persists atomically through electron-store.

**Step 3: Run the focused tests**

Run: `bun run test:unit -- src/tests/unit/ipc/workspace/workspace-store.test.ts`

Expected: PASS.

**Step 4: Commit**

```bash
git add src/ipc/workspace/workspace-store.ts src/tests/unit/ipc/workspace/workspace-store.test.ts
git commit -m "feat: persist SQL workspace in main process"
```

---

### Task 3: Add the oRPC workspace module

**Files:**
- Create: `src/ipc/workspace/handlers.ts`
- Create: `src/ipc/workspace/index.ts`
- Modify: `src/ipc/router.ts`
- Test: `src/tests/unit/ipc/workspace/handlers.test.ts`

**Step 1: Write the failing handler tests**

Follow the `connection-handlers.ts` style (`os.handler`, `os.input(zod).handler`, `ORPCError` with `BAD_REQUEST`/`NOT_FOUND`). Mock the store module and cover:
- list/save/delete/rename round-trips;
- appendHistory input validation rejects unknown status or missing connectionId;
- setHistoryFavorite on a missing history id throws `NOT_FOUND`;
- exportWorkspace returns the serialized storage; importWorkspace rejects invalid payloads with `BAD_REQUEST`;
- migrateFromLocalStorage accepts the v1 payload and clears the local key on the renderer side (handler returns `{ migrated: true }`).

**Step 2: Implement handlers and register the module**

Input schemas built from `workspace-contracts.ts`. Handlers map store errors to `ORPCError`. Export a `workspace` object with procedures:
`listSaved`, `listHistory`, `saveQuery`, `deleteQuery`, `renameQuery`, `appendHistory`, `setHistoryFavorite`, `clearHistory`, `exportWorkspace`, `importWorkspace`, `migrateFromLocalStorage`.

Aggregate in `src/ipc/workspace/index.ts` and register as `workspace` in `src/ipc/router.ts`.

**Step 3: Run tests and typecheck**

Run: `bun run test:unit -- src/tests/unit/ipc/workspace/handlers.test.ts`

Run: `tsc --noEmit --pretty false`

Expected: PASS and no type errors.

**Step 4: Commit**

```bash
git add src/ipc/workspace src/ipc/router.ts src/tests/unit/ipc/workspace/handlers.test.ts
git commit -m "feat: expose SQL workspace oRPC APIs"
```

---

### Task 4: Rewrite the renderer hook to use oRPC (with one-time migration)

**Files:**
- Create: `src/features/database/hooks/workspace-actions.ts`
- Modify: `src/features/database/hooks/useSqlWorkspace.ts`
- Test: `src/tests/unit/features/database/hooks/useSqlWorkspace.test.ts`

**Step 1: Write the failing hook tests**

Mock `workspace-actions` and test that:
- the hook loads saved + history through oRPC on mount and on connectionId change;
- save/delete/rename/append call the matching action and update local state;
- the legacy localStorage payload (`sql-workspace-v1`) is sent once via `migrateFromLocalStorage` on first load and the key is removed afterwards;
- when the store is already migrated (main store non-empty) no local payload is sent;
- the returned API shape stays source-compatible with the current consumers (`savedQueries`, `history`, `saveQuery`, `deleteQuery`, `renameQuery`, `appendHistory`) plus the new `setHistoryFavorite`, `clearHistory`, `exportWorkspace`, `importWorkspace`.

**Step 2: Implement the actions module**

Typed wrappers over `ipc.client.workspace.*` with an `extractWorkspaceErrorMessage` helper mirroring `extractAiErrorMessage` in `ai-actions.ts`. Export `SqlSavedQuery`/`SqlHistoryEntry` types re-exported from the contracts.

**Step 3: Rewrite the hook**

Remove localStorage reads/writes and the `WORKSPACE_UPDATED_EVENT` dispatch (no longer needed with main-process storage), call the actions, and keep React state as a cache of the last response. Keep `loadSaved`/`loadHistory` and the `connectionId`-keyed behavior. `appendHistory` may return the deduped/updated entry so the UI can reflect changes.

**Step 4: Run the focused tests**

Run: `bun run test:unit -- src/tests/unit/features/database/hooks/useSqlWorkspace.test.ts`

Run: `tsc --noEmit --pretty false`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/features/database/hooks/workspace-actions.ts src/features/database/hooks/useSqlWorkspace.ts src/tests/unit/features/database/hooks/useSqlWorkspace.test.ts
git commit -m "feat: load SQL workspace through oRPC with migration"
```

---

### Task 5: Add saved-query variable extraction (snippet variables)

**Files:**
- Create: `src/features/database/utils/sql-variables.ts`
- Test: `src/tests/unit/features/database/utils/sql-variables.test.ts`

**Step 1: Write the failing tests**

Cover:
- extracting `{{limit:100}}`, `{{name}}`, `{{ name : 10 }}` with whitespace;
- no matches returns an empty list;
- invalid names (empty, starting with a digit, containing spaces) are ignored;
- `substituteVariables(sql, values)` replaces every occurrence and leaves unknown variables untouched;
- string values are quoted as SQL literals while numeric values are not;
- preserving `$1`/`:param`-style placeholders that are not `{{...}}`.

**Step 2: Implement the helpers**

`extractSqlVariables(sql): SqlVariable[]` (name + defaultValue) using a module-level regex, and `substituteVariables(sql, values: Record<string, string>): string` that quotes non-numeric values. Keep the functions pure and dependency-free so they are testable in jsdom/node.

**Step 3: Run the focused tests**

Run: `bun run test:unit -- src/tests/unit/features/database/utils/sql-variables.test.ts`

Expected: PASS.

**Step 4: Commit**

```bash
git add src/features/database/utils/sql-variables.ts src/tests/unit/features/database/utils/sql-variables.test.ts
git commit -m "feat: support variables in saved SQL snippets"
```

---

### Task 6: Add row actions and favoriting in the workspace sidebar

**Files:**
- Modify: `src/features/database/components/SqlEditor/SqlEditor.tsx`
- Create: `src/features/database/components/SqlEditor/WorkspaceQueryRowActions.tsx`

**Step 1: Add row action dropdowns**

For each saved/history row render a compact action menu (shadcn `DropdownMenu`):
- Saved rows: Run now, Open in new tab, Insert at cursor, Copy, Star/Unstar, Rename, Delete.
- History rows: Run now, Open in new tab, Copy, Star (favorite), Delete.

"Run now" reuses the existing `runSql` path: load the SQL into the active tab, then execute it. For entries with variables, open the fill dialog first (Task 7). "Open in new tab" uses the existing `addTab` with `docOverrides` (title + sql) instead of overwriting the current tab. "Insert at cursor" inserts into the active Monaco model at the caret. "Copy" writes the SQL to the clipboard.

**Step 2: Wire favoriting**

History rows get a star toggle calling `setHistoryFavorite`; when starred, the row also appears under Saved with `isFavorite`. Unstarring from Saved removes the flag (and the auto-created entry). Keep the existing save/rename/delete flows working through the new hook API.

**Step 3: Run the relevant checks**

Run: `bun run test:unit -- src/tests/unit/features/database/hooks/useSqlWorkspace.test.ts`

Run: `tsc --noEmit --pretty false`

Expected: PASS.

**Step 4: Commit**

```bash
git add src/features/database/components/SqlEditor/SqlEditor.tsx src/features/database/components/SqlEditor/WorkspaceQueryRowActions.tsx
git commit -m "feat: add run, open, copy and favorite actions to workspace rows"
```

---

### Task 7: Add the variable fill dialog and "All connections" scope

**Files:**
- Create: `src/features/database/components/SqlEditor/SqlVariableDialog.tsx`
- Modify: `src/features/database/components/SqlEditor/SqlEditor.tsx`

**Step 1: Implement the variable fill dialog**

A small shadcn `Dialog` listing extracted variables with default values prefilled. On confirm, substitute values and pass the final SQL to the requested action (Run / Open in new tab / Insert / Save). Cancel aborts. Skipped when the SQL has no variables.

**Step 2: Add the connection scope selector**

Add a segmented control in the sidebar header: `Current connection` | `All connections`. In "all" mode, call `listHistory(null)`/`listSaved(null)`; render a small connection label on each row (resolving via the existing `connections` prop) and hydrate must switch the active connection when the entry's `connectionId` differs (reuse the existing `onSelectConnection` flow).

**Step 3: Wire actions through the dialog**

"Run now" and "Open in new tab" for saved/history entries with variables first open `SqlVariableDialog`; the confirmed SQL flows into the existing run/addTab paths.

**Step 4: Run the relevant checks**

Run: `bun run test:unit -- src/tests/unit/features/database/utils/sql-variables.test.ts src/tests/unit/ipc/workspace/handlers.test.ts`

Run: `tsc --noEmit --pretty false`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/features/database/components/SqlEditor/SqlVariableDialog.tsx src/features/database/components/SqlEditor/SqlEditor.tsx
git commit -m "feat: fill snippet variables and browse all connections in workspace"
```

---

### Task 8: Format, typecheck, lint, and run the full suites

**Files:**
- Modify only files changed by Tasks 1–7 if formatting requires it.

**Step 1: Apply project formatting**

Run: `bun x ultracite fix`

Expected: formatting completes without introducing unrelated file changes.

**Step 2: Run typecheck**

Run: `tsc --noEmit`

Expected: PASS.

**Step 3: Run focused and full unit tests**

Run: `bun run test:unit -- src/tests/unit/shared/workspace src/tests/unit/ipc/workspace src/tests/unit/features/database/hooks/useSqlWorkspace.test.ts src/tests/unit/features/database/utils/sql-variables.test.ts`

Then run: `bun run test`

Expected: PASS.

**Step 4: Run lint and database boundary checks**

Run: `bun run check`

Expected: PASS; no database-boundary changes are expected (workspace module does not import DB drivers).

**Step 5: Manually verify the interaction matrix**

In the SQL editor sidebar:
- executing the same query twice creates one history entry with updated metadata (dedup);
- starring a history row shows it under Saved as a favorite; unstarring removes it;
- Run now executes without overwriting the active tab's content when using "Open in new tab";
- copy and insert-at-cursor behave correctly;
- "All connections" shows entries across connections and switches connection on hydrate;
- a saved query with `{{limit:100}}` opens the fill dialog before Run and substitutes the value;
- restarting the app preserves everything (main-process persistence) and the old localStorage key is gone;
- export/import/clear-history flows work from the sidebar.

---

### Task 9: Add end-to-end coverage

**Files:**
- Create: `src/tests/e2e/sql-workspace.spec.ts`

**Step 1: Add the E2E spec**

Cover: saving the current query, executing a query and seeing it in History, starring a history entry into Saved, running a saved query via "Run now", switching to "All connections", and filling a `{{var}}` dialog before run. Keep assertions deterministic (mock the backend or use the local SQLite/Postgres test connection the project already uses in other specs).

**Step 2: Run the E2E suite**

Run: `bun run test:e2e -- sql-workspace.spec.ts`

Expected: PASS.

**Step 3: Commit**

```bash
git add src/tests/e2e/sql-workspace.spec.ts
git commit -m "test: cover SQL workspace favorites, run-now and variables"
```

---

## Final verification checklist

- [ ] `tsc --noEmit --pretty false` passes.
- [ ] `bun run check` passes, including database-boundary checks.
- [ ] `bun run test` passes (unit suites for contracts, store, handlers, hook, and variables).
- [ ] `bun run test:e2e -- sql-workspace.spec.ts` passes.
- [ ] Existing localStorage data migrates once and the `sql-workspace-v1` key is removed.
- [ ] No new `ipcRenderer.invoke` channels; everything on oRPC (`workspace` module).
- [ ] No changes to `src/features/shell/preload.ts`; no new major dependencies.
- [ ] History stays capped at 200 entries per connection; dedup works for consecutive identical queries.
- [ ] Raw result previews in history remain capped as today (`toHistoryResultPreview`).
