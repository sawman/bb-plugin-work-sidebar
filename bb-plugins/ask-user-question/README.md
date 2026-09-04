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
- Source commits in `/Users/matthewsaw/dev/bb`: `9f0b0a7a4` then
  `cc1a52e66`.
- Installed files replaced: `dist/server.js`, `dist/server.js.map`, and
  `dist/server.meta.json` only.
- Canonical rollback payload:
  [`rollback/bb-0.41.0/`](rollback/bb-0.41.0/), verified by its
  [`manifest.json`](rollback/bb-0.41.0/manifest.json). The local pre-deploy
  copy under `~/.bb/patch-backups/` is only a convenience mirror.
- Validation: focused plugin tests (42), typecheck, build, installed-artifact
  inspection, and built-in plugin reload.

## Update procedure

1. Check whether ACP has gained a durable interactive-call continuation. If it
   has, remove this patch after a live Reply test.
2. Otherwise apply/rebase the source patch against the updated BB checkout,
   run its focused test, typecheck, and `bb plugin build .`.
3. Back up the current built-in `dist/server*` artifacts under a new dated
   `~/.bb/patch-backups/` directory, replace those three server artifacts, and
   run `bb plugin reload ask-user-question`. If an emergency rollback is
   needed before an update, restore the version-matched payload in
   `rollback/bb-<version>/` after checking its manifest hashes.
4. Confirm one live ACP question and Reply resumes its agent, then update this
   document and the compatibility watchlist in [`TODO.md`](../../TODO.md).
