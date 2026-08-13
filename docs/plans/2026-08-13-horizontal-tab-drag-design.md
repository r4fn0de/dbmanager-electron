# Horizontal-only connection tab dragging

## Goal
Restrict connection-tab dragging to the horizontal axis while preserving dnd-kit collision detection, reordering, and existing motion feedback.

## Design
Add a local `@dnd-kit/core` modifier to `ConnectionTabs.tsx`. The modifier returns the incoming transform with `y` set to `0`, so pointer movement and sortable transforms can only move tabs horizontally. Keep `closestCenter`, `horizontalListSortingStrategy`, and the current `motion` styling unchanged.

No new dependency is needed. Typecheck and the existing connection-tab reorder E2E smoke test verify that reordering still works; the modifier's zeroed vertical transform is covered by a focused unit test if the existing test structure permits it.
