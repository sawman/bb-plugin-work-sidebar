# Work sidebar implementation handoff

Status: Active implementation baseline preparation
Date: 2026-08-27
Repository: `/Users/matthewsaw/dev/bb-plugin-work-sidebar`

This document transfers the recoverable implementation state and the product
requirements from the long-running recovery thread into the dedicated
`bbplug` BB project. Read it after `.bb/AGENTS.md` and before
changing the worktree.

## BB ownership and thread state

- Dedicated BB project: `proj_wpkwhd7urk` (`bbplug`). The linked BB Tasks
  project is also named `bbplug`; its historical `BBPLUGINWO` key prefix is
  intentionally stable.
- Implementation root thread: `thr_6bn73wstdm` (`Refactor work sidebar architecture`).
- Environment: `env_kx2zih2swg`, using this exact unmanaged checkout on `main`.
- The user resumed the implementation thread and explicitly authorized local
  baseline, child, integration, and checkpoint commits. Nothing may be pushed
  without separate authorization.
- Durable repository outcome: `BBPLUGINWO-1` (`Complete work-sidebar
  vertical-slice refactor`). It is attached to `thr_6bn73wstdm`.
- Direct execution tasks are `BBPLUGINWO-2` (root audit/integration),
  `BBPLUGINWO-3` (recovery), `BBPLUGINWO-4` (refactor plan), `BBPLUGINWO-5`
  (architecture docs), and `BBPLUGINWO-6` (independent architecture review).
- The predecessor Personal-project tree was migrated as follows:
  `PERS-54` to `BBPLUGINWO-1`, `PERS-55` to `BBPLUGINWO-3`, `PERS-57` to
  `BBPLUGINWO-4`, `PERS-58` to `BBPLUGINWO-5`, and `PERS-59` to
  `BBPLUGINWO-6`. Source records remain as canceled historical stubs and are
  no longer attached to the active implementation thread.
- Reviewer thread `thr_wscn6hu7xs` was deliberately stopped, then completed
  during shutdown. Do not resume it. Its complete read-only report is available
  with `bb thread output thr_wscn6hu7xs`.
- Fresh read-only Fable reviewer `thr_zmzrkqqkh3` completed against the recovered
  tree. Its execution task is `BBPLUGINWO-7`; close that completed task before
  G0 rather than leaving an ownerless durable execution binding. Current
  durable execution bindings are `BBPLUGINWO-2` (root owner) and
  `BBPLUGINWO-7` (completed review); historical tasks 3–6 remain audit records,
  not active owners.

Use BB Tasks as the source of truth. Do not replace the task queue with this
document or a repository TODO file.

## Git and recovery boundary

The last committed checkpoint is:

```text
8ee5356 (HEAD -> main, origin/main) style: use amber for requested reviews
```

Remote configuration currently says:

```text
origin  https://github.com/sawman/bb-plugin-work-sidebar.git
```

BB environment PR discovery reports that GitHub cannot resolve
`sawman/bb-plugin-work-sidebar`. Verify repository existence and authenticated
account before pushing. Do not rewrite the remote based only on the configured
URL.

All changes after `8ee5356` are uncommitted recovered work or the new
architecture package. They are valuable and must not be reset, checked out,
or replaced wholesale.

Current tracked delta:

```text
 app.tsx                         | 298 lines changed
 components/threads/task-row.tsx |  16 lines changed
 components/work/linear-card.tsx |   5 lines changed
 contracts.ts                    |  45 lines added
 server.ts                       | 402 lines changed
 views.css                       |  24 lines changed
 work-model.test.ts              |   1 line added
 work-model.ts                   |   1 line added

 total: 700 insertions, 92 deletions
```

Untracked files:

```text
.bb/AGENTS.md
components/tasks/assignee-picker.tsx
components/ui/combobox.tsx
components/work/card.tsx
docs/adr/0001-vertical-slice-architecture.md
docs/adr/0002-state-ownership.md
docs/adr/0003-atomic-ui-and-styling.md
docs/adr/0004-incremental-migration-and-verification.md
docs/adr/README.md
docs/architecture/refactor-plan.md
docs/architecture/implementation-handoff.md
```

