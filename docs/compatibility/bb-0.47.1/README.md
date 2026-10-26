# BB 0.47.1 compatibility audit

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
| Artifact verifier | exit 0; required stage/baseline checks and 4 isolated filesystem regression tests |

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
Its four regression tests use temporary fixtures only. No real deployment ran.
F2 is addressed by the actual registered eight-check probe above. BBPLUG-434
still owns integrating that behavior gate into the build pipeline.

## Root reproduction and deployment boundary

Rerun exact preflight after source acceptance, without a GitHub window:

```sh
BB_PATCH_SOURCE_ROOT=/tmp/bb-0471-443-source npm run bb-plugins:sync -- --keep-workspace
python3 bb-plugins/verify-artifacts.py docs/compatibility/bb-0.47.1/artifact-manifest.json
```

The verifier checks the accepted stage at
`/Users/matthewsaw/.bb/patch-staging/bb-0.47.1-2026-10-26T04-30-59-533Z`.
Use `--stage-root <new-stage>` to compare a fresh stage against the accepted
hashes; a difference fails and needs review. Do not use sync's unchecked deploy
copy path. After root acceptance, deploy the accepted stage with a fresh backup:

```sh
python3 bb-plugins/verify-artifacts.py docs/compatibility/bb-0.47.1/artifact-manifest.json --deploy --backup-root "$HOME/.bb/patch-backups/bb-0.47.1-reviewed-443"
python3 bb-plugins/verify-artifacts.py docs/compatibility/bb-0.47.1/artifact-manifest.json --verify-installed
bb plugin reload ask-user-question
bb plugin reload tasks
```

The backup path must not exist. These are root-only future commands. No core
artifacts or restart are required. Rollback payloads and member hashes remain
available in Git and the verified pre-write backup. Git rollback boundary is
the worker base above; revert the 443 commits to remove this catalog/audit
candidate. Restoring Git does not restore installed artifacts.

Root owns integration, full Sidebar gates, deployment/reload, both-sidebar
light/dark interaction acceptance, push, task completion and archiving.
Live ACP Reply remains BBPLUG-430; Mermaid 433, restore 414 and mandatory
pipeline 434 remain separate. No unresolved acceptance is waived, no speculative
feature task or Human reassignment was made, and no Ghostty work was performed.
