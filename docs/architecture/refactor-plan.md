# Work Sidebar vertical-slice refactor plan

Status: Audited; authorized baseline checkpoint in progress
Date: 2026-08-27
Scope: The complete Work Sidebar plugin, including both sidebars, contracts,
server integrations, styling, state management, and tests.

## Outcome

Refactor the recovered plugin into vertical feature slices built from a small
atomic UI system. Replace component-owned request orchestration with TanStack
Query, use Zustand only for shared interaction state, and leave ephemeral
control state in React. Keep BB SDK hooks as the source of truth for state that
the host already owns.

This is a large architectural change delivered incrementally. Every slice must
remain usable and verified while the next slice is migrated.

## Current baseline

The audit on 2026-08-27 found:

- `app.tsx` is about 1,500 lines and contains both sidebars, 66 `useState`
  calls, polling loops, request race counters, module-level caches, mutations,
  drag/drop, and rendering.
- `server.ts` is about 1,850 lines and combines plugin registration, GitHub,
  Tasks, task bindings, Linear/taskboard, provider health, thread organization,
  caching, and RPC handlers.
- `contracts.ts` is about 430 lines and combines every domain schema and RPC
  method.
- The frontend uses roughly 249 distinct `ws-*` class names.
- `.ws-card`, `.ws-work-card`, and `.ws-surface` are competing card contracts.
  Later selectors reset or override earlier selectors, so markup changes can
  alter typography and control sizing elsewhere.
- PR/check/review presentation is duplicated between thread rows, the left PR
  list, and the right Changes view.
- The frontend manually implements caching, stale-data retention, request
  cancellation by counters, polling, mutation-busy state, and refetch fan-out.
- Only seven pure-model tests exist. There are no frontend slot tests or server
  RPC tests.
- `npm test` and `npm run typecheck` pass. `bb plugin types --check` fails
  because the repository SDK/dependency layout is behind the running BB host.

The complete recovered feature inventory and parity requirements live in
`implementation-handoff.md`. That inventory is an acceptance catalog, not a
second task queue.

## Baseline checkpoint gate

The recovered working tree is the only complete product snapshot. Managed BB
worktrees start from committed Git state and cannot see it. No code-editing
child may start until the user approves a reproducible checkpoint.

The approved checkpoint must contain all recovered tracked and untracked
implementation, the amended architecture package, and these recorded facts:

- parent commit `8ee5356` on `main`;
- exact `git status --short` and `git diff --check` output;
- passing `npm test` (7 tests), `npm run typecheck`, production build, and
  `bb plugin reload work-sidebar` against the verified path registration;
- the known pre-refactor failure of `bb plugin types --check .` and the two CSS
  optimizer warnings;
- screenshots under the root thread's `baseline/2026-08-27/` storage directory
  for representative populated states on both surfaces, plus an explicit matrix
  of uncaptured tabs/themes/widths/states. A missing matrix cell does not weaken
  rollback of the recovered files, but it becomes a mandatory harness and live
  characterization before its owning slice can go green. Capture names use
  `<side>-<tab>-<state>-<theme>-<width>.png`;
- a keep/fold decision for the started Tasks, WorkCard, and Combobox
  extractions: they are recovered behavior prototypes, retained and migrated
  by their owning slices, not accepted as final primitives and not discarded.

Pre-checkpoint recovery artifacts are stored outside the repository in the root
thread storage as `recovered-tracked.patch` and
`recovered-untracked.tar.gz`. Regenerate both immediately before G0, write their
SHA-256 digests to the G0 execution task and an external `SHA256SUMS` file beside
the artifacts, prove the tracked patch with `git apply --check -R`, and prove
the extracted archive matches every untracked path. The handoff records the
external manifest path rather than embedding the hash of an archive that
contains the handoff itself. A stale artifact blocks G0. These artifacts are
disaster-recovery aids, not a substitute for the approved Git checkpoint used
by child worktrees.

No commit, tag, or push is authorized by this plan. Once the user authorizes
local checkpoint commits, create one baseline commit and checkpoint tag. Each
green stage thereafter gets one reviewable local checkpoint. Nothing is pushed
without separate authorization.

## Runtime and bundling constraints

The dependency decision is explicit:

