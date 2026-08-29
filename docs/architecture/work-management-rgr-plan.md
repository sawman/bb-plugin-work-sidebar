# Work management red-green-refactor implementation plan

Status: Active
Date: 2026-08-29
Specification: [work-management-spec.md](work-management-spec.md)

This plan is architecture and acceptance evidence, not the work queue. The
durable execution queue is BB Tasks: `BBPLUG-158`, `BBPLUG-160`, and
`BBPLUG-161` under outcome `BBPLUG-1`; this documentation amendment is owned
by `BBPLUG-166`. Historical `BBPLUGINWO-*` names belong only to the handoff's
historical records and are not current ownership references.

Baseline for this plan: checkpoint `9a3329b` (`checkpoint: preserve work
management baseline`) on branch `bb/work-management-integration`, with 74 files
and 407 tests passing, typecheck clean, and `git diff --check` clean. Every
loop begins from its recorded pre-loop snapshot, changes one vertical slice,
and removes or replaces the superseded path while green. Before the first edit,
record the exact base commit plus `git status --short` digest on the owning BB
Task. The rollback point is that recorded commit/digest; a later loop also
records its local checkpoint commit. Restore by reverting the loop commit(s) and
rebuilding/reloading the verified source. No checkpoint, commit, or push is
created without user authorization.

Every loop records named RED tests and observable failure output, the minimum
GREEN implementation and focused observable, the REFACTOR/removal, full gates,
and the rollback checkpoint. A generic statement that a suite passed does not
fill an acceptance cell.

### Landed before this plan was written

R31.1–R31.3 are implemented in the baseline tree: `hierarchy-model.ts`,
`hierarchy-server.ts`, `thread-hierarchy-context.tsx`,
`thread-hierarchy-picker.tsx`, `use-thread-hierarchy-menu.tsx`, the
`moveSidebarThread` handler, `useThreadHierarchyMutation`, and the
context-menu items, with `hierarchy-model.test.ts`,
`hierarchy-server.test.ts`, and the happy-path assertions in
`thread-row.test.tsx`.

R32.1 and R33.1 landed as pure models with tests and **no consumers**:
`work-context/work-item-model.ts` and `tasks/workflow-model.ts`. The legacy
`TasksCard` and separate `TrackerCard` are still the rendered path.

Loops R31.4, R32.3, R33.2, and R33.3 therefore start from existing code, not
from an empty slice. Each begins by adding the missing failing test against
what is already there.

## R31 — safe thread hierarchy manipulation (`BBPLUG-158`)

### R31.1 Pure hierarchy rules (landed)

- **Red:** add Threads model tests for candidate filtering and validation:
  self, descendants, archived threads, cross-project threads, and a move that
  changes the root of an outcome/execution binding are rejected; an unbound
  child-to-root and root-to-parent move are accepted.
- **Green:** retain the landed pure ancestry index and move-decision model. It
  consumes explicit thread and binding summaries and returns a typed allowed
  result or actionable rejection; it performs no SDK calls. Remaining failures
  are covered by R31.4.
- **Refactor:** centralize cycle/root-change reasoning in the Threads slice and
  remove any UI-only descendant checks introduced by the RED fixture.
- **Validation:** focused model tests twice, typecheck, and `git diff --check`.
  The pre-loop dirty tree is the rollback boundary.

### R31.2 Typed server mutation and group reconciliation (landed)

- **Red:** extend the official backend harness with strict-JSON tests proving
  exact `threads.update({ threadId, parentThreadId })` calls, fresh-state
  revalidation, custom-group removal when nesting, Active placement when
  promoting, one Threads realtime publication, rollback after preference-save
  failure, and no writes/publication for rejected moves.
- **Green:** retain the landed browser-safe schemas, injected Threads hierarchy
  service, registration handler, and targeted Query mutation/key policy. Use
  the BB SDK and existing preference service; do not mirror host threads.
- **Refactor:** keep `server.ts` and the Threads registration thin, isolate the
  SDK adapter from pure validation, and share the existing Threads-family
  invalidation parser.
