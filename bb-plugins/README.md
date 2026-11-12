# Local BB plugin patches

BB 0.49.0 / SDK 0.6.132 is installed with pristine Questions, Tasks and
Automations, byte-matched to the cached release ZIP. Questions ACP queue and
Tasks indexed thread read/parent forwarding remain required. Their old patches
fail against 0.49 source and now have explicit versioned candidates; Automations
remains retired. Worker audit is staging-only: root owns deployment and final
acceptance. No installed writes/reload/restart or UI changes occurred.

The [0.49 audit](../docs/compatibility/bb-0.49.0/README.md) records exact immutable
source, honest failures, behavior/artifact gates and provenance limits. Use its
[deployment-ready recipe](../docs/compatibility/bb-0.49.0/DEPLOYMENT-READY.md),
[accepted stage manifest](../docs/compatibility/bb-0.49.0/artifact-manifest.json)
and [pristine rollback](rollback/bb-0.49.0/README.md). The
[mandatory verifier](verify-artifacts.py) checks exact directories and every byte.
Questions writes/reload require the exact zero-pending/resolving-form disposal
gate; an artifact verifier does not inspect live forms. Historical sync silently
skips missing files; never use its unchecked `--deploy` copy path.

Historical 0.47.1 deployment remains in its
[deployment record](../docs/compatibility/bb-0.47.1/DEPLOYMENT.md), including live
ACP delivery and explicit UI limits; it is not current 0.49 acceptance. Historical
430 was superseded by 446, not retrospectively passed.

This directory is the versioned catalog for patches applied to BB's bundled
plugins. It is not a second plugin registry and it is not the work queue—BB
Tasks remains the source of truth for active implementation work.

Each patch directory contains its source-level patch, the exact built-in target,
the installed BB/SDK version, regression coverage, removal condition, and a
version-pinned rollback artifact. On a BB update, rebase or retire each patch
before relying on the new app.

`~/.bb/patch-backups/` is a convenient local backup made immediately before a
deployment. The canonical rollback payload and its checksums live here in Git,
so an emergency rollback is reproducible on another machine with the exact
matching BB version. Tracked rollback coverage is explicit: historical 0.41
payloads for Questions/Automations and [0.45 packages for all three plugins](rollback/bb-0.45.0/README.md).
Matching archives also cover [0.46.0](rollback/bb-0.46.0/README.md),
[0.46.1](rollback/bb-0.46.1/README.md) and
[0.47.1](rollback/bb-0.47.1/README.md) and
[0.49.0](rollback/bb-0.49.0/README.md). Other historical deployments have local
backups only; never use a different BB version's rollback payload.

Historical BB 0.46.1 deployment on 2026-10-20 is preserved in
[its deployment record](../docs/compatibility/bb-0.46.1/DEPLOYMENT.md) and
[worker audit](../docs/compatibility/bb-0.46.1/README.md), including its unverified
ACP Reply limit at that time. Its [rollback packages](rollback/bb-0.46.1/README.md)
remain version-specific; 0.47.1 acceptance does not rewrite that history.
`BB_PATCH_SOURCE_ROOT` selects an already-fetched local release checkout for
preflight; its HEAD must match the catalog's immutable source commit.

| Built-in plugin | Patch | Status |
| --- | --- | --- |
| `ask-user-question` | [ACP answer continuation](ask-user-question/README.md) | BB 0.49.0 candidate; source gates/stage evidence in audit, root acceptance pending |
| `automations` | [Personal-project availability](automations/README.md) | Retired; keep pristine built-in |
| `tasks` | [Thread workflow](tasks/README.md) | BB 0.49.0 candidate; indexed RPC/parenting retained, root acceptance pending |

Deployment on 2026-10-09 reran the exact-source preflight (43 Questions, 136
Automations, 412 Tasks tests, plus typechecks/builds). All installed artifacts
match the verified stage byte-for-byte. Backup packages above record the
version-matched pre-deployment artifacts and SHA-256 checksums.

Run `npm run bb-plugins:sync` for the non-mutating source/test/build pass.
Every cataloged Tasks patch now selects a [mandatory native behavior gate](tasks/README.md#mandatory-source-behavior-gate),
which must pass before any artifact staging/deployment. It supplements the
upstream suite and the separate exact-byte artifact verifier; historical
preflight counts above are not evidence that the new gate ran then.
For deployment or rollback, use the exact release's reviewed runbook and
mandatory verifier rather than sync's historical copy path. Never use a
rollback payload from a different BB version.

To preflight a downloaded desktop update before it becomes the running app,
set `BB_APP_ROOT` to that bundle's unpacked `bb-app` directory. The sync uses
the target bundle's own CLI for plugin artifact metadata, so the stage is
versioned for that update rather than whichever BB process is currently live.
