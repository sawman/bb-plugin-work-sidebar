# BB 0.49.0 patch and source audit

BBPLUG-467, 2026-11-12. Worker base is clean
`3ce2f2e226f1c5421780ddc91acd5a6f37fb74b6`. Exact `desktop-v0.49.0` is
`7b26cae79ec978fafd0a5db0e8517e94f12eb8f4`; source package SDK is 0.6.132.
Installed CLI/bundle is 0.49.0 and all three plugin metadata sets identify
0.6.132. No installed writes, built-in reload, restart or UI mutation occurred.
Root owns deployment/final acceptance; this task remains Agent-owned pending it.
SDK/package/Sidebar changes and their validation belong to BBPLUG-466.

[Source manifest](source-manifest.json) records immutable owning-boundary links,
source file hashes, exact source tree and provenance limits.
[Deployment-ready recipe](DEPLOYMENT-READY.md) records the native zero-form
inventory gate, read-only verification, root-only write/reload boundary and rollback.
[Pristine rollback](../../../bb-plugins/rollback/bb-0.49.0/README.md) captures all
three plugin sets before any deployment. [Validation manifest](validation-manifest.json)
pins command results, raw-log sizes/hashes and the durable evidence archive attached
to BBPLUG-467 as `01M76YNMWE63NWDB0XZXT8421W` (317,295 bytes). Retrieve with
`bb tasks attachment get 01M76YNMWE63NWDB0XZXT8421W --out <file.tar.gz>`;
the archive includes native gate reports/runner, source filelist, primary query
request/responses and complete raw failure/success logs. No forms/content were read
by the worker's native gate recipe, which remains unexecuted until root chooses it.

## Exact release and patch dispositions