Managed worktrees branch from committed Git state and will not inherit these
changes. Before delegating code edits to worktree children, establish a
reviewed baseline commit or another explicit, reproducible snapshot approved
by the user. Never ask a child to reconstruct this dirty state from memory.

## What the uncommitted implementation contains

### Tasks

- Task creation from the left Tasks tab, including project and human/agent
  selection.
- Task deletion with confirmation.
- Optimistic human/agent assignee updates.
- Attach/detach a task to the active thread from the left Tasks tab.
- Attach/detach and change assignee from the right Work Tasks card.
- Searchable combobox and a compact icon-based assignee picker.
- New task RPC contracts and Tasks-plugin server calls.
- Task project summaries returned with the task list.
- First extraction attempts in `components/tasks/assignee-picker.tsx`,
  `components/ui/combobox.tsx`, and `components/work/card.tsx`.

These extractions are incomplete and visually conflict with legacy card CSS.
Review them; do not assume they are the desired final atomic components.

### GitHub data and API budget

- Shared server-side GitHub read cache and in-flight request deduplication.
- Separate REST/GraphQL health and backoff classification.
- REST signal reads and repository-batched GraphQL signal reads.
- Authored-PR filtering for archived repositories.
- A lightweight base-PR fingerprint poll that refreshes the full stack only
  when the signal changes.
- Different active/background/left-list polling settings exposed through BB
  plugin settings.
- GitHub rate-limited/unavailable indicators in relevant sidebar surfaces.
- PR state, checks, review, re-requested review, and merged-stack signal work.

The current implementation still uses local effects, timers, request counters,
and module maps. The proposed Query migration must preserve the server cache
and API-budget protections instead of duplicating or bypassing them.

### Right Work and Changes panels

- Split context loading into work context, changes, tracker, provider health,
  and GitHub health requests, with bounded per-thread caches.
- Provider status light and provider status-page link.
- Current status plus Agent/User activity rows.
- Unarchived and active child-agent counts.
- Right-side task attachment and assignee controls.
- Working-tree changes, PR stack projection, PR fingerprints, and tracker data
  have separate RPC paths.
- Current BB host diff/source navigation is preferred over maintaining an
  inferior inline diff viewer.

The caches and independent loading are behavioral prototypes, not the final
state architecture. They should become explicit Query policies where the
architecture review determines that bundling and lifecycle are safe.

### Styling work

- New task composer, task metadata, combobox, assignee, GitHub health, Work
  surface, status, and review-state rules were appended to `views.css`.
- `WorkCard` deliberately uses `.ws-surface` instead of the legacy `.ws-card`
  cascade.
- Competing `.ws-card`, `.ws-work-card`, `.ws-surface`, task-card overrides,
  67 `!important` declarations, one `all: unset` selector, and eight distinct
  hex colors remain. `views.css` currently has a 2634-character maximum
  physical line. This is known debt and one cause of visual inconsistency.
- `views.css` is densely formatted, making surgical removal difficult. Make a
  formatting-only baseline change before semantic CSS cleanup if it can be
  reviewed independently.

## Current validation evidence

Validated against the dirty tree on 2026-08-27:

- `npm test`: passes, 1 test file and 7 tests.
- `npm run typecheck`: passes. Root imports cause many nested components to be
  checked transitively, but the current root-only `tsconfig.json` include can
  miss nested tests and unreferenced modules.
- `npm run build`: succeeds and writes the ignored `dist/` artifacts.
- The build emits two CSS optimizer warnings, including an unexpected closing
  curly bracket. Treat a warning-free CSS build as an acceptance condition.
- `git diff --check`: passes.
- `bb plugin types --check .`: fails.

The SDK compatibility failure says:

- Pin `@get-bb/plugin-sdk` from `^0.4.8` to host version `0.4.21` in
  `devDependencies`.
- Add the host-shimmed versions of `@pierre/diffs`, Radix packages,
  `class-variance-authority`, `clsx`, `tailwind-merge`, and `vaul` to
  `devDependencies` as directed by `bb plugin types`.
- Move `sonner` from `dependencies` to `devDependencies` at `^1.7.4`.

Do not mechanically run the mutating `bb plugin types` command until the
dependency/bundling decision is understood and captured in the ADRs.

