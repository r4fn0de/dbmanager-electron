# AI Agent Connections Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add reusable AI connection profiles for API providers and local agents (Claude Code, Codex, Pi, Oh My Pi, and OpenCode), support multiple models per connection, add an input model selector, and let agents interact safely with the database, SQL editor, workspace files, and terminal.

**Architecture:** Introduce an `AiConnectionHub` in the Electron main process with provider/agent adapters and a transport-neutral `AppToolRegistry`. API adapters use AI SDK tools directly; CLI adapters use scoped local MCP sessions and normalized streaming events. Conversations persist `connectionId` and `modelId` rather than relying on the current global provider/model.

**Tech Stack:** Electron 41, Node 22, React 19, TypeScript, AI SDK 6, oRPC for request/response APIs, raw Electron IPC for streaming, Zustand/local storage for renderer state, Zod 4 validation, electron-store/safeStorage for local settings, Vitest, Playwright, Biome/Ultracite.

---

## Implementation constraints

- Use `bun`, never npm or pnpm.
- Keep `src/features/shell/preload.ts` and `src/preload/ai.ts` as the only renderer/main bridges. Any preload change requires explicit review because it changes the security boundary.
- Keep provider/CLI processes and secrets in the main process. Never return raw API keys, CLI tokens, database passwords, or MCP bearer tokens to the renderer.
- Use oRPC for settings, connection management, discovery, and permission requests. Keep streaming and tool-approval events on raw IPC, matching the existing exception.
- Validate all renderer input and external process/API output with Zod schemas.
- Do not add database schema changes for the first version; persist connection profiles in the existing local settings mechanism.
- Before adding `@modelcontextprotocol/sdk` or another major dependency, ask for approval as required by `AGENTS.md`. Prefer the official SDK over a hand-written MCP protocol implementation once approved.
- Keep the existing global AI settings readable during migration and remove it only after migration tests and a compatibility period pass.

## Task 1: Define connection, model, capability, and session contracts

**Files:**
- Create: `src/shared/ai/connection-contracts.ts`
- Modify: `src/shared/ai/streaming-contracts.ts`
- Test: `src/tests/unit/shared/ai/connection-contracts.test.ts`

**Step 1: Write failing schema/type tests**

Cover:

- API and CLI connection discriminated unions.
- Providers: `openai`, `anthropic`, `google`, `openai-compatible`, `ollama`, `claude-code`, `codex`, `pi`, `oh-my-pi`, `opencode`.
- model entries with id, display name, custom/favorite flags, and capabilities.
- auth status without raw secret fields.
- session scope containing conversation, workspace, connection, and model IDs.
- permission scopes for database, editor, workspace, terminal, and credentials.
- rejection of invalid provider names, empty IDs, invalid workspace paths, and unknown capabilities.

Run: `bun run test:unit -- src/tests/unit/shared/ai/connection-contracts.test.ts`

Expected: FAIL because the contracts and schemas do not exist.

**Step 2: Implement the contracts and Zod schemas**

Add canonical types and runtime schemas. Keep `AiProviderName` as a compatibility alias only where the old API still requires it. Define separate `AiConnectionProvider` and `AiModelCapability` types so database connection providers cannot be confused with AI providers.

Extend `ChatStartInput` and `InlineGenerateStartInput` with optional `connectionId` and `modelId`. Extend done/error payloads with optional connection/model/session metadata. Preserve optionality until the renderer migration is complete.

**Step 3: Run the focused tests**

Run: `bun run test:unit -- src/tests/unit/shared/ai/connection-contracts.test.ts`

Expected: PASS.

**Step 4: Commit**

```bash
git add src/shared/ai/connection-contracts.ts src/shared/ai/streaming-contracts.ts src/tests/unit/shared/ai/connection-contracts.test.ts
git commit -m "feat: define AI connection contracts"
```

## Task 2: Add persisted connection profiles and migrate legacy settings

