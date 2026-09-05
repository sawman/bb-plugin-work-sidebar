# Tasks: thread workflow

## Problem

The standard Tasks plugin had no bounded reverse lookup for the tasks attached
to one thread. Consumers had to list a project and probe every task's thread
links. Its CLI dispatch path also discarded the calling thread, producing a
top-level worker instead of a child of the thread that dispatched it.

## Patch

The patch adds the typed `listTasksForThread` RPC. It uses the indexed
`task_threads.thread_id` path, scopes results to one thread, defaults to live
tasks, supports an explicit status filter or completed inclusion, bounds the
result size, and returns only the matching task links.

`bb tasks dispatch` now passes the CLI context's `threadId` through the
existing delegation RPC to `threads.spawn`. A dispatch started from a thread
therefore preserves its parent relationship; non-CLI delegation is unchanged.

This adds the capability without changing Work Sidebar's project-wide Tasks
pane. A future, separately reviewed migration can use the indexed RPC wherever
the UI specifically needs a per-thread task list.

## Current deployment

- Target: `builtin:tasks` inside BB `0.42.0`, SDK `0.4.47`.
- Verified source baseline: `desktop-v0.42.0` at
  `960255b98ce3dccdcb5754eb67a7f989236602a1`.
- Source patch: [thread-workflow.patch](thread-workflow.patch).
- Coverage includes database filtering and link scoping, typed RPC validation
  and label hydration, direct delegation, and CLI parent forwarding.

## Update procedure

Run the cataloged sync job from the repository root. It applies this patch to
the immutable source tag, runs the Tasks suite serially (to avoid upstream
shared-browser-storage races), typechecks, builds, validates metadata, then
stages the artifacts. Review the stage before deployment:

```sh
npm run bb-plugins:sync
npm run bb-plugins:sync -- --deploy
```

Retire the patch once upstream exposes an equivalent indexed thread-task read
and CLI dispatch forwards its caller thread. Track that decision in
[`docs/bb-compatibility-watchlist.md`](../../docs/bb-compatibility-watchlist.md).
