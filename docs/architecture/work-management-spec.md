# Work management and thread hierarchy specification

Status: Proposed for incremental implementation
Date: 2026-08-29
Owners: `BBPLUG-158`, `BBPLUG-160`, `BBPLUG-161`

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

## Current product audit

### Thread hierarchy

The host data already contains `parentThreadId`, and the BB SDK can update it,
but the enhanced sidebar has no safe interaction for promoting a child to a
root thread or moving a thread under another parent. Custom groups and durable
Work bindings make a raw `parentThreadId` write unsafe:

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

The thread context menu gains a **Move in hierarchy…** interaction:

- a child can choose **Make top-level**;
- a root or child can choose **Move under…** and search active compatible
  threads;
- the current thread, its descendants, archived threads, and threads from
  another project are not candidates;
- keyboard search, selection, Escape, outside dismissal, and focus return use
  the existing combobox/dialog accessibility contract.

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
- Success publishes one Threads-family invalidation. BB host state remains the
  source of truth; no thread record is copied into Query or Zustand.

## Unified Work item card

### Information architecture

The separate Outcome and Linear cards become one **Work item** card:

1. canonical BB outcome identity, priority, assignee, and status controls;
2. outcome description or compact empty state;
3. linked Linear issues, with the primary issue first when one is selected;
4. actions to create/adopt the BB outcome and link, unlink, or search Linear.

The Work panel order remains:

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

## Tasks workflow

### Relationship to Outcome

Outcome is the primary top-level task for managed work. The Tasks card does
not render it again as a normal row. Direct execution tasks are its logical
children and are projected by workflow rather than by raw Tasks nesting.

### Right Work Tasks card

The card answers “what needs to happen for this work?” and uses four sections:

1. **Needs you** — active Human-assigned tasks, decisions, reviews, and
   operations. This is first and visually distinct without being destructive.
2. **In progress** — active Agent-assigned tasks with their owner thread,
   provider icon, live execution state, and an open-thread interaction.
3. **Next** — backlog or to-do tasks not currently owned by an active worker.
4. **Completed** — collapsed by default, showing a count and only a bounded
   recent preview after expansion. A full-history action opens the Tasks app.

Each task appears exactly once. The card removes the duplicate thread count,
the prose-only bound-task count, and the second incompatible row system.

Human/Agent assignment is edited here because it expresses responsibility.
Owner-thread assignment is a separate searchable control. A Human task may
remain linked to a context thread without becoming agent-owned.

### Left Tasks pane

The left pane is the project-wide queue manager:

- search and filter across active tasks;
- show priority before status and keep titles unbolded;
- show the owner thread and provider when one exists;
- allow adding, replacing, or removing the linked/owner thread;
- keep Human/Agent assignment read-only here and edit it in the Work card;
- preserve create, status, priority, delete, modifier selection, and reorder
  behavior.

The pane does not use labels such as “bound direct execution task”. It shows
the human-readable owner thread and its provider instead.

### Status workflow

`in_review` remains a supported BB Tasks state for compatibility, but the
default agent workflow is:

`backlog` -> `todo` -> `in_progress` -> `done`

Use `in_review` only while a named reviewer or concrete acceptance gate is
actually pending. Completion or thread idleness never changes task status
implicitly.

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

- Hierarchy and task pickers are searchable combobox/dialog interactions with
  valid roles, active-descendant behavior, visible focus, Escape and outside
  dismissal, and focus restoration.
- Row-level controls consume activation before parent navigation or drag.
- Status and assignment are not conveyed by color alone.
- Loading keeps stable card structure; error and retry are local to the owning
  card or section.
- Empty sections are omitted when their absence is obvious; “No work” copy is
  used only when it provides an action.

## Non-goals

- Automatically merging or rewriting durable work bindings during thread
  reparenting.
- Treating Linear as the durable execution tree.
- Automatic two-way BB/Linear status synchronization.
- Replacing BB Tasks or creating a repository task queue.
- Copying remote or host records into Zustand.
- Rewriting all three areas in one change.

## Acceptance criteria

- A compatible unbound thread can be promoted or reparented; cycles,
  cross-project moves, archived targets, and binding-invalidating moves fail
  closed with actionable errors.
- Custom-group membership is reconciled with the resulting hierarchy.
- One Work item card presents the canonical outcome and all linked Linear
  records without duplicating persistence semantics.
- The right Tasks card has one deterministic projection into Needs you, In
  progress, Next, and bounded Completed sections.
- The left Tasks pane and right Work card expose distinct, understandable
  responsibilities while reading the same Query records.
- Agent tools and UI mutations preserve one outcome and direct execution
  children only.
- Focused tests, full serial tests, typecheck, SDK compatibility, build,
  verified-source reload, `git diff --check`, and affected live light/dark,
  narrow/wide interaction checks pass.

