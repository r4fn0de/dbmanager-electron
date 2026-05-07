# Database UI Selection Audit

Status legend:

- `OK`: follows policy already
- `Adjusted`: changed in this effort
- `N/A`: intentionally excluded in this round

## Component Checklist

- `TableDataEditor` (`GridHeader/GridRows`): `Adjusted`
  - Data labels/values are selectable.
  - Sort/resize/expand/FK action affordances remain non-selectable.

- `SqlEditor` (tab bar + informational text): `Adjusted`
  - Tab titles selectable.
  - Tab interaction/close affordances remain non-selectable.

- `QueryResults`: `Adjusted`
  - Errors, execution metadata, headers, and cell text selectable.
  - Action buttons and overlay copy targets remain non-selectable.

- `TablesExplorerSidebar`: `Adjusted`
  - Schema/table textual labels selectable where low conflict.
  - Collapsed overlay state and control/menu behaviors preserved.

- `ui/*` primitives and `TitleBar`: `N/A`
  - Out of scope for database-first rollout.

