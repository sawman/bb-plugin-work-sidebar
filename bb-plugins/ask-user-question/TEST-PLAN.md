# AskUserQuestion test plan

This is the release gate for the locally maintained `ask-user-question` patch.
It covers the BB core route, the built-in plugin, deployed artifacts, and the
real ACP continuation path. A green plugin unit suite alone is not sufficient:
the `providerId` incident was caused by a core/plugin artifact skew.

## Release rule

Do not accept or deploy a new patch candidate until every automated gate
below passes against the exact `desktop-v<installed-version>` source commit.
After deployment, complete the live smoke matrix before considering the patch
active. Record the BB version, source commit, artifact hashes, commands, and
results in the versioned rollback manifest or the related BB Task evidence.

## Automated gates

`npm run bb-plugins:sync` owns immutable-source, dependency, mandatory Tasks
behavior, retained-plugin suite/typecheck/build and metadata gates. Since 0.43.3
Questions is plugin-only: no core artifact is patched or staged. Run the core
type/interaction/dispatch/tool-route checks below separately against the same
exact source and record their results before accepting any stage for deployment.
A successful sync is not evidence those supplementary core checks ran.

| Layer | Required proof |
| --- | --- |
| Source provenance | Installed BB version matches the catalog; the cloned tag resolves to the pinned commit; every patch passes `git apply --check`. |
| Dependencies | `pnpm install --frozen-lockfile` completes before any patched-core build or test. |
| Core types | `turbo run typecheck --filter=@bb/server --force` passes after patches apply. |
| Core interaction behavior | Focused pending-interaction tests prove a blocking interaction gates messages and a non-blocking plugin form remains pending while messages dispatch. |
| Core dispatch states | Focused thread-dispatch tests send an ACP answer to idle and active/running threads, prove ordinary forms still produce an `interaction` wait, and prove a real provider-capacity wait remains a provider/plugin wait rather than being masked by the question form. |
| Core tool route | Focused internal tool-call tests verify current host plugin context/dispatch. The plugin supports a provided provider ID and safely reads the thread when absent; both paths are covered separately. |
| Plugin types | `turbo run typecheck --filter=bb-plugin-ask-user-question --force` passes. |
| Plugin behavior | Focused plugin tests cover ordinary blocking calls and ACP non-blocking calls, provider lookup fallback, validation, queueing, answer delivery, dismissal, and final-form cleanup. |
| Built artifact | `bb plugin build .` emits all six plugin artifacts with the expected plugin ID and BB version. Core artifacts are required only when explicitly cataloged for that historical release; the current plan has none. |
| Artifact boundary | The staged manifest lists exactly the cataloged plugin and core targets, and every staged file exists and has a recorded hash. |

The sync script must apply patches before builds and install frozen dependencies
before Turbo. It stages only in current use. Never use its historical unchecked
`--deploy` path. The strict artifact verifier and exact release's
[deployment runbook](../../docs/compatibility/bb-0.49.0/DEPLOYMENT-READY.md)
are mandatory. Core guard failures block acceptance even if artifacts were staged.

## Required behavioral corpus

These tests belong in the pinned BB source patch, not only in this repository.

### Provider and call modes

| Case | Expected result |
| --- | --- |
| Native provider with a user-question capability | Plugin tool is hidden; the provider retains its native question behavior. Non-ACP providers without native questions use the ordinary shared form and combined result. |
| `acp-cursor`, `acp-opencode`, and another arbitrary `acp-*` provider | Tool returns promptly with the pending acknowledgement; form remains visible; no timeout. |
| ACP context includes `providerId` | ACP mode is selected without an extra thread read. |
| Host context omits `providerId` (current supported SDK path) | Plugin reads the thread provider safely; it never calls `startsWith` on `undefined`. |
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

### Exhaustive bounded queue matrix

The implementation accepts 1–4 questions per call and stores at most 32
unanswered ACP questions per thread. The automated suite must exercise the
entire boundary, not only a representative happy path:

