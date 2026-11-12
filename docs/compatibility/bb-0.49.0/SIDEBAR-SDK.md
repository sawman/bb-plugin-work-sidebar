# Work Sidebar SDK compatibility — BB 0.49.0

The development and minimum admission pair is BB **0.49.0** and
`@get-bb/plugin-sdk@0.6.132`. The migration starts from clean canonical
`3ce2f2e226f1c5421780ddc91acd5a6f37fb74b6`. Release source is pristine
`desktop-v0.49.0`, commit `7b26cae79ec978fafd0a5db0e8517e94f12eb8f4`,
supplied by the separate patch audit worker. BBPLUG-466 owns this SDK migration;
the root owns combined acceptance and deployment. This note does not certify
an installed artifact or a live UI session.

## Dependencies and typing

Run the supported `bb plugin types .`, then install its package changes in an
isolated worktree. Its 16 singleton shim declarations remain devDependencies;
the package assertions verify both the required specifiers and exact lock
resolutions from the release's `apps/app` importer. `@pierre/diffs` uses
`~1.2.12`, ten Radix families use their release minor versions, and
`tailwind-merge` uses `^3.7.0`. React and React DOM are exact **19.3.1**,
with exact **19.3.0** type peers. Neither React nor any shim is bundled.

Zod remains a bundled dependency, aligned to **4.6.7** so the plugin and SDK
share the same schema package. Query remains bundled, with the SDK's new
minimum `^5.106.1` and the exact release **5.106.1** lock resolution. This
avoids a second Query version and narrows the incidental registry update to
5.107.1. Zustand ownership is unchanged. No audit fixes are included.

The new SDK derives RPC tag declarations through a mapped `Omit`. Implicit
inference across this plugin's large schema graph exhausted Node's default
4 GiB heap and a diagnostic 8 GiB heap. `contracts.ts` supplies exact input
and output schema maps to `defineRpcContract`, preserving every method,
payload type, runtime schema and the full nested TypeScript coverage. The
unchanged default `npm run typecheck` then passed with TypeScript 5.9.3;
no heap setting, compiler upgrade or coverage exclusion was needed. Dependency
alignment and explicit inference were applied together, so the mapped type
remains the static diagnosis rather than an independently isolated cause.

## Used API changes

| Boundary | Migration |
| --- | --- |
| Work header | Removed `experimental_threadHeaderAction` and `openThreadPanel` become `experimental_threadAction` with header placement and the public panel controller's `openTab`. BB owns compact menu placement, rendering and focus. The Work tab id and Work/Changes/Agents state are retained. |
| Repository and divergence | Removed `environments.status` / `diffBranches` become public `bb--git` typed RPC `workspaceStatus` / `branches`. The branch limit is numeric on the wire. Existing environment/branch deduplication, concurrency cap and fallback order remain. |
| Selected local diff | Removed `diffFiles` / `diffPatch` become `files` and keyed `patches`. One listing supplies the file revision and any initial patch; binary/absent files need no patch call. Missing or malformed rows and truncated patches are unavailable. No extra cache, raw Git command or private host transport is added. |
| Goal | Removed `timeline.goal` becomes validated `timeline.extensionStates["provider-codex/goal"]`. The public provider state also admits `blocked` and `usageLimited`. Full and summary-only snapshot caches retain their existing independent reads and cadence. This uses public timeline JSON; the provider-scoped frontend extension hook cannot read another plugin's kind. |
| Timeline result type | The new incremental response adds a delta arm. Our calls omit `afterTag` and request full snapshots; the snapshot type excludes that delta arm rather than weakening the timeline type. |
| Native PRs | Public native keyed rows still lack upstream validation time and head SHA. Existing causal demand/proof, budget, backoff, cache and error/absence semantics remain owned by the current PR slice and its regressions. |
| Native manual refresh | Keyed `refetch()` changed from method-subscribed keys to the calling hook's keys. The toolbar fans out through mounted public refresh handles, deduped per environment and window Query client, with teardown on key change/unmount. No domain data, cache or timer is added. |
| Agents and disclosure effects | Concurrent Agent refetches coalesce without cancellation; Query's successful revision admits a missing replacement after the retired roster settles. Missing response rows are errors, with the existing single retry and no effect retry loop. Disclosure persistence ignores controlled-prop toggle events matching each section's effective state, preserving default-closed Archive/Recycle Bin and default-open Active/custom groups. |
| Navigation and lifecycle | Used thread navigation, row writes, native archive/delete actions and split gesture remain public SDK responsibilities. Native action targets preserve the newly required `parentNotifications`, including the archived server/RPC/row projection, without a guessed default. Work tab props use the public type including `environment`. New sidebar fields and retired Goal activity fields are aligned in typed fixtures; Goal threads use the host's ordinary runtime signal. |
| Execution defaults | Exact release source now inherits `serviceTier` from a live parent for the same provider. The separate source worker owns that source gate; this migration does not add custom inheritance or change task dispatch. |

The shared native Git adapter validates only the consumed public response
projection and strips unrelated fields. The patch-key wire tuple is
`[environmentId, target, ignoreWhitespace, path, revision]`. The host does
**not** enforce that revision as an expected-revision guard when reading a
patch. Listing and patch reads are not an atomic snapshot, and no stronger
consistency guarantee is claimed.

## Public file capability audit

The installed **public app declarations** expose:

- `experimental_useCanOpenFileExternally(target)`: reactive eligibility for
  workspace, host and thread-storage targets. False while loading or when this
  client has no external file target for the file's host.
- `useBbNavigate().experimental_openFileExternally({ target, location })`:
  opens through the client's **preferred** external file target. There is no
  application, Finder, reveal or target-preference override in its options,
  and no separate public Finder/reveal function in the app surface.
- `experimental_saveFile({ fileName, url })` or
  `experimental_saveFile({ fileName, blob })`: the same host-owned browser,
  desktop download or mobile share path. Outcomes remain `started` / `failed`;
  completion and share cancellation are not reported. No destination folder,
  client save-folder preference or no-dialog parameter is exposed.

The existing Thread storage path stays at **10,000** entries, progressive
**200** rows per directory, and the current Blob/native-download handoff.
No new storage action, path preference, browser-picker fallback, server-side
destination write or private/native workaround is implemented. The concrete
availability finding was handed to root and the retained storage author
`thr_58e4eg7gt4`; a product addition requires its own scoped assignment.

## Verification and rollback

Compatibility RED was recorded before implementation at the supported SDK
checker, package contract, registered Work header/Goal and native Git/selected
patch boundaries. The SDK harness still captures removed legacy header slots,
so a legacy harness pass alone does not establish host compatibility.

BBPLUG-466 records focused tests, default typecheck, final SDK check, one serial
full suite, the exact candidate commit and log paths. The root retains the
combined build, source/artifact gates, reload and live acceptance. No build,
plugin install/reload, remote Git/GitHub action or user UI operation is part
of this child migration. Live acceptance must cover both sidebar surfaces,
Work header compact placement, Goal state, local repository/diff errors and
native interactions in the theme/width matrix.

Rollback is the inverse of the single SDK candidate commit on top of the
stated base, followed by installing that base's lockfile. Deployment rollback
and patch ordering remain root-owned. No schema/storage migration is added.
