# BBPLUG-362 worklog

## Base and scope

- Base verified: `main@3d57759` (clean managed worktree).
- R37.1 only: schemas, SQLite service, RPC/tools/guidance, realtime, archive/delete lifecycle cleanup, and server/architecture tests. Work card and Mermaid rendering are excluded.

## RED

- Added `features/inbox/tests/server.test.ts` before the service exists.
- First focused command, 2026-09-06: `npm test -- --no-file-parallelism features/inbox/tests/server.test.ts`.
- Result: expected environment failure before test discovery: `sh: vitest: command not found` (this worktree has no installed dependencies). Dependency installation is required to capture the intended missing-module RED failure.

## GREEN and verification

- Implemented `features/inbox` as the R37.1 server-only slice: browser-safe Zod schemas; append-only SQLite migration; strict list/ack/bookmark RPCs; agent create/read/update tools and concise guidance; thread-scoped retention, revisions, idempotency, literal search/pagination, realtime, and lifecycle purge/disposal.
- The subsequent correction removes individual-message deletion completely. Physical deletion is only retention and exact-thread archive/delete lifecycle cleanup.
- Provider ID and agent label are derived from `threads.get`, not agent tool input. Service checks the 32 KiB body cap in UTF-8 bytes for both create and update; output-bound pagination returns a cursor for unread rows.
- Focused command (run twice): `npm test -- --no-file-parallelism features/inbox/tests/server.test.ts features/inbox/tests/registration.test.ts tests/server/registration.test.ts features/tasks/tests/tools.test.ts tests/architecture/import-boundaries.test.ts tests/architecture/bundle.test.ts` — 6 files, 32 tests passed each run.
- Full serial suite (run twice): `npm test -- --no-file-parallelism` — 103 files, 673 tests passed (60.54s; 59.26s).
- `npm run typecheck` passed; `bb plugin types --check .` passed (SDK/host 0.4.47); `npm run build` passed (only Node DEP0205 deprecation warning); production bundle test passed; `git diff --check` passed.
- No reload or push was run, by request.
- Final correction: `leave_human_message` persists `threads.get().projectId` rather than the potentially stale agent-context project. Focused suite passed twice again (32 tests each); final serial suite passed twice again (103 files, 673 tests; 58.74s and 58.78s).
- Follow-up amendment: startup reconciliation now receives a lifecycle-active gate; late `threads.get()` settlement after disposal does not touch SQLite or log, and reconciliation catches detached failures. A deferred fake-host regression covers it. Acknowledge obtains its timestamp once, and the Inbox guidance is present only in global agent configuration (all three tools remain selected). Focused suite passed twice (6 files, 33 tests); final serial suite passed twice (103 files, 674 tests; 59.12s and 58.78s).
- Narrow follow-up: RED proved 51 newer acknowledged/unbookmarked records could hide older active/saved records in the default 50-message page. GREEN makes absent/blank query pages select only unacknowledged or bookmarked records; nonblank query continues to search all retained history. Focused `features/inbox/tests/server.test.ts` passed twice (8 tests); typecheck and `git diff --check` passed. Full suite was not rerun because this is isolated server-list projection behavior, per direction.
