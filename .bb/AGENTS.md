# Work Sidebar agent guidance

This repository is a BB plugin with two coupled product surfaces: the enhanced
left sidebar and the Work/Changes/Agents panel on the right. Preserve behavior
across both surfaces when changing shared domain concepts.

## Read first

Before structural or state-management work, read:

- `docs/architecture/implementation-handoff.md`
- `docs/architecture/refactor-plan.md`
- `docs/adr/0001-vertical-slice-architecture.md`
- `docs/adr/0002-state-ownership.md`
- `docs/adr/0003-atomic-ui-and-styling.md`
- `docs/adr/0004-incremental-migration-and-verification.md`

Clarify an accepted ADR in place only when its decision is unchanged. When a
decision is reversed or materially narrowed, preserve the old body, mark its
status `Superseded by NNNN`, and add the new ADR. Add a new ADR for a new
cross-cutting architectural decision; do not rewrite history to make an old
decision appear different.

## Work tracking

- In BB, use the durable Work outcome and BB Tasks as the source of truth.
- Do not create repository TODO files as an alternative task system.
- Treat Human-assigned tasks as user-owned unless the user explicitly
  delegates them. Agent-assigned tasks are eligible for agent work.
- Keep execution work as direct children of the root outcome.

## Architecture boundaries

- Organize product code as vertical feature slices. A slice may own app code,
  server code, contracts, models, and tests.
- Put code in `shared/` only after at least two feature slices need the same
  semantic abstraction. Similar markup alone is not sufficient.
- Keep `app.tsx` and `server.ts` as registration/composition entries. Do not
  add feature logic to them.
- Frontend code should import server contracts as types. A runtime contract
  value may be imported only when the typed RPC API requires it and the
  schema module is explicitly browser-safe, Zod-only, and Node-free. Keep
  `defineRpcContract` composition server-only. Do not pull server
  implementations, the SDK root entry, or Node dependencies into the app
  bundle.
- Use BB's typed RPC transport. Do not add Axios or call GitHub, Linear, or
  other integrations directly from the frontend.
- Keep GitHub rate-limit handling and cross-window caches on the server.

## State ownership

- BB hooks own BB host state: active threads, projects, composer drafts, host
  navigation, declarative plugin settings, and native sidebar actions.
- TanStack Query owns asynchronous RPC/server state, request deduplication,
  polling, cache lifetime, mutation state, and invalidation.
- Zustand owns shared client interaction state only: selections, anchors,
  expansion, drag targets, and tab/view state that spans components.
- React state owns ephemeral control state such as text input, rename drafts,
  focus, and a component-local disclosure.
- Git, PR, task, tracker, and provider data must not be copied into Zustand.
  Only their presentation state may live there.
- Realtime messages are invalidation signals. Refetch durable state through
  the relevant query key; do not fan one signal into ad hoc refresh methods.
- BB `useSettings` owns settings declared through `bb.settings`. Plugin-only
  durable preferences such as saved groups and list mode remain server
  storage exposed through typed queries/mutations. Work/Changes/Agents is
  plugin-local tab state; BB continues to own panel and thread navigation.

## UI and styling

- Build primitives from BB-vendored shadcn components and host theme tokens.
  R3 must verify whether the plugin build compiles utility classes absent from
  host CSS; if it does not, use plain plugin CSS over host tokens and supersede
  ADR 0003 before feature migration. Host-shimmed singleton
  packages belong in exact/version-aligned `devDependencies`; ordinary state
  libraries that BB does not shim are bundled plugin runtime dependencies.
- Use the host `experimental_Diff` and `experimental_SourceCode` components
  instead of owning a second diff or syntax-highlighting system.
- Centralize presentations for PR state, checks, review, task state, runtime
  state, and provider health. Both sidebars must use the same mapping.
- A primitive owns its typography and spacing. Feature selectors may arrange
  primitives but must not restyle their descendants.
- Prefer semantic `data-state`, `data-tone`, and `data-selected` variants.
- Do not introduce hardcoded gray/color palettes, `all: unset`, or
  `!important`. If host integration truly requires an exception, document why
  at the declaration.
- Preserve accessibility: semantic elements, keyboard navigation, visible
  focus, accessible names for icon buttons, and native/modifier-click behavior.

## BB-specific behavior to preserve

- Use `experimental_useSidebarThreadActions` for opening, renaming,
  archiving, and recursive delete confirmation.
- Let BB own cascading archive/delete semantics for child threads.
- Preserve the native thread split gesture from
  `experimental_useSidebarThreadSplit`; custom reordering must yield when a
  drag leaves the sidebar.
- Thread-row anchors keep `data-sidebar-thread-shortcut-target` and
  `data-sidebar-thread-id` so BB keyboard shortcuts continue to work.
- Do not fetch per-thread PR metadata eagerly when the SDK provides the
  opt-in row hook.

## Change discipline

- The dirty tree inventoried in `docs/architecture/implementation-handoff.md`
  is recovered user work. Until a reviewed checkpoint exists, every tracked
  and untracked path in that inventory is protected; "unrelated" means any
  pre-checkpoint hunk outside the current loop's explicit ownership.
- Do not create code-editing worktree children until the user approves the
  reproducible baseline checkpoint. Managed worktrees branch from committed
  state and do not inherit this recovered snapshot.
- Migrate one vertical slice at a time and remove that slice's legacy code in
  the same change. Do not leave parallel old/new styling systems behind.
- Preserve unrelated dirty worktree changes.
- Keep query keys centralized and use targeted invalidation after mutations.
- Prefer pure model/presentation functions and test them without mounting BB.
- Avoid one-line JSX components and deeply nested conditional markup; extract
  named components with one responsibility.

## Verification

For implementation changes, run:

```sh
npm test
npm run typecheck
npm run build
bb plugin reload work-sidebar
git diff --check
```

`npm run build` deliberately runs `env -u BB_CLI bb plugin build .`: the
standalone artifact builder must resolve the ordinary PATH entrypoint rather
than re-exec through the CLI injected into the agent process. Reload is a
server operation and intentionally keeps the thread's BB connection. Before
reloading, verify `bb plugin source work-sidebar --json`; it must resolve to
`path:/Users/matthewsaw/dev/bb-plugin-work-sidebar`.

For frontend changes, also exercise every affected tab in its loading, empty,
error, populated, selected, expanded, and mutation-busy states. Verify both
light and dark themes, narrow widths, keyboard behavior, modifier clicks, and
drag/drop placement. BB's frontend test harness does not reproduce host CSS or
layout, so live visual verification remains required.
