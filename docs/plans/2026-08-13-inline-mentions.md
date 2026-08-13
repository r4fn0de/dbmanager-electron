# Menções Inline no PromptInput — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Render selected connection mentions as editable inline chips inside the AI prompt while preserving the current serialized prompt and mention resolution flow.

**Architecture:** Add a dependency-free `contentEditable` editor path to `PromptInputTextarea`. The editor renders selected mention tokens as `contenteditable="false"` inline spans, serializes the DOM back to the existing `value` string, and maps DOM selection ranges to serialized cursor offsets. Update `useMentions` to keep the selected `@connection` token in the value and integrate the editor's cursor/removal callbacks in `AiChatPanel`.

**Tech Stack:** React 19, TypeScript, existing shadcn/Tailwind primitives, Vitest + jsdom, Biome/Ultracite.

---

### Task 1: Define and test inline mention segmentation and DOM offset helpers

**Files:**
- Create: `src/components/ui/prompt-input-mentions.ts`
- Create: `src/tests/unit/components/ui/prompt-input-mentions.test.ts`

**Step 1: Write the failing tests**

Cover:
- splitting `"antes @Produção depois"` into text/mention/text when `Produção` is selected;
- keeping unselected `@texto` as plain text;
- preserving mention token start/end offsets;
- serializing a DOM containing text nodes, a `data-prompt-mention-token` span, and `<br>` back to the original prompt;
- calculating the cursor offset before and after a non-editable mention span;
- treating duplicate selected connection names consistently.

**Step 2: Run the focused tests**

Run: `bun run test:unit -- src/tests/unit/components/ui/prompt-input-mentions.test.ts`

Expected: FAIL because the helper module does not exist yet.

**Step 3: Implement the pure helpers**

Add typed segment data for plain text and inline mentions. Match only complete selected tokens (`@${label}`) at valid token boundaries, return source offsets, and use `data-prompt-mention-token` as the canonical serialized value for DOM spans. Implement DOM traversal that counts text nodes normally, `<br>` as `\n`, and mention spans by their token length.

**Step 4: Run the focused tests again**

Run: `bun run test:unit -- src/tests/unit/components/ui/prompt-input-mentions.test.ts`

Expected: PASS.

**Step 5: Commit the isolated helper work**

```bash
git add src/components/ui/prompt-input-mentions.ts src/tests/unit/components/ui/prompt-input-mentions.test.ts
git commit -m "test: define inline prompt mention helpers"
```

---

### Task 2: Add the dependency-free inline editor path to PromptInput

**Files:**
- Modify: `src/components/ui/prompt-input.tsx:8-240`
- Modify: `src/tests/unit/components/ui/prompt-input-mentions.test.ts`

**Step 1: Extend the editor contract**

Add exported types for an inline mention (`id`, `label`) and an imperative editor handle (`focus`, `setCursorPosition`, `getCursorPosition`). Extend `PromptInputContext` with the cursor callback and change its internal focus ref to the editor handle. Keep the existing controlled `value`, `onValueChange`, autosize, submit, disabled, and external keydown contracts.

**Step 2: Add the inline editor props**

Support `inlineMentions`, `onInlineMentionRemove`, and `onCursorChange` on `PromptInputTextarea`. Add an optional renderer callback so the AI feature can reuse its existing `MentionChip` visual without importing feature code into shared UI. The default renderer should still produce an accessible text chip if no callback is supplied.

**Step 3: Render serialized text and selected mentions**

Replace the textarea DOM for this path with a `contentEditable` div containing text nodes, `<br>` for newlines, and non-editable mention spans. Rebuild the DOM only when the controlled value or mention signature changes; do not rebuild after an input event whose serialized value already matches, so native selection and focus remain stable. Add placeholder and autosize behavior equivalent to the current textarea.

**Step 4: Handle input, cursor, and deletion**

On input, serialize the editor DOM, calculate the serialized cursor offset, call `setValue`, then call the cursor callback with both value and offset. Intercept Backspace/Delete when the caret is adjacent to a mention, prevent partial editing, remove the complete token, call `onInlineMentionRemove` with its id and range, and restore the caret. Preserve external keydown handling and the existing Enter/Shift+Enter submit behavior.

**Step 5: Verify the editor behavior**

Add jsdom assertions for rendered mention spans, serialized input values, and the imperative cursor API where the environment supports selection APIs. Keep DOM-specific edge cases covered by the helper tests from Task 1.

Run: `bun run test:unit -- src/tests/unit/components/ui/prompt-input-mentions.test.ts`

Expected: PASS.

---

### Task 3: Preserve selected mention tokens in useMentions

**Files:**
- Modify: `src/features/ai/hooks/useMentions.ts:13-182`
- Create: `src/tests/unit/features/ai/hooks/useMentions.test.ts`

**Step 1: Write the failing hook tests**

Cover selecting a connection at the beginning, middle, and end of a prompt. Assert that the returned text contains `@${connection.name}`, that spacing remains natural, and that the returned cursor is after the inserted token/trailing separator. Cover removing and clearing selected mentions without changing unrelated map entries.

