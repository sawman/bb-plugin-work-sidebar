# BB COMPATIBILITY WATCHLIST

This is compatibility documentation only, not the repository work queue. BB Tasks remains the source of truth for repository work.

## Release-check procedure

When BB releases a new version, verify its Tasks plugin and SDK surface before
removing any item below. Re-run the linked searches against the current open
issues and pull requests, then confirm the shipped API through a typed plugin
test—not just a changelog entry.

Last checked: 2026-09-23 against BB 0.43.4 / SDK 0.5.9.

## BB 0.43.4 audit

Audited immutable `desktop-v0.43.4` source at
`9b8c1d3457b00359af206e3fd423fe50520182c2` and SDK 0.5.9. The three
cataloged built-in patches still apply and passed their exact-version plugin
tests, typechecks, builds, and artifact checks. They were deployed and reloaded
with rollback backup
`~/.bb/patch-backups/bb-0.43.4-2026-09-23T09-34-46-940Z`.

The SDK removed `PluginThreadListProps.Original` and added required sidebar
thread/project fields. Work Sidebar has been migrated, rebuilt, and reloaded;
its 773 tests, typecheck, and SDK check pass. SDK 0.5.9 also adds
`useSidebarThreadDraft(threadId)` and `useSidebarThreadDraftIds()`, satisfying
the missing host API for per-client unsent drafts even on unselected rows.
Adopting those hooks in our draft indicator is tracked as BBPLUG-406. The
remaining navigation and Tasks API gaps were not shown to be fulfilled, so
their workarounds remain.

## BB 0.43.3 audit

Audited immutable `desktop-v0.43.3` source at
`e865697f56bea89f3413dd4cc7fae964850d20a0` and SDK 0.4.104. The host now
detaches ordinary `requestInput` calls and delivers eventual answers to the
agent, so the AskUserQuestion patch no longer modifies or deploys core server
artifacts. Its ACP multi-call queue remains a plugin-local capability and is
therefore retained. Automations still needs the personal-project lookup
fallback. Tasks still lacks both the bounded indexed thread-task RPC and
caller-thread forwarding from `bb tasks dispatch`; its patch was reimplemented
against the new declarative CLI surface.

Preflight passed the cataloged serial suites—AskUserQuestion 45, Automations
105, Tasks 393—plus each plugin's typecheck, build, and target-CLI artifact
metadata check. All three artifacts were deployed and reloaded on 2026-09-21;
the version-matched rollback is
`~/.bb/patch-backups/bb-0.43.3-2026-09-21T09-05-13-046Z`. No watchlist item
was fulfilled. The SDK pin is updated to 0.4.104; Work Sidebar's own type
check is clean.

## BB 0.43.1 audit

Audited immutable `desktop-v0.43.1` source at
`267938526dfcbc0edb228ce827b5bec202c1af97` and the SDK 0.4.87 declarations.
None of the six watchlist items is fulfilled. AskUserQuestion moved ordinary
form rendering into shared UI but still lacks durable non-blocking ACP answer
continuation; Automations still rejects a personal project during creation;
Tasks still lacks the indexed thread read and CLI parent forwarding. The SDK
still explicitly excludes per-thread draft state from the array-wide sidebar
view and still exposes only preference-following HTTP URL navigation.

All three patches were rebased, preflighted, deployed with a version-matched
backup, and activated by restarting only BB's server child. Tests passed for
AskUserQuestion (87 plugin and 108 core), Automations (81), and Tasks (391),
with typecheck/build gates and exact staged/installed SHA-256 parity. Work
Sidebar is pinned to SDK 0.4.87. Issues #1978, #2200, and #2836 remain open;
repository searches found no issue or pull request for `listTasksForThread` or
the ACP continuation.

## BB 0.42.1 audit

Audited the immutable `desktop-v0.42.1` source at
`a4aa07f9ee3fdeb5716a26a368246ea1ef9e0b78`. The release leaves the three
patched built-in plugin areas and SDK 0.4.47 unchanged from 0.42.0, and all
three patches apply without modification. No watchlist item is fulfilled.
Issues #1978, #2200, and #2836 remain open, and current repository searches
found no open issue or pull request for `listTasksForThread` or the ACP answer
continuation.