**Files:**
- Create: `src/ipc/ai/connections-store.ts`
- Modify: `src/ipc/ai/config.ts`
- Test: `src/tests/unit/ipc/ai/connections-store.test.ts`
- Test: `src/tests/unit/ipc/ai/config-migration.test.ts`

**Step 1: Write migration and persistence tests**

Test that:

- empty/new storage creates a stable default profile from the existing `provider`, `model`, base URL, Ollama URL, custom models, and API keys;
- migration is idempotent;
- legacy settings remain readable while migration is in progress;
- multiple OpenAI-compatible profiles can have different base URLs and model lists;
- model favorites/defaults are scoped to a connection;
- removing a connection cannot remove another profile's secret;
- serialized settings contain metadata but never expose an API key through the public profile result.

Run the focused Vitest files and verify failure.

**Step 2: Implement the store**

Use the existing `electron-store` instance or a dedicated versioned store. Store profile metadata, model catalog, selected/default model, CLI path/configuration, workspace defaults, and permission defaults. Store secrets separately through the existing secure API-key mechanism; do not put raw keys in renderer-facing profile objects.

Add operations:

```ts
listConnections()
getConnection(id)
createConnection(input)
updateConnection(id, patch)
deleteConnection(id)
setConnectionModels(id, models)
setDefaultModel(id, modelId)
setPermissionPolicy(id, policy)
```

Implement a migration version and preserve the legacy global selection as the default connection for existing installations.

**Step 3: Run tests and inspect serialized output**

Run: `bun run test:unit -- src/tests/unit/ipc/ai/connections-store.test.ts src/tests/unit/ipc/ai/config-migration.test.ts`

Expected: PASS, with assertions that raw secrets are absent from public results.

**Step 4: Commit**

```bash
git add src/ipc/ai/connections-store.ts src/ipc/ai/config.ts src/tests/unit/ipc/ai/connections-store.test.ts src/tests/unit/ipc/ai/config-migration.test.ts
git commit -m "feat: persist multiple AI connections"
```

## Task 3: Create the adapter interface and API-provider adapter

**Files:**
- Create: `src/ipc/ai/adapters/types.ts`
- Create: `src/ipc/ai/adapters/api-provider-adapter.ts`
- Modify: `src/ipc/ai/config.ts`
- Test: `src/tests/unit/ipc/ai/api-provider-adapter.test.ts`

**Step 1: Write adapter tests**

Mock AI SDK factories and test:

- resolving a connection-specific API key/base URL/model;
- OpenAI, Anthropic, Google, Ollama, and OpenAI-compatible model construction;
- custom OpenAI-compatible profiles do not read the old global URL;
- missing required credentials produce actionable errors;
- invalid URLs and invalid models are rejected before a request starts;
- capability metadata is returned consistently.

**Step 2: Implement the common adapter interface**

Define adapter methods for detection, authentication, model discovery, session start/send/abort/dispose, and capability reporting. Keep the interface independent of AI SDK and CLI-specific event types.

Move provider factory logic out of the global-only path in `config.ts`. Retain `getCurrentModel()` as a compatibility wrapper that resolves the migrated default connection.

**Step 3: Implement API adapter sessions**

Use `streamText`/`generateText` with the resolved connection and model. Reuse existing timeout, smooth-stream, memory, and error normalization behavior. Make tool injection depend on the session permission scope rather than the global provider.

**Step 4: Run focused tests**

Run: `bun run test:unit -- src/tests/unit/ipc/ai/api-provider-adapter.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/ipc/ai/adapters src/ipc/ai/config.ts src/tests/unit/ipc/ai/api-provider-adapter.test.ts
git commit -m "feat: resolve AI models through connection adapters"
```

## Task 4: Add connection-management oRPC handlers

**Files:**
- Create: `src/ipc/ai/connection-handlers.ts`
- Modify: `src/ipc/ai/index.ts`
- Modify: `src/ipc/router.ts`
- Modify: `src/features/ai/hooks/ai-actions.ts`
- Test: `src/tests/unit/ipc/ai/connection-handlers.test.ts`

