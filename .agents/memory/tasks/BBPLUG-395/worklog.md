# BBPLUG-395 — BB 0.43.1 compatibility audit

## Host and SDK

- Audited BB `0.43.1` from immutable tag `desktop-v0.43.1` at
  `267938526dfcbc0edb228ce827b5bec202c1af97`.
- Updated Work Sidebar's exact Plugin SDK pin from `0.4.47` to `0.4.87`.
- Adapted test fixtures for the required nullable environment `providerId`,
  nullable `workspaceDisplayKind`, and required agent `pluginMetadata` fields.

## Built-in patch disposition

All three patches remain necessary and were rebased against the exact release:

- AskUserQuestion: ACP non-blocking continuation is still absent upstream.
- Automations: creation still rejects the personal project without the fallback.
- Tasks: indexed thread-filtered reads and caller-thread dispatch parenting are
  still absent upstream.

The catalog entry in `bb-plugins/registry.json` records the exact release and
core artifacts. `npm run bb-plugins:sync` passed before deployment. The deploy
pass then passed:

- AskUserQuestion: 87 plugin tests and 108 affected core tests.
- Automations: 81 tests.
- Tasks: 391 serial tests.
- Plugin/core typechecks and builds for every affected package.

Staged artifacts:
`/Users/matthewsaw/.bb/patch-staging/bb-0.43.1-2026-09-14T03-55-42-754Z`

Version-matched backup:
`/Users/matthewsaw/.bb/patch-backups/bb-0.43.1-2026-09-14T03-57-40-837Z`

The three built-ins were reloaded and only BB's server child was restarted to
activate the core AskUserQuestion route artifact. Installed artifact hashes
match the staged hashes. The running plugins report SDK `0.4.87` and zero
activation errors.

## Watchlist

None of the six compatibility items was fulfilled. Issues #1978, #2200, and
#2836 remain open. Repository searches found no issue or pull request for
`listTasksForThread` or the ACP continuation. The SDK still excludes durable
per-thread draft state from array-wide sidebar rows and exposes no explicit
inverse browser-open intent.

## Final verification

- Full serial suite: 108 files / 767 tests passed.
- Focused compatibility suite: 6 files / 72 tests passed.
- `npm run typecheck`: passed.
- `bb plugin types --check .`: pin and host both `0.4.87`.
- `npm run build`: passed; only the known Node `DEP0205` warning.
- `git diff --check`: passed.
- Work Sidebar source resolved exactly to this checkout before reload.
- Work Sidebar reloaded running with SDK `0.4.87`, compatible app bundle, and
  zero handler errors.

Commit and push evidence are recorded on the BB Task after publication.
