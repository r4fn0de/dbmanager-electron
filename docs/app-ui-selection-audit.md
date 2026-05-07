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

- `ConnectionForm`: `Adjusted`
  - duplicate warning/status/help feedback now selectable
  - action controls remain interaction-first

- `AI Chat Panel`: `Adjusted`
  - code language label selectable
  - code action controls preserved as interaction-first

- `Local DB dialogs`: `OK`
  - `CreateBranchDialog` / `BranchSwitchConfirmDialog` informational text adjusted to selectable
  - form-heavy controls remain interaction-first

- `DatabaseOverview`: `Adjusted`
  - connection identity metadata (name/badges/server fields/schema names) now explicitly selectable
  - copy-action target and action controls remain interaction-first

- `SettingsDialog`: `Adjusted`
  - sidebar category buttons explicitly interaction-first (`select-none`)
  - informational panel content remains selectable where applicable

- `AiSettingsPanel`: `Adjusted`
  - provider/select/config toggle controls explicitly interaction-first
  - informational/config text remains selectable for copy/reference

- `Settings / Theme / Title bar`: `Preserved`
  - title bar and chrome affordances stay interaction-first
  - no change in this rollout by design

## Exceptions kept intentionally

- `src/components/ui/*` primitives
- window drag/titlebar regions
- menu/select/button control internals