**Step 1: Write handler tests**

Cover list/get/create/update/delete, default-model updates, connection validation, masked auth status, and error mapping to `ORPCError`. Ensure raw credentials are never returned.

**Step 2: Implement handlers and renderer wrappers**

Expose oRPC procedures for connection profiles, model lists, connection tests, CLI detection, and authentication requests. Use Zod input schemas and return only public metadata.

Add typed functions in `ai-actions.ts` for the renderer without leaking oRPC error internals.

**Step 3: Register the handlers**

Aggregate them in `src/ipc/ai/index.ts` and keep the root router shape consistent with the existing `ai` module.

**Step 4: Run tests and typecheck**

Run: `bun run test:unit -- src/tests/unit/ipc/ai/connection-handlers.test.ts`

Run: `tsc --noEmit --pretty false`

Expected: PASS and no type errors.

**Step 5: Commit**

```bash
git add src/ipc/ai/connection-handlers.ts src/ipc/ai/index.ts src/ipc/router.ts src/features/ai/hooks/ai-actions.ts src/tests/unit/ipc/ai/connection-handlers.test.ts
git commit -m "feat: expose AI connection management APIs"
```

## Task 5: Introduce the connection-aware streaming hub

**Files:**
- Create: `src/ipc/ai/connection-hub.ts`
- Modify: `src/ipc/ai/streaming.ts`
- Modify: `src/shared/ai/streaming-contracts.ts`
- Modify: `src/preload/ai.ts`
- Modify: `src/renderer/types/window-ai.d.ts`
- Test: `src/tests/unit/ipc/ai/connection-hub.test.ts`
- Test: `src/tests/unit/ipc/ai/streaming-selection.test.ts`

**Step 1: Write failing hub/selection tests**

Test that:

- a valid `connectionId` + `modelId` resolves the requested adapter/model;
- missing IDs resolve only through the migrated default compatibility path;
- a model from another connection is rejected;
- abort targets only the selected session;
- normalized done/error events include connection/model/session metadata;
- selecting a CLI connection never silently falls back to an API model.

**Step 2: Implement the hub**

Create lifecycle maps keyed by session ID and route start/send/abort/dispose through the selected adapter. Keep active approval maps scoped by chat/session, not only chat ID. Preserve the current sender `WebContents` safety checks.

**Step 3: Update streaming contracts and preload bridge**

Add the typed fields to the existing `window.ai` streaming API. Do not expose Node APIs or child-process controls. Keep all new request/response management on oRPC; only add the minimal streaming metadata needed by the renderer.

This task changes the preload security boundary and must be reviewed before implementation.

**Step 4: Update the existing stream implementation**

Replace direct `getCurrentModel()` calls in chat/inline paths with hub resolution. Keep legacy SQL helpers resolving the migrated default profile when no explicit model is provided.

**Step 5: Run focused tests**

Run: `bun run test:unit -- src/tests/unit/ipc/ai/connection-hub.test.ts src/tests/unit/ipc/ai/streaming-selection.test.ts`

Run: `tsc --noEmit --pretty false`

Expected: PASS.

**Step 6: Commit**

```bash
git add src/ipc/ai/connection-hub.ts src/ipc/ai/streaming.ts src/shared/ai/streaming-contracts.ts src/preload/ai.ts src/renderer/types/window-ai.d.ts src/tests/unit/ipc/ai/connection-hub.test.ts src/tests/unit/ipc/ai/streaming-selection.test.ts
git commit -m "feat: route AI streaming through selected connections"
```

## Task 6: Build the transport-neutral AppToolRegistry

**Files:**
- Create: `src/ipc/ai/tools/app-tool-registry.ts`
- Create: `src/ipc/ai/tools/tool-permissions.ts`
- Modify: `src/ipc/ai/tools.ts`
- Test: `src/tests/unit/ipc/ai/app-tool-registry.test.ts`
- Test: `src/tests/unit/ipc/ai/tool-permissions.test.ts`