| Module/package | Runtime owner | Package placement | Verification |
| --- | --- | --- | --- |
| React, React DOM, `@get-bb/plugin-sdk/app` | BB host external/shared runtime | React/types and exact SDK pin in development tooling; never a second bundled React | Inspect production bundle imports/metadata and exercise hooks in both slots |
| Sonner, portal Radix families, `@pierre/diffs`, `clsx`, `tailwind-merge`, `class-variance-authority`, `vaul` | BB runtime shims | Host-aligned `devDependencies`, never runtime `dependencies` | `bb plugin types --check .` |
| `@tanstack/react-query` | Plugin bundle | `dependencies` | Bundle marker test proves Query is present without bundled React; two slot tests observe one QueryClient |
| `zustand` | Plugin bundle | `dependencies` | Bundle marker test proves Zustand is present without bundled React; store tests prove no persistence |
| Zod | Plugin bundle | `dependencies` | Browser bundle includes it only from a browser-safe schema module; SDK contract composition remains server-only |
| Vendored shadcn source | Plugin source plus verified styling path | Source owned by this repository; host-shim imports stay in `devDependencies` | R3 live utility probe decides whether utilities compile or primitives require plain plugin CSS over host tokens |

`definePluginApp` is evaluated once per plugin frontend generation in each app
window. A module-level QueryClient is therefore shared by the left and right
slot mounts in that window, not across windows. On frontend reload the host
unmounts the old slot generation; all Query observers, realtime subscriptions,
and component timers must end with it. No detached frontend timer is allowed.

Server caches are shared across windows and must be instantiated inside the
plugin factory or a factory-owned service. `bb.onDispose` clears timers, maps,
pending references, and subscriptions. No module-level cache may retain a stale
BB handle across reload.

R1 pins `@get-bb/plugin-sdk` to the running host's exact version (`0.4.21` in
the current build metadata), updates `engines.bbPluginSdk` to match, and runs
`bb plugin types --check .` before host API types are trusted. Until R1 lands,
typecheck evidence uses the installed 0.4.16 types. `experimental_*`
hooks/components and deprecated props such as `experimental_Original` are
wrapped in narrow adapters under `shared/host/` so SDK adjustment has one
migration point.

## Architecture principles

### Vertical ownership

A product concept is one slice. A slice owns the frontend, server adapter,
contract/schema, pure model, and tests needed to deliver that concept.

```text
features/
  threads/
    app/
    server/
    contract.ts
    model.ts
    tests/
  tasks/
  pull-requests/
  work-context/
  changes/
  agents/
  tracker/

shared/
  ui/
  query/
  status/
  styles/

app.tsx
server.ts
contracts.ts
```

`app.tsx`, `server.ts`, and `contracts.ts` compose registrations and feature
exports. They do not contain feature workflows.

`shared/` is intentionally small. A component becomes shared only when two
slices need the same semantic behavior. Features should not be coupled merely
because two rows happen to look similar.

### State semantics

Choose state ownership by what the state represents, not by which library is
convenient at the call site.

| State | Owner | Examples |
| --- | --- | --- |
| BB host state | BB SDK hooks | Active threads, projects, composer draft, native navigation/actions, and settings declared through `bb.settings` |
| Server state | TanStack Query | Archive, Tasks, task links, authored PRs, stacks, Work context, activity, repository changes, tracker, provider/GitHub health |
| Mutations | TanStack mutations | Reorder, move group, archive/unarchive, task assignment, PR draft toggle, checkout, tracker links |
| Shared interaction state | Zustand | Multi-selection, anchors, drag source/drop target, expanded groups/stacks, and plugin-only Work/Changes/Agents tab state |
| Per-thread interaction state | Zustand keyed by thread ID | Work tab, expanded activity, expanded stack branches, selected diff |
| Ephemeral local state | React | Rename text, search text, new-task text, focus, component-local popover/disclosure |
| Durable plugin preferences | Server query/mutation | Thread groups and native/enhanced mode when no declarative BB setting exists |

Git/PR/task/tracker/provider records are server state and must not be placed in
Zustand. Their selection or expansion may be.

### Transport and caching

Use BB's typed `useRpc` transport inside TanStack query and mutation functions.
Axios adds no useful transport behavior here and would discard contract
inference and BB's RPC envelope semantics.

Each app slot is wrapped in `PluginProviders`, backed by one stable QueryClient
per app window. This shares cache entries across the left and right plugin
surfaces without turning domain data into global UI state.

Query keys are defined in one factory and grouped by slice. Initial candidates:

