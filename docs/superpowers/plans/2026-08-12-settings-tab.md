# Settings Application Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the title-bar Settings modal with one route-backed, closable Settings tab that uses the existing application tab chrome and preserves all current Settings categories.

**Architecture:** Extend the existing persisted `useConnectionTabsStore` with a reserved Settings tab ID and an idempotent `openSettingsTab` action. Add `/settings` as a TanStack Router file route that renders a modal-free Settings page. Make `ConnectionTabs`, `TitleBar`, and root keyboard navigation route-aware so Settings participates in activation, closing, MRU fallback, reordering, and shortcuts without affecting connection-specific behavior.

**Tech Stack:** React 19, TanStack Router, Zustand persist, Motion, Vitest, TypeScript 7.0.2, Vite TanStack Router plugin.

## Global Constraints

- Settings is a normal tab: it is closable, cannot be duplicated, and is opened/reused by the title-bar settings button.
- The Settings route is exactly `/settings`.
- The reserved Settings tab ID is exactly `__settings__`.
- Settings preserves Appearance, AI Assistant, Shortcuts, and Updates categories and their current category transition animation.
- Settings content must not render inside `Dialog`, `DialogContent`, or `DialogTrigger`.
- Settings uses the existing tab-store persistence; no separate Settings persistence is introduced.
- Connection-specific provider icons and connection-only behavior must not be applied to the Settings tab.
- Closing active Settings selects the most recently active remaining tab; with no remaining tab, it navigates to `/`.
- Do not change the individual Settings panels or their persistence behavior.
- Do not add new dependencies.
- Every implementation task must run its focused test before committing.

---

### Task 1: Add an idempotent Settings tab to the shared tab store

**Files:**
- Modify: `src/lib/stores/connection-tabs.ts`
- Create: `src/tests/unit/connection-tabs.test.ts`

**Interfaces:**
- Produces `SETTINGS_TAB_ID`, `buildSettingsTab()`, `isSettingsTab()`, and `openSettingsTab()` for later route, title-bar, and tab-chrome tasks.
- Existing persisted connection tabs without a `kind` field remain valid; treat them as connection tabs.

- [ ] **Step 1: Add the Settings tab identity and backward-compatible kind field**

Add these declarations near the existing tab types and builder:

```ts
export const SETTINGS_TAB_ID = "__settings__";

type ConnectionTabKind = "connection" | "settings";

export interface ConnectionTab {
  id: string;
  name: string;
  kind?: ConnectionTabKind;
  isLocal?: boolean;
  color?: string;
  provider?: ConnectionProvider;
  chrome?: ConnectionTabChrome;
  chromeWidthPx?: number;
  lastSection?: SidebarSection;
  lastSchema?: string;
  lastTable?: string;
}

export function buildSettingsTab(): ConnectionTab {
  return {
    id: SETTINGS_TAB_ID,
    name: "Settings",
    kind: "settings",
  };
}

export function isSettingsTab(tab: Pick<ConnectionTab, "id" | "kind">): boolean {
  return tab.id === SETTINGS_TAB_ID || tab.kind === "settings";
}
```

Use the reserved ID as the authoritative identity so a persisted tab from a previous app version cannot be mistaken for a connection tab.

- [ ] **Step 2: Add idempotent store activation**

Add `openSettingsTab: () => void` to `ConnectionTabsState` and implement it beside `addTab`:

```ts
openSettingsTab: () =>
  set((state) => {
    const recent = [
      SETTINGS_TAB_ID,
      ...state.recentTabIds.filter((id) => id !== SETTINGS_TAB_ID),
    ];
    if (state.tabs.some((tab) => tab.id === SETTINGS_TAB_ID)) {
      return { activeTabId: SETTINGS_TAB_ID, recentTabIds: recent };
    }
    return {
      tabs: [...state.tabs, buildSettingsTab()],
      activeTabId: SETTINGS_TAB_ID,
      recentTabIds: recent,
    };
  }),
```

Do not create a second persistence store. Keep the existing `partialize` behavior so the Settings tab follows the same open-tab persistence as connections.

- [ ] **Step 3: Add focused store tests**