## Architecture review that must be reconciled first

The completed Fable review found two critical gaps:

1. TanStack Query and Zustand are mandated but absent from `package.json`.
   The docs do not state whether React, Query, Zustand, Zod, and SDK app
   modules are host externals or plugin-bundled dependencies, whether both
   slots share one module instance, or what survives plugin reload.
2. There is no committed baseline or real rollback artifact. A worktree-based
   migration is unsafe until the recovered dirty implementation and docs have
   a reviewed checkpoint.

High-priority corrections:

- Resolve the contradiction between requiring two consumers before a shared
  primitive and creating all shared primitives before any slice migrates.
- Define PR presentation changes as a deliberate cross-surface adoption step,
  not an isolated PR slice that pretends not to touch Threads and Changes.
- Move each feature's server adapter with its slice; reserve the later server
  stage for truly cross-slice services and registration cleanup.
- Widen `tsconfig` coverage for nested source and test files.
- Resolve SDK drift before trusting host-API type checks.
- State exactly how vendored shadcn primitives are styled and bundled.
- Reconcile the already-started Tasks/Work/Combobox extraction with migration
  order.
- Define or remove the tracker slice and define the agents-versus-threads
  boundary.

Additional required decisions from the report:

- Explicit Query defaults per key: retry, stale/gc time, focus behavior,
  polling, and realtime invalidation. GitHub queries must not retry in a way
  that defeats server rate-limit backoff.
- Prevent realtime invalidation from snapping optimistic reorder state back
  during an in-flight drag mutation.
- Do not use Zustand persistence for transient state; define per-thread state
  eviction on archive/delete or bounded LRU.
- Define client and server teardown behavior on plugin reload.
- Resolve BB settings ownership versus plugin server preferences, and BB
  navigation versus plugin-local tab selection.
- Permit browser-safe runtime contract imports when typed RPC needs them while
  still forbidding Node dependencies in the app bundle.
- Reconcile ADR supersession rules: preserve old ADR bodies, mark status as
  superseded, and add a new ADR.
- Name the frontend harness dependencies and the visual baseline artifact
  matrix.

Read the full reviewer output rather than relying only on this summary.

The second Fable pass accepted the architecture direction and identified G0
evidence gaps. The root resolved them by regenerating recovery artifacts after
the final documentation amendments, capturing every reachable populated tab in
light mode at wide and narrow widths, and making uncaptured dark and synthetic
states explicit owning-slice gates. R2 separates runtime contract schemas from
server SDK composition, R3 verifies the shadcn utility-compilation claim live,
and R1 treats the SDK 0.4.21 pin as work to perform rather than current fact.

### G0 recovery record

- Parent commit: `8ee53560438f21b9bbc4317bd7f651444f8240db`.
- Baseline commit: resolve annotated local tag
  `checkpoint/work-sidebar-recovered-2026-08-27`; its exact commit ID is also
  recorded in the G0 BB Task comment.
- Recovery digests: external
  `baseline/2026-08-27/SHA256SUMS` in root thread storage and the G0 BB Task
  comment. The untracked archive contains this handoff, so embedding that
  archive's own final hash here would make the artifact stale recursively.
- `git apply --check -R` passes for the tracked patch. The extracted archive's
  manifest exactly equals `git ls-files --others --exclude-standard`, and every
  archived file is byte-identical to the recovered working tree.
- Existing captures: all six populated tabs were captured and visually
  inspected in light mode at wide width: left Threads, Tasks, and PRs; right
  Work, Changes, and Agents. Paired captures also cover Threads/Work,
  PRs/Changes, and Tasks/Agents at a 1,100 px app-window width. The exact files
  live beside `SHA256SUMS` in root thread storage. Cua Driver used background
  accessibility actions; the original app frame and `default` BB theme were
  restored before the session ended.
- A `dracula` BB palette capture is retained as a palette diagnostic, not
  claimed as OS dark-mode evidence. True dark mode plus loading, empty, error,
  selected, expanded, and mutation-busy states remain mandatory harness and
  live checks before each owning slice goes green. Recovered or external data
  is not mutated to fabricate G0 evidence.

## Product behavior that the refactor must preserve

