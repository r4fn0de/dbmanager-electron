# AI Chat Visual Style Guide

This document captures the approved visual style for the global AI Chat panel, with emphasis on **readability in both light and dark modes**.

## Goals

- Improve contrast and rhythm for both themes, with emphasis on:
  - user message bubble background;
  - assistant text readability and rhythm.
- Keep style implementation local and predictable in `AiChatPanel.tsx`.

## User Message Bubble (Light Mode)

Applied on user message content in:
- `/src/components/AiChatPanel.tsx`

Current class recipe:

```tsx
text-[14px] leading-6 whitespace-pre-wrap break-words rounded-xl
border border-zinc-300/70 bg-zinc-200/85 px-3 py-2 text-zinc-900
shadow-[0_1px_0_rgba(255,255,255,0.45)_inset] backdrop-blur-sm
dark:border-zinc-700/70 dark:bg-zinc-800/85 dark:text-zinc-100
dark:shadow-[0_1px_0_rgba(255,255,255,0.05)_inset]
```

### Why

- `bg-zinc-200/85` + `border-zinc-300/70`: creates a clear bubble silhouette in light mode.
- `text-zinc-900`: raises foreground contrast.
- subtle inset shadow: gives definition without heavy elevation.
- dark mode mirrors the same silhouette logic with tuned neutral values.

## Assistant Text Formatting (Light Mode)

Applied on assistant text container in:
- `/src/components/AiChatPanel.tsx`

Current class recipe:

```tsx
!w-full !max-w-none !bg-transparent !p-0 text-[14.5px] leading-7 break-words
text-zinc-800 dark:text-foreground
[&_code]:rounded-md [&_code]:border [&_code]:border-zinc-300/80
[&_code]:bg-zinc-100 [&_code]:px-1.5 [&_code]:py-0.5
[&_code]:text-[0.92em] [&_code]:text-zinc-900
[&_code]:dark:border-zinc-700/80 [&_code]:dark:bg-zinc-800/80 [&_code]:dark:text-zinc-100
[&_li]:my-1 [&_ol]:my-2 [&_p+p]:mt-3 [&_strong]:font-semibold [&_ul]:my-2
```

### Why

- slightly larger font + line-height improves long-form scanability.
- paragraph/list spacing improves visual rhythm.
- inline code gets dedicated light styling for legibility and separation.
- dark text and inline code are now explicitly tuned for contrast against transparent chat surfaces.

## Guardrails for Future Changes

- Prefer class-only adjustments before introducing new wrappers.
- Keep `dark:*` fallbacks explicit when changing light mode.
- Validate with mixed content:
  - plain text paragraphs,
  - lists,
  - inline code,
  - mixed SQL + explanation.
- Avoid introducing hardcoded colors in multiple files; keep this style centralized in `AiChatPanel.tsx` unless a design-token migration is planned.

## Optional Next Step (when desired)

If we decide to systematize this style, extract these class recipes into semantic utilities (e.g. `chat-user-bubble`, `chat-assistant-copy`) in shared styles, then reference them in the panel.