```text
sidebar.archive(project?)
sidebar.preferences
tasks.list(project?)
tasks.links
github.authoredPullRequests
github.stacks
github.health
work.context(threadId)
work.activity(threadId)
work.changes(threadId)
work.tracker(threadId)
work.providerHealth(threadId)
work.fileDiff(threadId, path)
```

Realtime messages invalidate query families. They do not directly call every
refresh function. Mutations update or invalidate the narrowest affected keys.
Optimistic updates are limited to reversible local projections such as
selection-independent task assignment or sibling ordering.

Realtime payloads carry a contract-validated family discriminator such as
`{ family: "sidebar" | "tasks" | "github" | "work", threadId?: string }`.
The client maps each payload to exactly one query-key family and optional thread
scope; tests reject a payload without `family`.

The server retains GitHub caches, rate-limit backoff, and request deduplication
because those resources are shared across windows and clients. Client query
caching does not replace server API-budget protection.

Every query declares its policy beside its key. These are the initial parity
targets; characterization tests may tighten a value but may not silently
remove an existing refresh path:

| Query family | `staleTime` / `gcTime` | Retry and focus | Refresh/invalidation |
| --- | --- | --- | --- |
| `sidebar.preferences`, `sidebar.archive` | infinity or 5 min / 30 min | no retry for preferences, one archive retry; no focus refetch | own mutation and relevant realtime signal |
| `tasks.list`, `tasks.links` | 15 sec / 10 min | one retry; no focus refetch | targeted mutation invalidation; links may use one 30 sec visible poll until the external producer supplies realtime |
| `github.authoredPullRequests`, `github.stacks` | 60 sec / 15 min | no client retry after server-classified GitHub failure; no focus refetch | declarative setting maps to one 60–600 sec visible interval plus manual refresh |
| `github.health`, `work.providerHealth` | 15 sec / 2 min | no retry; no focus refetch | one 30 sec visible health interval and relevant realtime signal |
| `work.context`, `work.tracker` | 5 sec or 30 sec / 10 min | one retry; no focus refetch | mutations and realtime invalidate only the affected thread/family |
| `work.activity` | 0 / 2 min | at most one retry; no focus refetch | 2 sec only while active and visible; stop or slow when idle/backgrounded |
| `work.changes` | 30 sec / 10 min | no retry; no focus refetch | invalidate when the fingerprint changes or after checkout/mutation |
| `work.fingerprint` | 0 / 2 min | no retry; no focus refetch | one setting-controlled active/background interval |
| `work.fileDiff` | infinity, keyed by fingerprint and path / 5 min | no retry; no focus refetch | fingerprint-key change makes stale data unreachable |

A realtime-backed key does not also poll unless an external producer can
change it without sending realtime. Optimistic mutations cancel the affected
query, snapshot and update its reversible projection, then defer a racing
realtime invalidation until settlement before doing the final targeted
invalidation.

### Atomic UI system

Do not build a speculative Stage 1 catalog. A feature first owns the smallest
semantic primitive it needs. When a second slice needs the same behavior, the
second migration promotes that primitive to `shared/ui` and migrates both
consumers in the same loop. Likely candidates—not a pre-approved library—are
surfaces, list rows, tabs, disclosures, icon/status controls, badges, tooltips,
selection controls, and loading/empty/error states.

Use BB's host Diff and SourceCode components. Remove the plugin-owned diff
review implementation once the Changes slice has migrated.

Central presentation functions return a label, icon, tone, and optional
secondary marker for:

- PR state: open, draft, closed, merged
- checks: passing, pending, failing, absent, unavailable
- review: approved, required, requested, changes requested, re-requested
- task status and priority
- thread/runtime state
- provider and GitHub API health

Both sidebars consume the same presentation functions.

### Styling contract

Use host theme variables and a small plugin token layer. Candidate tokens:

```css
--ws-control-size
--ws-icon-size
--ws-row-min-height
--ws-surface-padding
--ws-surface-gap
--ws-section-gap
--ws-sidebar-tabs-height
--ws-sticky-toolbar-height
```

Primitives own typography, spacing, focus, and variants. Feature CSS may own
layout such as the PR stack rail, drag insertion line, and sticky sidebar
geometry. Feature selectors must not restyle arbitrary descendants of a
primitive.

Use semantic `data-state`, `data-tone`, `data-selected`, and `data-expanded`
attributes. Remove hardcoded gray palettes, `all: unset`, and `!important`.
Selected and hover treatments derive from the same semantic surface token.

## Migration plan

### Stage map

