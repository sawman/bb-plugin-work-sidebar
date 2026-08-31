# Work management and thread hierarchy specification

Status: Amended implementation specification
Date: 2026-08-29
Documentation owner: `BBPLUG-166`
Implementation owners: `BBPLUG-158`, `BBPLUG-160`, `BBPLUG-161`
Durable outcome: `BBPLUG-1` (the historical `BBPLUGINWO` namespace remains
only in historical handoff records)
Base checkpoint: `9a3329b` on `bb/work-management-integration`; 74 files and
407 tests passing, typecheck clean, and `git diff --check` clean at the
2026-08-29 baseline.

## Purpose

This specification defines one coherent workflow for three related product
areas:

1. changing a thread between root and child positions;
2. presenting the thread's outcome and linked Linear records as one work item;
3. making Tasks useful as an execution and human-follow-up queue.

The design keeps the existing architecture boundaries. BB host hooks own thread
state, BB Tasks remains the durable execution record, Linear remains an
external tracker, TanStack Query owns remote state, and Zustand owns only
cross-component presentation state.

## Implementation status at the baseline

R31 is landed end to end at the baseline: hierarchy model and server service,
context/picker/menu integration, the `moveSidebarThread` handler, the
`useThreadHierarchyMutation` hook, and the existing happy-path hierarchy tests
are present. R32.1 and R33.1 are also present as pure models with tests, but
they have no production consumers yet. The legacy `TasksCard` and separate
`TrackerCard` remain the rendered path until their owning implementation loops
replace them. This document is therefore an amendment plan against a partially
landed tree, not a claim that all three slices are unstarted.

## Current product audit

### Thread hierarchy

The host data already contains `parentThreadId`, and the BB SDK can update it.
The landed hierarchy path now provides guarded menu operations, while the
remaining work is cache correctness, candidate computation, accessibility, and
drag parity. Custom groups and durable Work bindings make a raw
`parentThreadId` write unsafe:

- nesting a root with an outcome under another managed root would create two
  competing outcomes for one host hierarchy;
- promoting a delegated execution thread would leave its execution task under
  the former root outcome;
- moving a thread under itself or a descendant would create a cycle;
- a nested thread must not remain stored as a top-level custom-group member.

### Outcome and Linear

The right Work tab currently renders a canonical BB Outcome card and a separate
Linear card. Users experience both as descriptions of the same product
outcome, but they have different responsibilities:

- the BB outcome is the durable root of execution tasks, ownership, dispatch,
  recovery, and agent tooling;
- Linear is an external product record, may contain multiple linked issues,
  and has its own status vocabulary and permissions.

Treating them as interchangeable persistence records would make execution
ownership and status synchronization ambiguous. Keeping them as unrelated
cards makes the product feel duplicated.

### Tasks

The current Work Tasks card mixes three projections:

- generic tasks attached to the selected thread;
- a count of binding-owned tasks that are not rendered in that first list;
- a second list of execution tasks from the Work outcome.

This produces transitional loading shapes, duplicated concepts, and little
help with the primary user journeys. Completed tasks can dominate the card,
the owner thread is not the main organizing signal, and it is unclear whether
Outcome is a task or separate from Tasks.

## Product model

### Canonical work hierarchy

- A managed work root has zero or one canonical BB outcome task.
- Execution tasks are direct children of that outcome. They are never nested
  further in BB Tasks, even when owner threads have a deeper host hierarchy.
- An execution task may be Agent- or Human-assigned and may have one owner
  thread binding.
- Generic tasks may be linked to threads without becoming durable Work
  bindings.
- Linear issues are external records linked to the work root. Several may be
  linked; one may optionally be marked primary for presentation.

The UI may call this combined concept a **Work item**, but the underlying
records do not become interchangeable.

### Managed versus exploratory threads

An exploratory or conversational thread does not require an outcome. A thread
becomes managed work when an outcome is created or adopted, an execution task
is bound, or the user explicitly links an external tracker item and chooses to
create the internal outcome.

Managed work encourages a canonical outcome; it does not block ordinary chat.

## Thread hierarchy manipulation

### Supported interactions

The thread context menu provides a **Move in hierarchy…** interaction:

- a child can choose **To Top**, which is announced with the description
  "Move this thread out of its parent and make it a top-level thread";