| Capability | Shipped boundary and disposition |
| --- | --- |
| ACP question queue | Retain plugin-only [0.49 patch](../../../bb-plugins/ask-user-question/acp-continuation-v0.49.patch). [Question server](https://github.com/get-bb/bb/blob/7b26cae79ec978fafd0a5db0e8517e94f12eb8f4/plugins/ask-user-question/src/server.ts) still awaits one ordinary requestInput; [ACP declaration](https://github.com/get-bb/bb/blob/7b26cae79ec978fafd0a5db0e8517e94f12eb8f4/plugins/provider-acp/src/declaration.ts) disables native questions. Ordinary detached continuation is not the ACP multi-call/per-answer auto-send queue. |
| Indexed thread-task read | Retain [0.49 Tasks patch](../../../bb-plugins/tasks/thread-workflow-v0.49.patch). [Native contract](https://github.com/get-bb/bb/blob/7b26cae79ec978fafd0a5db0e8517e94f12eb8f4/plugins/tasks/shared/contract.ts) still lacks listTasksForThread. Preserve indexed task_threads.thread_id reads and matching links consumed by Sidebar's five-completed-task preview until an equivalent native migration is verified. A DB index alone is not the RPC contract. |
| Parented Tasks CLI dispatch | Retain caller forwarding. [CLI dispatch](https://github.com/get-bb/bb/blob/7b26cae79ec978fafd0a5db0e8517e94f12eb8f4/plugins/tasks/cli/index.ts) still sends only task/preset/instructions to delegation; [delegate spawn](https://github.com/get-bb/bb/blob/7b26cae79ec978fafd0a5db0e8517e94f12eb8f4/plugins/tasks/delegate/index.ts) omits parentThreadId. Native parent execution defaults do not repair missing parenting. |
| Automations personal project | Keep retired/pristine. [Exact service](https://github.com/get-bb/bb/blob/7b26cae79ec978fafd0a5db0e8517e94f12eb8f4/plugins/automations/src/service.ts) explicitly accepts standard/personal project kinds and uses native projects.get. [GET route](https://github.com/get-bb/bb/blob/7b26cae79ec978fafd0a5db0e8517e94f12eb8f4/apps/server/src/routes/projects.ts) uses requirePublicProject. Read-only live proj_personal GET returns kind personal. No automation creation/mutation. |
| Explicit inverse HTTP navigation | Still absent from [SDK app contract](https://github.com/get-bb/bb/blob/7b26cae79ec978fafd0a5db0e8517e94f12eb8f4/packages/plugin-sdk/src/app-contract.ts): openUrl(url) has neither explicit in-app HTTP intent nor effective browser preference getter. |
| Browser-capable left URL host | Still absent. [App](https://github.com/get-bb/bb/blob/7b26cae79ec978fafd0a5db0e8517e94f12eb8f4/apps/app/src/App.tsx) uses app-wide AppNavigationUrlHost; [routing](https://github.com/get-bb/bb/blob/7b26cae79ec978fafd0a5db0e8517e94f12eb8f4/apps/app/src/lib/url-open-routing.tsx) defaults browser context to null. [Right panel](https://github.com/get-bb/bb/blob/7b26cae79ec978fafd0a5db0e8517e94f12eb8f4/apps/app/src/components/plugin/PluginPanelRightPanelHost.tsx) supplies openBrowser. No broad host patch or private preference mutation. |

Initial cataloged `npm run bb-plugins:sync` fails with no 0.49 catalog entry.
Unmodified 0.47 Questions and shared Tasks patches each fail `git apply --check`
on exact 0.49 source (exit 1). These failures are retained, not called passes.
Questions app context changed because the release now marks ordinary questions
required. Tasks API/contract insertion contexts changed due upstream additions.
The new versioned patches retain the same ACP queue/indexed RPC/parenting behavior,
with the ordinary required-answer adapter preserved at the production form boundary.
No old artifact is copied onto the new release, and no host core source is changed.

The Questions production server patch applies unchanged. The app retains shared
ordinary QuestionForm, draftKey, required answers and shipped shared-form behavior;
queued ACP questions continue through the existing local queue UI/shortcuts.
Timeout setting, submission summaries, native capability filtering, abort/dismiss,
retry and bounded maximum-32 queue behavior remain required validation boundaries.

## Parent execution defaults

Exact 0.49 now inherits the same-provider live parent's service tier as well as
model/reasoning. This differs from the preserved 0.47 audit. Native
[default policy](https://github.com/get-bb/bb/blob/7b26cae79ec978fafd0a5db0e8517e94f12eb8f4/apps/server/src/services/threads/thread-default-policy.ts)
chooses parent.serviceTier before project/product defaults; the
[execution plan](https://github.com/get-bb/bb/blob/7b26cae79ec978fafd0a5db0e8517e94f12eb8f4/apps/server/src/services/threads/thread-execution-plan.ts)
still applies explicit requests, provider support and allowFastServiceTier. The
[current owning suite](https://github.com/get-bb/bb/blob/7b26cae79ec978fafd0a5db0e8517e94f12eb8f4/apps/server/test/threads/thread-execution-defaults.test.ts)
expects fast tier from the parent. This is a source/test boundary, not live speed
certification. Tasks still has to forward the caller to establish that parent.
No host change is needed or made.

## Provenance

The prior local 0.47 source cache was gone and ~/.bb/patch-sources was empty.
One depth-1 clone fetched the exact release tag into
`/Users/matthewsaw/.bb/patch-sources/desktop-v0.49.0`; it remains pristine.
Every subsequent clone/preflight uses that local source. No broad remote fetch,
quota polling or GitHub query loop occurred. Remote windows switched to sawman
and verified active identity before each operation; matthew-se was restored and
verified afterward, including the restoration trap on clone failure paths.

The cached `bb-0.49.0-arm64.zip` SHA-512 matches local updater metadata.
The installed package and all 21 Questions/Tasks/Automations files match its
exact cached file sets and bytes. Installed `codesign --verify --deep --strict`
passes. These checks establish local cached-release parity; they do not prove
a signed source tag, independently authenticated release digest, reproducible
build or source-to-binary attestation. Those provenance limits remain explicit.
No installed SDK declaration path was assumed; Sidebar's independent installed
SDK/API check belongs to its owner.

One bounded GraphQL request refreshed three known issues and two narrow searches
across issues/PRs. #1978 is closed; #2200 and #2836 remain open. Exact
listTasksForThread search returns zero; ACP/question/queue returns three unrelated
open hits (#7136, #3020, #7454). The source boundary determines disposition;
search absence is supplementary. Exact request and responses are retained.

## Validation and acceptance

Frozen source candidate: `c84a819f2b1293c3f4420c19068762d80c138eba`.
Questions characterization first fails at the owning production form adapter when
the old raw questions prop is used: `Optional` renders instead of required-answer
behavior (exit 1, one selected test failed; eleven filtered). Restoring the
release's required:true adapter makes all twelve app tests pass, with no changed
assertion/timeout. The regression is included in the new versioned patch.

The mandatory Tasks pre-staging gate passes 24/24 against exact 0.49. Removing
the full patch yields twenty real native failures; removing only CLI caller
forwarding yields three. Both stop before the staging continuation. Restoring
production source passes 24/24 again; all four native acceptance checks pass.
The runner is the existing native acceptance script with only exact version,
versioned patch path and local paths selected in a retained task artifact.
No Tasks production additions/removals differ from the retained patch; only
insertion context/offsets changed. The gate executes actual SQLite/store/RPC/CLI
and spawn boundary, not source-string assertions.

Cataloged non-deploy preflight exits 0: Questions 5 files/143 tests; Tasks
36 files/428 tests including the injected 24-test native gate. Both plugin
typechecks, dependency-closure builds, target installed-CLI builds and BB/SDK
metadata checks pass. No core artifacts are cataloged or staged. Supplementary exact-source server typecheck passes (six tasks). Four current
core suites pass 158 tests: pending interactions, thread dispatch, parent execution
defaults (including service tier), and internal tool-call context. The old
parent-create suite was replaced upstream by thread-execution-defaults.test.ts;
no missing historical path is treated as a zero-test pass. Pristine Automations
passes 12 files/166 tests, typecheck, dependency build and target-CLI build with
BB 0.49.0 / SDK 0.6.132 metadata. Its source remains unchanged and its rebuilt
artifacts are not staged/deployed. Read-only personal-project GET passes.

[Accepted artifact manifest](artifact-manifest.json) pins all twelve staged
files, source candidate and exact stage/build workspace. The strict verifier
passes every staged file and all 21 pristine installed files with exact directory
membership. All three rollback archives and all 21 members are verified. Seven
isolated artifact-verifier regressions and fifteen sync-entrypoint fixture checks
pass. Fixture deploy branches write only temporary fixtures; no live bundle.
No prior-release count/live acceptance is a 0.49 pass.

Source dependency installation uses the exact frozen lockfile. Its optional
dtrace-provider node-gyp/Xcode detection fails internally, but its optional
installer returns success; pnpm exits 0. Missing not-yet-built CLI/script bin
warnings are retained. Exact shallow source also warns that generated official
marketplace dates are omitted because complete Git history is unavailable; no
history fetch or fabricated date was substituted. Node DEP0205 module.register
warnings remain. Vite's future native-config warning about upstream __dirname is retained too.
No warning suppression, lockfile/source workaround or hidden test exclusion was applied.

Current runbooks were reconciled during review: Questions/Automations previously
recommended sync's unchecked copy path, and the shared Questions test plan still
implied current core artifacts, BB restart and queue persistence across disposal.
Current instructions now require strict release-specific verification and the
zero-form gate, acknowledge the in-memory queue, and retain historical release
records. Supplementary core guards are stated separately from actual sync gates;
all were executed here before stage acceptance. Source/artifact proofs do not
certify a reload with user forms present.

Root owns a current zero-pending/resolving-form inventory before any Questions
write and again immediately before reload. This worker prepares the supported
native recipe and never clears forms. It does not run destructive disposal
probes, create live questions, navigate, change drafts/theme/zoom or restart BB.
Live ACP delivery, rendered-form keyboard/pointer, actual Tasks parenting/read,
and both Sidebar surfaces remain root-owned acceptance gaps for this release.
Historical 0.47 acceptance is preserved in its own records.

Git rollback is the worker base above; reverting the bounded candidate removes
repository changes only. Matching pristine rollback archives or root's verified
full-set backup restore installed bytes, under the same Questions disposal gate.