Create `src/tests/unit/connection-tabs.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import {
  SETTINGS_TAB_ID,
  isSettingsTab,
  useConnectionTabsStore,
} from "@/lib/stores/connection-tabs";

describe("connection tabs store", () => {
  beforeEach(() => {
    useConnectionTabsStore.setState({
      tabs: [],
      activeTabId: null,
      recentTabIds: [],
    });
  });

  it("opens Settings once and focuses the existing tab", () => {
    const store = useConnectionTabsStore.getState();

    store.openSettingsTab();
    store.openSettingsTab();

    const state = useConnectionTabsStore.getState();
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0]?.id).toBe(SETTINGS_TAB_ID);
    expect(state.tabs[0] && isSettingsTab(state.tabs[0])).toBe(true);
    expect(state.activeTabId).toBe(SETTINGS_TAB_ID);
    expect(state.recentTabIds[0]).toBe(SETTINGS_TAB_ID);
  });

  it("keeps connection tabs compatible with the Settings discriminator", () => {
    const store = useConnectionTabsStore.getState();
    store.addTab({ id: "connection-1", name: "Database" });

    const tab = useConnectionTabsStore.getState().tabs[0];
    expect(tab && isSettingsTab(tab)).toBe(false);
  });
});
```

- [ ] **Step 4: Run the focused test**

Run:

```bash
bun run test -- src/tests/unit/connection-tabs.test.ts
```

Expected: the new suite passes with 2 tests and no existing test failures.

- [ ] **Step 5: Commit the store slice**

```bash
git add src/lib/stores/connection-tabs.ts src/tests/unit/connection-tabs.test.ts
git commit -m "feat: add settings application tab state"
```

---

### Task 2: Convert the modal content into a `/settings` page

**Files:**
- Create: `src/features/settings/components/SettingsPage.tsx`
- Create: `src/routes/settings.tsx`
- Modify: `src/features/settings/index.ts`
- Delete: `src/features/settings/components/SettingsDialog.tsx`
- Generated: `src/routeTree.gen.ts` (regenerated by the TanStack Router Vite plugin)

**Interfaces:**
- Produces `SettingsPage`, a page component with no modal props and no Dialog dependency.
- Produces the `/settings` file route; direct navigation to `/settings` calls `openSettingsTab()` in an Effect and renders `SettingsPage`.

- [ ] **Step 1: Move the existing Settings dialog content into a page component**

Create `SettingsPage.tsx` by retaining the current `SettingsCategory`, `SETTINGS_ITEMS`, `EASE_OUT`, category state, `activeItem`, sidebar buttons, `AnimatePresence`, and four panel branches from `SettingsDialog.tsx`.

The page shell must replace the fixed modal shell with full available height:

```tsx
export function SettingsPage() {
  const [activeCategory, setActiveCategory] =
    useState<SettingsCategory>("appearance");
  const activeItem = SETTINGS_ITEMS.find((item) => item.id === activeCategory);

  return (
    <section className="h-full min-h-0 flex flex-col overflow-hidden bg-background">
      <header className="px-6 py-4 shrink-0 border-b border-border/40">
        <h1 className="text-base font-semibold text-foreground">
          {activeItem?.label ?? "Settings"}
        </h1>
      </header>
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Existing category sidebar and animated content remain here. */}
      </div>
    </section>
  );
}
```

The category sidebar keeps its current labels/icons and active-state styles. The animated content container remains scrollable with `overflow-y-auto`, but must not use the old Dialog width/height styles.

- [ ] **Step 2: Add the route and synchronize direct navigation with the tab store**

Create `src/routes/settings.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { SettingsPage } from "@/features/settings";
import { useConnectionTabsStore } from "@/lib/stores/connection-tabs";

export const Route = createFileRoute("/settings")({
  component: SettingsRoute,
});

function SettingsRoute() {
  useEffect(() => {
    useConnectionTabsStore.getState().openSettingsTab();
  }, []);

  return <SettingsPage />;
}
```

This keeps route navigation as the source of truth while ensuring a direct `/settings` URL creates and activates the corresponding tab after mount.

- [ ] **Step 3: Update the Settings feature export and remove the modal entrypoint**

Change `src/features/settings/index.ts` from:

```ts
export { SettingsDialog } from "./components/SettingsDialog";
```

to:

```ts
export { SettingsPage } from "./components/SettingsPage";
```

Delete `SettingsDialog.tsx` after all content has moved. No Settings dialog symbol may remain exported or imported.

- [ ] **Step 4: Regenerate the TanStack route tree**

Run the renderer Vite build so the existing `tanstackRouter({ target: "react" })` plugin discovers `src/routes/settings.tsx` and updates the tracked generated file:

```bash
bunx vite build --config vite.renderer.config.mts
```

Expected: exit code 0; `src/routeTree.gen.ts` contains `/settings` in its route maps and imports `./routes/settings`. Do not hand-author generated route types.

- [ ] **Step 5: Run the type-check and focused settings-related tests**

Run:

```bash
bun run typecheck
bun run test -- src/tests/unit/connection-tabs.test.ts
```

Expected: both commands pass. The old `SettingsDialog` import must no longer appear in TypeScript diagnostics.

