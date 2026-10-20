# BB 0.46.1 built-in/source/watchlist audit

Date: 2026-10-20. Worker: BBPLUG-430. Canonical parent:
`ff2588a730e6596ce9d3539d5785cbbfc3153e62` (clean managed worktree verified).
Exact release: `desktop-v0.46.1` at
`411eac54ac16d0a3cb57d1de8396d37564884a73`; source SDK and target bundle SDK
are both `0.6.49`; installed CLI is `0.46.1`.

`source-manifest.json` records immutable source URLs, SHA-256 and the retained
pristine checkout path shared with root and the SDK sibling. `release-delta.txt`
records the relevant source diff from exact 0.46.0. GitHub reads used sawman;
each remote window trapped restoration to matthew-se and verified `gh api user`
on entry and exit. `tag.json`, `release.json`, `issue-*.json` and `searches.json`
are primary evidence. No remote writes occurred.

| Capability | Exact shipped evidence and disposition |
| --- | --- |
| ACP accumulating queue and nonblocking delivery | Retain `acp-continuation-v0.46.patch` unchanged. Shipped `plugins/ask-user-question/src/server.ts` is unchanged from 0.46.0: one awaited requestInput with ctx.signal, followed by one combined tool result. No ACP provider branch, queue, per-answer send or auto delivery exists. The retained patch preserves configurable timeouts, describeSubmission and the ordinary persisted host form. |
| Indexed thread-task read | Retain `thread-workflow.patch` unchanged. Shipped Tasks contract still has project/global listTasks and task-to-thread listTaskThreads, with no reverse thread-scoped RPC. Existing DB thread index alone is not an exposed equivalent. The patch adds bounded listTasksForThread, filters live/status/completed tasks, and returns matching links. Work Sidebar now consumes this API for terminal preview5; preserve it through deployment. |
| Tasks CLI parenting | Retain the same Tasks patch. Shipped dispatch run(input) sends taskId/presetId/extraInstructions only; delegate spawn omits parentThreadId. The patch forwards caller thread through the typed delegation contract to spawn. Issue #2836 remains open. |
| Automations personal project | Keep pristine; retired patch remains historical. The exact service accepts kind personal, GET projects/:id uses requirePublicProject, and that helper rejects deleted projects but has no kind filter. 0.46.1 adds only cancellation signals in unrelated file-list routes; service behavior is unchanged. Read-only live `bb project show proj_personal --json` succeeds with kind personal (`personal-project.json`); no automation was created. |
| Explicit inverse HTTP intent | Still absent. SDK app-contract keeps openUrl(url: string): boolean, without explicit in-app/external HTTP destination or effective browser-preference getter. New save-file API is a download path, not navigation. |
| Browser-capable left URL host | Still absent. App.tsx still mounts AppNavigationUrlHost; routing browser context defaults null. Right panel supplies openBrowser through UrlOpenRoutingProvider. Both files are unchanged from 0.46.0. |

No remaining watchlist item is fulfilled. Open issue and PR searches were
refreshed separately for all five entries, including broader indexed Tasks
and ACP queue terms. Exact listTasksForThread searches returned zero issues
and PRs; broad hits are retained without treating them as shipped equivalents.
#1978 is closed; #2200 and #2836 remain open. The latter two remain existing
follow-ups; this audit does not implement them or work Human-owned tasks.

Source deltas relevant to opportunities: SDK adds experimental code-fence
renderers and saveFile; NewThreadRequest gains sessionOptions; thread-action
groups gain state. Tasks reasoning IDs now accept nonblank provider-defined
strings, with CLI options updated accordingly. Tasks adds a tagged signal
scheduler and restructures board/list reads; this is not the missing indexed
reverse RPC. Questions source and the navigation host wiring are unchanged.
The SDK sibling owns API consumption/pin changes and its SDK note. No speculative
product feature, PR-status audit fix, Floating Ghostty work or new task is included.

## Patch and artifact boundaries

The two retained patches modify only `plugins/ask-user-question/**` and
`plugins/tasks/**`. Registry 0.46.1 has no coreArtifacts or coreTests, so it
stages/deploys only each built-in's dist artifacts, including frontend assets.
No server core source change is claimed or shipped. Automations is excluded
from the deployment plan. The sync script itself is unchanged.

Retire Questions only after native ACP supports equivalent accumulating,
bounded questions and immediate nonblocking answer delivery, with live Reply
acceptance. Retire Tasks only after native indexed thread read and caller-parent
forwarding both exist; coordinate terminal preview5 migration before removing
the RPC. Historical patch files and audits remain intact.

Pristine matching rollback packages are tracked in
[rollback/bb-0.46.1](../../../bb-plugins/rollback/bb-0.46.1/README.md), with archive
and individual artifact hashes and exact app/server BB/SDK metadata. These
were captured from the new installed bundle before any worker deployment;
older rollback artifacts were not relabelled.

Catalog non-deploy preflight passed raw exit 0: Questions 5 files / 51 tests,
Tasks 37 files / 409 tests, both typechecks, dependency/standalone builds and
app/server BB 0.46.1 / SDK 0.6.49 metadata. No assertions or timeouts changed.
The Tasks count follows upstream test restructuring. Validation and staged
SHA-256 metadata are recorded in `validation.json` and `artifacts.json`.
`preflight.log` preserves the raw gate output. Rollback archive and member hashes
were independently verified. Root reports pristine Tasks reverse RPC404 and an
active personal project; Cursor auth_required currently limits live ACP Reply. Raw logs and numeric
exits are retained in this worktree's `.agents/memory/tasks/BBPLUG-430`.
Root owns review acceptance, combined full Sidebar gates, deploy/reload,
live ACP Reply and both-sidebar light/dark acceptance, push and task closure.
This worker does not certify live UI behavior or change installed artifacts.

## Root deployment reproduction

After integrating the candidate and passing root acceptance, use the pristine
retained `source-manifest.json` path (not the patched build workspace):

```sh
BB_PATCH_SOURCE_ROOT=/absolute/retained/source npm run bb-plugins:sync -- --deploy
```

The command reruns exact-source verification, tests, typechecks, dependency and
target-CLI builds, metadata checks, then backups/deploys/reloads Questions and
Tasks only. It requires no remote source clone. Root must inspect the resulting
stage/installed hashes. No core restart is required by these plugin-only patches.