- **Validation:** focused server/registration tests twice, full server suite,
  typecheck, SDK compatibility, build/bundle inspection, and diff check.

### R31.3 Context-menu picker and host parity (landed happy path)

- **Red:** the remaining registered left-slot coverage asserts **To Top** by
  its visible label and accessible description "Move this thread out of its
  parent and make it a top-level thread", searchable Move under, candidate
  exclusions, keyboard selection, busy/error/recovery, Escape/outside
  dismissal, focus return, and prevention of row open/select, drag, or native
  context-menu fallthrough. **Make top-level** is retired at the menu, toast,
  test, and documentation sites; no test may assert the old string.
- **Green:** retain the landed Threads-owned hierarchy picker opened from the
  existing thread context menu. React owns search/open state; Query owns
  mutation state; BB hooks supply the roster. Complete only the missing
  acceptance behavior listed in the Red step.
- **Refactor:** reuse the existing combobox/dialog primitives and row action
  boundaries. Do not add another menu implementation or store remote threads
  in Zustand.
- **Validation:** focused interaction and axe tests twice; full serial suite;
  typecheck; SDK check; build; source-verified reload; diff check; live
  light/dark, narrow/wide, mouse, keyboard, and group-placement verification.

### R31.4 Hierarchy correctness, invalidation, and cost

- **Red:** (a) a registered test proves a reparent invalidates the work,
  tracker, and tasks families for every thread in the affected subtree and
  publishes one work-family event for each of the old and new root; (b) a
  hook-level cost test in the style of
  `tests/sidebar-organization-performance.test.tsx` proves no candidate
  evaluation runs while every picker is closed; (c) interaction tests cover
  keyboard selection, busy state, mutation error and recovery, Escape, outside
  dismissal, focus return to the invoking menu item, and suppression of row
  open/select and drag; (d) an axe assertion covers the open picker; (e) a
  server test for `createSdkThreadHierarchyService` asserts exact
  `threads.list`/`threads.get`/`threads.update` calls and a distinct
  **hierarchy not fully loaded** rejection when an ancestor is absent.
- **Green:** return `oldRootThreadId`, `newRootThreadId`, and
  `affectedThreadIds` from the service; publish and invalidate accordingly;
  move candidate computation inside the open branch behind one memoized
  ancestry index owned by `ThreadHierarchyProvider`; render one picker per
  sidebar; add focus management and a unique picker title id; split the
  ancestor-missing rejection from the cycle rejection.
- **Refactor:** replace the modal dialog with the shared inline shell from R35
  once R35 lands; delete the per-row picker instance and global
  `querySelector` focus restoration.
- **Validation:** focused hierarchy model/server/interaction/axe tests twice;
  full serial suite; typecheck; SDK check; build; verified-source reload;
  `git diff --check`; live promote/reparent in light and dark at narrow and
  wide width, confirming the right panel re-roots without manual refresh.
- **Rollback:** baseline checkpoint `9a3329b` on
  `bb/work-management-integration` plus the recorded pre-loop
  `git status --short` digest, or the named local checkpoint for a subsequent
  loop.

## R32 — canonical Work item model (`BBPLUG-160`)

### R32.1 Work item projection (landed model foundation)

- **Red:** add pure projection tests for outcome-only, Linear-only,
  outcome-plus-multiple-Linear, explicit primary issue, legacy-adoptable, and
  fully empty states. Prove one canonical BB outcome and stable linked-item
  ordering.
- **Green:** retain the landed Work-context projection type that composes
  existing outcome and tracker Query results without copying or joining
  records in a store; its missing consumer is the next red condition.
- **Refactor:** move mapping and empty-state decisions out of JSX; retain
  tracker status semantics in the Tracker slice and task semantics in Tasks.
- **Validation:** focused model tests twice, typecheck, and diff check.

### R32.2 Explicit create/adopt/link workflow

- **Red:** add backend and Query tests for creating a BB outcome from a Linear
  issue, legacy BB outcome adoption, multiple links, primary selection, and
  independent BB/Linear status mutations. Prove no implicit status write crosses
  systems and failed partial operations remain recoverable.