**Step 2: Run the focused tests**

Run: `bun run test:unit -- src/tests/unit/features/ai/hooks/useMentions.test.ts`

Expected: FAIL because selection currently removes the trigger token instead of replacing it with the completed mention.

**Step 3: Update selection and removal behavior**

Change `selectMention` to replace the incomplete `@query` with the complete `@connection.name` token, add a separator only when the surrounding text needs one, and return the correct serialized cursor position. Keep `selectedMentions` as the source of connection metadata. Generalize the keydown event type to the contentEditable element used by the prompt editor.

**Step 4: Run the focused tests again**

Run: `bun run test:unit -- src/tests/unit/features/ai/hooks/useMentions.test.ts`

Expected: PASS.

**Step 5: Commit the hook work**

```bash
git add src/features/ai/hooks/useMentions.ts src/tests/unit/features/ai/hooks/useMentions.test.ts
git commit -m "feat: preserve selected mention tokens in prompts"
```

---

### Task 4: Integrate inline mentions into AiChatPanel

**Files:**
- Modify: `src/features/ai/components/AiChatPanel.tsx:1200-1480,1840-2025`
- Modify: `src/features/ai/components/MentionChip.tsx:126-180`

**Step 1: Adapt refs and cursor callbacks**

Change the prompt ref to the new editor handle. Pass the editor's serialized cursor callback into `handleTextChange` instead of reading `selectionStart` from a textarea. Update mention selection to call `setCursorPosition(result.cursorPos)` after the controlled value update.

**Step 2: Build inline mention metadata**

Derive the selected mention descriptors from `selectedMentions`. Pass them to `PromptInputTextarea` and render each descriptor with `MentionChip` without the hover remove button, so the chip remains inline and the editor owns atomic keyboard removal. Keep the existing selected connection map for submit-time resolution.

**Step 3: Remove the separate mention row**

Keep the context-chip row for selection/table/error chips, but stop rendering `selectedMentions` there. Ensure `hasChips` still accounts for context chips and no longer adds extra top padding only because a mention is selected.

**Step 4: Wire atomic mention removal**

When the editor reports an inline mention range, remove that exact token from `input`, remove its connection from `selectedMentions`, and restore the caret at the deletion point. Ensure clicking/focusing the prompt still targets the editor handle.

**Step 5: Run the relevant checks**

Run: `bun run test:unit -- src/tests/unit/features/ai/hooks/useMentions.test.ts src/tests/unit/components/ui/prompt-input-mentions.test.ts`

Expected: PASS.

---

### Task 5: Format, typecheck, and run the project checks

**Files:**
- Modify only files changed by Tasks 1–4 if formatting requires it.

**Step 1: Apply project formatting**

Run: `bun x ultracite fix`

Expected: formatting completes without introducing unrelated file changes.

**Step 2: Run typecheck**

Run: `tsc --noEmit`

Expected: PASS with no type errors for the new editor handle, DOM event types, or mention renderer.

**Step 3: Run focused and full unit tests**

Run: `bun run test:unit -- src/tests/unit/components/ui/prompt-input-mentions.test.ts src/tests/unit/features/ai/hooks/useMentions.test.ts`

Then run: `bun run test`

Expected: PASS.

**Step 4: Run lint and database boundary checks**

Run: `bun run check`

Expected: PASS; no database-boundary changes are expected.

**Step 5: Manually verify the interaction matrix**

In the AI chat panel, verify:
- mention at the start, middle, and end of a sentence;
- multiple mentions and normal text between them;
- cursor movement around a chip;
- Backspace/Delete removing the entire chip;
- dropdown navigation and Enter selection;
- Enter submit and Shift+Enter newline;
- multiline autosizing and placeholder;
- context chips remaining above the editor;
- sending still resolves the mentioned connection.

---

### Task 6: Commit only the inline mention implementation

**Files:**
- Add only the files changed by Tasks 1–4 and their tests.

**Step 1: Review the diff and status**

Run: `git status --short && git diff --check && git diff --stat`

Confirm that pre-existing user changes in `src/features/ai/components/AiChatPanel.tsx`, `src/features/ai/components/MentionChip.tsx`, `src/features/connection/components/ConnectionTabs.tsx`, `src/features/shell/main.ts`, and `src/tests/e2e/connection-tabs-reorder.spec.ts` are not accidentally staged or overwritten beyond the intended integration changes.

**Step 2: Commit the implementation**

```bash
git add src/components/ui/prompt-input.tsx src/components/ui/prompt-input-mentions.ts src/features/ai/hooks/useMentions.ts src/features/ai/components/AiChatPanel.tsx src/features/ai/components/MentionChip.tsx src/tests/unit/components/ui/prompt-input-mentions.test.ts src/tests/unit/features/ai/hooks/useMentions.test.ts
git commit -m "feat: render connection mentions inline"
```
