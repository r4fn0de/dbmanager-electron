# App UI Selection Audit (Post Database Rollout)

Status legend:

- `OK`: already aligned with policy
- `Adjusted`: changed in this pass
- `Preserved`: intentionally interaction-first, no change

## Database Surfaces

- `TableDataEditor`: `Adjusted`
- `SqlEditor`: `Adjusted`
- `QueryResults`: `Adjusted`
- `TablesExplorerSidebar`: `Adjusted`

## Remaining App Surfaces

- `ConnectionList`: `Adjusted`
  - connection names/tags/branch badges selectable
  - click-to-copy affordance remains non-selectable (interaction-first)

- `AI Chat Panel`: `Adjusted`
  - code language label selectable
  - code action controls preserved as interaction-first

- `Local DB dialogs`: `OK`
  - form-heavy controls; textual content remains naturally copyable where relevant

- `Settings / Theme / Title bar`: `Preserved`
  - title bar and chrome affordances stay interaction-first
  - no change in this rollout by design

## Exceptions kept intentionally

- `src/components/ui/*` primitives
- window drag/titlebar regions
- menu/select/button control internals