0. Create the user-approved Git baseline checkpoint and finish behavioral
   characterization. No implementation worktree exists before this gate.
1. Correct SDK/dependency ownership, recursive typechecking, import-boundary
   checks, the test harness, Query runtime, and CSS parsing baseline. This
   stage creates no speculative component catalog.
2. Migrate the pull-request slice across both sidebars, including its contract
   and server adapter, because its status presentation is intentionally
   cross-surface.
3. Migrate Tasks read and mutation paths across both sidebars, folding the
   recovered Tasks, WorkCard, and Combobox prototypes into their final owners.
4. Migrate Threads host integration, organization, selection, archive, and
   drag/split behavior with its server adapter.
5. Migrate Work status, outcome, goal, plan, task attachment, and activity as
   independent cards and query families.
6. Migrate tracker/Linear as its own optional integration slice; a tracker
   failure must not blank Work.
7. Migrate repository changes, stack projection, fingerprinting, checkout,
   previews, and file diffs. Replace the plugin diff renderer with a narrow BB
   host Diff/SourceCode adapter in this stage.
8. Migrate Agents as a distinct child-thread projection that consumes BB host
   state and preserves open/split navigation.
9. Reduce entrypoints and contracts to composition, extract only remaining
   cross-slice server services, dispose all cache/timer state, and remove the
   final legacy CSS and compatibility paths. Feature-specific server code has
   already moved with its slice; this is not a delayed server rewrite.
10. Run the full automated/live parity matrix, then obtain the required
    independent read-only review in the integrated environment. Use a verified
    Cursor Opus model if available; otherwise use a separate Codex Sol child.
    Repeat remediation until the reviewer has no valid finding.

### Strict red-green-refactor work units

The named test files are intended destinations; a worker may split a file when
the slice boundary is clearer, but it must preserve the stated red assertion.
For every loop, the owning BB execution task records the failing red output,
the focused green output, the diff reviewed by the root owner, the full gate,
and its rollback checkpoint.

#### Gate G0 — reproducible recovered baseline

This is an authorization gate, not a code loop. After explicit user approval,
commit every recovered tracked and untracked file plus the audited
documentation as one local commit named
`chore: checkpoint recovered sidebar baseline`, add the annotated local tag
`checkpoint/work-sidebar-recovered-2026-08-27`, and record its commit ID and
artifact digests in BB Tasks. Later loop checkpoints use the matching
`checkpoint/work-sidebar-rNN` tag form.
Re-run the exact baseline commands and screenshots before branching. If the
gate differs from the current recorded behavior, stop and reconcile rather
than normalizing the difference.

#### Loop R1 — SDK, package, and compile boundary

- **Red:** preserve the current failing `bb plugin types --check .` output and
  add `tests/architecture/package-contract.test.ts` asserting the exact host
  SDK pin, host shim `devDependencies`, bundled Query/Zustand dependencies,
  and recursive source/test inclusion. Add a nested type-error fixture check
  and a browser-import graph check rooted at `app.tsx` that rejects
  `@get-bb/plugin-sdk` root, `node:*`, and server modules reachable at runtime.
- **Green:** make the minimal `package.json`/lockfile and `tsconfig.json`
  changes, install the official BB harness and Testing Library dependencies,
  add `vitest.config.ts` with jsdom for frontend tests and Node for backend
  tests, and add no product behavior. Move Sonner and every host shim named by
  the compatibility check to aligned `devDependencies`.
- **Refactor/removal:** centralize the architecture checks in one small test
  helper; remove obsolete dependency placement only after the checker proves
  the intended owner.
- **Validation/evidence:** the new architecture test, `npm run typecheck`,
  `bb plugin types --check .`, `npm test`, production build, and bundle import
  inspection all pass. `tests/architecture/bundle.test.ts` reads `dist/app.js`,
  asserts the React/JSX/SDK app external specifier strings are present, rejects
  bundled React/React DOM implementation markers, and proves Query/Zustand
  implementation markers are present. The stage checkpoint can restore the
  pre-SDK layout.

#### Loop R2 — registration lifecycle and Query runtime

- **Red:** add `tests/app/registration.test.tsx` and
  `tests/server/registration.test.ts` that characterize the existing left and
  right slot IDs, RPC/settings registrations, unmount/dispose behavior, and
  fail because there is no shared provider/query policy seam.
