# BBPLUG-384 — thread branch divergence

Base: `475f6b34ab90e1aa31ca143b35f9661a1f4de27b`

## Plan

1. RED: characterize remote matching, batching/failure isolation, Query
   lifecycle, and compact row presentation.
2. GREEN: add a strict roster RPC over BB environment branch/status APIs and
   one Threads-owned Query observer.
3. REFACTOR: pass one directory through the existing thread tree; keep rows
   free of requests and hide unavailable/zero divergence.
4. Verify focused tests twice, full serial suite, typecheck, SDK compatibility,
   build, source registration, reload, theme probe, and whitespace.

Rollback boundary: revert the single BBPLUG-384 commit from the base above.

## Result

- Added one environment-roster RPC with six-way bounded concurrency and
  per-environment failure isolation. Duplicate thread/environment/branch
  targets share one comparison.
- Prefer `origin/<branch>`; when unavailable, use a unique same-named remote.
  Ambiguous or untracked branches intentionally render no indicator.
- Added one Threads-owned Query observer. It refreshes every 60 seconds only
  while the Threads pane is active, participates in manual refresh, becomes
  stale after 30 seconds, and is garbage-collected after 5 minutes.
- Added compact `↑ahead` and `↓behind` counts beside the existing branch label.
  Zero divergence stays hidden; explanatory text uses the shared tooltip
  primitive and the counts retain space when the branch name truncates.

## Evidence

- RED: focused tests initially failed for the missing reader, Query hook, and
  row marker.
- Focused GREEN passed repeatedly, including server resolution/concurrency,
  Query lifecycle, row presentation, registrations, and architecture guards.
- Full serial suite: 108 files / 756 tests passed.
- `npm run typecheck`: passed.
- `bb plugin types --check .`: passed; plugin and host SDK are 0.4.47.
- `npm run build`: passed; only the existing Node DEP0205 warning.
- `git diff --check`: passed.
- `npm run theme-control -- matrix -- node -e
  'console.log(process.env.BB_TEST_THEME)'`: light and dark passed, preference
  restored.
- `bb plugin source work-sidebar --json`: resolves to this checkout.
- `bb plugin reload work-sidebar`: passed; plugin is running.
- Post-reload filtered logs contain no branch-divergence/RPC errors.