The running CLI and host now report 0.42.1. The cataloged preflight and deploy
were rerun against the immutable release source; AskUserQuestion, Automations,
and Tasks artifacts were installed with a version-matched backup and exact
staged/installed checksum parity. SDK 0.4.47 remains aligned with this plugin.
Issues #1978, #2200, and #2836 remain open as of 2026-09-11, and refreshed
repository searches still find no open issue or pull request for
`listTasksForThread` or the ACP answer continuation.

## BB 0.42.0 audit

Audited the immutable `desktop-v0.42.0` source at
`960255b98ce3dccdcb5754eb67a7f989236602a1`, the installed SDK declarations,
and the linked upstream searches. No watchlist item is fulfilled in this
release, so no replacement feature task was created.

| Watchlist item | 0.42.0 result |
| --- | --- |
| ACP AskUserQuestion continuation | Still absent upstream; the local patch was rebased, tested, deployed, and BB restarted. |
| Thread-filtered Tasks read | Still absent upstream. The local Tasks patch now supplies the indexed read while this remains on the watchlist. |
| Parented Tasks dispatch | Still absent upstream. The local Tasks patch now forwards the CLI caller thread while this remains on the watchlist. |
| Durable per-thread composer draft | Still absent; the SDK explicitly says sidebar-wide thread state cannot report unsubmitted per-client drafts. |
| Explicit inverse HTTP navigation | Still absent; `UrlLink`/`openUrl` expose no explicit in-app or external intent, and the browser preference remains host-private. |
| Browser-capable left-sidebar URL host | Still absent; the enhanced thread-list remains under the app-wide URL host without a browser opener, unlike the right panel host. |

The SDK did add experimental sidebar-footer and plugin-app-URL surfaces. They
do not satisfy an existing requested feature or compatibility item, so this
audit intentionally did not create speculative work.

## Check later

- [ ] **ACP AskUserQuestion queue (BBPLUG-334).** BB now guarantees detached
  ordinary question continuations, but does not provide the ACP-specific
  multi-call queue that keeps unanswered questions visible while each submitted
  answer immediately reaches the agent. The local plugin-only patch supplies
  that queue (maximum 32 questions) and `threads.send({ mode: "auto" })`
  follow-up. It is cataloged against BB 0.43.4 with an exact source ref,
  regression suite, and rollback artifacts in
  [`bb-plugins/ask-user-question/`](bb-plugins/ask-user-question/). On every
  BB release, run `npm run bb-plugins:sync`: remove this patch only when ACP
  provides equivalent queueing and auto-follow-up behavior, otherwise rebase
  it and retain its cross-provider test matrix.

- [ ] **Thread-filtered Tasks read (BBPLUG-252).** Upstream BB Tasks still
  lacks a thread-scoped indexed read. The deployed local Tasks patch supplies
  `listTasksForThread({ threadId, statuses, includeCompleted, limit })` over
  the indexed `task_threads.thread_id` path, returning summaries and matching
  links in one bounded operation. Work Sidebar has not yet migrated its
  project-wide Tasks pane to use it; that requires a separate product decision.
  Remove the patch only after upstream exposes the equivalent. Open upstream
  searches found no matching issue or PR on 2026-09-05:
  [issues](https://github.com/search?q=repo%3Aget-bb%2Fbb+is%3Aopen+%22listTasksForThread%22&type=issues)
  and
  [pull requests](https://github.com/search?q=repo%3Aget-bb%2Fbb+is%3Aopen+%22listTasksForThread%22&type=pullrequests).
- [ ] **Parented builtin Tasks dispatch (BBPLUG-230).** Upstream builtin
  `bb tasks dispatch` still drops the invoking thread ID. The deployed local
  Tasks patch forwards the CLI context through the delegate RPC to
  `threads.spawn({ parentThreadId })`, so standard dispatch now produces a
  child thread. Retire the patch when upstream ships the same lifecycle.
  Related upstream issue:
  [#2836](https://github.com/get-bb/bb/issues/2836) covers spawn/handoff
  parenting, but it does not yet cover the Tasks dispatcher.
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