| Dimension | Required values |
| --- | --- |
| Questions in one tool call | 1, 2, 3, 4 |
| Existing queue depth before a call | 0, 1, 28, 29, 30, 31, 32 |
| Incoming unique count | 1, 2, 3, 4 |
| Capacity result | Every sum `<= 32` is accepted in insertion order; every sum `> 32` is rejected atomically with the existing queue byte-for-byte unchanged. |
| Duplicate prompt | Repeating a prompt neither consumes capacity nor changes ordering/version beyond the defined no-op semantics. |
| Answer position | First, middle, and final queue entries; after each answer, only that entry is removed and all survivors retain order. |
| Answer selection | One option, multiple options, free text, empty, unknown option, duplicate option, malformed result. |
| Delivery outcome | Success, rejection, delayed resolution, two concurrent submits, and retry after rejection. |

Use deterministic generated cases for the cartesian boundary table above
(seeded/explicit loops, not time-dependent randomness). Every generated case
must assert the queue IDs, version monotonicity, send count, and surviving
contents. A failure must print the seed/case tuple for exact reproduction.

### Dispatch and lifecycle

| Case | Expected result |
| --- | --- |
| Non-blocking form is pending | `hasPendingThreadInteraction` is false for dispatch gating, while interaction-list/UI still exposes the form. |
| Answer arrives while agent is idle | `threads.send({ mode: "auto" })` starts/steers the agent without manual Resume. |
| Answer arrives while agent is actively working | The answer is delivered as a follow-up without cancelling unrelated work. |
| Answer arrives while a normal blocking interaction exists | The normal interaction retains its existing dispatch semantics; no bypass is introduced. |
| Plugin reload / server restart with queued questions | Not a persistence guarantee: ACP queue is in memory and disposal interrupts pending/resolving plugin forms. Defer Questions writes/reload until the native zero-form gate passes; do not manufacture zero or run a destructive live probe. |
| Abort signal from original ACP tool call | The non-blocking request is retained and can still be answered after the tool call has returned. |
| Original tool-call timeout | The same as abort: a later inbox answer is accepted and sent exactly once; the original timeout must never cancel the display-only form. |
| Queue delivery while provider is unavailable | The question is retained after `threads.send` rejects; one explicit retry sends it once when delivery recovers. |
| Queue delivery while a thread is running/thinking | `mode: "auto"` follows the existing join/steer path; the form adds no `interaction` wait. |
| Queue delivery while core has a real blocker | The message keeps its real wait reason (provider capacity, provisioning, busy turn, or a normal user interaction) and is drained only by core's ordinary lifecycle. |

## Deployment and rollback smoke matrix

Root runs this only after the exact release's strict artifact verification,
zero-form disposal gate, reviewed deployment and plugin reload. Plugin-only
patches need no BB restart. Source builds do not certify live acceptance.

1. Confirm the complete installed plugin sets match the accepted artifact and
   pristine manifests. Check core artifacts only for a historical release whose
   catalog explicitly includes them; current Questions/Tasks are plugin-only.
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

Before root deployment, the strict verifier checks and backs up all three
complete plugin sets. On a failed smoke step:

1. Preserve any user forms and pass the Questions zero-form disposal gate before
   Questions restoration writes and again before its reload. Never clear forms
   or assume byte rollback restores an in-memory queue.
2. Restore only the exact release's verified full-set backup or pristine rollback
   archives; verify every hash and exact directory membership. Current plugin-only
   patches require plugin reload, not a BB restart. Historical core restore/restart
   applies only where that release explicitly cataloged core artifacts.
3. Record rollback/readback and the remaining live acceptance gap in the owning
   BB Task. Root owns any further smoke; no new live form is required for this
   worker's source audit. Do not retry until the failure has a regression test.

## BB 0.46.0 automated execution coverage

`src/acp-queue.test.ts` in the version-specific patch now executes the real
plugin through the SDK 0.6.37 harness with its actual tool context (which has
no providerId). It verifies thread-provider fallback for Cursor, OpenCode, and
custom ACP providers; detached calls; auto-mode delivery; remaining unanswered
questions; queue capacity and atomic rejection; deduplication; delivery retry;
and ordinary/failed-provider lookup paths. `app.test.tsx` explicitly exercises
the queued global-digit shortcut. Earlier preflight counts alone did not prove
this matrix; historical counts are preserved as historical evidence.
