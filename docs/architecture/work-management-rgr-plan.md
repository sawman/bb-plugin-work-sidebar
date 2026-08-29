# Work management red-green-refactor implementation plan

Status: Active
Date: 2026-08-29
Specification: [work-management-spec.md](work-management-spec.md)

This plan is architecture and acceptance evidence, not the work queue. The
durable execution queue is BB Tasks: `BBPLUG-158`, `BBPLUG-160`, and
`BBPLUG-161` under outcome `BBPLUG-1`.

Every loop begins from the current dirty-tree snapshot, changes one vertical
slice, and removes or replaces the superseded path while green. No checkpoint,
commit, or push is created without user authorization.

## R31 — safe thread hierarchy manipulation (`BBPLUG-158`)

### R31.1 Pure hierarchy rules

- **Red:** add Threads model tests for candidate filtering and validation:
  self, descendants, archived threads, cross-project threads, and a move that
  changes the root of an outcome/execution binding are rejected; an unbound
  child-to-root and root-to-parent move are accepted.
- **Green:** add the minimum pure ancestry index and move-decision model. It
  consumes explicit thread and binding summaries and returns a typed allowed
  result or actionable rejection; it performs no SDK calls.
- **Refactor:** centralize cycle/root-change reasoning in the Threads slice and
  remove any UI-only descendant checks introduced by the RED fixture.
- **Validation:** focused model tests twice, typecheck, and `git diff --check`.
  The pre-loop dirty tree is the rollback boundary.

### R31.2 Typed server mutation and group reconciliation

- **Red:** extend the official backend harness with strict-JSON tests proving
  exact `threads.update({ threadId, parentThreadId })` calls, fresh-state
  revalidation, custom-group removal when nesting, Active placement when
  promoting, one Threads realtime publication, rollback after preference-save
  failure, and no writes/publication for rejected moves.
- **Green:** add browser-safe schemas, an injected Threads hierarchy service,
  one registration handler, and a targeted Query mutation/key policy. Use the
  BB SDK and existing preference service; do not mirror host threads.
- **Refactor:** keep `server.ts` and the Threads registration thin, isolate the
  SDK adapter from pure validation, and share the existing Threads-family
  invalidation parser.
- **Validation:** focused server/registration tests twice, full server suite,
  typecheck, SDK compatibility, build/bundle inspection, and diff check.

### R31.3 Context-menu picker and host parity

- **Red:** add registered left-slot tests for Make top-level, searchable Move
  under, candidate exclusions, keyboard selection, busy/error/recovery,
  Escape/outside dismissal, focus return, and prevention of row open/select,
  drag, or native context-menu fallthrough.
- **Green:** add one Threads-owned hierarchy picker opened from the existing
  thread context menu. React owns search/open state; Query owns mutation state;
  BB hooks supply the roster.
- **Refactor:** reuse the existing combobox/dialog primitives and row action
  boundaries. Do not add another menu implementation or store remote threads
  in Zustand.
- **Validation:** focused interaction and axe tests twice; full serial suite;
  typecheck; SDK check; build; source-verified reload; diff check; live
  light/dark, narrow/wide, mouse, keyboard, and group-placement verification.

## R32 — canonical Work item model (`BBPLUG-160`)

### R32.1 Work item projection

- **Red:** add pure projection tests for outcome-only, Linear-only,
  outcome-plus-multiple-Linear, explicit primary issue, legacy-adoptable, and
  fully empty states. Prove one canonical BB outcome and stable linked-item
  ordering.
- **Green:** introduce a Work-context projection type that composes existing
  outcome and tracker Query results without copying or joining records in a
  store.
- **Refactor:** move mapping and empty-state decisions out of JSX; retain
  tracker status semantics in the Tracker slice and task semantics in Tasks.
- **Validation:** focused model tests twice, typecheck, and diff check.

### R32.2 Explicit create/adopt/link workflow

- **Red:** add backend and Query tests for creating a BB outcome from a Linear
  issue, legacy BB outcome adoption, multiple links, primary selection, and
  independent BB/Linear status mutations. Prove no implicit status write crosses
  systems and failed partial operations remain recoverable.
- **Green:** add only the missing typed RPC/service operation and narrow Query
  invalidations. Reuse the existing Tasks binding and Taskboard adapters.
- **Refactor:** keep one-time title/priority mapping pure and documented; keep
  Taskboard wire schemas server-owned and browser-safe RPC projections strict.
- **Validation:** focused fake-host, schema, and Query tests twice; full backend
  suite; typecheck; SDK check; build/bundle inspection; diff check.

### R32.3 Unified Work item card

- **Red:** add registered Work-slot tests for every projection state, multiple
  Linear links, primary link, BB and Linear status controls, loading/error
  isolation, busy recovery, and no duplicate Outcome/Linear cards.
- **Green:** replace the separate Outcome and Tracker cards with one Work item
  card while preserving the existing card order and header badges.
- **Refactor:** remove the superseded card composition and CSS in the same
  loop; promote shared elements only when both task and tracker semantics need
  them.
- **Validation:** focused UI and axe tests twice; full serial suite twice;
  typecheck; SDK check; build; verified-source reload; diff check; live
  light/dark and narrow/wide checks for empty, populated, linked, and busy
  states.

## R33 — task workflow projections (`BBPLUG-161`)

### R33.1 Deterministic workflow buckets

- **Red:** add exhaustive pure tests that project outcome, binding-owned
  execution tasks, generic linked tasks, assignee, owner runtime, and status
  into exactly one of Needs you, In progress, Next, or Completed. Cover
  missing owner threads, canceled work, `in_review` with and without a concrete
  gate, and stable sorting.
- **Green:** add a Tasks-owned workflow projection. Outcome is excluded from
  rows; execution and generic tasks are deduplicated by task ID.
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
- **Refactor:** remove obsolete binding labels and any second thread selector;
  keep owner-thread mutation separate from Human/Agent assignment.
- **Validation:** focused left Tasks tests twice; full serial suite; typecheck;
  SDK check; build; reload; diff check; live light/dark, narrow/wide, keyboard,
  drag, search, and long-list checks.

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

- **Red:** build a parity matrix covering hierarchy, Work item, Tasks, both
  sidebars, accessibility, lifecycle cleanup, narrow widths, and both themes.
  Any missing cell is a failing acceptance item, not prose residual.
- **Green:** address each reproducible finding in its owning slice with a new
  focused RED before implementation.
- **Refactor:** remove temporary adapters, stale selectors, and superseded
  tests only when equivalent behavioral evidence exists.
- **Validation:** all gates above plus a clean independent read-only review of
  architecture adherence, BB SDK lifecycle, remote-state ownership,
  accessibility, CSS collisions, bundling/runtime risk, and regressions.

