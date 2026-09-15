# BBPLUG-396 — split resolved and unresolved PR review comments

## Outcome

- The Changes PR review status now shows separate `N open` and `M resolved`
  review-comment counts when GitHub supplies a complete review-thread
  connection.
- Resolution is derived from GitHub GraphQL review threads and counts every
  comment in each thread according to the thread's `isResolved` state.
- If GraphQL is unavailable, rate-limited, malformed, or truncated beyond the
  first 100 threads, the UI retains the existing aggregate REST review-comment
  total instead of presenting an incomplete split.
- The split is fetched only for the current PR or current stack. Authored PR
  roster loading retains the cheaper aggregate count.
- The canonical project-scoped PR fact carries the split, so detailed facts
  are preserved across later signal-only refreshes without adding another
  client cache.

## RED / GREEN evidence

The initial focused run failed three intended regressions: the GraphQL reader
was absent, presentation still emitted only the aggregate count, and the
Changes row rendered one total. After implementation:

- Focused split/presentation/view/server tests: 102 passed.
- Broader affected PR and Changes tests: 115 passed.
- Full serial suite: 108 files / 770 tests passed.
- Typecheck: passed.
- SDK compatibility: plugin and host SDK 0.4.87, passed.
- Production build: passed; only the existing Node DEP0205 warning.
- `git diff --check`: passed.

## Live evidence

- A live `gh api graphql` query against `SystemEarth/systemearth#1408`
  returned two complete review threads, both unresolved, with one comment
  each.
- The plugin source resolved to this checkout and reloaded successfully.
- The non-mutating theme probe reported the current light theme. A direct
  visual assertion was not forced because the active BB window was displaying
  a native PR browser rather than the Changes panel; preserving the user's
  foreground state took precedence.