- **Green:** add the smallest `PluginProviders`, one module-generation
  QueryClient, query-key factory, explicit defaults, and factory-owned server
  lifecycle seam without moving a feature yet. Split browser-safe Zod schemas
  into slice contract modules that import only Zod; compose
  `defineRpcContract` in a server-only contract module never imported by the
  app.
- **Refactor/removal:** keep `app.tsx`/`server.ts` behavior unchanged while
  extracting registration-only helpers; eliminate any detached provider timer
  exposed by the tests.
- **Validation/evidence:** registration and query-key/policy tests pass; two
  mounted slots observe one client; unmount/dispose leaves zero subscriptions
  or timers; typecheck, full tests, build, reload, and `git diff --check` pass.

#### Loop R3 — CSS parse baseline

- **Red:** add `tests/architecture/styles.test.ts` that parses every plugin
  stylesheet, caps pathological physical line length, and records the current
  `all: unset`, hardcoded palette, and undocumented `!important` debt by
  selector. The production build still demonstrates the two known optimizer
  warnings.
- **Green:** mechanically format dense rules and repair only malformed braces
  or syntax necessary to make the parser and optimizer clean; screenshots
  must remain behaviorally equivalent at the established states.
- **Refactor/removal:** introduce the minimal token declarations needed by the
  unchanged CSS, without renaming feature selectors or altering layout.
- **Validation/evidence:** style test and warning-free build pass, before/after
  left/right screenshots match behavior, and full tests/typecheck/reload/diff
  check pass. A temporary live probe using a utility absent from host CSS (for
  example `pl-[13px]`) must produce the expected computed style. If it does
  not, supersede ADR 0003's utility-compilation path before R5 and implement
  primitives with plain plugin CSS over host tokens; remove the probe before
  checkpointing.

#### Loop R4 — pull-request presentation semantics

- **Red:** add `features/pull-requests/tests/presentation.test.ts` covering PR,
  check, review, re-request, comment-count, health, merged-layer, and archived
  repository cases from both current surfaces; it initially exposes divergent
  labels/tones/icons.
- **Green:** create pure pull-request models/presentation functions and switch
  both consumers to them without moving requests. Define one shared
  `pullRequestSignal` schema whose checks are
  `failed|passing|pending|none|unknown` and whose review states include
  `changes_requested_review_requested`; both `pullRequest` and
  `sidebarStackLayer` reuse it and the server normalizes before responding.
- **Refactor/removal:** promote a status primitive to `shared` only because the
  second sidebar now consumes the same semantic contract; remove both old
  mappings and their selectors in this loop.
- **Validation/evidence:** presentation tests prove identical cross-surface
  output, existing model tests pass, and live left PR/right Changes states
  match in light/dark and narrow/wide layouts.

#### Loop R5 — pull-request remote ownership

- **Red:** add `features/pull-requests/tests/queries.test.tsx` and
  `server.test.ts` for authored PRs, stacks, health, manual refresh, setting-
  controlled visible polling, rate-limit no-retry, draft mutation, cache
  sharing, and archived-repository filtering; they fail against counters and
  module caches.
- **Green:** move the PR contract, server adapter/cache/backoff, query hooks,
  and mutations as one vertical slice and migrate both surfaces.
- **Refactor/removal:** remove old request counters, polling effects, refresh
  fan-out, duplicate handlers, and PR-specific legacy CSS immediately.
- **Validation/evidence:** focused frontend/RPC tests pass with fake timers and
  targeted invalidation; build inspection proves no server import in the app;
  full gate and live refresh/draft/stack checks pass.

#### Loop R6 — Tasks read model

- **Red:** add `features/tasks/tests/model.test.ts` and `queries.test.tsx` for
  project filtering, status/priority/assignee presentation, task ordering,
  thread links, independent errors, loading/empty/populated states, and the
  current left/right parity contract.
- **Green:** move task/project/link contracts, server reads, query keys, pure
  models, and the smallest owned row/card views; fold in the recovered Tasks
  and WorkCard prototypes.
- **Refactor/removal:** promote row/card semantics only after both surfaces use
  them; remove the corresponding old reads, manual caches, counters, and CSS.
- **Validation/evidence:** read/model/component/RPC tests pass; one failed task
  query does not blank sibling Work cards; live left Tasks and right Tasks card
  states pass; full gate passes.

#### Loop R7 — Tasks mutations and controls

- **Red:** add `features/tasks/tests/mutations.test.tsx` for create, delete,
  attach/detach from both surfaces, searchable assignment, right-side assignee
  editing, reorder, busy/error rollback, modifier behavior, and racing realtime
  invalidation.
