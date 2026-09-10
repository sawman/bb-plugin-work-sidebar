# BBPLUG-390 worklog

## Outcome

- Registered real `Bookmark`, `BookmarkX`, and `Copy` glyphs in the shared icon primitive; Inbox actions no longer fall back to a circle.
- Reduced a collapsed message row to one line: compact subject + relative age + four icon actions.
- Removed the redundant source-thread title entirely.
- Removed the visible message ID and absolute `Created`/`Edited` metadata rows.
- Reduced body copy to the shared metadata text scale after live feedback showed subtext was still too large.
- Forced the host Markdown root to inherit that scale; the host wrapper otherwise overrode the Inbox container typography.
- Kept Markdown code monospace while making inline and fenced code inherit the same 0.61rem size and line height as surrounding message text.
- Normalized rich Markdown descendants as one compact rendering boundary: headings keep emphasis without growing, block spacing is controlled, lists and quotes are compact, and tables, code blocks, and media cannot overflow the card.
- Added an icon-only copy-ID button with clipboard success/error feedback.
- Follow-up: moved copy-ID onto the truncating message title itself and removed the separate copy icon, preserving the terse tooltip and exact clipboard/toast behavior while freeing one action slot.
- Kept the absolute created timestamp as the accessible label for the compact `<time>` element.
- Hoisted the absolute timestamp formatter so a long Inbox does not allocate one formatter per row.

## Verification

- RED: two focused regressions failed before implementation (circle fallback and un-compacted metadata).
- Focused Inbox/icon suite passed: 3 files, 23 tests.
- Final rich-Markdown boundary suite passed: 2 files, 21 tests.
- Final focused Inbox/typography suite passed: 3 files, 30 tests.
- Full serial suite passed: 108 files, 763 tests.
- `npm run typecheck` passed.
- `bb plugin types --check .` passed with SDK 0.4.47.
- `npm run build` passed; only the known Node `DEP0205` warning remained.
- `git diff --check` passed.
- `bb plugin reload work-sidebar` succeeded from the canonical checkout.

## Live visual note

A read-only desktop snapshot found the user's active BB window on a different thread/surface where the Inbox card was not mounted. No clicks, scrolling, focus changes, or navigation were performed. Mounted DOM, clipboard, icon-geometry, accessibility, and CSS architecture tests cover the changed states.

The final light/dark theme matrix also completed without foreground interaction and restored the original preference. The active window still did not have an Inbox card mounted, so visual evidence remains the rich mounted fixture plus the CSS contract tests rather than a live card capture.
