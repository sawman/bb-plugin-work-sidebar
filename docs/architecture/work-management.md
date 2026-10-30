# Work, Tasks and thread hierarchy

This contract describes the current ownership model. BB Tasks is the durable
work record; host threads, external Linear records and plugin goal references
have distinct authorities. The Human-owned direction decision BBPLUG-355
remains open; this document does not resolve it.

## Outcome, Goals and Queue

- A managed root has at most one canonical BB outcome task. Execution tasks
  are direct children only, even if their owner threads nest more deeply.
  Each execution has one direct root owner or one delegated child owner.
  Generic tasks may be linked without becoming durable execution bindings.
- Conversation alone does not require an outcome. Creation/adoption and
  binding are explicit. Pending or uncertain dispatch must be reconciled
  before retry; thread idleness/completion never changes task status.
- **Goals** holds zero or one Current goal plus an ordered Backlog of BB Task
  or Linear references. References do not copy source titles/statuses/assignees.
  Promotion atomically puts the former Current at the front of Backlog;
  demotion clears Current and prepends it to Backlog. Reorder affects Backlog.
- Goal classification is separate from the durable outcome container. Legacy
  import can seed Current from the outcome or primary Linear link only when
  no explicit queue exists. Current code retains unresolved references with
  fallback BB Task/Linear labels. Omitting missing sources and compacting them
  on the next successful mutation remains an intended requirement, not
  implemented behavior; this gap is reported with the consolidation review.
- BB status controls write BB Tasks; Linear controls write through Taskboard.
  There is no automatic cross-system status synchronization. Creating a BB
  execution task from Linear is an explicit copy with provenance. One-time
  outcome creation copies title and maps urgent/high/medium/low priority
  case-insensitively, with other values mapped to none.
- Queue references are root-scoped SQLite records, imported from older KV
  storage. Taskboard absence is supported: BB-only Work remains usable and
  existing Linear links are retained for when the integration returns.

The Work items card composes Goals, source-aware add/search and task workflow.
It does not repeat the durable outcome as an ordinary task or duplicate Goals
in Queue. [Work composition](../../features/work-context/views.tsx) is the
source for current card order; older separate Outcome/Tracker/Tasks layouts
are retired.

## Responsibility and history

**Queue** holds unfinished Agent-assigned execution, including backlog,
blocked, waiting and review-gated work. **Needs You** holds unfinished
Human-assigned work requiring a concrete action or decision from this user.
Waiting for CI, another agent, retries or a GitHub reviewer does not transfer
responsibility. A Human task can retain a context thread without becoming
Agent-owned. Existing Human tasks require explicit delegation before an agent
works or reassigns them.

Ownership is separate from status and owner-thread availability. Default status
flow is backlog → todo → in_progress → done. Use in_review only while a named
reviewer or concrete acceptance gate is pending; this is an agent convention,
not a Tasks reviewer field. Fully validated work goes directly to done.

The [workflow model](../../features/tasks/workflow-model.ts) deduplicates by
task ID, preferring execution records over generic links and excluding the
outcome. Queue sorts by owner liveness, priority, status and key; unavailable
owners remain visible. Human/Agent assignment and thread ownership are
separate controls. The left Tasks pane manages project-wide search, creation,
status, priority, links, deletion, selection and ordering; responsibility
editing belongs in Work, with an escape hatch for unowned tasks on the left.

Completed includes done and canceled tasks, with distinct status presentation,
collapsed by default and at most five recent entries. Counts and the full
history destination remain available in the Tasks app. The patched indexed
`listTasksForThread` read supplies completed previews; do not replace it with
an unbounded task scan. Completion history is a bounded UI projection, not
permission to delete older Tasks records.

Task-bearing responses hydrate one project-scoped Query fact directory, capped
at 1,000 tasks, while lists/links retain references. Newer durable timestamps
win; equal revisions prefer Work bindings over sidebar lists over compact link
summaries. Client-local hydration revisions and optimistic assignee authority
prevent an in-flight read from undoing assignment. Facts require the expected
execution revision before projection. Keep these authorities out of Zustand.

## Hierarchy and grouping

**Move under…** and **To Top** share server-validated hierarchy rules. The
anchored searchable picker offers active, same-project, non-descendant valid
candidates, roots first, only while open. Reparent drag uses an explicit hit
target; ordinary whole-row dragging still reorders/moves groups and yields to
BB native open/split when it leaves the sidebar. Neither move changes the
selected thread or implicitly opens a split.

Reject self/descendant cycles, archived or cross-project moves, incomplete
rosters/ancestry, and any move that invalidates durable root bindings. There
is no silent binding migration or merging of managed outcomes. Revalidate
against fresh host state; client filtering is not authorization.

Nesting removes custom top-level group membership. To Top defaults to Active.
The server updates the host parent then preferences, attempting parent rollback
if preference persistence fails. Results identify old/new roots and affected
subtree IDs; invalidate Work, Tracker and Tasks for that scope. Thread records
remain BB-owned. Shared search, modifier selection, rename text selection,
shortcut attributes and BB-owned recursive archive/delete confirmation remain
required behavior on the enhanced list.

## Recycle Bin and archive

Recycle Bin is reversible plugin filing: record the previous group and entry
time, keep the thread live and its environment intact, and exclude it from
Active/custom groups and thread pickers. Restore returns to the recorded
group, falling back to Active if it vanished. Restore is an explicit action,
not a drag back into a custom group.

Host Archive is a separate recursive lifecycle action in the destructive menu;
binning must never call it. Optional retention requires an explicitly
configured BB automation invoking `expireRecycleBinThreads({ retentionDays })`.
The plugin starts no retention timer. Eligible expiry archives through BB,
removes accepted bin records and invalidates Threads.

Archived rows keep **Resume in new worktree**, including their ordinary click,
as an explicit compose flow for the original project. This does not restore
the original history or create a workspace itself. **Open original thread**
navigates to the original history without unarchiving or restoring anything.
**Unarchive** invokes the existing native core archive/unarchive action;
BB retains lifecycle ownership, disabled state and recursive confirmation.

After explicit native unarchive, an active row's context menu reads fresh
`threads.get` state including its environment. It offers **Restore workspace**
only for a settled, unarchived, undeleted thread with a destroyed environment
and host `canRestoreEnvironment: true`. The action rechecks eligibility before
calling `threads.restoreEnvironment`; BB revalidates atomically, owns provider
restoration/provisioning and starts no turn. Acceptance opens the original
thread and is not a claim that provisioning has finished. Already-ready state
opens the original thread without restoring again.

A known false eligibility for a settled destroyed workspace offers the
explicit **Resume in new worktree** alternative. Missing/failed eligibility is
unavailable, with a read retry on failure. Busy/provisioning states cannot
restore or offer replacement as an implicit recovery. Restore failures show
the error; they never automatically compose or create a replacement. Explicit
retry rereads host state, preventing a second restore after BB has accepted
provisioning. Pending actions are disabled; dismissed menu reads and late
replies after the owning row is removed cannot initiate a restore or navigate.
No provider implementation, deleted data recovery or new environment backend
belongs to this feature. BBPLUG-414 retains root-owned live acceptance.
