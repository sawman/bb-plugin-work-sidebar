# Work Sidebar SDK compatibility — BB 0.46.1

Task: BBPLUG-431. Checked 2026-10-20 in isolated managed environment
`env_i6hty65dth`, branch `bb/bb-0-46-1-sidebar-sdk-compatibility-thr_6g3tebimy3`.
The clean starting HEAD was exactly
`ff2588a730e6596ce9d3539d5785cbbfc3153e62`.

## Package disposition

`bb plugin types --check .` initially exited 1: package pin 0.6.37 versus
host SDK 0.6.49. The supported `bb plugin types .` updated only the exact
SDK devDependency to 0.6.49. `npm install` updated only that package's lock
resolution, version and integrity (and root pin); host shim versions were
already aligned and remain devDependencies. Installation exited 0.

Retain engine floors `bb >=0.46.0` and `bbPluginSdk >=0.6.37`: this change
adopts no newer API. The package contract now checks the exact 0.6.49 pin
and resolved lock version, while preserving its engine and shim assertions.
There are no production app/server changes or new runtime dependencies.

## Declaration audit

Compared the published 0.6.37 npm tarball's bundled declarations with the
installed 0.6.49 package, including app, server, testing and internal surfaces.
The complete diff is retained in task-local scratch as `sdk.diff`.

| Boundary | Verified delta and disposition |
| --- | --- |
| Navigation and row writes | `BbNavigate`, `useBbNavigate`, `useSdk`, title/pin/read calls remain compatible. Keep SDK-owned optimistic state and rollback in `shared/use-thread-controls.ts`. |
| Thread actions and split | Adds the `state` action group and reorganizes host menu descriptions. Existing core archive/delete keys and action contracts remain compatible. Keep host confirmation/cascade ownership and native split hook; no custom descendant traversal added. |
| Composer and drafts | Existing draft hooks, snapshots, mentions and attachments remain compatible. `NewThreadRequest` adds optional provider `sessionOptions`; Work Sidebar does not own a custom new-thread submission path requiring forwarding. |
| PR contracts | No changed used PR contract or sidebar PR hook signature. Keep existing shared server reads and Query policies; prior PR audit findings are outside this upgrade. |
| Queue | Queue entries now expose `state` (queued, scheduled, waiting, claimed, failed_retrying, failed_exhausted). Existing payload/sendAt/waitingOn projection remains valid; source `listQueuedThreadMessagesForApi` filters claimed rows, retaining live failures. No dispatch policy moves into the plugin. |
| Timeline | Adds provider commands/session options and optional context cost. Pagination metadata drops kind/segmentLimit/contentPage/hasOlderRows and requires historySnapshot/olderRowsSourceSeqEnd. Work Sidebar projects rows, goal, pendingTodos and background jobs, not those pagination fields. |
| Workspace | Host workspace status adds maxFiles/fileCount. The Changes slice uses its existing Git/PR server adapters rather than this host-daemon RPC, so no migration is required. |
| Settings, tools and state | Used settings hooks, agent-tool context.threadId and typed RPC contracts remain compatible. BB owns host state, Query owns durable reads, Zustand remains presentation-only. |
| Other additions | Save-file API, descendant listing, custom code-fence registration, CLI/telemetry APIs, marketplace subdirectory, string-valued provider reasoning and session-option APIs require no current consumer change. No speculative adoption. |

## Exact release source and Tasks coordination

The source worker supplied pristine `desktop-v0.46.1` commit
`411eac54ac16d0a3cb57d1de8396d37564884a73` at its task-local `source`
directory. No remote Git/API read was performed by this worker.

The copied `getPluginPanelRoutePath` and `parseTasksRoute` functions in
`tests/fixtures/bb-task-navigation-contract.ts` were compared byte-for-byte
with that commit's `packages/client-core/src/routes/route-paths.ts` and
`plugins/tasks/shell/routes.ts`; both match. Fixture provenance now identifies
0.46.1. Links remain `/plugins/tasks/tasks/task/<key>` through host `UrlLink`.
Title and copy remain separate accessible siblings. Ownership reads retain
`activeOnly: false`; filtered assignments never prove deletion.

Pristine upstream Tasks still lacks `listTasksForThread`. Work Sidebar still
requires the source worker's retained patch for bounded terminal task history:
statuses done/canceled, includeCompleted true, limit 5. The source worker
confirmed that patch is retained unchanged. Patch deployment and live RPC
acceptance belong to root; SDK compatibility alone cannot satisfy that gate.

## Host Mermaid opportunity (separate follow-up)

The new `experimental_codeFenceRenderer` registers plugin components for
assistant/nested-agent fences and explicitly excludes plugin Markdown. It
does not itself expose a Mermaid renderer or eliminate a renderer dependency.

However, the exact release's existing host Markdown path supports Mermaid:

- `apps/app/src/lib/plugin-sdk-app-impl.tsx:175`: `PluginMarkdown` forwards
  content to `MarkdownPreview`.
- `apps/app/src/components/ui/markdown-preview.tsx:1763`: imagePolicy defaults
  to render; line 787 selects `MarkdownMermaidDiagram` for Mermaid fences.
- `apps/app/src/components/ui/markdown-mermaid-loader.ts:8`: the host lazily
  imports its own Mermaid library.
- `packages/plugin-sdk/src/app-contract.ts:3421`: public `MarkdownProps`
  accepts Markdown content.

Inbox currently intercepts Mermaid in `features/inbox/views.tsx:376` and
renders its source fallback. This source chain supports a separate follow-up
to evaluate host rendering without bundling Mermaid, subject to live proof.
It may predate 0.46.1; no claim that this release introduced it. Root recorded
the follow-up. No Inbox behavior changes are included here.

## Validation and limits

Raw logs remain under `.agents/memory/tasks/BBPLUG-431/` in this worktree.

| Gate | Result |
| --- | --- |
| Initial SDK check (`types-before.log`) | Exit 1, expected pin mismatch. |
| Package contract RED (`package-red.log`) | Exit 1: old exact-pin assertion; 5 pass, 1 fail. |
| Focused compatibility (`focused.log`) | 16 files, 117 pass/1 fail, exit 1; the sole failure was architecture scanning the unpacked old SDK in scratch. |
| Boundary cleanup (`boundary-green.log`) | Removed scratch extraction, changed no assertions: 10/10 pass, exit 0. |
| Final package contract (`package-green.log`) | 6/6 pass, exit 0, includes resolved SDK lock-version assertion. |
| Artifact/route/server (`artifact.log`) | 3 files, 9/9 pass, exit 0; bundle test runs production build and verifies browser/server ownership. |
| No-emit typecheck (`typecheck-final.log`) | Exit 0. |
| SDK check (`types-after.log`) | Exit 0, pin/host both 0.6.49. |
| Diff whitespace | `git diff --check`, exit 0. |

The focused run covers composer latest-draft preservation, both surfaces'
thread controls, split and optimistic writes, task links/controls/ownership,
tool context, PR reads, settings composition, and background/timeline reads.
No assertion weakening or blanket timeouts. Expected jsdom navigation notices
are retained in the raw focused log. npm reported 3 dependency audit findings;
no unrelated dependency remediation was attempted.

No full worker suite, plugin reload/deployment, restart or registry/patch
mutation was performed. Root owns one full serial suite on the final combined
tree and live light/dark, interaction, task-link and patched Tasks acceptance.
BBPLUG-431 remains Agent/in_progress pending that acceptance.
