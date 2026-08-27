# ADR 0002: Assign state according to its semantics

Status: Accepted
Date: 2026-08-27

## Context

The current frontend manages remote records, caches, request races, polling,
mutation progress, selection, expansion, drag state, and input state with
component state and module-level maps. This makes thread switches expensive,
causes broad refreshes, and couples unrelated cards.

Using one general-purpose global store for all of this would centralize the
complexity without correcting the ownership model.

## Decision

Use four state owners:

1. BB SDK hooks own host state supplied reactively by BB.
2. TanStack Query owns RPC/server state, caching, polling, retries, mutations,
   and invalidation.
3. Zustand owns shared client interaction state that spans components or must
   survive component remounts.
4. React state owns ephemeral state local to one control or component.

Git, PR, task, tracker, and provider records are TanStack Query data, not
Zustand data. Zustand may store their selected IDs or expansion state.

Use BB's typed RPC client as the query transport. Do not introduce Axios.

Realtime messages signal invalidation; durable state is reread through query
keys. The server retains API-budget caches shared by all clients.

Each realtime payload carries a validated domain-family discriminator and an
optional entity/thread scope. One payload maps to one query-key family; an
unscoped legacy signal may not be used to recreate the current refresh fan-out.

BB externalizes React, React DOM, and the plugin SDK app runtime. TanStack
Query and Zustand are not host shims and are bundled as plugin runtime
dependencies; both must resolve React through the host external rather than
shipping a second React copy. Zod is bundled only in server/browser-safe
contract modules that need runtime validation. A module-level QueryClient is
one singleton per frontend bundle generation and app window, so independently
mounted left and right slots in that window share it; windows do not share
client caches. Server API-budget caches remain cross-window.

Ownership details:

- `useSettings` owns BB-declared GitHub polling settings.
- Typed queries/mutations own plugin-server preferences such as saved thread
  groups, sibling order, and enhanced/native list mode.
- BB owns panel/thread navigation. Zustand may own the plugin's
  Work/Changes/Agents tab and presentation-only selection/expansion state.
- Zustand uses no persistence middleware. Per-thread presentation state that
  must outlive the active left roster—such as a Work/Changes/Agents tab for an
  archived thread that remains open in the right panel—is retained by the
  40-entry least-recently-used cap and is not roster-pruned. Other
  roster-scoped interaction state may be pruned when a thread leaves the
  active host roster.

Query policies are declared by key, not inherited accidentally from library
defaults. GitHub queries do not retry client-side after server-classified
rate-limit/unavailable results. A realtime-backed key does not also poll unless
the external producer has no realtime signal. Optimistic ordering cancels its
key, defers matching realtime invalidation while the mutation is in flight,
and performs one targeted invalidation after settle.

## Consequences

- Thread switching can display cached data while independently refetching.
- Cards can show separate loading and error states.
- Mutation invalidation becomes explicit and testable.
- Zustand stores stay small and selector-oriented.
- Query defaults must be configured intentionally to avoid excessive retries
  or polling.
- The app needs one stable QueryClient shared by its independently mounted
  plugin slots.
- Frontend reload replaces the slot generation and unmounts its observers;
  no detached timers or subscriptions may outlive that generation. Server
  cache/service instances are created inside the plugin factory and cleared
  through `bb.onDispose`, so an SDK handle or pending timer cannot survive a
  reload.

## Guardrails

- No component-owned RPC cache or request sequence counter.
- No remote domain entity copied into Zustand.
- Query keys live in centralized feature factories.
- Every query key has tested stale/gc/retry/focus/poll/invalidation policy.
- Polling settings map to query policies rather than independent intervals.
- Persist only genuine preferences; never persist drag, hover, or mutation
  state.
- Do not use Zustand `persist`; prune roster-scoped interaction entries and
  enforce the bounded LRU for per-thread presentation state retained beyond the
  active roster.
