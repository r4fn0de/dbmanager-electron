# Horizontal-only connection tab dragging

## Goal
Restrict connection-tab dragging to the horizontal axis while preserving Motion's documented reorder animation.

## Design
Use `Reorder.Group axis="x"` with `values` and `onReorder`, and render each connection tab as a `Reorder.Item`. Motion owns the drag transform and layout animation, so no separate collision system or transform composition is needed. Keep the existing visual feedback and test that a large vertical pointer movement leaves the tab on its original horizontal track.

The implementation uses Motion 13.1.0 and removes the no-longer-needed dnd-kit dependencies.
