# Motion Reorder for connection tabs

## Goal
Use Motion's documented `Reorder.Group`/`Reorder.Item` implementation for connection tabs, with horizontal-only dragging and the current tab visuals preserved.

## Findings
The current Motion documentation recommends `Reorder.Group` with `values` and `onReorder`, `Reorder.Item` with `value`, and `axis="x"` for a horizontal list. The current project uses Motion 12.38.0; the latest available release is 13.1.0.

## Design
Replace the dnd-kit context and sortable wrappers with `Reorder.Group axis="x"` and `Reorder.Item`. Keep the existing tab order callback, container ref, wheel scrolling, close/click handling, and Motion drag feedback. Use a local ordered-ID list during the drag so crossing tabs does not persist to Zustand on every reorder event; commit the final order once on drag end. Set `dragMomentum={false}` and a neutral `dragElastic` so the item remains controlled by the horizontal group. Update the `motion` dependency and lockfile to 13.1.0, then validate the reorder smoke test and typecheck.

This intentionally uses Motion's lightweight list reorder model rather than cross-zone collision detection; connection tabs remain a single horizontal reorder group.
