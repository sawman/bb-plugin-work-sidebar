# ADR 0001: Organize the plugin as vertical feature slices

Status: Accepted
Date: 2026-08-27

## Context

The recovered plugin is organized primarily by technical layer. The large
`app.tsx`, `server.ts`, and `contracts.ts` files each coordinate several
unrelated domains. UI extraction alone would leave feature behavior spread
across frontend components, server helpers, schemas, and shared CSS.

The two sidebars also reuse domain semantics without always reusing the same
presentation or behavior. PR review state is a representative example.

## Decision

Organize product code by vertical feature slice:

- threads
- tasks
- pull requests
- work context
- changes
- agents
- tracker

A slice may own app components/hooks, server adapters/services, contracts,
pure models, query definitions, mutation definitions, and tests.

Keep a small `shared/` area for infrastructure and semantic primitives used by
multiple slices. Do not move code into `shared/` based only on similar markup.

Keep `app.tsx`, `server.ts`, and `contracts.ts` as composition boundaries.

The boundaries that overlap in the UI are semantic, not file-shaped:

- `threads` owns the left host-thread hierarchy, grouping, selection, and
  native thread actions;
- `agents` owns the right-panel projection and navigation of child execution
  threads, while reusing shared runtime presentation;
- `tracker` owns the optional Taskboard/Linear adapter, contract, query, and
  card; Work context only decides where that card is composed.

Each slice moves its server adapter and RPC handlers when it migrates. The
final server stage extracts only services that already have at least two slice
consumers and reduces the entrypoint to registration.

## Consequences

- A change to one product concept can usually be understood within one
  directory.
- Contracts and tests remain close to the behavior they protect.
- Cross-surface semantic reuse is explicit.
- Some slices contain both frontend and backend directories; bundling
  boundaries must be maintained carefully.
- Shared primitives require discipline to avoid becoming a second horizontal
  feature layer.

## Guardrails

- Frontend modules import backend contracts as types only.
- A runtime contract value is allowed only when the SDK requires it and the
  schema module is browser-safe, imports only browser-safe dependencies such as
  Zod, and is Node-free. `defineRpcContract` composition belongs to a
  server-only module that the app never imports.
- Server/Node dependencies never enter app runtime imports.
- Stage 0 adds a checked app/server import-boundary rule covering every nested
  source file; passing root-only TypeScript compilation is not sufficient.
- New shared abstractions require at least two semantic consumers.
- A cross-surface domain slice may update thin presentation consumers in
  another surface (for example PR state in Threads and Changes) without taking
  ownership of that surface's state or data workflow.
- A migrated slice removes its legacy implementation in the same change.