### Left sidebar: Threads

- Tabs are Threads, Tasks, and PRs. They warm independently and show local
  loading/error states rather than blanking the entire sidebar.
- Thread selection supports ordinary click, Shift-click range selection, and
  Control/Command-click toggling.
- Modifier-click behavior applies consistently to all selectable lists.
- Archiving or deleting a parent cascades through its child threads.
- Default groups are Active and Archive. Custom groups are supported; Later is
  the initial custom group. Groups can be added, renamed, and removed only
  while empty.
- Context menus move a thread directly to another named status/group. Archive
  offers Active and Later destinations; custom groups offer Active/Archive and
  other valid groups.
- Dragging the whole row reorders within a group, moves across groups including
  Archive, and exposes a clear insertion line. The destination group and
  persisted order must agree after drop.
- The same whole-row drag can target BB's main view to open or split a thread,
  matching native BB thread behavior.
- Rename allows normal text selection and does not initiate drag.
- Native/enhanced list switching lives behind a compact settings control. Its
  menu opens downward and is not occluded by sticky headers.
- Status presentation avoids duplicate unread/completed indicators. Unsent
  composer content uses BB's pencil signal alongside other row status signals.
- Child-agent count is hidden at zero; otherwise it preserves row alignment and
  can subtly indicate active child work.
- Sticky tabs/toolbars fully occlude scrolling rows with no transparent gap.
- Hover and selected backgrounds use the same restrained family; controls and
  icons remain geometrically aligned.

### Left sidebar: Tasks

- Primary row interaction assigns or attaches the task to a thread.
- Tasks can be created and removed.
- A task can be assigned to a specific thread from both sidebars.
- Human/agent attribution is edited on the right and shown with Human/Bot
  icons. Human work is not automatically executed by agents.
- All assignment controls are searchable dropdowns where the option set can be
  long; the two-value human/agent control is a compact proper dropdown.
- Status and priority use compact semantic icons, not oversized chips or
  circles.
- Metadata follows the same typography and control scale as other cards/rows.
- Reorder and modifier selection continue to work.

### Left sidebar: PRs

- Show all open PRs authored by the current user, excluding archived
  repositories. Closed and merged PRs do not appear in this left authored list.
- Group by repository and then stack so repository text is not repeated in
  every row.
- Stacks start collapsed. Top-level stack PRs align with unstacked PRs;
  expanded descendants alone receive additional indent.
- Stack chevron and rail are compact and precisely centered. PR number never
  ellipsizes; branch text may ellipsize and does not include merge target.
- Use the same PR/check/review semantics as the right Changes view.
- PR state: open green, draft muted, closed red with cross, merged purple.
- Checks: pass green, failure red cross, pending/unknown neutral and derived
  from all relevant checks rather than one arbitrary check.
- Review distinguishes approved, review required/not requested, review
  requested, changes requested, and review re-requested after changes.
- Review requested uses a sufficiently dark amber eye. Re-requested uses an
  amber eye with a small red work/wrench marker.
- Review comment count can appear beside the review signal.
- Icons have fast hover labels. Clicking the PR state control toggles
  draft/open and shows a spinner while mutating.
- Manual refresh bypasses the long display cache. Background refresh remains
  API-budget aware.

### Right sidebar: Work

- Tab title is Work. It is a vertically consistent list of compact cards, not
  duplicated template prose.
- Status card combines runtime state with one Agent row and one User row. The
  rows expand/collapse without shifting labels or command styling.
- Activity reflects the latest agent output and latest user input promptly;
  polling should update only that card, not remount the entire panel.
- Provider health uses a steady green/amber/red light in the card corner and
  opens the remote provider's official status page.
- Child-agent totals count only unarchived children and distinguish total from
  active using compact right-justified icons.
- Tasks, Outcome, Goal, Plan, and optional tracker/Linear data are independent
  cards with identical header/content/empty/error typography.
- The Work section header can show compact current-outcome and tracker badges.
- Do not render Linear when it is not the project's selected tracker.
- Linear search is a rounded search row directly above its result list,
  supports key and title, and presents related suggestions before typing. The
  current suggestion algorithm is text matching unless a real tracker endpoint
  is explicitly introduced.

### Right sidebar: Changes

