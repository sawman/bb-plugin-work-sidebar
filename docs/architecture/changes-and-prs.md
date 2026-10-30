# Changes and pull-request data

The left authored PR list, thread badges and right Changes panel share PR
identity and presentation infrastructure. Local worktree state, GitHub facts,
remote topology and file snapshots have different authorities. Preserve these
boundaries when changing loading or refresh behavior.

## Authorities and readiness

- BB owns thread-to-environment discovery. Native `bb--github-pr-status`
  keyed rows own branch PR discovery, reactive freshness and host API-budget
  caches. Only disclosed thread rows and the active Changes environment opt in;
  there is no eager all-thread PR request. Concurrent server enrichment reads
  coalesce only while pending; there is no settled duplicate host projection
  cache. Thread-local Stack overlays retain their existing authority.
- Native frontend rows pass the browser-safe provider schema before canonical
  fact hydration. Confirmed `absent` clears that thread's association;
  unavailable, malformed, missing and disabled-plugin results remain explicit
  errors with retry and retain known associations. SDK 0.6.79 rejects an entire
  keyed batch when a key is omitted, so that case reports a shared native read
  error; malformed present rows are isolated individually. Repository, thread
  controls and Work/Tasks cards remain independent. A failed PR summary may
  expose the local Stack projection with the error still visible; it never
  promotes enrichment to remote PR identity authority.
- Repository readiness, PR summary and enrichment are independent queries.
  Local changes can paint before remote enrichment. A truly cold PR summary
  still needs host/remote discovery; cached paint requires a known association.
- One bounded Query PR-fact directory owns lifecycle, title, head/base,
  checks/review and per-record observation time. Detailed facts take precedence
  over lightweight authored/stack envelopes for metadata and signals; light
  reads can seed absent facts but must not refresh detailed observation time.
  Merged lifecycle is irreversible for the same repository/PR identity: a
  merged Stack member promotes an older open fact without replacing detailed
  metadata, signals or their observation time. Later stale open reads cannot
  reopen it. Closed and draft remain reversible through detailed updates.
  Rendering preserves that merged lifecycle even before fact hydration. The
  authored open roster removes known merged/closed roots while retained Stack
  members keep their lifecycle and resolve the same shared facts.
  Thread/Stack overlays must match the repository/PR fact key before affecting
  another PR's status. Retained merged/closed authored rows disable draft
  conversion, using the same resolved lifecycle as their status badge.
  Confirmed no-PR clears stale associations. Keys use repository/PR identity
  with URL fallback; the directory caps facts at 500 and roster references at
  1,000. Do not copy this data into Zustand or another projection cache.
- Remote-only repository topology and PR files may be shared across threads.
  Raw topology seeds carry discovery/order, not a second computed status
  directory. The left authored projection filters open PRs and archived
  repositories; actual stack members can include merged/closed PRs.
- Current checkout, stash, rebase, extra local branches and every gh-stack
  response remain thread-local overlays. A remote cache must not carry them
  between worktrees. Local checkout/diff invalidation remains local.

The current detailed-fact precedence has a known age-cutoff gap; it is not a
freshness guarantee. See unresolved findings below.

## Cache and refresh contract

Central Query policies retain the 30-second Changes stale window and finite
GC. Server GitHub read caching, in-flight deduplication and REST/GraphQL
backoff protect the shared API budget across windows. A client Query cache
does not replace that server authority. GitHub-classified failures do not
trigger extra client retries. Configurable active/background/authored polling
and explicit refresh retain their distinct scopes.

Remote topology retention is at most 30 seconds and cannot outlive the raw
discovery inputs' 120-second expiry. File snapshots retain at most ten
minutes, 128 entries and 8 MiB, keyed by repository, PR and head/base branch
refs. Each record carries the actual SHA pair for validation and immutable
diff reuse; lower-level diff reads are scoped by that SHA pair. Cache hits do
not extend the 120-second upstream validation deadline.
Initial or changed revisions read metadata/files/metadata to reject races;
stable deadline revalidation can reuse an immutable SHA-pair diff. Selected
patches use that PR's SHA pair, with expected-head guards.

Manual, fingerprint, realtime and PR mutations retire related semantic/raw
generations. Cancelled/late reads cannot republish retired data. A pending-only
coordinator coalesces the same broadcast and concurrent manual refresh; a new
signal needs a successor even if the current pass fails. Unknown associations
use explicit thread-scoped retirement, preserving unrelated reads and the
authored base-search cache. Refresh failures surface through existing error
boundaries and allow retry. Disposal clears pending ownership and caches.

## Interaction and status

PR disclosure expands that PR's files; checkout is a separate action. Keep
disclosure stable by PR identity across summary/enrichment. Missing expanded
files remain loading while enrichment is pending. Current/uncommitted files
open through host diff/source rendering. No second diff renderer is owned here.
Authored title activation follows BB browser preferences; modifier clicks stay
native. Reviewer discovery/mutation remains server-owned, lazy on picker open.

The [status matrix](pull-request-status-matrix.md) is the intended common
precedence. Lifecycle and authoritative signals should control presentation;
do not create per-view status rules. Complete GraphQL review-thread data can
split resolved/unresolved comments; truncated data keeps the aggregate REST
fallback rather than guessing.

### Unresolved correctness and coverage

BBPLUG-426 and BBPLUG-427 completed read-only audits, **not fixes**. Their
recorded findings remain unresolved by this documentation change:

- Lowercase REST check conclusions can be classified as passing after failure.
- Stale host failed/pending counters can override fresh signals during fact
  hydration.
- Changes branch rows bypass common conflict/queue/rebase precedence.
- Detailed authority lacks an age cutoff when its producer stops observing a
  PR and can suppress fresher lightweight facts, except for the merged
  lifecycle promotion above.
- REST check reads omit later pages and legacy commit statuses.

Existing passing tests do not prove all-three-surface icon/tone/tooltip
transitions, stale-counter hydration or complete REST check handling. New PR
work requires regression cases at those production boundaries; a pure resolver
test alone does not establish publication or rendering parity. BB Tasks and
audit attachments retain reproduction evidence; no PR implementation is
authorized or claimed by documentation consolidation.