- **Green:** extend the outcome-creation input with an optional `priority`;
  migrate `work-linear-links:v1` to a `{ keys, primaryKey }` shape behind a
  forward-compatible reader; add `setPrimaryLinearIssue`; make
  `trackerItemSchema` and `trackerStatusOptionSchema` `.strict()`; derive
  `WorkItemTrackerRecord` from the inferred contract types rather than
  re-declaring them. Reuse the existing Tasks binding and Taskboard adapters.
- **Refactor:** keep one-time title/priority mapping pure and documented; keep
  Taskboard wire schemas server-owned and browser-safe RPC projections strict.
- **Validation:** focused fake-host, schema, and Query tests twice; full backend
  suite; typecheck; SDK check; build/bundle inspection; diff check.

### R32.3 Unified Work item card

- **Red:** add registered Work-slot tests for every projection state, multiple
  Linear links, primary link, BB and Linear status controls, loading/error
  isolation, busy recovery, and no duplicate Outcome/Linear cards.
- **Green:** replace the separate Outcome and Tracker cards with one Work item
  card in slot 2, preserving the other card order and header badges while
  intentionally moving tracker content from its current final-card position.
- **Refactor:** remove the superseded card composition and CSS in the same
  loop; promote shared elements only when both task and tracker semantics need
  them.
- **Validation:** focused UI and axe tests twice; full serial suite twice;
  typecheck; SDK check; build; verified-source reload; diff check; live
  light/dark and narrow/wide checks for empty, populated, linked, and busy
  states.

## R33 — task workflow projections (`BBPLUG-161`)

### R33.1 Deterministic workflow buckets (landed model foundation)

- **Red:** add exhaustive pure tests that project outcome, binding-owned
  execution tasks, generic linked tasks, assignee, owner runtime, and status
  into exactly one of Needs you, In progress, Next, or Completed. Cover
  missing owner threads, canceled work, stable section sorting, the
  execution-record-wins dedup tie-break, an archived owner thread, and the
  bounded Completed preview.
- **Green:** retain the landed Tasks-owned workflow projection. Outcome is
  excluded from rows; execution and generic tasks are deduplicated by task ID.
  `in_review` is projected by assignee, not by an unmodellable reviewer/gate
  field: Agent work is In progress and Human work is Needs you.
- **Refactor:** replace ad hoc count/filter logic in the Work card with the
  model. Keep remote records in Query and runtime summaries in BB host reads.
- **Validation:** focused model tests twice, typecheck, and diff check.

### R33.2 Right Work Tasks card

- **Red:** add registered Work-slot tests for the four sections, Human-first
  follow-up, Agent owner thread/provider/open action, backlog tasks, collapsed
  bounded completion history, assignment changes, owner changes, and local
  loading/error/busy recovery. Prove every task title appears once and the old
  bound-count prose/two-list layout is absent.
- **Green:** implement the four-section Tasks card with shared task rows and a
  collapsed Completed disclosure. Keep Human/Agent assignment controls here.
- **Refactor:** delete the legacy generic-plus-execution rendering path and
  duplicated count. Centralize only truly shared row atoms.
- **Validation:** focused Tasks/Work tests twice; full serial suite twice;
  typecheck; SDK check; build; reload; diff check; live populated, empty,
  error, long-completed, and narrow-width verification.

### R33.3 Left Tasks queue responsibilities

- **Red:** extend registered left-slot tests so rows show priority before
  status, an owner thread/provider instead of binding jargon, a searchable
  add/change/remove thread control, read-only Human/Agent presentation, and
  unchanged create/delete/reorder/modifier behavior.
- **Green:** adapt the existing left task row to the shared workflow semantics
  while retaining project-wide queue ownership.
- **Refactor:** delete every reachable path to "Bound outcome task", "Bound
  delegated execution task", and "Bound direct execution task" in
  `features/tasks/task-row.tsx`, including the fallback taken when the owner
  thread title is unavailable; assert the absence of all three strings. Keep
  owner-thread mutation separate from Human/Agent assignment and provide the
  left-row context-menu escape hatch for unowned tasks.