- [ ] **Step 6: Commit the page and route slice**

```bash
git add src/features/settings src/routes/settings.tsx src/routeTree.gen.ts
git commit -m "feat: add settings route page"
```

---

### Task 3: Make the tab chrome and tab synchronization route-aware

**Files:**
- Modify: `src/features/connection/components/ConnectionTabs.tsx`
- Modify: `src/lib/stores/connection-tabs.ts` only if a small shared helper is needed

**Interfaces:**
- Consumes `SETTINGS_TAB_ID`, `isSettingsTab`, and `ConnectionTab` from Task 1.
- Produces tab clicks, close actions, direct-route synchronization, and rendering that support both connection and Settings tabs.

- [ ] **Step 1: Derive Settings as the active tab on `/settings`**

Import `SETTINGS_TAB_ID` and `isSettingsTab`. Track the route with the existing `pathname` value and replace the current effective-ID calculation with:

```ts
const isSettingsRoute = pathname === "/settings";
const effectiveActiveId = currentConnectionId
  ?? (isSettingsRoute ? SETTINGS_TAB_ID : null)
  ?? activeTabId;
```

Keep connection-route precedence unchanged.

- [ ] **Step 2: Route tab clicks through a single application-tab helper**

Add a callback beside `handleTabClick`:

```ts
const navigateToTab = useCallback(
  (tab: ConnectionTab) => {
    if (isSettingsTab(tab)) {
      navigate({ to: "/settings" });
      return;
    }
    navigate({
      to: "/database/$connectionId",
      params: { connectionId: tab.id },
    });
  },
  [navigate],
);
```

Update `handleTabClick` to resolve the tab by ID, call `setActiveTab(id)`, and pass the resolved tab to `navigateToTab`. If the ID no longer exists, return without navigation.

- [ ] **Step 3: Preserve connection close behavior and use MRU fallback for active Settings**

Destructure `recentTabIds` from the store. In `handleClose`, keep the current index-neighbor fallback for connection tabs. For an active Settings tab, choose the first open ID from `recentTabIds` other than the closing ID, then fall back to the current index-neighbor if the MRU list is incomplete:

```ts
const tab = tabs.find((candidate) => candidate.id === id);
const isClosingSettings = tab ? isSettingsTab(tab) : false;
const recentFallback = isClosingSettings
  ? recentTabIds
      .filter((candidateId) => candidateId !== id)
      .map((candidateId) => remaining.find((candidate) => candidate.id === candidateId))
      .find((candidate): candidate is ConnectionTab => Boolean(candidate))
  : undefined;
const nextTab = recentFallback ?? remaining[Math.min(idx, remaining.length - 1)];
```

After the existing exit timer removes the tab, call `navigateToTab(nextTab)` when a next tab exists; otherwise navigate to `/`. Include `recentTabIds` and `navigateToTab` in the callback dependencies.

- [ ] **Step 4: Render Settings without connection-specific icon logic**

At the icon branch inside each tab item, add the Settings branch first:

```tsx
{isSettingsTab(tab) ? (
  <Icon name="settings" className="size-3.5 shrink-0" />
) : tab.provider === "neon" ? (
  // Existing provider branches remain unchanged.
```

Change the tab-list accessible label from `Connection tabs` to `Application tabs`. Keep the same close affordance and active/inactive styles so Settings remains a normal closable/reorderable tab.

- [ ] **Step 5: Prevent connection synchronization from deleting Settings**

In `useConnectionTabSync`, skip Settings before checking `connectionIds`:

```ts
for (const tab of tabs) {
  if (isSettingsTab(tab)) continue;
  if (!connectionIds.has(tab.id)) {
    removeTab(tab.id);
    navigateAwayFromDeleted(tab.id);
  }
}
```

The existing connection metadata update loop must also skip Settings explicitly, even though the connection map will not contain its ID.

- [ ] **Step 6: Run the focused tests and type-check**

Run:

```bash
bun run test -- src/tests/unit/connection-tabs.test.ts
bun run typecheck
```

Expected: both pass with no route or tab type errors.

- [ ] **Step 7: Commit route-aware tab chrome**

```bash
git add src/features/connection/components/ConnectionTabs.tsx
git commit -m "feat: integrate settings into application tabs"
```

---

### Task 4: Replace the title-bar modal trigger and update global tab shortcuts

**Files:**
- Modify: `src/components/TitleBar.tsx`
- Modify: `src/routes/__root.tsx`

**Interfaces:**
- Consumes the Settings tab action and route-aware tab helpers from earlier tasks.
- Produces title-bar activation, Ctrl/Cmd+W closing, Ctrl/Cmd+Tab cycling, and bracket/PageUp/PageDown navigation that work for both tab kinds.

