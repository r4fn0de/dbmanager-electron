# AGENTS.md — TarsDB

## Stack & Versions

- **Runtime**: Electron 41 (Node 22.x), Chromium 132
- **Renderer**: React 19.2, TypeScript 5.9
- **Bundler**: Vite 8 (via `@electron-forge/plugin-vite`)
- **Package Manager**: Bun (always use `bun`, never `npm` or `pnpm`)
- **Styling**: TailwindCSS 4, shadcn/ui, Geist font
- **Router**: TanStack Router (file-based routing under `src/routes/`)
- **State/Query**: TanStack Query, Zustand
- **Validation**: Zod 4
- **Lint/Format**: Ultracite with Biome (do not run Prettier separately)
- **Tests**: Vitest (unit, jsdom) + Playwright (E2E)

## Key Commands

- **Install deps**: `bun install`
- **Start dev**: `bun run start` (runs `prestart` script that patches Electron first)
- **Typecheck**: `tsc --noEmit` (no dedicated typecheck script; use `tsc` directly)
- **Lint**: `bun run check` (runs `ultracite check` + `check:db-boundaries`)
- **Lint fix**: `bun run fix` (runs `ultracite fix`)
- **Unit tests**: `bun run test`
- **Unit single file**: `bun run test:unit -- src/tests/unit/path/to/file.test.ts`
- **Unit watch**: `bun run test:watch`
- **E2E tests**: `bun run test:e2e`
- **All tests**: `bun run test:all`
- **Build for prod**: `bun run make`
- **Package (no make)**: `bun run package`
- **Bump shadcn components**: `bun run bump-ui`

## Project Structure

- `src/main.ts` — Electron main process entry
- `src/preload.ts` — Preload script; **only file** allowed to use `contextBridge` / `ipcRenderer`
- `src/ipc/` — oRPC router and handlers for IPC communication
  - `src/ipc/router.ts` — root oRPC router (aggregates domain routers)
  - `src/ipc/handler.ts` — oRPC MessagePort handler registration
  - `src/ipc/context.ts` — `IPCContext` singleton for main-window state and unsaved-changes tracking
  - `src/ipc/db/` — database drivers, Kysely factories, connection registry
  - `src/ipc/ai/` — AI streaming handlers (legacy IPC, not oRPC)
- `src/routes/` — TanStack Router file-based routes
  - `__root.tsx` — root layout
  - `index.tsx` — home route
  - `database.$connectionId.tsx` — connection detail route
- `src/components/` — React components
  - `src/components/ui/` — shadcn/ui components (auto-generated, **do not edit directly**)
- `src/lib/` — utilities and Zustand stores
- `src/hooks/` — custom React hooks
- `src/localization/` — i18next resources
- `src/next-app/` — experimental Next.js-like sub-structure (keep isolated)
- `src/tests/unit/` — Vitest tests (mirrors `src/` structure where applicable)
- `src/tests/e2e/` — Playwright tests
- `scripts/` — build and maintenance scripts
- `forge.config.ts` — Electron Forge configuration

## IPC & Communication Rules

- **Use oRPC for all new IPC APIs**. Define contracts in `src/ipc/<domain>/` and register them in `src/ipc/router.ts`.
- The renderer calls oRPC via a MessagePort bridge initialized at startup. Do **not** add new `ipcRenderer.invoke` channels for standard request/response flows.
- **Exception — AI streaming**: AI chat and inline SQL generation use raw IPC events (`ipcRenderer.send`/`on`) because oRPC MessagePort does not support streaming. New streaming features may follow this pattern only after discussion.
- `src/preload.ts` is the **only** file that may import `ipcRenderer` or call `contextBridge.exposeInMainWorld`. No exceptions.
- `nodeIntegration: true` in main window is intentional for local DB driver support, but renderer code should still prefer oRPC APIs over direct Node usage.

## Coding Conventions

- **React Compiler is enabled** via Babel in `vite.renderer.config.mts`. Do not manually wrap components in `memo` unless the compiler fails to optimize.
- Use `function` declarations for React components, not arrow functions.
- Always use the `@/` path alias for imports from `src/`. Never use relative `../../` paths.
- Use Zod 4 schemas for all external data validation (DB responses, AI outputs, file reads).
- Use Kysely query builder for all raw SQL generation; never concatenate SQL strings unsafely.
- Use `date-fns` for date manipulation, not native `Date` math.
- Icons: Lucide React (`lucide-react`). Brand icons: `@icons-pack/react-simple-icons`.
- Tailwind v4 syntax: no `tailwind.config.js`; theme config lives in CSS via `@theme`.

## Testing Rules

- **Unit**: Place tests in `src/tests/unit/`. Use `jsdom` environment. Setup file: `src/tests/unit/setup.ts`.
- Mock Electron APIs and oRPC calls in unit tests; never instantiate real BrowserWindow in Vitest.
- **E2E**: Playwright config at repo root. Tests in `src/tests/e2e/`.
- E2E tests must handle the custom title bar (`titleBarStyle: hidden`) and platform-specific window chrome.
- Run `bun run check` before committing; CI will fail on lint or boundary errors.

## Database & AI Boundaries

- `scripts/check-db-boundaries.mjs` runs in `bun run check`. It enforces that DB driver imports stay within `src/ipc/db/`.
- Adding a new DB driver requires registry updates in `src/ipc/db/registry.ts` and Kysely dialect registration.
- AI streaming handlers in `src/ipc/ai/` are isolated from oRPC. If adding new AI providers, use the existing `@ai-sdk/*` pattern and keep provider logic inside `src/ipc/ai/`.

## 🚫 Never

- Do **not** modify files inside `src/components/ui/` directly. Use `bun run bump-ui` or `npx shadcn add` instead.
- Do **not** commit secrets, `.env` files, or local database files.
- Do **not** add new `ipcRenderer.invoke` channels without justification; prefer oRPC.
- Do **not** force-push to `main`.
- Do **not** run Prettier; Biome (via Ultracite) is the single source of truth for formatting.

## ⚠️ Ask First

- Adding new major dependencies (especially native modules or Electron rebuilds)
- Database schema changes (local SQLite schema used by the app)
- Changes to `forge.config.ts` (packaging, ASAR unpack rules, fuses)
- Changes to `src/preload.ts` (security boundary)
- New IPC patterns that bypass oRPC
