# BBPLUG-185 evidence

## Scope

Opus M3, M4, D5, D6, and the behavioral shared-search portion of L12.

## Red

`npm test -- tests/architecture/shared-search-shell.test.tsx features/threads/tests/thread-row.test.tsx`
initially failed three mounted assertions: tracker focus theft, its initial
portalled popup, detached hierarchy-picker input, and the tooltip child inside
the thread menu. The initial architecture test required a `.tsx` extension
because it now mounts JSX rather than scanning source text.

## Green (focused)

`npm test -- tests/architecture/shared-search-shell.test.tsx features/threads/tests/thread-row.test.tsx components/ui/combobox.test.tsx features/threads/tests/thread-hierarchy-context.test.tsx features/tracker/tests/card.test.tsx`

Passed: 5 files, 21 tests.

The mounted coverage asserts that the tracker starts closed without moving
focus, a server-supplied fuzzy result remains selectable despite a nonmatching
raw query, portalled picker inputs live inside their own portalled content,
empty open pickers retain stable combobox semantics, and menu children contain
no tooltip role.

## Full validation

- `npm test`: passed, 79 files and 461 tests (the existing jsdom navigation
  notices remain non-fatal).
- `npm run typecheck`: passed.
- `npm run build`: passed; BB emitted its existing `DEP0205` deprecation
  warning only.
- `bb plugin source work-sidebar --json`: resolves to
  `/Users/matthewsaw/dev/bb-plugin-work-sidebar`, not this managed worktree;
  therefore no reload was performed.
