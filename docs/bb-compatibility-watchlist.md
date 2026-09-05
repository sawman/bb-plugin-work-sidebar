# BB COMPATIBILITY WATCHLIST

This is compatibility documentation only, not the repository work queue. BB Tasks remains the source of truth for repository work.

## Release-check procedure

When BB releases a new version, verify its Tasks plugin and SDK surface before
removing any item below. Re-run the linked searches against the current open
issues and pull requests, then confirm the shipped API through a typed plugin
test—not just a changelog entry.

Last checked: 2026-09-05 against BB 0.42.0 / SDK 0.4.47.

## BB 0.42.0 audit

Audited the immutable `desktop-v0.42.0` source at
`960255b98ce3dccdcb5754eb67a7f989236602a1`, the installed SDK declarations,
and the linked upstream searches. No watchlist item is fulfilled in this
release, so no replacement feature task was created.

| Watchlist item | 0.42.0 result |
| --- | --- |
| ACP AskUserQuestion continuation | Still absent upstream; the local patch was rebased, tested, deployed, and BB restarted. |
| Thread-filtered Tasks read | Still absent; the Tasks contract exposes only task-to-thread `listTaskThreads`, not a thread-to-task read. Open issue/PR search remains empty. |
| Parented Tasks dispatch | Still absent; `runDispatch` receives no CLI context and the delegate spawn omits `parentThreadId`. |
| Durable per-thread composer draft | Still absent; the SDK explicitly says sidebar-wide thread state cannot report unsubmitted per-client drafts. |
| Explicit inverse HTTP navigation | Still absent; `UrlLink`/`openUrl` expose no explicit in-app or external intent, and the browser preference remains host-private. |
| Browser-capable left-sidebar URL host | Still absent; the enhanced thread-list remains under the app-wide URL host without a browser opener, unlike the right panel host. |

The SDK did add experimental sidebar-footer and plugin-app-URL surfaces. They
do not satisfy an existing requested feature or compatibility item, so this
audit intentionally did not create speculative work.

## Check later

- [ ] **ACP AskUserQuestion continuation (BBPLUG-334).** BB's local
  `ask-user-question` plugin now avoids holding an interactive MCP tool call
  open for every ACP provider (`providerId.startsWith("acp-")`). It returns
  immediately after showing the question, then delivers the submitted answer
  through `threads.send({ mode: "auto" })`; this prevents ACP
  clients from timing out and leaves no manual Resume step. It is deployed into
  BB 0.42.0 as of 2026-09-05 and cataloged with an exact source ref, patch,
  regression suite, and rollback artifacts in
  [`bb-plugins/ask-user-question/`](bb-plugins/ask-user-question/). On every
  BB release, run `npm run bb-plugins:sync`: remove this patch only when ACP
  guarantees a durable answer continuation, otherwise rebase it and retain its
  cross-provider test matrix.

- [ ] **Thread-filtered Tasks read (BBPLUG-252).** The sidebar currently has
  to read every active project task and call `listTaskThreads(taskId)` for each
  one. BB Tasks has an indexed `task_threads.thread_id` table, but its public
  API has no forward, thread-scoped read. Request an indexed endpoint such as
  `listTasksForThread({ threadId, statuses, includeCompleted, limit })` that
  returns task summaries and their linked threads in one operation. This is the
  prerequisite for a real long-task-list optimization; neither plugin-local
  caching nor a bulk reverse lookup fixes the initial scan. Open upstream
  searches found no matching issue or PR on 2026-09-05:
  [issues](https://github.com/search?q=repo%3Aget-bb%2Fbb+is%3Aopen+%22listTasksForThread%22&type=issues)
  and
  [pull requests](https://github.com/search?q=repo%3Aget-bb%2Fbb+is%3Aopen+%22listTasksForThread%22&type=pullrequests).
- [ ] **Parented builtin Tasks dispatch (BBPLUG-230).** Builtin
  `bb tasks dispatch` does not propagate the invoking thread ID as
  `parentThreadId`. Current workaround: use `bb thread spawn --parent-self
  --new-environment worktree`, then run `bb tasks attach <key>` from the
  spawned child. Remove this item when the Tasks delegate RPC and CLI forward
  `parentThreadId`. Related upstream issue:
  [#2836](https://github.com/get-bb/bb/issues/2836) covers spawn/handoff
  parenting, but it does not yet cover the Tasks dispatcher.
- [ ] **Durable per-thread composer draft.** The BB SDK/host does not provide
  durable composer-draft state for unselected thread rows, so the plugin cannot
  derive a draft indicator purely from host state across refresh. Current
  workaround in `features/threads/thread-attention.ts` uses `hasComposerDraft`
  when supplied, otherwise only legacy `draft`/`working-draft` row indicators;
  it never infers state from the mounted, selection-dependent composer. Remove
  this item when the SDK exposes durable per-thread draft metadata or an event.
  Related open issues [#1978](https://github.com/get-bb/bb/issues/1978) and
  [#2200](https://github.com/get-bb/bb/issues/2200) improve composer input and
  draft creation, respectively, but neither currently exposes row-level durable
  draft state to plugins.
- [ ] **Explicit inverse HTTP navigation.** Ordinary plugin `UrlLink`s and
  `openUrl` only honor BB's browser preference; the SDK neither exposes that
  preference nor a documented “open in BB browser” HTTP destination. The
  plugin can currently force only the external half of its optional
  Cmd/Ctrl-click behavior. Revisit when BB exposes (a) the effective
  in-app-browser preference and (b) explicit in-app and external HTTP intents,
  so modified PR links can reliably do the opposite and Settings can state the
  live result. Do not read or transiently mutate BB's private local-storage
  preference as a workaround. Upstream source as of SDK 0.4.47 stores this as
  `bb.openLinksInAppBrowser`; it is not a plugin contract.
- [ ] **Browser-capable left-sidebar URL host.** The enhanced thread-list
  slot is mounted beneath BB's app-wide `AppNavigationUrlHost`, whose
  `openInAppBrowser` callback is `null`; its otherwise identical `UrlLink`
  therefore opens HTTP URLs externally. The right Work/Changes panel is
  mounted beneath `UrlOpenRoutingProvider` with `openBrowser`, so it honors
  BB's in-app-browser preference. The plugin already uses the same
  `PullRequestUrlLink` wrapper on both surfaces. Revisit when BB gives the
  thread-list slot an in-app HTTP destination or exposes one through the SDK;
  do not use `window.open` as a normal-click workaround.
