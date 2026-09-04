# AskUserQuestion test plan

This is the release gate for the locally maintained `ask-user-question` patch.
It covers the BB core route, the built-in plugin, deployed artifacts, and the
real ACP continuation path. A green plugin unit suite alone is not sufficient:
the `providerId` incident was caused by a core/plugin artifact skew.

## Release rule

Do not deploy a new BB version or edit this patch until every automated gate
below passes against the exact `desktop-v<installed-version>` source commit.
After deployment, complete the live smoke matrix before considering the patch
active. Record the BB version, source commit, artifact hashes, commands, and
results in the versioned rollback manifest or the related BB Task evidence.

## Automated gates

Run these through `npm run bb-plugins:sync`; it must stop before staging if
any gate fails.

| Layer | Required proof |
| --- | --- |
| Source provenance | Installed BB version matches the catalog; the cloned tag resolves to the pinned commit; every patch passes `git apply --check`. |
| Dependencies | `pnpm install --frozen-lockfile` completes before any patched-core build or test. |
| Core types | `turbo run typecheck --filter=@bb/server --force` passes after patches apply. |
| Core interaction behavior | Focused pending-interaction tests prove a blocking interaction gates messages and a non-blocking plugin form remains pending while messages dispatch. |
| Core tool route | Focused internal tool-call test proves a provider ID reaches the plugin context on current BB; plugin fallback is separately tested with that field absent. |
| Plugin types | `turbo run typecheck --filter=bb-plugin-ask-user-question --force` passes. |
| Plugin behavior | Focused plugin tests cover native blocking calls and ACP non-blocking calls, provider lookup fallback, validation, queueing, answer delivery, dismissal, and final-form cleanup. |
| Built artifact | `bb plugin build .` emits all six plugin artifacts with the expected plugin ID and BB version. The patched core build emits both cataloged core artifacts. |
| Artifact boundary | The staged manifest lists exactly the cataloged plugin and core targets, and every staged file exists and has a recorded hash. |

The sync script must apply patches **before** building the core and must install
dependencies **before** invoking Turbo. It stages only; `--deploy` is a
separate, reviewed action.

## Required behavioral corpus

These tests belong in the pinned BB source patch, not only in this repository.

### Provider and call modes

| Case | Expected result |
| --- | --- |
| Native provider with a user-question capability | One host form; tool waits; answer returns the normal combined answer object. |
| `acp-cursor`, `acp-opencode`, and another arbitrary `acp-*` provider | Tool returns promptly with the pending acknowledgement; form remains visible; no timeout. |
| ACP context includes `providerId` | ACP mode is selected without an extra thread read. |
| Older host context omits `providerId` | Plugin reads the thread provider safely; it never calls `startsWith` on `undefined`. |
| Provider lookup fails | No crash; safe blocking behavior is used and an informational log is emitted. |
| Non-ACP provider | Existing blocking behavior is unchanged. |

### Queue and answer delivery

| Case | Expected result |
| --- | --- |
| One ACP question | Selecting one option sends exactly one normalized answer to the same thread in `auto` mode. |
| Several separate ACP calls | They accumulate in one per-thread inbox up to 32 entries; no already-visible question is removed. |
| Answer first of several entries | Only that answer is delivered; remaining entries remain visible and answerable. |
| Answer final entry | The answer is delivered once, then the display-only interaction is cancelled/closed. |
| Multiple selection | The sent payload preserves every selected option in deterministic option order. |
| Invalid question ID, option ID, duplicate selection, malformed payload | RPC rejects with a user-safe validation error; queue and existing answers are unchanged. |
| Queue full | The next tool call fails clearly without mutating the existing inbox. |
| Dismiss | No answer is sent and queued state is cleaned up as defined by the UX. |
| Double click / concurrent answer | At most one message is sent for that question; the second response is a harmless stale/not-found result. |

### Dispatch and lifecycle

| Case | Expected result |
| --- | --- |
| Non-blocking form is pending | `hasPendingThreadInteraction` is false for dispatch gating, while interaction-list/UI still exposes the form. |
| Answer arrives while agent is idle | `threads.send({ mode: "auto" })` starts/steers the agent without manual Resume. |
| Answer arrives while agent is actively working | The answer is delivered as a follow-up without cancelling unrelated work. |
| Answer arrives while a normal blocking interaction exists | The normal interaction retains its existing dispatch semantics; no bypass is introduced. |
| Plugin reload / server restart with queued questions | Queue persistence and post-restart answer delivery behave according to the stored interaction state; no duplicate messages. |
| Abort signal from original ACP tool call | The non-blocking request is retained and can still be answered after the tool call has returned. |

## Deployment and rollback smoke matrix

Run this against the installed artifacts after `npm run bb-plugins:sync -- --deploy`
and a BB restart. Do not claim success from a source build alone.

1. Confirm the installed built-in plugin and core `start-server` contain the
   expected patch markers and their hashes match the staged manifest.
2. Spawn a disposable `acp-cursor` child thread in a managed worktree.
3. Have it ask one question, submit an answer through the **rendered UI Send
   button**, and confirm the agent prints/acts on the answer without Resume.
4. Repeat with two independent tool calls. Answer only the first; confirm the
   second stays on screen and the first agent message is delivered immediately.
   Answer the second and confirm the form closes with no duplicate follow-up.
5. Exercise Cancel/Dismiss and confirm no agent follow-up is sent.
6. Check server logs for no `startsWith`, timeout, or unhandled RPC errors.
7. Repeat the single-question path with one non-ACP provider to confirm the
   standard blocking flow did not regress.
8. Archive the disposable workers and record the evidence.

If a physical UI test cannot run because the desktop is locked, record that
blocker explicitly. An exact production RPC plus an agent-delivery smoke is
useful evidence, but does not replace the next available rendered-button test.

## Rollback

Before deployment, the sync command backs up every cataloged plugin and core
artifact. On any failed smoke step:

1. Restore the version-matched backup files, including `start-server.js` and
   its map when core artifacts were deployed.
2. Restart BB.
3. Confirm the old artifact hashes and run one native question smoke.
4. Leave the incident and rollback evidence on the related BB Task; do not
   retry a deployment until the failed case has a regression test.
