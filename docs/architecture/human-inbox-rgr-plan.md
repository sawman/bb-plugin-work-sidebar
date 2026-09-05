# Agent-to-human Inbox red-green-refactor plan

Status: Ready for execution  
Specification: [human-inbox-spec.md](human-inbox-spec.md)

BB Tasks is the executable queue. This document fixes slice boundaries,
acceptance evidence, and integration order; it is not a second task system.

## Delivery order

The loops are sequential because each later loop consumes the exact contract
from the preceding one. Every code-editing worker uses a BB-managed worktree
from the latest integrated `main`. The root inspects and integrates each clean
commit before dispatching the next worker.

1. BBPLUG-361 — specification and architecture checkpoint.
2. BBPLUG-362 — contracts, SQLite service, tools, guidance, realtime, archive
   cleanup, and server tests.
3. BBPLUG-363 — Query lifecycle, Work card, Markdown/Mermaid rendering, user
   mutations, search, and frontend tests.
4. BBPLUG-364 — integration gate, live matrix, independent review,
   remediation, reload, commit, and push.

## R37.1 — contract, storage, and lifecycle

### RED

Add slice-owned server tests that fail before implementation for:

- strict message/create/update/read schemas and JSON boundaries;
- create idempotency and stable `msg_` IDs;
- thread ownership and archived-thread rejection;
- revision compare-and-set conflict behavior;
- list/search pagination and literal wildcard handling;
- acknowledge/bookmark idempotency;
- all four 501st-message retention cases;
- exact-thread archive/delete purge and repeated/cascade events;
- one targeted realtime invalidation only after a changed write;
- no message body in logs or realtime payloads;
- service disposal and post-dispose event callbacks doing no work;
- app-bundle boundary rejection for database/server imports.

The first focused command and its expected failures are recorded on
BBPLUG-362 before implementation.

### GREEN

- Add Inbox schemas under `features/inbox/schemas.ts` and compose them into
  the server-only RPC contract.
- Append the Inbox table/index migration to `shared/server-storage.ts`.
- Build a service from injected database, clock, ID generator, and thread
  lookup dependencies.
- Register strict RPC handlers, three native agent tools, provider-neutral
  guidance, realtime publication, and archive/delete listeners.
- Add `inbox` to the validated work signal family.

### REFACTOR

- Keep SQL and retention policy in the Inbox slice; shared storage owns only
  migration ordering and handle creation.
- Make create/update/state transactions single-entry service methods and
  remove test-only mutation shortcuts.
- Keep `server.ts` registration-only and lifecycle-own all generation state.

### Gate

Run the focused server suite twice, server registration/contract/bundle tests,
full serial tests, typecheck, SDK check, production build, and diff check.
Commit one clean BBPLUG-362 change with RED/GREEN evidence.

## R37.2 — Query state and Inbox Work card

### RED

Add frontend tests that fail before implementation for:

- centralized, thread/search/cursor-scoped keys and finite GC;
- one observer only while Work is active and cleanup on tab/thread change;
- realtime invalidating the exact current thread;
- independent loading, empty, error/retry, populated, search, and mutation
  states without sibling-card resize or failure;
- Inbox/Saved disclosure counts and acknowledged-history search;
- acknowledge, bookmark, unbookmark, rollback, conflict
  recovery, and busy-state suppression;
- copyable full IDs and edit metadata;
- Markdown/emoji and Mermaid success/error/theme/unmount behavior;
- keyboard search, disclosure, actions, focus return, and zero axe violations;
- exact card placement after Status and before Work items.

### GREEN

- Add Inbox query keys and policy beside the existing query runtime.
- Implement read/mutation hooks with cancellation, snapshot, optimistic
  projections only where reversible, rollback, and final targeted
  invalidation.
- Compose `InboxCard` into Work and use existing SurfaceCard, disclosure,
  search, tooltip, confirmation, copy, and icon primitives.
- Render normal segments through host `Markdown`; dynamically load the narrow
  Mermaid adapter only for visible diagrams.
- Add plugin-local semantic CSS over host tokens for Inbox-only layout.

### REFACTOR

- Extract no generic row/card merely for similar markup. Promote a primitive
  only if the Inbox is its third real semantic consumer and migrate all
  consumers in the same diff.
- Keep records out of Zustand and component caches.
- Remove fallback/parallel render paths as soon as the registered card owns
  the feature.

### Gate

Run focused Query/component/accessibility tests twice, full serial tests twice,
typecheck, SDK check, build and bundle inspection, theme-control light/dark
matrix, minimum/wide panel checks, verified-source reload, and diff check.
Commit one clean BBPLUG-363 change with screenshots or computed-layout proof.

## R37.3 — independent closure and deployment

### Review

After R37.1 and R37.2 are integrated into canonical `main`, dispatch a fresh
read-only reviewer from another model family. The reviewer receives the spec,
plan, exact base/head commits, and must inspect:

- message privacy and thread authorization;
- SQLite migration/retention/transaction correctness;
- archive/delete races and lifecycle cleanup;
- tool ergonomics and instruction overuse risk;
- Query observer, realtime, optimistic mutation, and GC lifecycle;
- Markdown/Mermaid sanitization and bundle size;
- accessibility, narrow-width layout, both themes, and card composition;
- test quality, vacuous assertions, and app/server import boundaries.

Every valid finding becomes a reproducible RED in the owning slice, receives
the smallest fix, and is re-reviewed until clean.

### Final gate

1. Focused Inbox server and frontend suites twice.
2. Full serial suite twice with deterministic totals.
3. `npm run typecheck`.
4. `bb plugin types --check .`.
5. `npm run build` and browser/server bundle inspection.
6. `npm run theme-control -- matrix -- <Inbox verification command>`.
7. Verify `bb plugin source work-sidebar --json` resolves to this checkout.
8. `bb plugin reload work-sidebar`.
9. Live create/edit/realtime/search/ack/save/archive checks in narrow
   and wide panels.
10. `git diff --check` and clean tree.

Only after the clean independent review and final gate may BBPLUG-364 move
directly from in progress to done. Remote Git follows the repository identity
protocol: switch `gh` to `sawman`, verify, push, then restore `matthew-se` and
verify even after failure.

## Rollback

- The pre-R37 canonical commit is the rollback boundary.
- R37.1 can be reverted without deleting the SQLite table; the append-only
  migration remains harmless and preserves rollback safety.
- R37.2 can be reverted independently because it consumes only typed RPCs and
  adds no host-global UI registration.
- If Mermaid causes bundle or runtime regressions, retain Markdown and show
  Mermaid fences as code while the rendering adapter is disabled; message
  storage and actions must remain available.
- No rollback may retain two Inbox implementations or a stale agent tool.
