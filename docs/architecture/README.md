# Work Sidebar architecture

This is the current architecture reference for the enhanced left sidebar and
the right Work/Changes/Agents panel. The structural migration is complete;
feature limitations and outstanding acceptance work still exist. BB Tasks owns
work status and validation evidence. These contracts describe boundaries and
required behavior, not a blanket certification of every UI state.

## Code boundaries

`app.tsx`, `server.ts`, and `contracts.ts` compose registrations and feature
exports. Product logic belongs in `features/`: Threads, Tasks, Pull Requests,
Work context, Changes, Agents, Tracker, and Inbox. A slice owns its views,
models, browser-safe schemas, server adapters, queries, mutations, and tests.
Shared infrastructure lives in `shared/`, `components/ui/`, and the central
query runtime. Share a semantic abstraction only after two slices need it;
similar markup alone is insufficient.

Use BB's typed RPC transport. Browser code imports server contracts as types;
runtime schemas must be explicitly browser-safe and Node-free. RPC contract
composition and server implementations stay out of the app bundle. Optional
Taskboard/Linear calls and GitHub CLI calls stay behind server adapters.

The [ADR index](../adr/README.md) preserves decision history. ADR 0005
supersedes 0003's styling direction. Recovery and migration checkpoints in ADR
0004 describe the completed migration; current changes use the discipline in
[agent guidance](../../.bb/AGENTS.md), without reopening a baseline approval
gate or appending loops to a migration plan.

## State and lifetime

| Data | Authority |
| --- | --- |
| Threads, projects, drafts, navigation, native actions, declared BB settings | BB SDK hooks and APIs |
| RPC results, async mutations, deduplication, polling, invalidation | TanStack Query |
| Shared selection, expansion, drag targets, plugin tabs | Zustand, presentation only |
| Text drafts, focus, local disclosure state | React |
| Durable Work bindings, goal references, plugin preferences, Inbox | Server-owned storage and typed adapters |

[query-runtime.tsx](../../query-runtime.tsx) owns key factories and explicit
stale/GC/retry/focus policies. There is one QueryClient per frontend bundle
generation and app window, shared across both slots; windows share server
API-budget caches, not client caches. Do not mirror domain records in Zustand
or component caches. Zustand has no persistence middleware; roster-scoped
state is pruned, while retained per-thread presentation uses a 40-entry LRU.

Realtime messages validate a family and scope, then invalidate the relevant
query family. They never carry replacement records. Poll only where the
producer lacks the necessary realtime signal; stop inactive observers and
timers while retaining deliberate warm caches. Reversible optimistic mutations
cancel/snapshot/update, roll back on failure, defer racing invalidation, and
perform targeted invalidation on settlement.

Server services belong to the plugin factory. Disposal clears caches, pending
references, subscriptions and timers; invalidated late reads cannot republish.
SQLite migrations are append-only and domain SQL belongs to its owning slice.
Keep rollback compatible with existing stored data.

## UI and host integration

Plugin-local atomic CSS derives from host theme tokens. Primitives own their
typography, internal spacing, focus and semantic variants; features arrange
them. Six text roles (primary, title, subtext, metadata, label, code) share one
bounded text scale. Shared search/combobox controls own keyboard movement,
portals, dismissal, focus return and loading/error states. Do not create a
parallel card, search, status, syntax-highlighting or diff system.

Host Diff, SourceCode, Markdown, links and navigation remain behind narrow
adapters where needed. Preserve keyboard/modifier behavior, accessible control
names, visible focus and terse tooltips. Shared domain presentations serve
both sidebars. React, React DOM, the SDK app runtime and host-shimmed singleton
packages remain external; exact host-compatible tooling belongs in
`devDependencies`. Query, Zustand and Zod are bundled runtime dependencies.

## Current feature contracts

- [Work, Tasks and thread hierarchy](work-management.md): ownership, Goals,
  Queue, task history, hierarchy safety and Recycle Bin versus host archive.
- [Inbox](inbox.md): one-way messages, retention, editing and rendering limits.
- [Changes and PR data](changes-and-prs.md): cache authorities, local/remote
  separation, refresh and unresolved status correctness findings.
- [PR status matrix](pull-request-status-matrix.md): intended common precedence.

Work cards load independently. Goal and Plan reflect thread timeline content;
Background projects BB-reported commands/workflows rather than OS processes.
The Work timeline snapshot service coalesces compatible reads while retaining
separate full and summary-only snapshots. Agents projects unarchived children
with shared runtime presentation and open/split navigation that preserves the
current panel. These remain distinct feature responsibilities.

### Thread storage

The Work tab ends with a read-only Thread storage card. It starts collapsed;
opening it mounts a thread-scoped Query over `threads.storagePaths`. The
projection contains at most 200 safe relative file/directory entries, ordered
directories first, with local folder disclosures and an explicit truncated
notice. It does not fetch file bodies or expose absolute host paths. Files
open through BB FileLink with an explicit thread-storage target.

Collapse or leaving Work removes the content observer. Reopen and manual
refresh are the refresh paths; there is no plugin storage realtime hook or
directory-scoped browsing API. Host listing caching may return data up to 30
seconds old. Explicit refresh cancels an initial pending read before targeted
invalidation; client GC is two minutes. There are no upload/edit/delete
controls. BBPLUG-438 records automated and limited live acceptance, including
the unverified live keyboard/modifier/context-menu and empty/error states.

## Compatibility and verification

The package declares minimum BB 0.46.0 and SDK 0.6.37; the exact development
SDK pin is a separate compatibility fact. Use the
[compatibility watchlist](../bb-compatibility-watchlist.md),
[patch catalog](../../bb-plugins/README.md) and versioned deployment evidence
for upgrades. Preserve their source/artifact manifests and rollback runbooks.
BBPLUG-430 retains actual ACP Reply acceptance work; BBPLUG-434 tracks making
the Tasks patch behavior gate mandatory. Settled architecture does not close
these checks or authorize unrelated implementation.