- Always show the GitHub stack as a PR list. A PR-row disclosure expands that
  PR's files; it never hides the whole stack.
- Clicking a PR row expands files. Checking out the branch is a separate,
  clearly spaced action.
- Current checkout highlight is subtle and does not tint the expanded file
  list or add a bracket rail.
- Show open/draft/closed/merged, checks, review, re-requested review, and review
  comment count in the subtitle before branch name using the same shared status
  logic as the left PR list.
- Include merged PR layers when they are part of the actual GitHub stack;
  display them purple and visually subdued rather than as closed.
- Show uncommitted working-tree files in a PR-like current-checkout card with
  counts and a disclosure.
- Clicking changed files for the current checkout or uncommitted changes opens
  BB's native diff/source view. Do not maintain a noisy independently scrolling
  inline split/unified viewer unless it reaches host quality.
- Remove obsolete “workspace branch is not part of a stack” and “GitHub Stack
  unavailable” filler when PR and working-tree information remains usable.
- Changes data loads independently and uses a cheap base-PR REST fingerprint
  poll; refresh the full stack only when it changes or the user refreshes.

### Right sidebar: Agents

- Show only unarchived child agents and their live status.
- Use a true split-button/open-in-split interaction. Opening a child in a split
  must not replace or close the current Work tab.
- Polish typography, row state, empty states, and control sizing to match the
  shared surface/list system.

### Global behavior and settings

- Both sidebars must preserve all keyboard, modifier, context-menu, drag,
  open/split, refresh, and cache behavior while migrating.
- All remote data should load asynchronously by card/tab with cached content
  shown immediately on thread switches.
- Manual refresh still refreshes every domain it advertises, including archive
  details, subtext, PR state, and working-tree state.
- Expose separate configurable active, background, and left-list GitHub polling
  intervals in the plugin settings page.
- Surface GitHub unavailable/rate-limited state.
- Prefer REST for cheap focused polling and GraphQL for one batched data shape
  where it materially reduces total calls. Share server caches across left and
  right clients.
- Use BB host primitives and typed RPC. Do not add Axios.
- Eliminate competing card/list typography and broad CSS collisions. Visual
  verification in both themes and narrow/wide panels is mandatory.

## Required implementation workflow

Before code changes, amend the plan and ADRs using the reviewer findings and
produce a concrete sequence of strict red-green-refactor loops. Every loop must
name:

1. the characterization or failing test added first;
2. the minimum implementation that makes it pass;
3. the structural cleanup performed while green;
4. focused and full validation evidence;
5. the rollback/checkpoint boundary.

Use multiple bounded BB children only after a reproducible baseline exists:

- Provider `codex`, model `gpt-5.6-luna` for mechanical tests/extractions.
- Provider `codex`, model `gpt-5.6-terra` for feature-slice implementation.
- Every code-editing child uses `--parent-self`,
  `--new-environment worktree`, and the verified base branch.
- Give every child one direct execution task, a non-overlapping slice, and its
  own task-memory directory.
- Integrate and inspect each diff; never accept a child because it merely says
  tests pass.

After integration and full validation, create a read-only review child in the
integrated environment with a verified Cursor Opus model when available, or a
separate Codex `gpt-5.6-sol` child when Opus capacity is unavailable, using high
or xhigh reasoning. The review must cover behavior parity, architecture
boundaries, BB SDK lifecycle/bundling, CSS collisions, accessibility, test gaps,
and visual regressions. Address every valid finding before asking the user to
accept the work.

## First actions when the implementation thread resumes

1. Read `.bb/AGENTS.md`, this handoff, the refactor plan, all ADRs, and the
   complete Fable output.
2. Re-run `git status --short`; do not assume the inventory above is unchanged.
3. Reconcile the Fable amendments into the docs using small reviewed edits.
4. Resolve the bundling/dependency and SDK version facts empirically with BB's
   build/type tooling.
5. Present the baseline/checkpoint choice to the user before creating worktree
   children if no approved commit exists.
6. Write the red-green-refactor implementation plan into the architecture plan
   and mirror executable work in BB Tasks.
7. Begin with characterization coverage around the highest-risk preserved
   behavior, not with broad component movement.