- **Green:** add narrow TanStack mutations and finish the Combobox under its
  task owner, using optimistic projections only for reversible assignment and
  sibling ordering.
- **Refactor/removal:** remove ad hoc cache writes and mutation-busy state;
  promote the Combobox only if a later non-Tasks slice needs the same semantic
  control.
- **Validation/evidence:** mutation tests prove cancellation/snapshot/rollback/
  settlement order and targeted keys; keyboard/accessibility checks, both live
  surfaces, full gate, and reload pass.

#### Loop R8 — Threads interaction model

- **Red:** add `features/threads/tests/model.test.ts` and `store.test.ts` for
  selection anchors, modifier selection, expansion, drag targets, per-thread
  Work view state, no persistence, roster cleanup, and the 40-entry LRU cap.
- **Green:** add focused sidebar and per-thread Zustand stores containing only
  presentation state; BB records remain hook-owned.
- **Refactor/removal:** replace corresponding React/module globals and expose
  selectors that avoid whole-store rerenders; retain ephemeral rename/search
  state locally.
- **Validation/evidence:** pure/store tests pass, remount proves no persistence,
  roster/LRU cleanup is deterministic, and typecheck/full tests/build pass.

#### Loop R9 — Threads host and server slice

- **Red:** add `features/threads/tests/thread-row.test.tsx`, `queries.test.tsx`,
  and `server.test.ts` for groups/order/archive/preferences, rename, recursive
  archive/delete confirmation, shortcut attributes, open/modifier-click,
  reorder across groups, native split handoff when drag exits the sidebar, and
  the existing `normalizeThreadGroups` behavior without importing `server.ts`.
- **Green:** move the thread app/server/contract slice while retaining BB
  hooks for active records, native actions, per-row PR data, and split gesture;
  move `normalizeThreadGroups` into the slice's pure model.
- **Refactor/removal:** remove archived-thread subprocesses, old organization
  paths, overlapping drag state, and migrated selectors in the same loop.
- **Validation/evidence:** harness and RPC tests pass; live keyboard, rename,
  open/split, custom group, cross-group drag, archive, and delete behavior pass
  in both sidebar widths; full gate passes.

#### Loop R10 — Work context cards

- **Red:** add `features/work-context/tests/model.test.ts` and
  `cards.test.tsx` for Status, Tasks, Outcome, Goal, and Plan independent
  loading/error/populated/mutation-busy behavior and cached thread switching.
- **Green:** move the Work context contract/server reads/queries and split the
  monolith into independently observed cards; keep task domain logic in Tasks.
- **Refactor/removal:** remove `workPanelCache`, request counters, and the old
  monolithic renderer/CSS as soon as all cards use the slice.
- **Validation/evidence:** one card failure never blanks or resizes siblings,
  component/RPC tests and cached-switch tests pass, right Work live matrix and
  full gate pass.

#### Loop R11 — Work activity lifecycle

- **Red:** add `features/work-context/tests/activity.test.tsx` with fake timers
  for active-visible, idle, background, thread-switch, unmount, reconnect, and
  realtime/poll collision cases.
- **Green:** migrate activity to its own query and status-card observer using
  the explicit policy table.
- **Refactor/removal:** delete activity intervals, counters, and fan-out effects
  outside Query; consolidate visibility/active predicates.
- **Validation/evidence:** fake-timer tests leave no work after unmount, live
  runtime transitions update only Status, and full gate/reload pass.

#### Loop R12 — tracker integration

- **Red:** add `features/tracker/tests/adapter.test.ts` and `card.test.tsx` for
  absent plugin, invalid runtime payload, loading/error/populated, link/create/
  unlink mutations, and isolation from the rest of Work.
- **Green:** move the optional Taskboard/Linear contract, validated server
  adapter, query/mutations, model, and card into `features/tracker`.
- **Refactor/removal:** remove tracker logic from Work/server/contracts and
  promote a shared error/card primitive only if this is its second semantic
  consumer.
- **Validation/evidence:** adapter/RPC/component tests pass with malformed and
  unavailable plugin responses; live tracker states and full gate pass.

#### Loop R13 — Changes repository state

- **Red:** add `features/changes/tests/model.test.ts`, `queries.test.tsx`, and
  `server.test.ts` for clean/dirty repositories, stack/non-stack projection,
  renamed/untracked/deleted files, fingerprint changes, health, loading/error,
  and active/background refresh.