- [ ] **Step 1: Replace both `SettingsDialog` instances in the title bar**

Remove the `SettingsDialog` import. Add `SETTINGS_TAB_ID` only if needed for an active-state check; the button itself should use the store action and current `navigate` instance:

```tsx
const handleOpenSettings = useCallback(() => {
  useConnectionTabsStore.getState().openSettingsTab();
  navigate({ to: "/settings" });
}, [navigate]);
```

Replace both platform-specific `<SettingsDialog />` usages with the existing icon visual wrapped in an accessible button:

```tsx
<button
  type="button"
  aria-label="Settings"
  onClick={handleOpenSettings}
  className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground active:scale-[0.97]"
>
  <Settings className="size-4" />
</button>
```

Use the existing Windows/Linux dimensions (`size-8`, `rounded-none`) in the second platform branch so current platform chrome remains unchanged.

- [ ] **Step 2: Add route-aware navigation to root keyboard shortcuts**

Import `ConnectionTab` and `isSettingsTab` in `__root.tsx`. After `const navigate = useNavigate();`, define:

```tsx
const navigateToTab = useCallback(
  (tab: ConnectionTab) => {
    if (isSettingsTab(tab)) {
      navigate({ to: "/settings" });
      return;
    }
    navigate({
      to: "/database/$connectionId",
      params: { connectionId: tab.id },
    });
  },
  [navigate],
);
```

Use this helper in Ctrl/Cmd+Tab, Ctrl/Cmd+Shift+Tab, bracket navigation, and PageUp/PageDown instead of always constructing a database route. Add `navigateToTab` to the keyboard effect dependency array.

- [ ] **Step 3: Make Ctrl/Cmd+W close Settings with MRU fallback**

In the existing close-shortcut branch, retain index fallback for connection tabs. When `activeTabId` identifies Settings, choose the first remaining tab from `recentTabIds`, call `removeTab(activeTabId)`, and route through `navigateToTab`. Navigate to `/` only when no tab remains.

Do not intercept the shortcut inside text inputs, selects, textareas, or Monaco; preserve the current guard clauses.

- [ ] **Step 4: Run type-check and lint checks**

Run:

```bash
bun run typecheck
bun run check
```

Expected: both pass; no `SettingsDialog` import remains in `TitleBar.tsx`.

- [ ] **Step 5: Commit title-bar and shortcut integration**

```bash
git add src/components/TitleBar.tsx src/routes/__root.tsx
git commit -m "feat: open settings from title bar tab"
```

---

### Task 5: Run full verification and manual tab-flow smoke test

**Files:**
- Modify only if verification identifies a defect in the preceding tasks.

**Interfaces:**
- Verifies the complete `/settings` route, tab lifecycle, Settings category rendering, and unchanged connection-tab behavior.

- [ ] **Step 1: Run the complete automated checks**

Run:

```bash
bun run typecheck
bun run check
bun run test
```

Expected:

- TypeScript exits 0.
- Ultracite and database-boundary checks exit 0.
- The full Vitest suite passes with all test files green.

- [ ] **Step 2: Launch the application for UI smoke testing**

Run:

```bash
bun run start
```

Exercise this exact scenario in the Electron window:

1. Click the title-bar Settings button.
2. Confirm the URL is `/settings`, one Settings tab appears, and the Settings page shows Appearance, AI Assistant, Shortcuts, and Updates.
3. Click the Settings button again and confirm no second Settings tab appears.
4. Open a connection tab, return to Settings, then close Settings; confirm the connection tab is restored.
5. Reopen Settings, close the only remaining tab, and confirm the app navigates to `/`.
6. Reopen Settings and use Ctrl/Cmd+Tab, bracket, and PageUp/PageDown navigation to cycle between Settings and connection tabs.
7. Use Ctrl/Cmd+W on Settings and confirm it closes the tab and routes to the MRU remaining tab.
8. Confirm a connection tab still opens its database route and its provider icon/context behavior is unchanged.

Use the repository search tool on `src/components/TitleBar.tsx`, `src/features/settings`, and `src/routes/settings.tsx` for `SettingsDialog`, `DialogContent`, and `DialogTrigger`.

Expected: no `SettingsDialog` reference in the title bar or settings feature; no modal wrapper in the Settings page or route. Confirm `src/routeTree.gen.ts` contains the `/settings` route and no unrelated generated route changes.
 
If all verification checks pass, do not create an empty verification commit. If a correction is needed, commit the exact corrected paths with a specific message such as `fix: complete settings tab navigation`.

