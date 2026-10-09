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

## BB 0.45.0 compatibility preflight

- Target: `builtin:tasks` in BB `0.45.0`, SDK `0.6.15`, from
  `desktop-v0.45.0` at `129f621771a3e275773992db648316966ac207cf`.
- The patch retains its behavior. Import/export hunk context was shortened around the upstream MoveTaskToProjectResult import and moveTaskToProject export additions. The shared patch also passes `git apply --check` on exact 0.44 source `0baa605b32a00619c1d7e3f32be6553ebcf8244a`.
- Non-deploy preflight on 2026-10-09 passed 412 serial plugin tests,
  typecheck, dependency and standalone builds, and target-CLI artifact metadata
  checks. All three plugin artifacts are staged at
  `/Users/matthewsaw/.bb/patch-staging/bb-0.45.0-2026-10-09T04-20-14-758Z`.
- This worker did not install, reload, or deploy. Previous deployment and
  rollback evidence below remains historical; these artifacts require root
  integration and deployment before being treated as active.

## BB 0.44.0 upgrade

- Target: `builtin:tasks` in BB `0.44.0`, SDK `0.5.29`, from
  `desktop-v0.44.0` at `0baa605b32a00619c1d7e3f32be6553ebcf8244a`.
- The indexed read and CLI caller-thread forwarding patch applies unchanged.
  Exact-version preflight and deployment each passed 394 plugin tests,
  typecheck, build, and artifact metadata checks. Deployed 2026-09-29 with
  rollback backup
  `~/.bb/patch-backups/bb-0.44.0-2026-09-29T03-04-21-503Z`.
- The installed server artifact matches the staged SHA-256.

## BB 0.43.4 upgrade

- Target: `builtin:tasks` in BB `0.43.4`, SDK `0.5.9`, from
  `desktop-v0.43.4` at `9b8c1d3457b00359af206e3fd423fe50520182c2`.
- The indexed thread read and CLI caller-thread forwarding still apply
  unchanged. Exact-version preflight and deployment passes each ran the Tasks
  suite, typecheck, build, and artifact metadata check.
- Deployed 2026-09-23 with the version-matched backup in the patch catalog.

## BB 0.43.3 upgrade

- Target: `builtin:tasks` inside BB `0.43.3`, SDK `0.4.104`.
- Verified source baseline: `desktop-v0.43.3` at
  `e865697f56bea89f3413dd4cc7fae964850d20a0`.
- Source patch: [thread-workflow.patch](thread-workflow.patch).
- Coverage includes database filtering and link scoping, typed RPC validation
  and label hydration, direct delegation, and CLI parent forwarding.
- BB 0.43.3 rewrote the CLI command surface; the patch was reimplemented as
  the same narrow RPC and parent-forwarding additions. Preflight passed 393
  serial tests, typecheck, both plugin builds, and target-CLI metadata checks.
- Deployed on 2026-09-21 with the version-matched rollback recorded in the
  patch catalog.

## BB 0.43.1 upgrade

- Upstream expanded project-list pagination but still exposes neither the
  indexed `listTasksForThread` RPC nor CLI caller-thread forwarding.
- The patch was rebased without changing its behavior. The preflight and
  deployment pass each passed 391 serial tests, typecheck, and build; installed
  artifacts match the staged SHA-256 hashes.

## BB 0.42.1 upgrade

- Verified source baseline: `desktop-v0.42.1` at
  `a4aa07f9ee3fdeb5716a26a368246ea1ef9e0b78`.
- BB 0.42.1 does not change the Tasks plugin or SDK 0.4.47. The patch still
  applies unchanged and remains necessary.
- The full 0.42.1 preflight and deployment pass each passed 368 plugin tests,
  typecheck, and build. The resulting BB 0.42.1 / SDK 0.4.47 artifacts were
  deployed with a version-matched local backup and exact checksum parity.

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
