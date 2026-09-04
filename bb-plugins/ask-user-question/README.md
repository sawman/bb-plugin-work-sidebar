# AskUserQuestion: ACP answer continuation

## Problem

ACP clients can time out an interactive MCP `tools/call` while the user is
reading the question. The form accepts a reply, but the expired tool call can
no longer return it to the waiting agent, requiring a manual Resume.

## Patch

For every provider with an ID beginning `acp-`, return after the question has
been rendered and retain `requestInput` without the original tool-call abort
signal. On submission, send the normalized answer to the same thread with
`threads.send({ mode: "steer-if-active" })`. Native-user-question providers
remain excluded by their declared capability.

The source patch is [acp-continuation.patch](acp-continuation.patch). It adds
coverage for Cursor, OpenCode, and a custom ACP provider, plus dismissal.

## Current deployment

- Target: `builtin:ask-user-question` inside BB `0.41.0`, SDK `0.4.34`.
- Verified source baseline: `desktop-v0.41.0` at
  `ee4a5777bf1efb255a87cd9dc91fd3ae92830268`.
- Installed files replaced: `dist/server.js`, `dist/server.js.map`, and
  `dist/server.meta.json` only.
- Canonical rollback payload:
  [`rollback/bb-0.41.0/`](rollback/bb-0.41.0/), verified by its
  [`manifest.json`](rollback/bb-0.41.0/manifest.json). The local pre-deploy
  copy under `~/.bb/patch-backups/` is only a convenience mirror.
- Validation: 42 focused plugin tests, core route test, plugin and core
  typechecks, build, installed-artifact inspection, and built-in plugin reload.

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
   document and the compatibility watchlist in [`TODO.md`](../../TODO.md).
