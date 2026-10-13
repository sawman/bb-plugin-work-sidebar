# BB 0.46.0 / SDK 0.6.37 audit

Date: 2026-10-13. Worker: BBPLUG-418. Canonical parent:
`898a9a3d84b8f18b1887dcbdc0679875d3e11aab`.
Release: `desktop-v0.46.0` at `4c87fdec7b7effc022ff2ee31ec95c0a09c9ee62`.
`source-manifest.json` records immutable URLs and SHA-256 of unmodified release
sources. `tag.json`, `issues.json`, `searches.json`, and `pr-searches.json`
record GitHub reads through sawman, with matthew-se restored and verified by
an EXIT trap. No pushes, installation, reload, or root-checkout edits.

The published SDK and exact source both identify 0.6.37. Compatibility floors
are BB >=0.46.0 and SDK >=0.6.37, enforced in package/lock metadata and tests. The public app export
removes `experimental_useSidebarThreadActions`; internal compatibility methods
remain in source and are not a supported exported plugin contract. Both sidebar
surfaces now use `useBbNavigate.toThread`/`toCompose`. Row title/pin/read writes
use the optimistic `useSdk().threads` methods. Archive/delete select the shipped
`bb--core/archive` and `bb--core/delete` actions, retaining BB's recursive
confirmation. The shared adapter passes the actual lifecycle target, handles
nullable environment IDs, and honors absent/disabled actions. SDK write
failures are contained with visible toasts; rejected rename/pin/unpin tests
protect fire-and-forget row handlers without copying host optimistic state. The deprecated
host `PluginThreadListProps.searchQuery` is ignored; plugin-local search remains.

No extra thread-action menu feature, host glyph, clipboard, terminal, or browser
feature is introduced. Existing Human decisions and BBPLUG-414 remain out of scope.

| Watchlist item | 0.46 disposition and exact-source evidence |
| --- | --- |
| ACP queue | Retain version-specific Questions patch. `plugins/ask-user-question/src/server.ts` still uses one requestInput; retain new timeout settings and describeSubmission plus ordinary persisted shared form. |
| Indexed thread Tasks read | Retain unchanged Tasks patch. `plugins/tasks/shared/contract.ts` has no listTasksForThread; separate open issue and PR searches returned zero. |
| Tasks CLI parent | Retain unchanged Tasks patch. CLI/delegate still omit calling thread; issue #2836 open, open PR search returned zero. |
| Automations personal project | Retire by root decision. Native GET route uses requirePublicProject; database lookup has no kind filter. Live proj_personal read succeeds with kind:personal (personal-project.json). Preserve historical patch only. |
| Explicit inverse HTTP intent | Still absent in SDK app contract: openUrl has no explicit browser/external intent or effective browser-preference getter. |
| Browser-capable left host | Still absent: App.tsx mounts AppNavigationUrlHost; URL routing defaults browser context to null. Right host supplies openBrowser. |

Issue #1978 remains closed (composer contract delivered in 0.45); #2200 and
#2836 remain open. Broad search hits are retained as evidence, not treated as
shipped equivalents. Focused open ACP queue and Tasks dispatcher PR searches
returned zero. Automations is retired; retained ACP and Tasks patches still lack native equivalents.

Regression coverage tests actual navigation and SDK calls, native lifecycle
routing, disabled/missing core actions, nullable environment targets, and both
left and right navigation. Questions adds a real 0.46-context ACP execution matrix: Cursor/OpenCode/custom provider resolution through threads.get, detached calls, auto-send, unanswered retention, atomic capacity rejection, prompt deduplication, failed-delivery retry, ordinary/missing-provider fallback, and global queued digit shortcuts. Upstream timeout/submission-summary tests remain. Final serial suite: 110 files / 812 tests pass without assertions or timeout
changes. Typecheck, SDKcheck, production build/bundle boundary, diff checks,
Questions51/Tasks412 preflight, and pristine Automations148 tests pass. Full
results: validation.json. Exact paths/checksums: artifacts.json. Live acceptance
is root-owned.