**Step 1: Write permission and registry tests**

Test automatic reads, SELECT detection, mutation approval, terminal approval, workspace boundary enforcement, credential denial, argument validation, output truncation, and unknown-tool rejection.

Pin tests for:

- `../` traversal and symlink escape from workspace;
- SQL comments/strings not bypassing mutation classification;
- terminal commands receiving a constrained cwd/environment;
- approval cancellation and timeout;
- results never containing connection passwords or API keys.

**Step 2: Implement permission policy**

Create a policy evaluator returning `allow`, `ask`, or `deny`, with a reason and sanitized preview. Scope every decision by session, connection, workspace, and tool.

**Step 3: Implement the registry**

Define tool schemas with Zod and handlers for database, editor, workspace, terminal, and app state. Reuse existing DB actions and approval plumbing where possible. Keep the old SQL tools as wrappers or aliases until all callers migrate.

**Step 4: Add editor/app command routing**

Use a main-process command/event bridge to ask the renderer to read active editor state or apply a SQL/file diff. Require an acknowledgement/result and never manipulate renderer DOM from the main process.

**Step 5: Run focused tests**

Run: `bun run test:unit -- src/tests/unit/ipc/ai/app-tool-registry.test.ts src/tests/unit/ipc/ai/tool-permissions.test.ts`

Expected: PASS.

**Step 6: Commit**

```bash
git add src/ipc/ai/tools src/ipc/ai/tools.ts src/tests/unit/ipc/ai/app-tool-registry.test.ts src/tests/unit/ipc/ai/tool-permissions.test.ts
git commit -m "feat: add scoped TarsDB agent tools"
```

## Task 7: Add approval events for editor, files, and terminal

**Files:**
- Modify: `src/shared/ai/streaming-contracts.ts`
- Modify: `src/constants/index.ts`
- Modify: `src/ipc/ai/streaming.ts`
- Modify: `src/preload/ai.ts`
- Modify: `src/features/ai/hooks/useAiChat.ts`
- Modify: `src/features/ai/components/ai-elements/tool.tsx`
- Test: `src/tests/unit/features/ai/useAiChatApprovals.test.tsx`

**Step 1: Write renderer approval tests**

Cover rendering a pending file/terminal/editor approval, showing sanitized preview/warnings, approving, rejecting, and handling session cancellation.

**Step 2: Extend approval payloads**

Add operation category, scope, preview/diff, and risk metadata without changing the existing database mutation approval shape incompatibly.

**Step 3: Implement event routing and UI state**

Reuse `window.ai.toolApproval` and add only the fields needed to distinguish categories. Ensure pending approvals are settled on abort, window destruction, timeout, and adapter failure.

**Step 4: Run focused tests**