- a root or child can choose **Move under…**, which opens a compact inline
  anchored combobox — not a modal dialog — prepopulated with every active,
  non-archived, same-project, non-descendant thread whose move would not
  invalidate a durable binding. Root threads sort first, and each candidate
  shows its current root so the user can see the depth being created. Deep
  host hierarchies remain allowed; the picker offers all valid non-descendants.
- the current thread, its descendants, archived threads, and threads from
  another project are not candidates;
- keyboard search, selection, Escape, outside dismissal, and focus return use
  the shared search shell. Candidate computation occurs only while the picker
  is open.

The same two operations are also reachable by drag:

- dropping a row onto another row's parent affordance makes it a child of that
  row;
- dropping a row onto the group's top-level drop zone makes it top-level.

Drag reparenting is a distinct hit target from reorder, cross-group move, and
BB's native drag-to-open/split. Reorder remains the default whole-row gesture;
reparenting requires the explicit affordance. A drag that leaves the sidebar
always yields to BB's native split handling. Rejected drops show the same
actionable error as the menu path and leave order and grouping unchanged.

Both surfaces use one label. The menu item and drag target are **To Top** and
carry the accessible description "Move this thread out of its parent and make
it a top-level thread", also exposed as the tooltip. The success toast and
rejection copy use the same wording. The former promotion label is retired and
must not survive as an alias.

The operation preserves the selected thread and does not implicitly open or
split it.

### Safety rules

The server revalidates every operation against fresh BB SDK state. Frontend
filtering is convenience, not authorization.

An operation is rejected when:

- source and destination are the same;
- the destination is a descendant of the source;
- source or destination is archived or belongs to another project;
- the move would merge two durable work roots;
- the source, or a descendant whose root would change, owns an outcome or
  execution binding that cannot remain valid after the move.

The first release does not silently migrate Tasks bindings. The error explains
which managed-work relationship must be completed, canceled, or explicitly
rebound first. A future binding-migration wizard is a separate product decision.

### Group and cache behavior

- Nesting a top-level thread removes it from every custom top-level group.
- Promoting a child places it in Active by default; it is not silently restored
  to an old custom group.
- The mutation uses the BB SDK for `parentThreadId`, then reconciles plugin
  group preferences. If preference persistence fails, the server attempts to
  restore the original parent and reports the failure.
- A successful move publishes one thread-preference invalidation and one
  work-family invalidation for both the previous and the new root. The client
  invalidates the work, tracker, and tasks query families for every thread in
  the affected subtree, because outcome, execution-task, and Linear records
  are root-scoped on the server. The mutation result carries
  `oldRootThreadId`, `newRootThreadId`, and `affectedThreadIds` so this scope is
  explicit. BB host state remains the source of truth; no thread record is
  copied into Query or Zustand.
- The server reads at most one project roster per move. If the roster is
  truncated or an ancestor is not loaded, the move is rejected as **hierarchy
  not fully loaded**, distinctly from a cycle or other invalid hierarchy.

## Unified Work item card

### Current-goal and backlog revision (2026-08-31)

The earlier primary-Linear presentation is replaced by a user-visible **work
queue**. A work-item reference is a small, plugin-owned classification record
which points at exactly one source record; it never copies the source title,
status, assignee, or description.

- A root has zero or one **Current goal**. It can reference either a BB Task
  or a Linear issue.
- It may have an ordered **Backlog** of additional BB Task and Linear
  references.
- Everything else belongs to **Execution tasks**. Those retain the existing
  BB outcome/execution binding rules; a Linear record cannot silently become
  a BB execution task.
- Promoting a backlog entry makes it Current and atomically demotes the old
  Current entry to the front of Backlog. Demoting Current clears that lane and
  places it at the front of Backlog. Reordering is scoped to Backlog only.
- A source-native status control updates precisely its referenced source:
  BB Task through BB Tasks; Linear through Taskboard. There is no automatic
  cross-system status synchronization.

"Move to tasks" therefore has honest source-specific meaning: a BB Task is
reclassified out of the goal queue and remains/gets linked as a normal task;
a Linear goal offers **Create BB execution task from Linear**. That explicit
copy records its Linear origin and leaves the Linear issue as the source of
the goal's status. "Move to goals" promotes an existing linked BB Task or a
linked Linear issue into Current/Backlog. The durable BB outcome is a system
execution container, not an implicit second Current goal; migrations seed it
as Current only when no explicit work-queue data exists.

