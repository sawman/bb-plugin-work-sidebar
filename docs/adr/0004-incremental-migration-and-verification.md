# ADR 0004: Migrate and verify one complete slice at a time

Status: Accepted
Date: 2026-08-27

## Context

The plugin was recovered from historical sessions and has accumulated many
interdependent UI fixes. A single all-at-once rewrite would be difficult to
review and would risk losing subtle behavior such as modifier selection,
native split dragging, cascading thread actions, review re-request signals,
and independent card loading.

The BB frontend test harness validates plugin behavior but does not reproduce
host CSS, panel layout, sticky positioning, or drag-to-split interaction.

## Decision

Migrate vertical slices in this order:

0. approved recovered baseline and behavioral characterization
1. SDK/dependency/type coverage, query/runtime foundations, and CSS diffability
2. pull requests and deliberate cross-surface presentation adoption
3. tasks
4. threads
5. work context
6. tracker
7. changes
8. agents
9. cross-slice server/contract composition and remaining legacy removal
10. integrated verification and clean independent read-only review

Each slice is migrated end-to-end, tested, visually exercised, and stripped of
its legacy code before the next slice begins.

Use three verification levels:

- pure unit tests for models, presentations, keys, stores, and parsers
- BB frontend/backend harness tests for slots, actions, RPC, storage, and
  invalidation
- live BB verification for CSS, dimensions, sticky headers, menus, modifier
  clicks, and drag/drop/open/split behavior

## Consequences

- The plugin stays usable during the refactor.
- Regressions have a narrow owning slice.
- Temporary adapters may exist at slice boundaries, but parallel styling and
  state systems do not remain after a slice is complete.
- The migration takes more review steps than a rewrite, but each step is
  evidence-backed.

Rollback is Git-backed, not aspirational. Before Stage 0 implementation, the
reviewed recovered tree and amended architecture package become a user-approved
baseline commit and checkpoint tag. Each completed stage is one reviewable
local commit/checkpoint. Rollback means reverting that stage, rebuilding, and
reloading the verified path registration. Once a later slice depends on a
foundation stage, revert the dependent stages first. No commit or tag is made
without explicit user authorization, and no worktree child starts before the
baseline checkpoint is approved.

## Guardrails

- Capture baseline states before the first structural edit.
- Immediately before the baseline commit, regenerate and hash the tracked patch
  and untracked archive, prove the reverse patch applies to the recovered tree,
  and prove the extracted archive matches every untracked path.
- Capture representative populated states on both surfaces and inventory every
  missing tab/theme/width/state cell. Each missing cell becomes a harness and
  live characterization gate before its owning slice goes green; do not mutate
  recovered or external data merely to manufacture G0 screenshots.
- Widen TypeScript coverage to nested source/tests and add a checked app/server
  import-boundary rule before using typecheck as acceptance evidence.
- Add the official frontend/backend harness peers in Stage 0: React DOM,
  Testing Library, jsdom, and better-sqlite3, version-compatible with the
  pinned plugin SDK.
- Do not mix unrelated slice migrations in one change.
- Cross-surface consumers of the same domain presentation are related for that
  slice; their state/data workflows remain out of scope.
- Verify loading, empty, error, populated, selected, expanded, and busy states.
- Run tests, typecheck, build, plugin reload, and `git diff --check` for every
  implementation stage.
- Review both sidebars whenever a shared status or primitive changes.
- Record the red failure, green focused check, full gate, and rollback
  checkpoint in the owning BB execution task before advancing.
