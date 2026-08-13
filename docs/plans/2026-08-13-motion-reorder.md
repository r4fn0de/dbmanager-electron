# Motion Reorder for connection tabs Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restore Motion's documented horizontal reorder implementation and update Motion to the latest available release.

**Architecture:** Render the tab list with `Reorder.Group axis="x"`, passing the ordered tab IDs through `values` and `onReorder`. Render each tab as a `Reorder.Item value={tab.id}` so Motion owns drag transforms and layout animation. Preserve the existing tab content, visual states, constraints, and event handlers.

**Tech Stack:** React, TypeScript, `motion/react` 13.1.0, Vitest/Playwright.

---

### Task 1: Restore Motion Reorder

**Files:**
- Modify: `src/features/connection/components/ConnectionTabs.tsx`

**Step 1: Replace dnd-kit imports and helpers**

Remove dnd-kit imports, collision helpers, and the custom sortable item wrapper. Import `Reorder` from `motion/react`.

**Step 2: Restore the documented group**

Use `Reorder.Group axis="x" values={tabIds} onReorder={handleReorder}` with the existing tab-list ref, wheel handler, classes, and accessibility attributes.

**Step 3: Restore item drag behavior**

Render each tab using `Reorder.Item value={tab.id}`. Keep the current tab handlers and visual states; use `dragMomentum={false}`, `dragElastic={0}`, `dragConstraints={containerRef}`, `layout="position"`, and the existing drag feedback.

### Task 2: Update Motion

**Files:**
- Modify: `package.json`
- Modify: `bun.lock`

**Step 1: Update the package**

Run: `bun add motion@latest`
Expected: Motion resolves to 13.1.0 and the lockfile updates.

### Task 3: Verify behavior

**Files:**
- Test: `src/tests/e2e/connection-tabs-reorder.spec.ts`

**Step 1: Run typecheck**

Run: `tsc --noEmit --pretty false`
Expected: no TypeScript errors.

**Step 2: Run the reorder smoke test**

Run: `PW_TAB_REORDER_SMOKE=1 bun run test:e2e -- connection-tabs-reorder.spec.ts`
Expected: PASS, including horizontal-only movement and cleared drag feedback.

**Step 3: Check the diff**

Run: `git diff --check`
Expected: no whitespace errors.