- **Green:** move repository/stack/fingerprint contracts, server services,
  models, and queries; keep selected file and expanded stack presentation in
  Zustand only.
- **Refactor/removal:** remove manual caches/counters/pollers and the migrated
  repository selectors without disturbing the file-diff path yet.
- **Validation/evidence:** model/query/RPC tests pass, fingerprint invalidates
  only affected thread data, live clean/dirty/stack paths pass, and full gate
  passes.

#### Loop R14 — Changes interactions and host rendering

- **Red:** add `features/changes/tests/interactions.test.tsx` for checkout busy/
  failure, preview/open behavior, lazy diff keys by fingerprint/path, binary or
  unavailable diff fallback, keyboard access, and host renderer adaptation.
  Extend the package/bundle contract test so it fails while `react-diff-view`
  or its runtime/CSS markers remain.
- **Green:** migrate checkout and file-diff server/query paths and introduce a
  narrow adapter over BB's experimental Diff/SourceCode components.
- **Refactor/removal:** delete `react-diff-view`, its dependency and custom
  syntax/diff CSS; remove the old checkout/diff handlers in the same loop.
- **Validation/evidence:** component/RPC tests pass, the architecture check proves
  `react-diff-view` is absent from the package, import graph, bundle, and CSS;
  `bb plugin types --check .` and bundle inspection pass; and live file
  preview/diff/checkout checks pass in both themes and panel widths before the
  full gate.

#### Loop R15 — Agents projection

- **Red:** add `features/agents/tests/model.test.ts` and `view.test.tsx` for
  direct/recursive child projection, archived filtering, empty/error/populated,
  active state, open/modifier-click, and split navigation.
- **Green:** move Agents model/view into its own slice and consume BB thread
  hooks/actions directly; add a server adapter only if a non-host datum is
  actually required.
- **Refactor/removal:** remove Agents branches and selectors from the Work
  monolith and share status semantics only where already proven by R4.
- **Validation/evidence:** model/harness/accessibility tests and live right
  Agents states pass; full gate passes.

#### Loop R16 — composition and server lifecycle

- **Red:** strengthen `tests/app/registration.test.tsx`,
  `tests/server/registration.test.ts`, and
  `tests/architecture/import-boundaries.test.ts` with line/complexity budgets,
  exact feature composition, strict JSON adapter validation, multiple reloads,
  and zero stale BB handles/timers/caches after disposal.
- **Green:** reduce `app.tsx`, `server.ts`, and `contracts.ts` to composition;
  extract only genuinely cross-slice GitHub/cache and binding infrastructure.
- **Refactor/removal:** remove every dormant handler, compatibility type,
  feature cache, selector, and polling path; centralize factory-owned disposal.
- **Validation/evidence:** lifecycle/registration/boundary tests pass over
  repeated reloads; bundle and RPC registrations match the contract; full gate
  and `git diff --check` pass.

#### Loop R17 — shared styling and legacy removal audit

- **Red:** expand the style/DOM architecture tests to fail on competing card/
  row contracts, broad descendant typography, hardcoded palettes, `all: unset`,
  undocumented `!important`, inaccessible icon buttons, and obsolete `ws-*`
  selectors with no consumer.
- **Green:** promote only primitives now proven by at least two slices, migrate
  both consumers together, and replace remaining values with host tokens and
  semantic data variants.
- **Refactor/removal:** delete the superseded primitive and selector path in
  the same change; retain feature-only layout such as rails, drag insertion,
  and sticky geometry in the owning slice.
- **Validation/evidence:** style/DOM/accessibility tests and warning-free build
  pass; light/dark, narrow/wide, hover/focus/selected, rename selection, and
  drag placement are inspected across both sidebars; full gate passes.

#### Loop R18 — integrated parity gate

- **Red:** execute the handoff acceptance catalog and add any missing
  characterization test for a state or interaction that cannot yet be proven;
  each uncovered gap is the red assertion, not an undocumented manual fix.
- **Green:** make the smallest owning-slice correction for each gap.
- **Refactor/removal:** remove only duplication revealed by the correction and
  rerun that slice before proceeding.
- **Validation/evidence:** `npm test`, recursive typecheck, warning-free plugin
  build, `bb plugin types --check .`, verified-path plugin reload,
  `git diff --check`, bundle inspection, and the complete live parity matrix
  all pass; no worktree remains unintegrated.

#### Loop R19 — independent final review and remediation