Storage is root-scoped and versioned. Migration reads the existing outcome
and `work-linear-links:v2`: outcome becomes Current when present; otherwise
the old primary Linear issue becomes Current and remaining links become
Backlog. Invalid/missing references are omitted on projection and retained in
storage only until the next successful queue mutation, which compacts them.
Every queue mutation publishes the existing ordered Work then Tasks realtime
signals for the root and all affected owner threads.

The card renders Current goal first, then Backlog, then its add/search actions.
The Tasks card renders execution and ordinary linked tasks only; it never
duplicates a Current goal. This keeps one workflow without concealing that
BB Tasks and Linear have different lifecycle APIs and permissions.

### Information architecture

The separate Outcome and Linear cards become one **Work item** card:

1. canonical BB outcome identity, priority, assignee, and status controls;
2. outcome description or compact empty state;
3. linked Linear issues, with the primary issue first when one is selected;
4. actions to create/adopt the BB outcome and link, unlink, or search Linear.

The unified card intentionally changes the current layout: the separate
Tracker card currently renders after Background, while the unified card moves
its tracker content into slot 2. The resulting Work panel order is:

1. Status
2. Work item
3. Tasks
4. Goal
5. Plan
6. Background

### Empty and adoption states

- No BB outcome and no Linear link: show **Create outcome** and **Link Linear**.
- Linear linked without a BB outcome: show **Create BB outcome from Linear**.
  This is an explicit one-time copy of title and mapped priority, followed by
  the ordinary durable outcome binding.
- A legacy top-level BB task remains explicitly adoptable through the existing
  guarded adoption flow.
- BB outcome without Linear: show the outcome normally and offer **Link
  Linear** only when the selected tracker is available.

### Synchronization policy

There is no automatic bidirectional status synchronization in the first
release. BB status controls mutate BB Tasks; Linear status controls mutate the
selected Linear issue. Successful mutations invalidate their narrow Query
families and realtime remains an invalidation signal. The UI labels both
systems clearly when their statuses differ.

Multiple Linear links remain supported. A primary link affects ordering and
the compact header badge only; it does not delete or demote other links.

### Linked tracker records

One linked Linear issue may be marked primary. The primary key is stored beside
the link list in plugin server storage and exposed through one typed
`setPrimaryLinearIssue` operation. Migrate `work-linear-links:v1` to
`work-linear-links:v2` with `{ keys, primaryKey }`; the reader remains
forward-compatible with v1 data and treats its first key as the presentation
primary. Unlinking the primary demotes it and makes the first remaining link
primary for presentation only; no other link is deleted or reordered.

**Create BB outcome from Linear** copies title and mapped priority exactly once
through the outcome-creation contract, which carries an optional `priority`.
The mapping is case-insensitive for `urgent|high|medium|low`; all other values
map to `none`. It is never re-applied on later Linear edits.

If the tracker is unavailable, the Work item card still renders the BB outcome
and shows the tracker error inside its linked-records section only.

## Tasks workflow

### Relationship to Outcome

Outcome is the primary top-level task for managed work. The Tasks card does
not render it again as a normal row. Direct execution tasks are its logical
children and are projected by workflow rather than by raw Tasks nesting.

### Right Work Tasks card

The card answers “what needs to happen for this work?” and uses four sections:

1. **Needs you** — active Human-assigned tasks, decisions, reviews, and
   operations. This is first and visually distinct without using a destructive
   tone.
2. **In progress** — active Agent-assigned tasks with their owner thread,
   provider icon, live execution state, and an open-thread interaction.
3. **Next** — backlog or to-do tasks not currently owned by an active worker.
4. **Completed** — collapsed by default, showing a count and only a bounded
   recent preview after expansion. A full-history action opens the Tasks app.

Each task appears exactly once. When the same task ID arrives from both the
generic task list and the outcome's execution-task list, the execution record
wins. Within each section, tasks sort by owner liveness (for In progress),
then priority, then status, then key — the same precedence as the left queue.
Completed shows at most five recent entries after expansion, with a count and a
full-history action. Canceled tasks appear in Completed with a distinct status
icon and are named as canceled in their accessible label. Next includes tasks
whose owner thread is archived, showing that owner as unavailable rather than
silently dropping the task.

