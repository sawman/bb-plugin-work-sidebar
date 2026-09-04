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
matching BB version.

| Built-in plugin | Patch | Status |
| --- | --- | --- |
| `ask-user-question` | [ACP answer continuation](ask-user-question/README.md) | deployed on BB 0.41.0 |
| `automations` | [Personal-project availability](automations/README.md) | deployed on BB 0.41.0 |

Run `npm run bb-plugins:sync` for the non-mutating local CI pass. It stages
only verified artifacts. `npm run bb-plugins:sync -- --deploy` reruns that
preflight, creates a fresh local backup, deploys, and reloads the cataloged
built-ins. A catalog entry with core artifacts also stages and deploys those
files; restart BB before treating a core patch as active.