- **Red:** spawn one read-only child in the integrated environment with
  a verified Cursor Opus model, or provider `codex` and model `gpt-5.6-sol`
  when Opus capacity is unavailable, at high or xhigh reasoning. Every valid
  architecture, behavior, test, accessibility, style, SDK lifecycle, or
  bundling/runtime finding becomes a failing test or reproducible check in its
  owning slice.
- **Green:** assign one bounded owner to each remediation and implement the
  smallest fix; the reviewer never edits the checkout.
- **Refactor/removal:** integrate and inspect each fix, remove any superseded
  path, then rerun the affected slice and integrated gate.
- **Validation/evidence:** repeat independent read-only review after remediation
  until its final report contains no valid finding, then rerun every R18 gate.
  Only that clean report plus final validation can move the outcome to review.

### BB child execution protocol

After G0 is explicitly authorized and created, each code-editing loop receives
one direct BB execution task, one owner, and its own task-memory directory.
Before task creation, binding, dispatch, or status change, the root rereads the
durable work context. Children are spawned with `--parent-self`, provider
`codex`, `--new-environment worktree`, and `--base-branch main`; Luna owns
mechanical/bounded migrations and Terra owns state, lifecycle, interaction, or
cross-surface work. Overlapping slices are not run concurrently.

The root inspects every child diff and evidence before integrating it into
`main`; integration and local checkpoint commits occur only under the user's
commit authorization. A failed or uncertain dispatch is reconciled from BB
Tasks/thread state rather than retried blindly. The final independent child is
read-only and shares the already integrated environment rather than receiving
an isolated code-editing worktree.

## Testing strategy

### Pure tests

- Status presentations and domain projections
- Thread and task ordering/group movement
- Query keys and invalidation plans
- Zustand actions/selectors and per-thread cleanup
- GitHub response parsing and rate-limit classification

### Frontend tests

Use `@get-bb/plugin-sdk/testing/app` plus Testing Library for:

- Slot registration and BB action calls
- Independent card loading/error states
- Modifier selection and keyboard tabs
- Mutation success/failure and query invalidation
- Empty/populated variants
- Accessible labels and menu/select behavior
- axe-core checks for every rendered slot-state fixture, with zero ARIA validity
  violations. Selection uses `data-selected` plus a valid option/row/gridcell
  role or `aria-current`, never `aria-selected` on a link or article.

### Backend tests

Use `@get-bb/plugin-sdk/testing` for:

- RPC validation and strict JSON results
- storage preferences and realtime invalidations
- task binding lifecycle
- archive/unarchive via the SDK
- GitHub cache invalidation and backoff with injected command adapters
- taskboard/Tasks cross-plugin failure isolation

### Live verification

The SDK frontend harness does not reproduce host CSS, panel layout, sticky
headers, or drag-to-split behavior. Use the running BB app to verify:

- left Threads, Tasks, and PRs tabs
- right Work, Changes, and Agents tabs
- loading, empty, error, populated, selected, and expanded states
- light/dark themes and narrow/wide panels
- hover/focus/selected consistency
- text selection while renaming
- drag insertion lines and destination groups
- open/split gestures and modifier clicks

## Acceptance criteria

- `app.tsx`, `server.ts`, and `contracts.ts` are thin composition files.
- No feature component owns an RPC cache, request race counter, or polling
  loop that TanStack Query can express.
- No server record is duplicated in Zustand.
- Every query has a centralized key and explicit freshness/polling policy.
- Realtime signals invalidate query keys rather than fan out refresh calls.
- PR/check/review semantics have one source of truth used on both sides.
- Realtime payloads validate one family/scope and invalidate only that query
  family.
- One Surface contract serves all right-side cards.
- One ListRow contract serves corresponding left-side list rows.
- No competing legacy card system, broad descendant typography override,
  `all: unset`, or undocumented `!important` remains.
- All existing interactions remain: modifier clicks, cascading archive/delete,
  reorder, cross-group drag, open/split drag, custom groups, task assignment,
  PR refresh/draft toggle, stack expansion, and working-tree diffs.
- `npm test`, `npm run typecheck`, `npm run build`, plugin reload, and
  `git diff --check` pass.
- Every affected visual state is inspected in the live BB app.

## Explicit non-goals

- Replacing BB's typed RPC transport with Axios.
- Mirroring BB host state in a plugin store.
- Building a normalized GitHub cache in the browser.
- Rewriting all slices in one unreviewable change.
- Creating a generic design system detached from the needs of this plugin.