- **Validation:** focused left Tasks tests twice; full serial suite; typecheck;
  SDK check; build; reload; diff check; live light/dark, narrow/wide, keyboard,
  drag, search, and long-list checks.

## R35 — one shared inline search and combobox shell

- **Red:** add a shell test asserting `combobox`/`listbox`/`option` roles,
  `aria-expanded` derived from real open state, active-descendant movement,
  Home/End/Arrow/Enter/Escape, outside dismissal, focus restoration, and
  busy/empty/error rendering. Add one consumer test for each of the six
  surfaces: left toolbar search, task-to-thread assignment, PR reviewer
  multi-select, Linear issue search, task attachment, and hierarchy parent
  selection. An architecture test rejects feature-owned `type="search"`
  inputs, `role="combobox"`, and literal `aria-expanded="true"`.
- **Green:** generalize `components/ui/combobox.tsx` into the plugin-local
  shell with single- and multi-select modes and an optional anchored portal,
  folding in `SidebarSearch`'s portal and fit logic. Migrate all six
  consumers, including the hierarchy picker.
- **Refactor:** delete bespoke inputs and superseded CSS from task assignment,
  reviewer selection, Linear search, task attachment, and hierarchy selection.
  Fix the hardcoded `aria-expanded="true"` by construction; no feature slice
  declares its own search input or picker keyboard contract.
- **Validation:** focused shell and six consumer suites twice; full serial
  suite twice; typecheck; SDK check; build; verified-source reload;
  `git diff --check`; axe on every open picker; live light/dark and narrow/wide
  checks of all six surfaces.
- **Rollback:** the recorded pre-loop checkpoint and dirty-tree digest from
  `9a3329b` on `bb/work-management-integration`, with the loop's local commit
  recorded before the next wave.
- **Sequencing:** run sequentially as an isolated Terra (`codex` /
  `gpt-5.6-terra`) worktree child with `--parent-self`
  `--new-environment worktree`, based on the latest integrated
  `bb/work-management-integration` commit. The root only inspects and merges
  after validation.

## R36 — drag reparenting and To Top

- **Red:** registered left-slot tests prove (a) ordinary whole-row drag still
  reorders within a group and moves across groups including Archive; (b) a drop
  on a row's parent affordance calls `moveSidebarThread` with that row as
  parent and does not change sibling order; (c) a drop on the To Top zone calls
  it with `parentThreadId: null`, and the zone's accessible name is **To Top**
  with the description "Move this thread out of its parent and make it a
  top-level thread"; (d) descendant, archived, cross-project, or
  binding-invalidating drops use the menu error and leave order/grouping
  unchanged; (e) leaving the sidebar yields to BB native split and issues no
  hierarchy write; (f) insertion line and reparent affordance are never shown
  simultaneously; and (g) keyboard users reach both operations through the
  context menu.
- **Green:** add one explicit reparent hit target to the existing pointer-drag
  controller and route its drop through the existing hierarchy mutation. Do
  not add a second drag system or validation path.
- **Refactor:** keep validation in `hierarchy-model.ts`, presentation state in
  the existing Zustand interaction store, and no thread record in the store.
- **Validation:** focused drag and registered suites twice; full serial suite;
  typecheck; SDK check; build; verified-source reload; `git diff --check`; live
  reorder, cross-group, reparent, To Top, and drag-to-split mouse checks in
  light/dark and narrow/wide layouts.
- **Rollback:** the named post-R35 local checkpoint plus its pre-loop status
  digest; revert the loop commit and rebuild/reload if any drag meaning loses
  parity.

## R37 — semantic typography

- **Red:** an architecture test parses every plugin stylesheet and fails on
  any `font-size` or `font-weight` declaration outside the token block. It
  asserts exactly six roles — primary, title, subtext, metadata, label, and
  code — each derived from one root scale variable. A characterization test
  records the current computed role for each surviving distinct size so the
  migration is behavior-preserving.
