# AskUserQuestion: ACP answer continuation

## Problem

ACP clients can time out an interactive MCP `tools/call` while the user is
reading the question. The form accepts a reply, but the expired tool call can
no longer return it to the waiting agent, requiring a manual Resume.

## Patch

For every provider with an ID beginning `acp-`, return after the question has
been rendered and retain `requestInput` without the original tool-call abort
signal. The core patch marks that interaction non-blocking: it remains visible
but does not stop thread message dispatch. On submission, send the normalized
answer to the same thread with `threads.send({ mode: "auto" })`: it steers a
live turn or starts an idle one. Native-user-question providers remain excluded
by their declared capability.

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

## Current deployment

- Target: `builtin:ask-user-question` inside BB `0.41.0`, SDK `0.4.34`.
- Verified source baseline: `desktop-v0.41.0` at
  `ee4a5777bf1efb255a87cd9dc91fd3ae92830268`.
- Installed files replaced: all six built-in plugin `dist/*` artifacts plus
  `server/dist/start-server.js` and its source map. Restart BB after deploying
  the core artifact.
- Canonical rollback payload:
  [`rollback/bb-0.41.0/`](rollback/bb-0.41.0/), verified by its
  [`manifest.json`](rollback/bb-0.41.0/manifest.json). The local pre-deploy
  copy under `~/.bb/patch-backups/` is only a convenience mirror.
- Validation: 87 focused plugin tests, 72 focused core tests, plugin and core
  typechecks, builds, installed-artifact inspection, and a live ACP Reply
  round-trip.

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
