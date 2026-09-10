# BBPLUG-389 worklog

## Outcome

- Normalized submitted Inbox message rows and Markdown bodies onto the shared primary-text typography tokens.
- Replaced the standalone `Collapse message body` / `Show message body` text control with an icon-only chevron action in the existing message action group.
- Kept full accessible labels, tooltip hints, `aria-expanded`, and `aria-controls` semantics.
- Extracted the common three-use `InboxMessageAction` primitive for acknowledge, bookmark, and disclosure controls.

## Verification

- RED: focused Inbox tests initially failed in 2 cases before the implementation.
- GREEN: focused Inbox tests passed: 2 files, 19 tests.
- Full serial suite passed: 108 files, 760 tests.
- `npm run typecheck` passed.
- `npm run build` passed; only the known Node `DEP0205` warning remained.
- `bb plugin types --check .` passed with SDK 0.4.47.
- `git diff --check` passed.
- `bb plugin reload work-sidebar` succeeded from the canonical checkout.
- Theme probe confirmed the live desktop is currently in light mode.

## Live visual note

A read-only capture confirmed the running BB window, but the selected thread had the browser panel open rather than the Work/Inbox card. The UI was not moved or scrolled because doing so would interrupt the user's active desktop session. Mounted interaction, accessibility, and structural CSS coverage exercise the changed states.
