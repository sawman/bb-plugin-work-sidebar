# Final consolidation red-green-refactor plan

Status: Active implementation plan
Date: 2026-08-31
Baseline: `main` at `0e19e63dfa6cacf4ecc378b93eab74ec913e6869`
Durable owner: `BBPLUG-215`

## Objective

Perform one final evidence-driven consolidation pass after the feature refactor.
Reduce structural and runtime cost without changing product behavior, creating a
generic component catalog, or moving remote/host records into shared client
state.

The pass may share a component only when at least two semantic consumers need
the same behavior. It may share interaction state only when the state represents
one interaction spanning those consumers. TanStack Query remains the owner of
remote state, BB hooks remain the owner of host state, Zustand remains limited
to bounded presentation state, and React remains the owner of local control
state.

## Verified starting evidence

- `git status --short`: clean.
- Branch/commit: `main` / `0e19e63dfa6cacf4ecc378b93eab74ec913e6869`.
- `npm test -- --no-file-parallelism`: 82 files / 485 tests passed.
- Product entrypoints remain thin; the largest production concentration is
  `features/work-context/views.tsx`, while settings editing is concentrated in
  `features/threads/sidebar-appearance-settings.tsx`.
- Existing shared semantics already include `SurfaceCard`, `CopyBadge`,
  `SidebarListActions`, the search/combobox shell, status presentation, and
  thread-row content. This pass must reuse or refine those contracts rather
  than introduce parallel variants.
- Normal production code contains no browser `console.*` calls. Script CLI
  output is intentional. The serial suite currently emits jsdom navigation
  diagnostics, which are test-harness noise to characterize before changing.

## Loop C1 — Work composition and justified primitives

**Red**

- Add an architecture characterization that records the current Work view
  declaration/line concentration and fails until independent card
  responsibilities have bounded modules.
- Add or retain mounted fixtures proving the exact Status, Work item, Tasks,
  Goal, Plan, and Background ordering and their loading/error/populated/busy
  isolation.
- Add a source ownership assertion that prevents a second card header, item-row,
  or collapsible-section contract when an existing semantic primitive already
  serves two consumers.

**Green**

- Extract independent Work card composition from the monolithic view module
  into Work-owned modules. Keep query hooks in the owning feature and keep the
  root panel/composition thin.
- Promote a UI element to `components/ui` only when the diff migrates at least
  two real consumers in the same loop. Otherwise keep the extraction feature
  local.
- Preserve all card order, headings, controls, accessible names, and mutation
  behavior byte-for-byte at the public contract.

**Refactor**

- Remove superseded declarations/imports/selectors in the same commit.
- Add declaration and physical-line budgets that constrain responsibilities,
  not arbitrary one-line implementations.

**Validation / acceptance evidence**

- Focused Work model/card/registration/accessibility tests twice.
- Full serial suite, typecheck, SDK check, production build, bundle/import
  boundary inspection, and `git diff --check`.
- Root diff inspection confirms no Query key, RPC shape, or card behavior drift.

**Rollback boundary**

- One isolated Luna worktree commit based on the verified integration commit.

## Loop C2 — Settings composition and editor lifecycle

**Red**

- Characterize the exact declared setting keys/defaults/options and every
  appearance editor's valid, invalid, pending, autosave, rejection, and external
  refresh behavior.
- Add a structure test that fails while the generic numeric autosave lifecycle
  is embedded in the Threads settings composition.
- Prove the compact Thread-list editor and plugin Settings section render the
  same saved value and do not create duplicate mutation or realtime owners.

**Green**

- Extract the reusable numeric autosave control and settings-row composition.
  Keep it feature-local unless a second feature adopts the same semantic
  contract during this loop.
- Centralize setting descriptors and parsing close to their owning server
  slices; do not create an app-wide settings store and do not mirror
  `useSettings` values into Zustand.
- Preserve inline validation, debounced persistence, recovery toasts, focus,
  and light/dark host-token styling.

**Refactor**

- Delete duplicate wrappers/helpers and replace source-string assertions with
  behavior or AST/style ownership checks.
- Keep polling settings owned by Pull Requests and appearance settings owned by
  Threads; share only low-level editor behavior.

**Validation / acceptance evidence**

- Focused settings, lifecycle, registration, and accessibility tests twice.
- Full serial suite, typecheck, SDK check, build/CSS inspection, and diff check.

**Rollback boundary**

- One isolated Luna worktree commit based on the integrated C1 commit.

## Loop C3 — Measured performance, state, and logging cleanup

**Red**

- Add fake-timer/observer/render-count tests for elapsed-time clocks, inactive
  tabs, Query observers, realtime listeners, and cleanup on tab exit/unmount.
  The red assertion must demonstrate duplicate work or a stale lifecycle before
  production code changes.
- Add a fake-host test proving normal registration/read success produces no
  debug/info log entries while genuine warnings/errors remain observable.
- Capture and attribute serial-suite console output; only suppress diagnostics
  by correcting the responsible test interaction or harness boundary.
- Add store-selector tests only for a measured cross-component rerender. Do not
  merge the Threads, Tasks, Changes, or Agents stores merely to reduce file
  count.

**Green**

- Hoist or share clocks only where two simultaneously mounted consumers can
  demonstrably reuse one cadence; retain separate cadences where they avoid
  unnecessary rerenders.
- Stabilize derived maps/arrays and narrow Query invalidation or observers only
  where the red test proves excess work. Retain deliberate warm caches.
- Remove normal-path logging and test navigation noise without hiding real
  failures.

**Refactor**

- Remove obsolete timers, memo/version props, callbacks, and tests made
  redundant by stronger mounted lifecycle coverage.
- Keep runtime state out of Zustand and avoid blanket `React.memo`.

**Validation / acceptance evidence**

- Focused fake-timer, observer, render-count, fake-host, and registration tests
  twice.
- Compare full serial suite duration/output with the baseline; then run the
  suite twice, typecheck, SDK check, build/artifact inspection, source
  verification, and diff check.

**Rollback boundary**

- One isolated Terra worktree commit based on the integrated C2 commit.

## Loop C4 — Integration and independent review

**Red**

- Integrate only commits whose focused evidence and full diff the root has
  inspected. Run the complete gate; any regression becomes an owning-slice
  failing test.
- Start one strictly read-only Claude Code child in the integrated environment
  with `claude-opus-5[1m]` and high or xhigh reasoning. It reviews architecture
  boundaries, behavior, state ownership, Query/realtime lifecycle,
  accessibility, CSS, settings, bundling, SDK disposal, performance, tests,
  and both sidebar surfaces.

**Green**

- Assign every valid finding to one bounded Terra/Luna remediation loop and
  rerun the reviewer until the report is clean.

**Refactor**

- Remove temporary probes and merge-only compatibility code. Retain the plan
  and durable BB Task evidence.

**Validation / acceptance evidence**

- `npm test -- --no-file-parallelism` twice.
- `npm run typecheck`.
- `bb plugin types --check .`.
- `npm run build` and app/server bundle ownership inspection.
- `bb plugin source work-sidebar --json` resolves to this checkout.
- `npm run theme-control -- matrix -- <affected live checks>` where the
  desktop is available, plus narrow/wide interaction checks.
- `bb plugin reload work-sidebar` and post-reload source/status verification.
- `git diff --check` and clean tree.

**Deployment boundary**

- Merge the reviewed integrated branch to `main`.
- Switch GitHub CLI to `sawman`, verify, push, then restore and verify
  `matthew-se` even if the push fails.