The card removes the duplicate thread count, the prose-only bound-task count,
and the second incompatible row system.

Human/Agent assignment is edited here because it expresses responsibility.
Owner-thread assignment is a separate searchable control. A Human task may
remain linked to a context thread without becoming agent-owned.

### Left Tasks pane

The left pane is the project-wide queue manager:

- search and filter across active tasks;
- show priority before status and keep titles unbolded;
- show the owner thread and provider when one exists;
- allow adding, replacing, or removing the linked/owner thread;
- keep Human/Agent assignment read-only here and edit it in the Work card when
  the task has an owner thread or belongs to an outcome. A task with neither is
  editable from the left row's context menu, so no task is unreachable;
- preserve create, status, priority, delete, modifier selection, and reorder
  behavior.

The pane does not use labels such as “bound direct execution task”. It shows
the human-readable owner thread and its provider instead.

### Status workflow

`in_review` remains a supported BB Tasks state and projects into In progress
for Agent-assigned work and Needs you for Human-assigned work. BB Tasks has no
reviewer or gate field, so the UI does not distinguish a gated from an ungated
review; the named-reviewer/concrete-gate rule is a working convention for
agents, not a modelled attribute. The default agent workflow is:

`backlog` -> `todo` -> `in_progress` -> `done`

Completion or thread idleness never changes task status implicitly.

### Agent automation surface

The existing tools remain the durable write surface:

- `create_work_task` ensures the canonical outcome;
- `create_execution_task` creates a direct child with explicit Human/Agent
  assignment;
- `bind_execution_owner` binds direct or delegated ownership;
- `update_task` changes safe fields and Human/Agent assignment;
- `get_work_context`, `get_task`, and `get_sidebar_tasks` provide readback.

The UI must present these records consistently; it must not invent a second
assignment store. Agent-created work defaults to Agent only when explicitly
requested by the caller. Explicit user follow-up is assigned Human.

## State and API ownership

- BB SDK hooks own active thread rosters, current thread state, and navigation.
- A Threads-slice typed RPC mutation owns hierarchy writes through
  `bb.sdk.threads.update` and server-side safety checks.
- TanStack Query owns Work outcome, Tasks, tracker, mutation state, and narrow
  invalidation.
- Zustand may own an open section, selected task, or picker anchor. It does not
  store tasks, tracker items, threads, hierarchy, or binding records.
- Linear remains behind the server Taskboard adapter. The frontend never calls
  Linear directly.
- `app.tsx` and `server.ts` remain registration/composition only.

## Accessibility and interaction requirements

- Every compact search and single- or multi-select picker is an instance of the
  shared inline shell. It uses valid combobox/listbox/option roles,
  active-descendant behavior, visible focus, Escape and outside dismissal, and
  focus restoration to the invoking control. `aria-expanded` reflects real
  open state, never a literal feature value.
- The hierarchy picker is a compact anchored popover, not an `aria-modal`
  dialog. The **To Top** menu item and drag zone carry the description "Move
  this thread out of its parent and make it a top-level thread"; row controls
  consume activation before parent navigation or drag.
- Row-level controls consume activation before parent navigation or drag.
- Status and assignment are not conveyed by color alone.
- Loading keeps stable card structure; error and retry are local to the owning
  card or section.
- Empty sections are omitted when their absence is obvious; “No work” copy is
  used only when it provides an action.

## Shared search shell

One plugin-local primitive owns every compact inline search and single- or
multi-select combobox in both sidebars: the left toolbar search, task-to-thread
assignment, PR reviewer selection, Linear issue search, task attachment, and
the hierarchy parent picker. It owns the input, the anchored portalled list,
`role="combobox"`/`role="listbox"`/`role="option"`, `aria-expanded` derived
from real open state, active-descendant movement, Home/End/Arrow/Enter/Escape,
outside dismissal, focus restoration, and busy/empty/error states. Features
supply options, selection, and mutation state only. No feature slice declares
its own search input, and no consumer hardcodes `aria-expanded`.

## Typography system