Run: `bun run test:unit -- src/tests/unit/features/ai/useAiChatApprovals.test.tsx`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/shared/ai/streaming-contracts.ts src/constants/index.ts src/ipc/ai/streaming.ts src/preload/ai.ts src/features/ai/hooks/useAiChat.ts src/features/ai/components/ai-elements/tool.tsx src/tests/unit/features/ai/useAiChatApprovals.test.tsx
git commit -m "feat: approve agent file and terminal actions"
```

## Task 8: Implement CLI detection and process supervision

**Files:**
- Create: `src/ipc/ai/agents/cli-runtime.ts`
- Create: `src/ipc/ai/agents/installation-detection.ts`
- Create: `src/ipc/ai/adapters/cli-agent-adapter.ts`
- Test: `src/tests/unit/ipc/ai/cli-runtime.test.ts`
- Test: `src/tests/unit/ipc/ai/installation-detection.test.ts`

**Step 1: Write process lifecycle tests**

Mock `node:child_process` and test executable resolution, custom binary paths, login-shell PATH discovery, stdout/stderr redaction, process exit, abort/kill escalation, timeout, and no secret leakage in diagnostics.

**Step 2: Implement safe process supervision**

Use `spawn` with argument arrays, never shell interpolation. Track child process, workspace cwd, sanitized environment, exit status, and cancellation. Apply output size/time limits and redact credential-like values before logging or streaming.

**Step 3: Implement installation probes**

Add provider-specific command names and probe hooks for Claude Code, Codex, Pi, OMP, and OpenCode. Return installation/auth/model capability metadata, not raw config contents.

**Step 4: Run tests**

Run: `bun run test:unit -- src/tests/unit/ipc/ai/cli-runtime.test.ts src/tests/unit/ipc/ai/installation-detection.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/ipc/ai/agents src/ipc/ai/adapters/cli-agent-adapter.ts src/tests/unit/ipc/ai/cli-runtime.test.ts src/tests/unit/ipc/ai/installation-detection.test.ts
git commit -m "feat: supervise local AI agent processes"
```

## Task 9: Add ACP adapters and authentication flows

**Files:**
- Create: `src/ipc/ai/adapters/acp-agent-adapter.ts`
- Create: `src/ipc/ai/agents/acp-protocol.ts`
- Modify: `src/ipc/ai/agents/installation-detection.ts`
- Modify: `src/ipc/ai/connection-handlers.ts`
- Test: `src/tests/unit/ipc/ai/acp-agent-adapter.test.ts`

**Step 1: Obtain dependency approval**

Before installing an ACP or MCP SDK, present the dependency and its security/licensing/runtime impact for approval. If approved, add it with `bun add` and update the lockfile. If not approved, use the smallest existing-compatible transport only after documenting the trade-off.

**Step 2: Write protocol adapter tests**

Mock initialize/authenticate/session/new/session/prompt/abort messages. Cover malformed responses, unknown capabilities, model list caching, auth failures, session cleanup, and tool-call event normalization.

**Step 3: Implement ACP normalization**

Implement the common ACP lifecycle for agents that advertise ACP support. Normalize text, reasoning, model availability, tool calls, tool results, and auth methods into the TarsDB contracts. Keep provider-specific authentication labels and commands in descriptors.

**Step 4: Add provider descriptors**

Define Claude Code and Codex descriptors first. Add Pi/OMP/OpenCode descriptors using runtime capability detection rather than assuming identical flags or auth files.

**Step 5: Run tests and typecheck**

Run: `bun run test:unit -- src/tests/unit/ipc/ai/acp-agent-adapter.test.ts`

Run: `tsc --noEmit --pretty false`

Expected: PASS.

**Step 6: Commit**

```bash
git add package.json bun.lock src/ipc/ai/adapters src/ipc/ai/agents src/ipc/ai/connection-handlers.ts src/tests/unit/ipc/ai/acp-agent-adapter.test.ts
git commit -m "feat: integrate local AI agent authentication and ACP"
```

## Task 10: Add scoped local MCP sessions for CLI agents

**Files:**
- Create: `src/ipc/ai/mcp/session-server.ts`
- Create: `src/ipc/ai/mcp/session-scope.ts`
- Create: `src/ipc/ai/mcp/provider-config.ts`
- Modify: `src/ipc/ai/connection-hub.ts`
- Modify: `src/ipc/ai/adapters/cli-agent-adapter.ts`
- Test: `src/tests/unit/ipc/ai/mcp-session-server.test.ts`
- Test: `src/tests/unit/ipc/ai/mcp-session-scope.test.ts`

**Step 1: Write security tests**

Test loopback-only binding, random port allocation, bearer-token validation, session/connection/workspace/tool scope, token revocation, server shutdown, request size limits, and redaction of MCP errors.

**Step 2: Implement scoped session lifecycle**

Start one MCP server per active agent session, register the `AppToolRegistry`, issue an opaque token, and destroy/revoke it on session end, abort, process exit, or window destruction.

**Step 3: Implement CLI configuration injection**

For each agent descriptor, inject only the required MCP endpoint/token through a temporary config or environment mechanism. Preserve the user's existing config and restore temporary files in `finally` blocks. Never write a token to permanent project configuration.

**Step 4: Run tests**

Run: `bun run test:unit -- src/tests/unit/ipc/ai/mcp-session-server.test.ts src/tests/unit/ipc/ai/mcp-session-scope.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/ipc/ai/mcp src/ipc/ai/connection-hub.ts src/ipc/ai/adapters/cli-agent-adapter.ts src/tests/unit/ipc/ai/mcp-session-server.test.ts src/tests/unit/ipc/ai/mcp-session-scope.test.ts
git commit -m "feat: expose scoped app tools to CLI agents"
```

## Task 11: Persist connection/model selection in chat state

**Files:**
- Modify: `src/features/ai/hooks/useAiChat.ts`
- Modify: `src/features/ai/components/AiChatPanel.tsx`
- Modify: `src/shared/ai/streaming-contracts.ts`
- Test: `src/tests/unit/useAiChat.test.tsx`

**Step 1: Write state migration tests**

Cover old conversations without selection, new conversations with selection, selection changes between messages, chat reload, abort, retry, and a selected model disappearing from the catalog.

**Step 2: Extend conversation state**

Add optional `aiConnectionId`, `aiModelId`, and `aiSessionId` to conversations/messages as appropriate. Keep old local-storage versions readable and migrate them without dropping messages.

**Step 3: Update send/abort flow**

Pass the selected connection/model into `window.ai.chat.start`. Keep the active database connection and inline database mentions independent from the AI connection selection.

**Step 4: Run tests**

Run: `bun run test:unit -- src/tests/unit/useAiChat.test.tsx`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/features/ai/hooks/useAiChat.ts src/features/ai/components/AiChatPanel.tsx src/shared/ai/streaming-contracts.ts src/tests/unit/useAiChat.test.tsx
git commit -m "feat: persist AI connection selection per conversation"
```