- **Green:** declare the six role token pairs and one scale variable over host
  theme tokens; apply roles in primitives; migrate one slice at a time and
  delete that slice's raw declarations in the same change, including
  `font-size: 0.6rem !important`.
- **Refactor:** remove each superseded selector as its slice migrates. Leave no
  parallel raw-size system, in accordance with ADR 0004.
- **Validation:** architecture and focused per-slice tests; full serial suite;
  typecheck; warning-free build; verified-source reload; `git diff --check`;
  `npm run theme-control -- matrix` light/dark inspection of all six tabs at
  narrow/wide widths.
- **Rollback:** the named post-R35 checkpoint plus its pre-loop status digest;
  restore that checkpoint if typography changes alter an unrelated primitive.
- **Sequencing:** run sequentially as an isolated Terra (`codex` /
  `gpt-5.6-terra`) worktree child with `--parent-self`
  `--new-environment worktree`, based on the latest integrated
  `bb/work-management-integration` commit. The root only inspects and merges
  after validation.

## R37.2 — bounded text-scale preference

- **Red:** tests reject malformed and out-of-range scale values, mirroring
  `validateSidebarRowHeight`; a Query test proves round-trip through the
  existing typed RPC/preference path; a registered test proves both sidebars
  re-render at the new scale without reload; and an accessibility test proves
  the smallest role at the smallest scale stays above the declared minimum.
- **Green:** add one bounded compact/default/comfortable scale preference beside
  sidebar row height using server storage, typed RPC, and Query, not
  `bb.settings`, and bind it to the root scale variable.
- **Refactor:** reuse the existing appearance settings editor and its
  debounce/toast behavior. Add no second settings mechanism or per-role
  control.
- **Validation:** focused settings tests twice; full serial suite; typecheck;
  SDK check; build; verified-source reload; `git diff --check`; live light/dark
  checks at both scale extremes and narrow/wide widths.
- **Rollback:** the named post-R37 checkpoint plus its pre-loop status digest;
  revert the preference loop if either sidebar fails to update or the minimum
  accessibility threshold is not maintained.

## R34 — automation, lifecycle, and integrated acceptance

### R34.1 Tool and realtime contract

- **Red:** add official fake-host tests for the complete journey: agent creates
  an Agent execution task, binds an owner, assigns a Human decision through
  `update_task`, and both sidebars receive one targeted invalidation. Prove
  fully validated work goes directly to done and `in_review` remains explicit.
- **Green:** make only missing tool metadata, assignment, or publication fixes.
  Do not create a parallel task API.
- **Refactor:** align UI copy, tool instructions, and `.bb/AGENTS.md` with the
  same workflow vocabulary.
- **Validation:** focused tool/server tests twice; strict JSON/RPC inspection;
  full serial suite twice; typecheck; SDK check; build/bundle/source checks;
  verified-source reload; diff check.

### R34.2 Final independent acceptance

- **Red:** build and fill this enumerated parity matrix. Rows are left Threads,
  left Tasks, left PRs, right Work, right Changes, right Agents, hierarchy
  picker, unified Work item card, Tasks workflow card, and shared search shell.
  Columns are loading, empty, error + retry, populated, selected, expanded,
  mutation-busy, and mutation-error-recovered. Apply these axes to every
  populated cell: light theme, dark theme, narrow width, wide width,
  keyboard-only, modifier-click, drag/drop where the surface supports it, and
  axe clean. Every cell is either a passing automated assertion or a dated
  live-capture reference recorded on the owning BB execution task. An unfilled
  cell fails acceptance; prose asserting the behavior does not fill it.
- **Green:** address each reproducible finding in its owning slice with a new
  focused RED before implementation.
- **Refactor:** remove temporary adapters, stale selectors, and superseded
  tests only when equivalent behavioral evidence exists.
- **Validation:** all gates above plus a clean independent read-only review of
  architecture adherence, BB SDK lifecycle, remote-state ownership,
  accessibility, CSS collisions, bundling/runtime risk, and regressions.
