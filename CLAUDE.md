# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun install                # install dependencies
bun run start              # dev mode (electron-forge + vite HMR)
bun run check              # lint (ultracite/biome) + db boundary checks
bun run fix                # auto-fix lint issues
bun run test               # unit tests (vitest, once)
bun run test:watch         # unit tests in watch mode
bun run test:e2e           # playwright e2e tests
bun run test:all           # unit + e2e
bun run package            # package app for current platform
bun run make               # create installers
```

Run a single unit test: `bunx vitest run src/tests/unit/some.test.ts`

Unit tests live in `src/tests/unit/` (vitest + jsdom). E2E tests in `src/tests/e2e/` (playwright).

## Architecture

**Tars** — an Electron desktop database manager supporting PostgreSQL, MySQL/MariaDB, SQLite, ClickHouse, and Redis.

### Process model

- **Main process** (`src/main.ts`): window lifecycle, database drivers, oRPC server, AI streaming handlers, auto-updater.
- **Renderer** (`src/app.tsx`): React 19 app with TanStack Router (file-based routes in `src/routes/`).
- **Preload** (`src/preload.ts`): context-isolated bridge; exposes `window.electron` for AI streaming channels that bypass oRPC.

### IPC

All request/response IPC goes through **oRPC over MessagePort** — type-safe RPC between renderer and main.

- Client: `src/ipc/manager.ts` — singleton `IPCManager` creates a `MessageChannel`, sends the server port to main via `postMessage`.
- Server: handlers registered per domain in `src/ipc/` subdirectories.
- Router: `src/ipc/router.ts` aggregates namespaces: `theme`, `window`, `app`, `shell`, `db`, `ai`.
- Call pattern in renderer: `ipc.client.db.executeQuery(...)`.

**Exception**: AI streaming (chat + inline SQL) uses raw Electron `ipcMain`/`ipcRenderer` events because oRPC doesn't natively support streaming. Channels defined in constants, handlers in `src/ipc/ai/streaming.ts`.

### Database layer

Driver registry pattern in `src/ipc/db/`:

- `driver.ts` — `DatabaseDriver` interface every engine implements (connection, queries, schema introspection, DDL, data export).
- `registry.ts` — `DriverRegistry` singleton maps `DatabaseType` → driver instance; drivers lazy-loaded at startup.
- Implementations: `pg-driver-adapter.ts`, `mysql-client.ts`, `sqlite-driver.ts`, `clickhouse-client.ts`, `redis-driver.ts`.
- `kysely-factory.ts` — centralized Kysely connection pooling for PostgreSQL and MySQL.
- `local-db-manager.ts` — manages embedded PostgreSQL (`embedded-postgres`) and SQLite instances with auto-start, port allocation, metadata in `~/.config/TarsDB/local-databases.json`.
- `handlers.ts` — oRPC handlers that delegate to the appropriate driver via the registry.

`scripts/check-db-boundaries.mjs` enforces that renderer code never imports database drivers directly (run via `bun run check`).

### AI integration

Uses Vercel AI SDK with provider adapters (Anthropic, OpenAI, Google, OpenAI-compatible).

- `src/ipc/ai/handlers.ts` — settings, API key management, SQL fix (non-streaming).
- `src/ipc/ai/streaming.ts` — event-based streaming for chat and inline SQL generation.
- `src/ipc/ai/tools.ts` — AI tools that introspect the database (schema, table samples) for context-aware responses.
- `src/ipc/ai/memory-handlers.ts` — persistent conversation memory.

### Frontend

- **React 19** with React Compiler enabled.
- **TanStack Router** — file-based routing in `src/routes/`. Main route: `database.$connectionId.tsx`.
- **TanStack React Query** — data fetching/caching for all IPC calls.
- **Zustand** — stores in `src/lib/stores/` with `persist` middleware (connection tabs, AI chat state).
- **shadcn/ui + Radix + Tailwind CSS v4** — UI components in `src/components/ui/`.
- **Monaco Editor** — SQL editor with inline AI suggestions.

### Key paths

| Area | Path |
|------|------|
| DB drivers | `src/ipc/db/{pg,mysql,sqlite,clickhouse,redis}-*.ts` |
| IPC handlers | `src/ipc/{ai,db,theme,window,shell,app}/` |
| React components | `src/components/` |
| Zustand stores | `src/lib/stores/` |
| Hooks | `src/hooks/` |
| Routes | `src/routes/` |
| Types | `src/types/`, `src/ipc/db/types.ts` |
| Shared (cross-process) | `src/shared/` |

## Code style

- **Linter**: Ultracite (Biome underneath). Config in `biome.jsonc`. shadcn/ui components excluded from lint.
- **TypeScript**: strict mode, `@/*` path alias to `src/`. Target ESNext.
- Prefer `unknown` over `any`. Use const assertions, optional chaining, nullish coalescing.
- Arrow functions for callbacks. `for...of` over `.forEach()`.
- Function components only. Hooks at top level.
- No `console.log`, `debugger`, or `alert` in production code.

## Build

Electron Forge v7 + Vite 8 with separate configs: `vite.main.config.mts`, `vite.preload.config.mts`, `vite.renderer.config.mts`. Native modules (`embedded-postgres`, `better-sqlite3`) are configured for unpacking in `forge.config.ts`.
