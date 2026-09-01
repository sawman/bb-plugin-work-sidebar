# BBPLUG-231 remediation worklog

## Red

- Added executable timing coverage for a same-value external revert with a newer saved-source version.
- Added CSS architecture coverage requiring compact settings-row typography and layout to be primitive-owned rather than selected through the Threads feature.
- Both characterizations fail at the baseline: the editor cannot observe a newer same-value source event, and no semantic compact-row primitive selector exists.

## Green

- Added a saved-source version to the numeric editor and passed TanStack Query's `dataUpdatedAt` from both appearance surfaces, so a newer same-value revert is no longer mistaken for the pre-save echo.
- Made `ws-settings-row[data-layout="compact"]` the primitive-owned compact variant and removed Threads descendant typography/layout selectors.
- Moved work-context RPC projection schemas to the browser-safe work-context slice, restored the recently compressed execution-binding formatting, and kept `contracts.schemas.ts` below the original 250-line and 240-character gates with a 210-line headroom guard.

## Validation

- Focused suite run twice: 7 files / 56 tests passed each time.
- Final serial suite run twice: 86 files / 504 tests passed each time.
- `npm run typecheck`, `bb plugin types --check .`, `npm run build`, and `git diff --check` passed.
- Final app-bundle inspection found no `better-sqlite3`, `hono`, `@get-bb/plugin-sdk/server`, `defineRpcContract`, or `zod`; it contains one `"react"` literal.
- Build emitted only Node's known `DEP0205` deprecation warning. No reload, push, or merge was performed.
