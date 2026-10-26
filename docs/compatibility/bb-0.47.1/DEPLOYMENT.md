# BB 0.47.1 deployment and bounded acceptance

Root deployed on 2026-10-26. Final combined source:
`0bf1d2e399ec41adb9b9555d536be11aa5d910de`, containing the reviewed built-in
audit/verifier through `00ee5864`, Sidebar author `02fd8a6` integrated as
`7a0d479`, and Zod author `6f5081d` integrated as `0bf1d2e`. Independent
BBPLUG-445 reviews were clean. This record reports root's handed-off evidence;
the documentation worker performed no new build, reload, or deployment.

The [worker audit](README.md) preserves source provenance and preflight history.
Use its existing [accepted artifact manifest](artifact-manifest.json) for all
file sizes, SHA-256 and installed targets, the
[pristine rollback manifest](../../../bb-plugins/rollback/bb-0.47.1/manifest.json)
for the 21-file baseline, and [SDK migration note](SIDEBAR-SDK.md) for API and
dependency details. Raw evidence remains in task attachments, without duplicate
deployment manifests or logs here.

## Validation and installed state

Root ran one final combined serial suite on `0bf1d2e`:
`npm test -- --no-file-parallelism`, exit 0, **121 files / 929 tests**,
101.15 seconds Vitest time. Wrapper interval:
`2026-10-26T05:08:33.454Z`–`05:10:16.594Z`. BBPLUG-444 attachments:
log `01M5V9W58VRJJ8S832DQ4AKVHF`; source/exits
`01M5V9W5H6PXRX65RXHKCMXXSS`.

Fresh `npm ci`, native SQLite in-memory select smoke, typecheck, exact SDK/host
0.6.79 check, production build and base diff check passed. Build emitted only
the existing Node DEP0205 warning. Production dependency audit is zero after
the narrow bundled Zod 4.6.6 patch; six development findings remain
(three moderate, three high), without broad dependency upgrades. Eighteen
host singletons resolve to exact host versions; SDK peer specifications and
React/DOM 19.2.4 alignment are documented in the SDK note.

Questions and Tasks were copied from the accepted stage after root passed all
seven verifier tests and read-only stage/pristine checks. Backup:
`/Users/matthewsaw/.bb/patch-backups/bb-0.47.1-reviewed-443-20261026`.
The complete baseline was verified before writes; postcopy, postreload and final
05:10 installed readback passed exact directory membership and all baseline
bytes with the twelve accepted overrides. Automations remains pristine. There
is no core patch or core restart. The accepted stage/manifests are unchanged.

Before writes at `04:52:15.663Z` and before reload at `04:52:32.802Z`, root
read public interaction metadata for a stable **103 unarchived threads across
all projects, including hidden threads**. Both scans found zero Questions
`pending`/`resolving` forms. These were complete reads, not a pending-flag
shortcut; no forms were cancelled to manufacture zero. The gate is non-atomic;
future deployments still require the [disposal safety gate](README.md#root-reproduction-and-deployment-boundary).

| Runtime | Reported generation prefix | State |
| --- | --- | --- |
| Work Sidebar | `a6aa18214e33358a` (486,074 JS bytes) | SDK 0.6.79, compatible, running, statusDetail null |
| Questions | `457fd90398ce9fe6` (224,852 bytes) | SDK 0.6.79, running, statusDetail null |
| Tasks | `630e5bdc4e7e380b` (1,045,981 bytes) | SDK 0.6.79, running; historical list-cursor invalidation detail remains |
| Native GitHub PR Status | `04ec4c1095bbde5a` | SDK 0.6.79, running, statusDetail null |

These generation prefixes are runtime identifiers, not substitutes for the
full SHA-256 artifact manifest. Sidebar source resolution was verified as
`/Users/matthewsaw/dev/bb-plugin-work-sidebar` with the new engine floors.
The native Tasks indexed read with statuses `done`/`canceled`,
`includeCompleted: true`, `limit: 5` returned five real scoped records; the
historical cursor detail did not produce a failure in that read.

## Live acceptance and limits

**ACP delivery passed in BBPLUG-446**; report attachment
`01M5V9HEV6QY0DKRS1GMQTB3S4`. Two real registered ACP Cursor question calls
accumulated at version 2 in one provider session
`1e305ddd-c688-43d5-907c-0c3e80b61efc`. Answer A left B pending
(remaining 1/version 3), followed by ACK_A. Answer B emptied the queue
(remaining 0/version 4), followed by ACK_B/DONE. Exactly two agent-only
answers were delivered. Only after both deliveries, root used the documented
public display-only cancel route as the frontend does; interactions were empty.
The disposable worker was archived/detached and 446 completed.

The advertised model `default` was rejected before tools; explicit current
catalog model `grok-4.6` succeeded. No credentials or provider configuration
changed. An initial retry read context/files/CLI beyond the intended scope,
with zero fileChanges; constraints were restated before the question-only run.
Pointer/keyboard submission of the rendered form was **not** exercised.
Historical 430 was cancelled as superseded, not retrospectively passed on 0.46.

Sidebar acceptance used the running renderer without foregrounding BB or opening
Settings. CuaDriver reported permission granted but `desktop_unlocked: false`;
its session was closed. The theme-control matrix applied light/dark, restored
the exact original `bb.theme: "system"`, and closed its temporary inspector.
Root captured and viewed Work (all seven cards, loading then populated
Queue/Needs You/Completed five), Changes (clean main/no linked PR), and Agents
(populated workers) in both themes at 835 CSS pixels. No overflow, alerts or
removed-API error were observed. Background semantic DOM activations cycled the
tabs with correct selection, then restored Work and the original route; these
were not pointer/keyboard tests. A scratch selector quoting error was corrected
without product changes or another suite run.

Native `pullRequests` for `env_kx2zih2swg` returned absent; Sidebar PR projection
returned no PR/stack, and repository projection returned available/main/zero
files. Repository availability remained usable independently of PR absence.
Unverified cells remain: populated remote PRs and GitHub mutations, disabled
plugin live behavior, cross-window watches, narrow width, keyboard/modifiers,
drag-to-split and thread switching. This is bounded acceptance, not a blanket
live certification. Mermaid 433, restore 414 and mandatory Tasks pipeline 434
remain separate; five watchlist gaps are still absent in native BB.

## Future reproduction

Current installed Questions/Tasks are patched. The audit's `--deploy` procedure
is **pristine-installation-only** and intentionally fails closed if repeated
against this installation. For present read-only verification use:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 bb-plugins/verify-artifacts.py docs/compatibility/bb-0.47.1/artifact-manifest.json --verify-installed
```

For a future restore/redeployment, follow the matching rollback/runbook and
reviewed baseline; do not bypass pristine checks. Source and workers remain
retained through root final acceptance. Root owns push, task status and archives.
