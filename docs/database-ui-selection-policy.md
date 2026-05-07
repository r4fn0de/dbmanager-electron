# Database UI Text Selection Policy

This policy applies to database-facing UI surfaces (SQL editor, query results, table explorer, table data editor).

## Rule

- Use `select-text` for read/copy content.
- Use `select-none` for interactive controls.

## Use `select-text` when

- Showing data values, row/column metadata, SQL errors, query execution metadata, schema/table labels.
- Showing SQL/DDL previews and non-editable informational text.

## Use `select-none` when

- Element acts as a control: buttons, menu items, tab switchers, close buttons, resize handles, drag affordances.
- Element has pointer/keyboard interaction where accidental selection hurts UX.

## Exceptions

- Desktop drag regions and title bar remain interaction-first (`select-none` allowed by default).
- `src/components/ui/*` primitives keep their own behavior unless a database surface explicitly needs override.

## PR Review Checklist (Database UI)

1. Data text can be selected and copied with mouse/keyboard.
2. Controls do not start accidental text selection during click/drag.
3. Focus/keyboard behavior remains accessible after class changes.
4. Double-click behavior in tables/tabs remains unchanged.
5. Visual consistency (hover/active/focus states) remains intact.

