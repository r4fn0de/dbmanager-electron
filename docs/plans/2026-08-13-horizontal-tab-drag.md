# Horizontal-only connection tab dragging Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent connection tabs from moving vertically while dragging, without changing collision detection or reorder animation.

**Architecture:** Use Motion's documented `Reorder.Group axis="x"` with `values`/`onReorder` and `Reorder.Item value={tab.id}`. Motion owns the drag transform and layout animation, while the existing handlers and visual states remain on each item.

**Tech Stack:** React, TypeScript, Motion 13.1.0, Playwright.

---

### Task 1: Restore Motion Reorder

**Files:**
- Modify: `src/features/connection/components/ConnectionTabs.tsx`

**Step 1: Render the documented group**

Use `Reorder.Group axis="x" values={tabIds} onReorder={handleReorder}` and preserve the current tab-list ref, classes, accessibility attributes, and wheel scrolling.

**Step 2: Render reorder items**

Use `Reorder.Item value={tab.id}` with the existing visual states and handlers, plus `dragMomentum={false}`, `dragElastic={0}`, `dragConstraints={containerRef}`, and `layout="position"`.

**Step 3: Run typecheck**

Run: `tsc --noEmit --pretty false`
Expected: no TypeScript errors.

### Task 2: Verify drag behavior

**Files:**
- Test: `src/tests/e2e/connection-tabs-reorder.spec.ts`

**Step 1: Run the existing reorder smoke test**

Run: `PW_TAB_REORDER_SMOKE=1 bun run test:e2e -- connection-tabs-reorder.spec.ts`
Expected: the reorder test passes.

**Step 2: Review the diff**

Run: `git diff --check -- src/features/connection/components/ConnectionTabs.tsx docs/plans/2026-08-13-horizontal-tab-drag-design.md docs/plans/2026-08-13-horizontal-tab-drag.md`
Expected: no whitespace errors.