## Task 12: Build renderer connection state and input selector

**Files:**
- Create: `src/features/ai/hooks/useAiConnections.ts`
- Create: `src/features/ai/components/AiConnectionPicker.tsx`
- Create: `src/features/ai/components/AiModelOptionList.tsx`
- Modify: `src/features/ai/components/AiChatPanel.tsx`
- Modify: `src/components/ui/prompt-input.tsx` only if the selector needs a composition slot
- Test: `src/tests/unit/features/ai/components/AiConnectionPicker.test.tsx`
- Test: `src/tests/unit/features/ai/hooks/useAiConnections.test.tsx`

**Step 1: Write picker tests**

Cover grouping by connection, multiple models, favorites, search, selected state, missing auth, loading/error states, keyboard navigation, and preserving inline mention behavior.

**Step 2: Implement the query/state hook**

Load connection metadata through oRPC, refresh model catalogs on demand, persist favorites/defaults, and expose actions for selecting a connection/model and opening configuration.

**Step 3: Implement the picker**

Render a compact selector near the prompt input. Keep context chips above the contentEditable editor. Use accessible buttons/menu semantics and show provider icon, connection name, model, auth status, and capabilities.

**Step 4: Wire selection into `AiChatPanel`**

Use the active conversation selection as the source of truth. Selecting a provider/model must affect the next message without changing database tabs or mentions.

**Step 5: Run tests and lint**

Run: `bun run test:unit -- src/tests/unit/features/ai/components/AiConnectionPicker.test.tsx src/tests/unit/features/ai/hooks/useAiConnections.test.tsx`

Run: `bun x biome check src/features/ai/hooks/useAiConnections.ts src/features/ai/components/AiConnectionPicker.tsx src/features/ai/components/AiModelOptionList.tsx src/features/ai/components/AiChatPanel.tsx`

Expected: PASS with no diagnostics.

**Step 6: Commit**