Six semantic text roles replace ad-hoc sizes: primary, title, subtext,
metadata, label, and code. Each role is one plugin token pair (size and weight)
derived from a single root scale variable over host theme tokens, per ADR 0005.
Primitives apply roles; feature selectors never declare `font-size` or
`font-weight`. Migration is per slice and removes that slice's raw declarations
in the same change, including `font-size: 0.6rem !important`.

An architecture test rejects any `font-size` or `font-weight` declaration
outside the typography token block. The six roles preserve semantic hierarchy
across left Threads/Tasks/PRs and right Work/Changes/Agents without exposing
per-feature type controls.

## Settings surface

The only typography preference exposed to users is one bounded text-scale
choice: compact, default, or comfortable (implemented as a clamped numeric
multiplier). It is stored as a plugin-server preference through the typed
RPC/Query path already used by sidebar row height, not through `bb.settings`,
because ADR 0002 assigns plugin-only durable preferences to server storage.
The preference applies live to both sidebars without reload, and the smallest
role at the smallest scale remains above the declared accessible minimum.

Per-role font sizes, font family, line height, letter spacing, weight, and
colour are deliberately not exposed: each is arbitrary CSS surface area that
breaks the primitive contract or can push text below an accessible minimum.

## Non-goals

- Automatically merging or rewriting durable work bindings during thread
  reparenting.
- Treating Linear as the durable execution tree.
- Automatic two-way BB/Linear status synchronization.
- Replacing BB Tasks or creating a repository task queue.
- Copying remote or host records into Zustand.
- Rewriting all three areas in one change.

## Recycle Bin and destructive archive

The enhanced sidebar distinguishes reversible filing from BB's destructive host
archive lifecycle:

- **Recycle Bin** is a plugin-managed group. Moving a live thread there does
  not call the SDK archive action, does not close its pane, and retains its
  environment. A durable bin record stores the thread id, its previous group
  (or Active), and the time it entered the bin.
- **Restore** removes that record and returns the thread to its recorded group;
  if the group no longer exists, it returns to Active. Binned threads are
  excluded from Active/custom groups and from every thread assignment, parent,
  reviewer-link, and owner picker.
- Bin is reachable from the row context menu and a drag target. Restore is a
  context-menu/row action, so binned rows cannot accidentally re-enter a
  custom group through a drag gesture.
- **Archive** remains BB's host-owned recursive operation, sits in the
  destructive Delete section, and uses destructive styling. It is never used
  as an implementation detail of binning.
- A genuinely archived thread is read-only for grouping: it cannot move to a
  custom group. Its only recovery affordance is **Resume in new worktree**.
  The SDK cannot revive the old archived environment or history, so this opens
  BB's new-thread flow preselected to the original project; it must never claim
  to restore the original thread.
- Retention is opt-in. The preference stores a retention duration but does not
  silently archive anything. A separately configured BB automation may invoke
  the plugin's expiry endpoint; it archives only eligible bin records, removes
  each record after the host action is accepted, and emits one Threads-family
  invalidation.

## Acceptance criteria

- A compatible unbound thread can be promoted or reparented; cycles,
  cross-project moves, archived targets, and binding-invalidating moves fail
  closed with actionable errors.
- Custom-group membership is reconciled with the resulting hierarchy.
- The unified card renders the BB outcome status control and the Linear status
  control as separately labelled controls, and mutating one issues no request
  to the other system.
- The right Tasks card has one deterministic projection into Needs you, In
  progress, Next, and bounded Completed sections.
- The left pane exposes create, delete, reorder, priority, status, owner-thread
  add/replace/remove, and modifier selection; the right card exposes
  Human/Agent assignment and section membership. No control appears on both
  surfaces.
- The Needs you section is the first rendered section and carries no
  destructive tone token.
- Agent tools and UI mutations preserve one outcome and direct execution
  children only.
- A reparent invalidates the work, tracker, and tasks families for the affected
  subtree; the right panel of a moved thread shows the new root's outcome
  without a manual refresh.
- Every compact search and combobox in both sidebars resolves to the shared
  shell; no feature slice declares its own search input.
- No stylesheet declares `font-size` or `font-weight` outside the typography
  token block.
- Focused tests, full serial tests, typecheck, SDK compatibility, build,
  verified-source reload, `git diff --check`, and affected live light/dark,
  narrow/wide interaction checks pass.
