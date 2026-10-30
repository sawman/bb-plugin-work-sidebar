# BB 0.47.1 compatibility audit

Root subsequently deployed. The [deployment and bounded acceptance record](DEPLOYMENT.md)
supplements this preserved worker preflight/source evidence.

2026-10-26, BBPLUG-443. Clean managed worker base:
`c7dce156f30c4ac84472e6b52b102a3e5469f8c6`. Exact `desktop-v0.47.1`:
`5e1acd765039e874643f34c4d35409e58484e408`, parent
`b17bfc8fddaa99140e00317b2dd36fdc0e833d05`. Pristine source is retained at
`/tmp/bb-0471-443-source` through root acceptance. Source and independently
installed SDK declarations both identify 0.6.79. This worker has not deployed,
reloaded, installed, pushed, or run the Sidebar full suite.

[Source manifest](source-manifest.json) records immutable links, file hashes,
live SDK declaration hashes and refreshed primary issue/PR searches.
[Artifact manifest](artifact-manifest.json) records every accepted staged
file's size, SHA-256, target and version. [Validation manifest](validation-manifest.json)
records commands, numeric exits/counts, raw-log hashes and task attachments.
Complete logs and source deltas are compressed task evidence, not repository logs.

| Capability | Exact shipped boundary and disposition |
| --- | --- |
| ACP question queue | Retain plugin-only implementation in `acp-continuation-v0.47.patch`. [Shipped server](https://github.com/get-bb/bb/blob/5e1acd765039e874643f34c4d35409e58484e408/plugins/ask-user-question/src/server.ts) still awaits one ordinary requestInput and returns a combined result. [ACP declaration](https://github.com/get-bb/bb/blob/5e1acd765039e874643f34c4d35409e58484e408/plugins/provider-acp/src/declaration.ts) disables native questions; custom IDs retain `acp-`. ACP-next is retired into ACP, not an alternative queue implementation. |
| Indexed thread-task read | Retain unchanged Tasks patch. [Contract](https://github.com/get-bb/bb/blob/5e1acd765039e874643f34c4d35409e58484e408/plugins/tasks/shared/contract.ts) has no native reverse thread-scoped RPC. The DB index alone does not satisfy the consumer. Coordinate any future migration of Sidebar's five-completed-task preview with its owner before retiring the RPC. |
| Tasks CLI parenting | Retain unchanged patch. [CLI](https://github.com/get-bb/bb/blob/5e1acd765039e874643f34c4d35409e58484e408/plugins/tasks/cli/index.ts) dispatch still omits the caller; [delegate](https://github.com/get-bb/bb/blob/5e1acd765039e874643f34c4d35409e58484e408/plugins/tasks/delegate/index.ts) spawn has no parentThreadId. Parent execution defaults do not repair missing parenting. |
| Inverse HTTP navigation | Still absent. [SDK](https://github.com/get-bb/bb/blob/5e1acd765039e874643f34c4d35409e58484e408/packages/plugin-sdk/src/app-contract.ts) has `openUrl(url)` and anchor props, with no explicit in-app HTTP intent/effective preference getter. New pane/tab navigation is not that HTTP contract. |
| Browser-capable left URL host | Still absent. [App](https://github.com/get-bb/bb/blob/5e1acd765039e874643f34c4d35409e58484e408/apps/app/src/App.tsx) retains AppNavigationUrlHost; [routing](https://github.com/get-bb/bb/blob/5e1acd765039e874643f34c4d35409e58484e408/apps/app/src/lib/url-open-routing.tsx) defaults its browser context to null. [Right panel](https://github.com/get-bb/bb/blob/5e1acd765039e874643f34c4d35409e58484e408/apps/app/src/components/plugin/PluginPanelRightPanelHost.tsx) supplies openBrowser. |

Automations remains retired and pristine. Exact service accepts personal
projects; GET uses requirePublicProject, which excludes deleted records without
a standard-kind restriction. Read-only live `proj_personal` succeeds with
`kind: personal`. No automation was created. Matching rollback archives for all
three plugins are [tracked here](../../../bb-plugins/rollback/bb-0.47.1/README.md).

All five gap searches were refreshed separately for issues and PRs; exact
`listTasksForThread` searches returned zero. Broad ACP hits concern telemetry,
Other-field translation, Pi cards, and answer persistence; none ships an
equivalent queue. [#1978](https://github.com/get-bb/bb/issues/1978) remains closed;
[#2200](https://github.com/get-bb/bb/issues/2200) and
[#2836](https://github.com/get-bb/bb/issues/2836) remain open. Primary responses
and exact query counts are retained; absence is established by shipped source,
not inferred solely from search results.

The initial read-only clone began before switching to sawman (process deviation,
reported immediately to root). Exact tag fetch and every later GitHub window
switched/verified sawman before remote operations and trapped restoration to
matthew-se, verified even on exit. No remote writes occurred.

## Parent defaults and PR API

The current guide's live-parent wording now matches
[project-execution-defaults.ts](https://github.com/get-bb/bb/blob/5e1acd765039e874643f34c4d35409e58484e408/apps/server/src/services/threads/project-execution-defaults.ts#L108):
explicit inputs precede available parent provider/model/reasoning, then project
defaults. This implementation is added since 0.46.1; the guide wording already
existed then, so the earlier implementation audit is not overturned by prose.
The shipped parent-create suite exercises overrides, provider mismatch,
disabled/unavailable providers and absent parent execution.

Service tier is distinct: the parent merge copies model/reasoning only. Tier
comes from remembered project defaults or product default, with explicit
requests and the fast-tier setting applied by thread-execution-plan. Parent
speed is not automatically inherited. Permissions follow their separate
parent-execution rule and provider/host limits. These are source/test findings,
not a live speed certification.

Environment PR status moved to the bundled `bb--github-pr-status` plugin's
[keyed contract](https://github.com/get-bb/bb/blob/5e1acd765039e874643f34c4d35409e58484e408/plugins/github-pr-status/contract.ts):
`pullRequests` accepts up to 200 environment IDs. Exact contract/server/build
retirement diagnostics were sent to 444, which owns Sidebar consumption and
SDK/package changes. Questions/Tasks/Automations retain IDs and installed paths
`server/dist/builtin-plugins/<name>/dist`; live plugin inventory and metadata
confirm them despite built-in versus official packaging changes.

## Gates and review responses

Frozen patch candidate `1fc4416bdc02a36372f9293f056b86364a5fde3b` passed:

| Check | Result |
| --- | --- |
| Catalog nondeploy `--keep-workspace` | exit 0; Questions 5 files/141 tests, Tasks 37/410; both typechecks, dependency builds, target-CLI builds |
| Registered Questions coverage | 90 additional cases: 3 ACP providers × 7 queue depths × 4 batch sizes, plus abort/dismiss/native-capability and delayed concurrent-send cases; retained retry coverage |
| Actual core interaction/dispatch/parent defaults | exit 0; 3 files/78 tests, including idle question card, active/background dispatch and normal provider approvals |
| Pristine Automations | exit 0; 12 files/143 tests, typecheck and target-CLI build |
| Actual patched Tasks service/CLI probe | exit 0; 8 checks, repeated in the final retained build root |
| Artifact verifier | exit 0; required stage/baseline checks and 7 isolated filesystem regression tests |

Existing assertions, skips and timeouts were not changed. Questions production
code equals the retained 0.46 patch: configurable timeout, submission summary,
shared ordinary QuestionForm/draftKey and native capability semantics remain.
Tasks suite count alone does **not** cover local additions. The attached typed
probe registers the actual store/API/CLI, asserts live/completed/status/limit
reads and matching links, and inspects actual spawn arguments with/without a
caller. Initial Node strip-only execution failed before assertions; checkout
tsx passes. Source and full raw failure/success logs are retained.

445 F1: historical sync silently skips ENOENT. The separate
[mandatory verifier](../../../bb-plugins/verify-artifacts.py) fails on missing
files, hash/size/version mismatch or incomplete pristine installation; deployment
backs up all three exact plugin sets before writing, verifies backup and every
installed byte, and restores/verifies pristine artifacts on copy/readback failure.
Its seven regression tests use temporary fixtures only. The full-set amendment
first recorded three red failures: unexpected installed files before writes,
unexpected files after copying, and corruption of an untouched app.js.map.
Baseline, backup and postcopy verification now require exact directory membership;
postcopy hashes cover every pristine entry with only the twelve staged overrides.
No real deployment ran in this worker; root deployment is recorded separately.
F2 was addressed for that release preflight by the actual registered eight-check
probe above. The subsequently added mandatory pipeline gate is recorded below;
the historical probe was not itself part of that original sync run.

## Mandatory Tasks behavior gate

BBPLUG-434 subsequently adds the
[cataloged 24-test native gate](../../../bb-plugins/tasks/README.md#mandatory-source-behavior-gate)
to the actual sync pipeline before any artifact staging or deployment. It uses
the release's own Tasks/SDK/SQLite/Vitest seams and dependencies; missing profile,
input/report, incomplete results and version mismatch block the pipeline. The
separate exact-byte artifact verifier is unchanged.

The owning-entrypoint regression first failed because sync reached stage/deploy
without executing a configured failing behavior command. Isolated tool/app
fixtures were used for that RED and for orchestration GREEN. Native acceptance
uses a private disposable copy of the retained 0.47.1 build workspace at exact
source HEAD `5e1acd765039e874643f34c4d35409e58484e408`: patched behavior passes
24/24, removing the whole Tasks patch fails the mandatory pre-staging boundary,
and removing CLI parent forwarding alone fails the same boundary. Both mutations
are restored and patched behavior passes again. Missing/empty/skipped/corrupt
reports (including stale successes) and source/build-version failures are exercised
separately in 15 passing actual-entrypoint fixture checks. The native mutation
runner passes all four acceptance checks; Tasks typecheck including the injected
test, all seven unchanged artifact-verifier regressions, Node syntax checks and
`git diff --check` pass. No artifact build or full Sidebar/catalog suite ran.
An initial test typecheck caught the missing CLI status argument; that test-only
registration was fixed and native acceptance rerun. Current raw evidence is in the
[compressed validation log](tasks-gate-validation.log.gz).

The profile is selected for every cataloged Tasks release. Actual native
execution here covers 0.47.1; older release preflights have not been rerun or
newly certified. There is no bypass for older versions. Original suite counts,
manual eight-check probes, accepted artifacts and deployment acceptance above
remain historical evidence. No production Tasks/Questions patch bytes change;
Automations stays pristine and retired. No app bundle, installation, deployment,
reload, restart, remote Git/API, package install or global CLI identity change
is part of this work. Root still owns integration, broader gates and lifecycle.
Questions disposal safety below remains mandatory for any later writes/reload.

## Root reproduction and deployment boundary

**Questions deployment requires zero pending/resolving Questions forms.**
Shipped [plugin disposal](https://github.com/get-bb/bb/blob/5e1acd765039e874643f34c4d35409e58484e408/apps/server/src/services/plugins/plugin-runtime.ts#L1996)
interrupts the plugin's interactions; the
[DB update](https://github.com/get-bb/bb/blob/5e1acd765039e874643f34c4d35409e58484e408/packages/db/src/data/pending-interactions.ts#L368)
includes both `pending` and `resolving`. The patched ACP queue lives in plugin
memory and disappears on disposal, without automatically re-asking unanswered
questions. A verified artifact copy/rollback does not preserve these forms.

Before any Questions artifact writes and again immediately before its reload,
root must enumerate **all unarchived threads across all projects, including
hidden threads**, then read each thread's interactions through the exact shipped
read-only CLI/API:

```sh
bb thread list --include-hidden --json
bb thread interactions list <thread-id> --json
```

The second command uses `GET /threads/:id/interactions` and returns an array.
Retain only metadata needed for the gate: thread ID, interaction ID, status,
`origin.kind`, `origin.pluginId`, and `origin.rendererId`. Require zero rows
where `origin.kind == "plugin"`, `origin.pluginId == "ask-user-question"`,
and status is `pending` or `resolving`; any missing/failed thread read blocks
the gate. Do not auto-answer, cancel, dismiss, or re-ask forms to manufacture
zero. If forms remain, defer Questions writes/reload while independently scoped
Sidebar/Tasks work may continue. The combined deployment command below writes
both Questions and Tasks and therefore assumes this root-owned gate has passed;
the artifact verifier itself does not inspect live interactions. No new live
question or destructive disposal probe is required to establish this hazard.

The following commands reproduce the original **pristine-installation-only**
preflight/deployment procedure, without a GitHub window. Current Questions/Tasks
are already patched: default pristine verification and `--deploy` intentionally
fail closed. Use the [deployment record](DEPLOYMENT.md#future-reproduction)
for current read-only installed verification. Source preflight itself remains
non-mutating:

```sh
BB_PATCH_SOURCE_ROOT=/tmp/bb-0471-443-source npm run bb-plugins:sync -- --keep-workspace
PYTHONDONTWRITEBYTECODE=1 python3 bb-plugins/verify-artifacts.py docs/compatibility/bb-0.47.1/artifact-manifest.json
```

The verifier checks the accepted stage at
`/Users/matthewsaw/.bb/patch-staging/bb-0.47.1-2026-10-26T04-30-59-533Z`.
Use `--stage-root <new-stage>` to compare a fresh stage against the accepted
hashes; a difference fails and needs review. Do not use sync's unchecked deploy
copy path. For a pristine matching installation only, after root acceptance and the
zero-form gate, the original deployment command is:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 bb-plugins/verify-artifacts.py docs/compatibility/bb-0.47.1/artifact-manifest.json --deploy --backup-root "$HOME/.bb/patch-backups/bb-0.47.1-reviewed-443"
PYTHONDONTWRITEBYTECODE=1 python3 bb-plugins/verify-artifacts.py docs/compatibility/bb-0.47.1/artifact-manifest.json --verify-installed
bb plugin reload ask-user-question
bb plugin reload tasks
```

The backup path must not exist. These are root-only reproduction commands for
a pristine matching installation. No core artifacts or restart are required.
Rollback payloads and member hashes remain
available in Git and the verified pre-write backup. Git rollback boundary is
the worker base above; revert the 443 commits to remove this catalog/audit
candidate. Restoring Git does not restore installed artifacts.

Root owns integration, full Sidebar gates, deployment/reload, both-sidebar
light/dark interaction acceptance, push, task completion and archiving.
Root subsequently passed live ACP delivery in 446; historical 430 was cancelled
as superseded, not retrospectively passed. The [deployment record](DEPLOYMENT.md)
is authoritative for current acceptance and GUI limits. Mermaid 433, restore
414 and mandatory pipeline 434 remain separate. No unresolved acceptance is
waived, no speculative feature task or Human reassignment was made, and no
Ghostty work was performed.
