# BBPLUG-390 worklog

## Outcome

- Registered real `Bookmark`, `BookmarkX`, and `Copy` glyphs in the shared icon primitive; Inbox actions no longer fall back to a circle.
- Reduced a collapsed message row to one line: compact subject + relative age + four icon actions.
- Removed the redundant source-thread title entirely.
- Removed the visible message ID and absolute `Created`/`Edited` metadata rows.
- Reduced body copy to the shared metadata text scale after live feedback showed subtext was still too large.
- Forced the host Markdown root to inherit that scale; the host wrapper otherwise overrode the Inbox container typography.
- Added an icon-only copy-ID button with clipboard success/error feedback.
- Kept the absolute created timestamp as the accessible label for the compact `<time>` element.
- Hoisted the absolute timestamp formatter so a long Inbox does not allocate one formatter per row.

## Verification

- RED: two focused regressions failed before implementation (circle fallback and un-compacted metadata).
- Focused Inbox/icon suite passed: 3 files, 23 tests.
- Full serial suite passed: 108 files, 762 tests.
- `npm run typecheck` passed.
- `bb plugin types --check .` passed with SDK 0.4.47.
- `npm run build` passed; only the known Node `DEP0205` warning remained.
- `git diff --check` passed.
- `bb plugin reload work-sidebar` succeeded from the canonical checkout.

## Live visual note

A read-only desktop snapshot found the user's active BB window on a different thread/surface where the Inbox card was not mounted. No clicks, scrolling, focus changes, or navigation were performed. Mounted DOM, clipboard, icon-geometry, accessibility, and CSS architecture tests cover the changed states.
