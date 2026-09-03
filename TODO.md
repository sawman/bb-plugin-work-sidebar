# UPSTREAM BB COMPATIBILITY WATCHLIST

This is compatibility documentation only, not the repository work queue. BB Tasks remains the source of truth for repository work.

## Release-check procedure

When BB releases a new version, verify its Tasks plugin and SDK surface before
removing any item below. Re-run the linked searches against the current open
issues and pull requests, then confirm the shipped API through a typed plugin
test—not just a changelog entry.

Last checked: 2026-09-04 against BB Tasks 0.1.2 / SDK 0.4.34.

## Check later

- [ ] **Thread-filtered Tasks read (BBPLUG-252).** The sidebar currently has
  to read every active project task and call `listTaskThreads(taskId)` for each
  one. BB Tasks has an indexed `task_threads.thread_id` table, but its public
  API has no forward, thread-scoped read. Request an indexed endpoint such as
  `listTasksForThread({ threadId, statuses, includeCompleted, limit })` that
  returns task summaries and their linked threads in one operation. This is the
  prerequisite for a real long-task-list optimization; neither plugin-local
  caching nor a bulk reverse lookup fixes the initial scan. Open upstream
  searches found no matching issue or PR on 2026-09-03:
  [issues](https://github.com/search?q=repo%3Aget-bb%2Fbb+is%3Aopen+%22listTasksForThread%22&type=issues)
  and
  [pull requests](https://github.com/search?q=repo%3Aget-bb%2Fbb+is%3Aopen+%22listTasksForThread%22&type=pullrequests).
- [ ] **Parented builtin Tasks dispatch (BBPLUG-230).** Builtin
  `bb tasks dispatch` does not propagate the invoking thread ID as
  `parentThreadId`. Current workaround: use `bb thread spawn --parent-self
  --new-environment worktree`, then run `bb tasks attach <key>` from the
  spawned child. Remove this item when the Tasks delegate RPC and CLI forward
  `parentThreadId`. Related upstream issue:
  [#2836](https://github.com/get-bb/bb/issues/2836) covers spawn/handoff
  parenting, but it does not yet cover the Tasks dispatcher.
- [ ] **Durable per-thread composer draft.** The BB SDK/host does not provide
  durable composer-draft state for unselected thread rows, so the plugin cannot
  derive a draft indicator purely from host state across refresh. Current
  workaround in `features/threads/thread-attention.ts` uses `hasComposerDraft`
  when supplied, otherwise only legacy `draft`/`working-draft` row indicators;
  it never infers state from the mounted, selection-dependent composer. Remove
  this item when the SDK exposes durable per-thread draft metadata or an event.
  Related open issues [#1978](https://github.com/get-bb/bb/issues/1978) and
  [#2200](https://github.com/get-bb/bb/issues/2200) improve composer input and
  draft creation, respectively, but neither currently exposes row-level durable
  draft state to plugins.
- [ ] **Explicit external HTTP navigation.** Ordinary plugin `UrlLink`s honor
  BB's browser preference. The plugin currently uses the host's new-window
  route for its optional Cmd/Ctrl-click external-link preference. Revisit this
  when BB exposes an explicit external HTTP navigation API, so this bridge can
  be replaced with a documented destination.