```bash
git add src/features/ai/hooks/useAiConnections.ts src/features/ai/components/AiConnectionPicker.tsx src/features/ai/components/AiModelOptionList.tsx src/features/ai/components/AiChatPanel.tsx src/components/ui/prompt-input.tsx src/tests/unit/features/ai/components/AiConnectionPicker.test.tsx src/tests/unit/features/ai/hooks/useAiConnections.test.tsx
git commit -m "feat: add AI connection and model picker"
```

## Task 13: Replace the single-provider settings UI with connection management

**Files:**
- Create: `src/features/ai/components/AiConnectionsPanel.tsx`
- Create: `src/features/ai/components/AiConnectionEditor.tsx`
- Create: `src/features/ai/components/AiAgentStatusRow.tsx`
- Modify: `src/features/ai/components/AiSettingsPanel.tsx`
- Modify: `src/features/ai/hooks/ai-actions.ts`
- Test: `src/tests/unit/features/ai/components/AiConnectionsPanel.test.tsx`

**Step 1: Write settings tests**

Cover add/edit/delete, duplicate profile, API key masking, base URL validation, add/remove several models, manual model entry, refresh discovery, CLI detection, login action, test connection, default model, and migration banner/empty state.

**Step 2: Implement the connections panel**

Replace provider cards with a connection list while retaining privacy settings. Each row shows provider type, auth status, model count, default model, and actions. OpenAI-compatible profiles must have independent base URLs and model lists.

**Step 3: Implement API and agent editors**

Use separate fields for API profiles and CLI agent profiles. Keep secret inputs write-only, show masked metadata, and avoid putting raw values into React state after save where possible.

**Step 4: Add model management**

Support discovered models, manual model IDs, favorites, default model selection, and stale-catalog refresh.

**Step 5: Run tests and typecheck**

Run: `bun run test:unit -- src/tests/unit/features/ai/components/AiConnectionsPanel.test.tsx`

Run: `tsc --noEmit --pretty false`

Expected: PASS.

**Step 6: Commit**

```bash
git add src/features/ai/components/AiConnectionsPanel.tsx src/features/ai/components/AiConnectionEditor.tsx src/features/ai/components/AiAgentStatusRow.tsx src/features/ai/components/AiSettingsPanel.tsx src/features/ai/hooks/ai-actions.ts src/tests/unit/features/ai/components/AiConnectionsPanel.test.tsx
git commit -m "feat: manage AI provider and agent connections"
```

## Task 14: Add workspace and terminal context plumbing

**Files:**
- Create: `src/ipc/ai/workspace-tools.ts`
- Create: `src/ipc/ai/terminal-tools.ts`
- Modify: `src/ipc/ai/tools/app-tool-registry.ts`
- Modify: `src/features/ai/components/AiChatPanel.tsx`
- Modify: `src/features/shell/main.ts` only if workspace/process lifecycle registration requires it
- Test: `src/tests/unit/ipc/ai/workspace-tools.test.ts`
- Test: `src/tests/unit/ipc/ai/terminal-tools.test.ts`

**Step 1: Write safety tests**

Cover workspace root resolution, read/search limits, patch previews, write approval, terminal cwd, environment filtering, command timeout, output truncation, process cancellation, and cleanup.

**Step 2: Implement workspace tools**

Resolve workspace roots from the selected connection/session, reject escapes, redact sensitive files by default, and return bounded file content/search results. Generate unified diffs for writes and patches.

**Step 3: Implement terminal tools**

Use supervised child processes with explicit argument arrays, constrained cwd/env, timeout, output limits, and approval metadata. Never execute an agent-provided shell string through an unrestricted shell by default.

**Step 4: Surface previews in chat**

Render file diffs, terminal command previews, and database mutation previews in the existing tool UI. Keep approval responses correlated to the session.

**Step 5: Run tests**

Run: `bun run test:unit -- src/tests/unit/ipc/ai/workspace-tools.test.ts src/tests/unit/ipc/ai/terminal-tools.test.ts`

Expected: PASS.

**Step 6: Commit**

