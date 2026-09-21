# AskUserQuestion: ACP answer continuation

## Problem

ACP clients can time out an interactive MCP `tools/call` while the user is
reading the question. The form accepts a reply, but the expired tool call can
no longer return it to the waiting agent, requiring a manual Resume.

## Patch

For every provider with an ID beginning `acp-`, return after the question has
been rendered and retain `requestInput` without the original tool-call abort
signal. On submission, send the normalized answer to the same thread with
`threads.send({ mode: "auto" })`: it steers a live turn or starts an idle one.
Native-user-question providers remain excluded by their declared capability.

The normal host interaction is one form containing **one to four** independent
questions and returns one combined answer object. ACP calls append independent
questions to a per-thread inbox (bounded at 32). An overflowing batch is
rejected atomically rather than silently dropping questions. Each selected
answer is sent immediately while unanswered questions remain visible. The final
answer closes the display-only interaction without producing a duplicate
follow-up.

The source patch is [acp-continuation.patch](acp-continuation.patch). It adds
coverage for Cursor, OpenCode, and a custom ACP provider, plus dismissal.
The versioned release criteria and live smoke matrix are in
[TEST-PLAN.md](TEST-PLAN.md).

## BB 0.43.3 upgrade

- Target: `builtin:ask-user-question` inside BB `0.43.3`, SDK `0.4.104`.
- Verified source baseline: `desktop-v0.43.3` at
  `e865697f56bea89f3413dd4cc7fae964850d20a0`.
- BB now natively detaches ordinary `requestInput` calls and delivers their
  eventual result to the agent. The local patch is therefore plugin-only: it
  retains the ACP multi-call queue and auto-follow-up behavior, but no longer
  patches or deploys BB core artifacts.
- Preflight passed 45 serial plugin tests, typecheck, both plugin builds, and
  target-CLI artifact metadata validation.
- Deployed on 2026-09-21 with a version-matched rollback at
  `~/.bb/patch-backups/bb-0.43.3-2026-09-21T09-05-13-046Z`.

## Previous deployment

- BB 0.43.1 replaced all six built-in plugin `dist/*` artifacts plus
  `server/dist/start-server.js` and its source map.
- Historical 0.41.0 rollback payload:
  [`rollback/bb-0.41.0/`](rollback/bb-0.41.0/), verified by its
  [`manifest.json`](rollback/bb-0.41.0/manifest.json). The exact current
  0.43.1 pre-deploy payload is retained locally under `~/.bb/patch-backups/`;
  never apply the historical payload to a different BB version.
- Validation: 87 focused plugin tests, 108 focused core tests, plugin and core
  typechecks, builds, and exact staged/installed artifact checks. The previous
  release's live ACP Reply matrix remains the behavioral baseline.

## BB 0.43.1 upgrade

- Verified source baseline: `desktop-v0.43.1` at
  `267938526dfcbc0edb228ce827b5bec202c1af97`.
- Upstream moved ordinary question rendering and form state into shared UI,
  and moved request validation into SDK host policy. The continuation remains
  absent, so the patch was rebased to preserve the queue-aware form and extend
  the new normalized request path with the non-blocking flag.
- The preflight and deployment pass each passed 87 plugin tests and 108 core
  tests, both typechecks, and both builds. Installed core and plugin artifacts
  match the staged SHA-256 hashes exactly.

## BB 0.42.1 upgrade

- Verified source baseline: `desktop-v0.42.1` at
  `a4aa07f9ee3fdeb5716a26a368246ea1ef9e0b78`.
- BB 0.42.1 does not change this plugin, the relevant server tool-call path,
  or SDK 0.4.47. The patch still applies unchanged.
- The full 0.42.1 preflight and deployment pass each passed 101 core tests and
  87 plugin tests, both typechecks, and both builds. Verified BB 0.42.1 / SDK
  0.4.47 artifacts were deployed with a version-matched local backup; staged
  and installed checksums match exactly.

## Update procedure

1. Check whether ACP has gained a durable interactive-call continuation. If it
   has, remove this patch after a live Reply test.
2. Otherwise run the cataloged sync job from the repository root. It checks the
   installed BB version, clones the matching `desktop-v<version>` tag, verifies
   every patch, runs focused tests/typechecks, and stages the built artifacts.
3. Review the stage, then run `npm run bb-plugins:sync -- --deploy`. If an
   emergency rollback is needed, restore the version-matched payload in
   `rollback/bb-<version>/` after checking its manifest hashes.
4. Confirm one live ACP question and Reply resumes its agent, then update this
   document and the compatibility watchlist in
   [`docs/bb-compatibility-watchlist.md`](../../docs/bb-compatibility-watchlist.md).
