# Horizontal-only connection tab dragging Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent connection tabs from moving vertically while dragging, without changing collision detection or reorder animation.

**Architecture:** Define a small local dnd-kit modifier in `ConnectionTabs.tsx` that preserves the incoming transform's horizontal offset and forces its vertical offset to zero. Pass it to `DndContext`; leave `SortableContext`, collision detection, and Motion styling intact.

**Tech Stack:** React, TypeScript, `@dnd-kit/core`, `@dnd-kit/sortable`, Motion.

---

### Task 1: Add the horizontal-axis modifier

**Files:**
- Modify: `src/features/connection/components/ConnectionTabs.tsx`

**Step 1: Write the modifier**

Create a typed local modifier that accepts dnd-kit's modifier arguments and returns the original transform with `y: 0`.

**Step 2: Attach the modifier**

Pass the modifier through the existing `DndContext`'s `modifiers` prop. Do not alter the existing collision detector or horizontal sorting strategy.

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