```bash
git add src/ipc/ai/workspace-tools.ts src/ipc/ai/terminal-tools.ts src/ipc/ai/tools/app-tool-registry.ts src/features/ai/components/AiChatPanel.tsx src/tests/unit/ipc/ai/workspace-tools.test.ts src/tests/unit/ipc/ai/terminal-tools.test.ts
 git commit -m "feat: add scoped workspace and terminal tools"
```

## Task 15: Add end-to-end coverage and compatibility tests

**Files:**
- Modify: `src/tests/e2e/ai-chat.spec.ts` if present, otherwise create it
- Create: `src/tests/e2e/ai-connections.spec.ts`
- Create: `src/tests/e2e/ai-agent-permissions.spec.ts`
- Modify: `playwright.config.ts` only if agent fixtures need a controlled test server
- Create: `src/tests/unit/ipc/ai/fixtures/mock-agent-runtime.ts`

**Step 1: Add deterministic mock fixtures**

Create mock API and CLI runtimes that stream text, advertise multiple models, request tools, fail authentication, hang, and exit unexpectedly. Do not run real CLIs in the default CI suite.

**Step 2: Add picker/settings E2E tests**

Cover migrated default connection, adding an OpenAI-compatible profile, adding several models, selecting a model in the input, refreshing, and persistence after reload.

**Step 3: Add agent interaction E2E tests**

Cover schema read, SELECT, SQL editor preview, file diff approval, terminal approval/rejection, session abort, and unavailable-agent error states.

**Step 4: Add optional real-runtime smoke tests**

Gate real CLI checks behind explicit environment variables such as `TARSDB_AGENT_SMOKE=1`. Detect missing CLIs and mark the test as skipped with a clear reason; never require credentials in normal CI.

**Step 5: Run the suites**

Run:

```bash
bun run test
tsc --noEmit
bun run check
bun run test:e2e -- ai-connections.spec.ts ai-agent-permissions.spec.ts
```

Expected: all unit tests, typecheck, lint/boundary checks, and deterministic E2E tests pass.

**Step 6: Commit**

```bash
git add src/tests/e2e src/tests/unit/ipc/ai/fixtures src/tests/unit/ipc/ai playwright.config.ts
git commit -m "test: cover AI connections and agent permissions"
```

## Task 16: Documentation, migration verification, and release checklist

**Files:**
- Modify: `docs/plans/2026-08-13-ai-agent-connections-design.md` only if implementation decisions materially change
- Create: `docs/ai-connections.md`
- Create: `docs/ai-agent-security.md`
- Modify: `README.md` only if user-facing setup instructions belong there

**Step 1: Document setup**

Document supported providers/agents, installation detection, login methods, OpenAI-compatible profiles, model discovery, workspace selection, and permission behavior.

**Step 2: Document security**

Document secret storage, MCP loopback/token scope, workspace boundaries, terminal restrictions, approval behavior, logging redaction, and what agents cannot access.

**Step 3: Run final validation**

Run:

```bash
git diff --check
tsc --noEmit --pretty false
bun run check
bun run test
bun run test:e2e
```

Manually verify:

- existing users receive one migrated connection;
- no API key appears in renderer devtools, chat payloads, logs, or MCP config files after cleanup;
- selecting a model changes only the AI session, not database tab/mention state;
- aborting a CLI kills the process and revokes MCP access;
- destructive database/file/terminal operations always require confirmation.

**Step 4: Commit**

```bash
git add docs/ai-connections.md docs/ai-agent-security.md README.md
git commit -m "docs: document AI connections and agent security"
```

## Final verification checklist

- [ ] `tsc --noEmit --pretty false` passes.
- [ ] `bun run check` passes, including database-boundary checks.
- [ ] `bun run test` passes.
- [ ] Deterministic Playwright AI connection and permission tests pass.
- [ ] Real-agent smoke tests are opt-in and do not require secrets in CI.
- [ ] Preload changes were explicitly reviewed.
- [ ] Any new major dependency was explicitly approved.
- [ ] No raw secret, database credential, or temporary MCP token is committed or logged.
