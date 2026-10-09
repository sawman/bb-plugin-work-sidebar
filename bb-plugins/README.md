# Local BB plugin patches

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
Other historical deployments have local backups only; never use a different
BB version's rollback payload.

| Built-in plugin | Patch | Status |
| --- | --- | --- |
| `ask-user-question` | [ACP answer continuation](ask-user-question/README.md) | verified and deployed for BB 0.45.0 |
| `automations` | [Personal-project availability](automations/README.md) | verified and deployed for BB 0.45.0 |
| `tasks` | [Thread workflow](tasks/README.md) | verified and deployed for BB 0.45.0 |

Deployment on 2026-10-09 reran the exact-source preflight (43 Questions, 136
Automations, 412 Tasks tests, plus typechecks/builds). All installed artifacts
match the verified stage byte-for-byte. Backup packages above record the
version-matched pre-deployment artifacts and SHA-256 checksums.

Run `npm run bb-plugins:sync` for the non-mutating local CI pass. It stages
only verified artifacts. `npm run bb-plugins:sync -- --deploy` reruns that
preflight, creates a fresh local backup, deploys, and reloads the cataloged
built-ins. A catalog entry with core artifacts also stages and deploys those
files; restart BB before treating a core patch as active.

To preflight a downloaded desktop update before it becomes the running app,
set `BB_APP_ROOT` to that bundle's unpacked `bb-app` directory. The sync uses
the target bundle's own CLI for plugin artifact metadata, so the stage is
versioned for that update rather than whichever BB process is currently live.
