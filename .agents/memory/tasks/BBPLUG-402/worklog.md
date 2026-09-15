# BBPLUG-402 worklog

## Outcome

Background jobs now render as a compact three-column row: a Terminal icon for
local commands or Layers icon for workflows, a single truncated title, and the
status at the right edge. Runner/model and detail metadata no longer create a
second row, so `local_bash` is not shown as if it were an AI model.

## RED / GREEN

- RED: the mounted Background-card test could not find the Terminal icon and
  still rendered the old two-row metadata structure.
- GREEN: the Background card and CSS architecture suites passed twice: 2 files,
  20 tests per run.

## Validation

- React quality pass: no new state, effects, subscriptions, or bundle boundary;
  the icon remains accessible and the title truncates.
- Full serial suite: 108 files, 770 tests passed.
- `npm run typecheck`: passed.
- `bb plugin types --check .`: SDK pin and host both 0.4.87.
- `npm run build`: passed; only the existing Node DEP0205 warning was emitted.
- `git diff --check`: passed.
- `bb plugin reload work-sidebar`: reloaded from this checkout and reported
  running.
- Live UI navigation was not performed because BB was displaying another
  active repository thread; the mounted layout contract covers the requested
  ordering without disturbing that session.

