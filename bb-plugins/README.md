# Local BB plugin patches

BB 0.46.0 deployment is recorded in
[`docs/compatibility/bb-0.46.0/DEPLOYMENT.md`](../docs/compatibility/bb-0.46.0/DEPLOYMENT.md).
Questions and Tasks were deployed from checksum-verified artifacts;
Automations now uses the native release implementation.

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

BB 0.46.0 / SDK 0.6.37 Questions and Tasks candidates are cataloged for
non-deploy verification in BBPLUG-418. Automations is retired for 0.46 by
root decision: native personal-project reads now work. The 0.45 deployment remains historical; no 0.46
candidate is active until root deploys it. Pristine 0.46 rollback packages are
tracked under [rollback/bb-0.46.0](rollback/bb-0.46.0/README.md).
`BB_PATCH_SOURCE_ROOT` selects an already-fetched local release checkout for
preflight; its HEAD must still match the catalog's immutable source commit.

| Built-in plugin | Patch | Status |
| --- | --- | --- |
| `ask-user-question` | [ACP answer continuation](ask-user-question/README.md) | BB 0.46 candidate verified/staged; 0.45 deployment historical |
| `automations` | [Personal-project availability](automations/README.md) | Retired for BB 0.46; keep pristine built-in |
| `tasks` | [Thread workflow](tasks/README.md) | BB 0.46 candidate verified/staged; 0.45 deployment historical |

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
