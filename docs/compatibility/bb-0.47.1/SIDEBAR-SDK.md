# Work Sidebar SDK compatibility — BB 0.47.1

The exact development SDK is `@get-bb/plugin-sdk@0.6.79`. Minimum admission
is BB 0.47.1 / SDK 0.6.79 because this plugin now requires the new tab and
keyed native PR APIs. This is the conservative, verified release pair;
0.47.0 and earlier hosts have not been certified for these requirements.

The source comparison uses pristine `desktop-v0.47.1`, commit
`5e1acd765039e874643f34c4d35409e58484e408`, supplied by the source worker.
The npm comparison packages stayed outside the plugin workspace. The 16 singleton shim packages plus React/React DOM resolve to the exact
`apps/app` importer versions in that release's `pnpm-lock.yaml` and remain
devDependencies. BB's checker requires its literal caret specifiers for the
16 shims; the lock pins their host versions, and React/React DOM are exact
19.2.4 dev pins. Matching ranges alone had admitted newer npm resolutions;
package tests now check both required specifiers and resolved lock versions. Runtime Query, Zustand and Zod ownership
is unchanged. Validation, review and live acceptance evidence belong to
BBPLUG-444 and its parent outcome in BB Tasks.

## Used API disposition

The 0.6.49 → 0.6.79 audit covers app, backend and both testing declaration
entries, imported SDK symbols and the used SDK areas below.

| Boundary | Release delta and disposition |
| --- | --- |
| Branch PR reads | `environments.pullRequest` is removed. The shared thread enrichment adapter now calls native `bb--github-pr-status` typed RPC `pullRequests({ keys: [environmentId] })` and selects the matching keyed result. Missing rows fail explicitly. |
| Native reactive PR state | `experimental_useSidebarThreadPullRequest` and `PluginSidebarPullRequest` are removed. Disclosed thread rows and active Changes use `experimental_useRpcKeyedQuery`; semantic PR types belong to the PR slice. No all-thread PR request or component status cache remains. |
| PR actions/context | Removed environment draft/ready/merge methods have no production callers here. Native contracts are `markReady`, `markDraft`, `merge`, with environment-scoped inputs and tags; copied wire schemas match installed RPC inspection. Existing authored URL draft actions, reviewer edits and thread-local Stack checkout retain their server adapters and error paths. The native plugin owns its composer/Info context and actions. |
| Work destination | `threadPanelAction` / `PluginThreadPanelProps` are removed. Work registers `experimental_tab` with thread context, action availability, the same `work-context` id, flush layout and `{ threadId, params }` props. Existing `openThreadPanel` navigation remains supported. Work/Changes/Agents selection stays thread-local. |
| Navigation, row writes and lifecycle | Used `useBbNavigate`, `useSdk().threads` title/pin/read methods, native action menus and recursive archive/delete ownership remain compatible. Split adds optional options; existing calls still preserve the native gesture. |
| Workspace and files | `diffFiles` now names `EnvironmentDiffFilesArgs`; existing environment/target calls remain valid. New viewed-diff APIs are unused. Repository `status`, `get`, `diffPatch`, thread storage paths and FileLink/SourceCode/Diff consumption remain compatible. |
| Thread/server reads | Used thread get/list/spawn/archive/update, queue, output, default execution options, timeline, provider states and usage limits compile with their consumed fields. New optional fields/events require no projection change. Storage, events, lifecycle disposal and settings APIs retain their use. |
| RPC and host clients | Contracts add tags, keyed reads/watches/invalidation and typed client errors. Existing `useRpc`, validated `plugins.callRpc`, server registration and host-client transport remain valid; contract composition stays server-only. New internal tunnel APIs are unused. |
| Composer and settings | Used composer customization, drafts/mentions/attachments, settings and provider directory hooks remain compatible. No defaults or provider configuration change. |
| Testing and task routes | The real 0.6.79 hook and `tabs` capture drive migration tests; obsolete sidebar PR fixtures are removed. `renderSlot` adds page-title/contract options without breaking existing calls. Task route-builder/parser excerpts still exactly match release source; only provenance changes. |

## Native status boundary

The browser-safe PR slice schema imports only Zod. Every frontend row is
validated before projection or canonical fact hydration: the host keyed hook
transports JSON without validating output rows. Backend reads use the SDK's
schema-validating RPC transport. No raw HTTP or GitHub frontend bypass is used.

Native core hydration preserves supplemental comment totals and same-review-state
reviewer identities until their existing enrichment refresh. `available`
hydrates the existing bounded shared Query fact directory;
confirmed `absent` removes only that thread association. Native unavailable,
malformed, missing or disabled-plugin results show errors with retry and do
not prove no PR. Repository state and other Work cards remain independent. A failed native
summary also leaves the independently available local Stack projection usable;
native retry rereads its scoped summary/projection without promoting remote
enrichment to summary authority.
Malformed present rows are isolated individually. SDK 0.6.79 rejects a whole
keyed batch if any key is omitted; its shared error retains prior associations
and retry uses the official keyed owner. Discarded valid rows are not recovered
through a second transport or shadow cache.

BB owns native keyed freshness, watches, retries and native server API-budget
caches. Manual refresh rechecks currently subscribed keys. Scoped Stack/detail
enrichment starts only for an available disclosed thread row and retains its
existing Query, shared server-cache and generation/disposal guards. Both
sidebars resolve the same normalized facts. The authored list retains its
existing GitHub Query authority and passively consumes those shared facts;
its endpoint is not an environment-keyed native read. Known status-audit
findings in [the current contract](../../architecture/changes-and-prs.md)
remain separate work.

## Live acceptance boundary

This change is built and harness-tested without reload or deployment. Root
owns the final frozen combined serial suite, integration and live acceptance.
After loading the verified candidate, check native available/absent/unavailable
and disabled-plugin recovery alongside usable local repository and Work cards;
exercise Work/Changes/Agents thread switches, disclosed/collapsed rows, native
updates, retry, authored links/draft errors, modifier clicks, keyboard focus
and drag-to-split. Check narrow/wide light/dark layouts with the repository
`theme-control matrix` utility. Harness results do not certify host CSS,
real GitHub mutations, native watch delivery across windows or those live
interaction cells. No merge/ready/draft remote mutation was performed here.
