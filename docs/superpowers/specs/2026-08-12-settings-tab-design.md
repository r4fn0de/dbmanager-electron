# Settings as a Closable Application Tab

## Goal

Replace the current Settings modal opened from the title bar with a normal, closable application tab that uses the existing connection-tab chrome and navigation model.

## User experience

- The title-bar settings button opens the Settings tab.
- Opening Settings when it is already open activates the existing tab instead of creating a duplicate.
- Settings behaves like a normal tab and can be closed with the existing tab close affordance.
- Closing Settings returns to the previously active tab when one exists; otherwise navigation falls back to the connections home route.
- Settings keeps its current internal categories:
  - Appearance
  - AI Assistant
  - Shortcuts
  - Updates
- The category sidebar and category transition animation remain available inside the tab.
- Settings content must not be rendered inside a Dialog or depend on modal open state.

## Architecture

### Route

Add a dedicated `/settings` route that renders the settings page. The route is the navigation source of truth for the active Settings tab, matching the existing `/database/$connectionId` route pattern.

### Tab state

Extend the connection-tab state model with a Settings tab representation. Use a stable reserved ID such as `__settings__` so the tab can be detected and deduplicated without relying on display text.

The store needs operations equivalent to:

- Add or activate Settings idempotently.
- Remove Settings through the existing tab removal behavior.
- Preserve the existing most-recently-used tab ordering so fallback after closing Settings is deterministic.

Because the existing tab store persists open tabs, the Settings tab uses that same persistence behavior. No separate Settings persistence mechanism is introduced.

### Title bar

Replace `SettingsDialog` usage in `TitleBar` with a trigger that calls the shared tab/navigation action. The trigger keeps the existing visual button and platform-specific placement.

The trigger must:

1. Ensure the Settings tab exists.
2. Mark it active.
3. Navigate to `/settings`.

### Settings content component

Refactor the current `SettingsDialog` content into a page-oriented component. Preserve the current category state, panel selection, transitions, and panel props. Remove modal-only dependencies (`Dialog`, `DialogContent`, `DialogTrigger`, and modal dimensions).

The page should provide its own scrollable content area and retain the current visual hierarchy without relying on the fixed 880x640 Dialog shell.

### Tab chrome

The existing tab renderer must recognize the Settings tab and render:

- Settings icon.
- `Settings` label.
- The same active/inactive styling as connection tabs.
- The existing close behavior.

Connection-specific provider icons and connection-only context menus must not be applied to the Settings tab.

## Navigation and edge cases

- Repeated clicks on the title-bar settings button never create duplicate Settings tabs.
- Navigating directly to `/settings` creates/activates the Settings tab through the same synchronization path used by database routes.
- Clicking a connection tab from Settings navigates to that connection and activates its tab.
- Closing Settings while it is active chooses the previous MRU tab if available; otherwise it navigates to `/`.
- Closing a non-active Settings tab is not possible through normal UI because Settings is activated when opened, but the store should remain consistent if removal is called programmatically.
- Browser history must remain route-based: Settings navigation should be observable as `/settings`, not only as local component state.

## Scope boundaries

Included:

- Settings route.
- Settings tab state and deduplication.
- Title-bar trigger migration.
- Tab rendering and close behavior for Settings.
- Refactoring modal content into a page component.

Not included:

- Changes to individual settings panels or their persistence.
- New Settings categories.
- Changes to connection-tab persistence semantics beyond supporting the Settings tab.
- New keyboard shortcuts.
- Visual redesign of Settings beyond adapting the modal shell to the application content area.

## Verification

The implementation must provide evidence for these contracts:

1. Type-checking succeeds with the repository's TypeScript command.
2. Existing unit tests remain green.
3. The Settings trigger creates one Settings tab and reuses it on repeated activation.
4. Settings renders at `/settings` with all four categories available.
5. Settings can be closed through the normal tab close control and returns to the expected previous route.
6. Connection tabs continue to open, activate, close, and navigate normally.
7. No Settings Dialog is mounted or imported by the title bar.
