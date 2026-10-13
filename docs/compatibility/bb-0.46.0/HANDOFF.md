# BBPLUG-418 root handoff

Reviewed production source: `c16ef2076e24dd8f16eb9e3073881d27fc463a83`.
Exact parent: `898a9a3d84b8f18b1887dcbdc0679875d3e11aab`.
This handoff/evidence is a separate follow-up commit with no production changes.

Work Sidebar is pinned to SDK 0.6.37 and requires BB >=0.46.0 / SDK >=0.6.37.
Both surfaces use host navigation, optimistic SDK writes, and core lifecycle
confirmation. Write errors produce a toast and settle safely. Deprecated host
search is ignored; local filtering remains. ACP queue tests exercise actual
0.46 tool contexts and queued shortcuts. Historical audits/patches are preserved.

Questions is rebased and retained. Tasks is retained unchanged. Automations is
retired for 0.46 by root decision based on immutable native API/DB evidence plus
successful live `proj_personal` read; pristine suite: 148 tests passing. Root
keeps the already-bundled Automations version. No remaining retirement decision
is required for this upgrade; outstanding watchlist gaps stay documented.

Final retained-patch preflight: Questions 51 tests and Tasks 412 tests, both
plugin typechecks/builds and target BB 0.46.0 / SDK 0.6.37 metadata checks pass.
Work Sidebar typecheck, SDKcheck, and production build pass. Final serial
integrated suite: 110 files / 812 tests pass in106.77s at default timeouts;
results are recorded in `validation.json`.

Earlier full-suite and follow-up concurrent runs exceeded the default 5-second
budget in existing compiler/import-graph tests; those tests pass in isolation
with unchanged assertions/default timeout. Root requested the final full serial
rerun after all preflight load stopped. No assertion or timeout was changed in
repository test code.

Patch stage:
`/Users/matthewsaw/.bb/patch-staging/bb-0.46.0-2026-10-13T05-56-48-377Z`.
Verified candidate source:
`/var/folders/2p/_p95gdmd3rv2qzzhs0h2y2th0000gn/T/bb-plugin-sync-0.46.0-MFtlNl/bb`.
Immutable local release checkout: `/tmp/bb046-audit-418`.
The earlier three-plugin candidate stage is superseded and must not be deployed.

All 12 patched artifacts byte-match the final candidate dist; version metadata
is checked. Archive and per-file pristine rollback hashes are verified for all
21 files across three built-ins. Complete absolute paths, patch hashes, and
SHA-256 values: [`artifacts.json`](artifacts.json). Version-matched rollback:
[`bb-plugins/rollback/bb-0.46.0`](../../../bb-plugins/rollback/bb-0.46.0/README.md).
Full logs are retained at the final stage's `validation/` directory.

Root-only catalog deployment command from the integrated checkout:

```sh
BB_PATCH_SOURCE_ROOT=/tmp/bb046-audit-418 npm run bb-plugins:sync -- --deploy
```

This rechecks immutable source and reruns preflight before deploying/reloading
only retained Questions and Tasks. Worker has performed no installation,
deployment, reload, push, automation creation, or root-checkout modification.
GitHub source/API reads ran through sawman, with an EXIT trap restoring and
verifying matthew-se even on failure; root was notified when those reads finished.
BBPLUG-418 remains in_progress; root owns integration/live acceptance/completion.

Warnings: existing Node DEP0205 during builders; release-monorepo install warns
about not-yet-built bins. No plugin compiler/CSS warning. npm production audit
is clean. Existing dev-only Hono moderate, source-map-js high, Undici high
findings remain; their lock entries are unchanged from canonical parent. No
unrelated dependency updates or audit fixes were applied.

Changed files:

- `.bb/AGENTS.md`
- `bb-plugins/README.md`
- `bb-plugins/ask-user-question/README.md`
- `bb-plugins/ask-user-question/TEST-PLAN.md`
- `bb-plugins/ask-user-question/acp-continuation-v0.46.patch`
- `bb-plugins/automations/README.md`
- `bb-plugins/registry.json`
- `bb-plugins/rollback/bb-0.46.0/README.md`
- `bb-plugins/rollback/bb-0.46.0/ask-user-question.tar.gz`
- `bb-plugins/rollback/bb-0.46.0/automations.tar.gz`
- `bb-plugins/rollback/bb-0.46.0/manifest.json`
- `bb-plugins/rollback/bb-0.46.0/tasks.tar.gz`
- `bb-plugins/tasks/README.md`
- `components/threads/archived-thread-row.tsx`
- `docs/bb-compatibility-watchlist.md`
- `docs/compatibility/bb-0.46.0/HANDOFF.md`
- `docs/compatibility/bb-0.46.0/README.md`
- `docs/compatibility/bb-0.46.0/artifacts.json`
- `docs/compatibility/bb-0.46.0/issues.json`
- `docs/compatibility/bb-0.46.0/personal-project.json`
- `docs/compatibility/bb-0.46.0/pr-searches.json`
- `docs/compatibility/bb-0.46.0/searches.json`
- `docs/compatibility/bb-0.46.0/source-manifest.json`
- `docs/compatibility/bb-0.46.0/tag.json`
- `docs/compatibility/bb-0.46.0/validation.json`
- `features/agents/agent-row.tsx`
- `features/agents/tests/view.test.tsx`
- `features/threads/recycle-bin-view.tsx`
- `features/threads/sidebar-controller.tsx`
- `features/threads/tests/archived-thread-row.test.tsx`
- `features/threads/tests/left-slot-parity.test.tsx`
- `features/threads/tests/thread-row-characterization.test.tsx`
- `features/threads/tests/thread-row-split.test.tsx`
- `features/threads/tests/thread-row.test.tsx`
- `features/threads/use-thread-row-actions.ts`
- `package-lock.json`
- `package.json`
- `scripts/bb-plugin-patch-sync.mjs`
- `shared/use-thread-controls.test.tsx`
- `shared/use-thread-controls.ts`
- `tests/architecture/package-contract.test.ts`
- `tests/utils/thread-controls-host.ts`
