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
- One bounded Query PR-fact directory owns the resolved lifecycle, title,
  head/base, checks/review, mergeability and supplementary metadata. Authority
  follows each field group's source evidence, never the presence of rich detail.
  Older observations may supply compatible missing detail but cannot replace
  newer fields. Missing fields preserve compatible data; explicit empty lists
  and nulls clear it. The directory retains facts for warm/error paint, caps
  facts at 500 and thread references at 1,000, and uses the existing 15-minute
  Query GC. No domain data is copied into Zustand or another client cache.
- Merged is irreversible for the same repository/PR identity, including a
  retained Stack member before hydration. Closed/reopened and draft/ready are
  reversible through newer observations. Authored open roots disappear when
  canonically closed/merged; retained Stack layers preserve lifecycle and
  disable draft conversion. Thread/Stack overlays must match the full
  repository/PR key. Confirmed successful absence clears only that thread's
  association; unavailable/malformed/missing results retain warm facts.
  An available keyed native association wins over a null summary; summary
  absence clears the reference only when no keyed row is available.
- Remote-only repository topology and PR files may be shared across threads.
  Raw topology seeds carry discovery/order, not a second computed status
  directory. The left authored projection filters open PRs and archived
  repositories; actual stack members can include merged/closed PRs.
- Current checkout, stash, rebase, extra local branches and every gh-stack
  response remain thread-local overlays. A remote cache must not carry them
  between worktrees. Local checkout/diff invalidation remains local.

## Source evidence and native observations

Each plugin-owned envelope enumerates only the groups it observed: title,
lifecycle, head, base, checks, raw check counts, review, people, comments and
mergeability/queue. Successful external commands carry their actual admission
sequence, server-instance epoch and request-start validation time. Cached and
coalesced reads retain that evidence unchanged. Source PR `updatedAt` versions
order metadata, never checks. Search title/lifecycle and topology head/base keep
separate evidence; combining cached search data with new topology cannot make
the title fresh. Existing batched signal reads include PR metadata and SHA
identities, so a fresh lightweight observation can replace stale detail.

SDK 0.6.79's native public row exposes neither upstream validation time nor head
SHA. Its GitHub PR `updatedAt` is not a checks clock or a SHA. An opaque native
change paints provisionally without a freshness claim. Consecutive identical
selected-group fingerprints, including remounts in the same Query generation,
change no occurrence, age or validation demand. A real A→B→A transition creates
a new occurrence. The fingerprint is synchronous fixed-field JSON, with exact
PR/group scope; it has no crypto or secure-context dependency.

Only changes to native checks, review or mergeability/queue demand validation
in the existing scoped RPC. A demand contains a client identity, group content
and occurrence. The server stamps receipt using its own monotonic factory
sequence. A successful upstream admission strictly after receipt can echo an
exact matching proof; the client compares proof equality, never browser and
server wall clocks. A proof for another PR, group, occurrence, head or retired
server epoch cannot win. This works with remote/web client clock skew. Native
metadata-only changes do not force signal validation.

Metadata with equal PR `updatedAt` remains incomparable. When native metadata
arrived first, an equal-version GitHub observation does not replace its values
or attach head/base SHA evidence. The SHA compatibility guard is unavailable
for those metadata groups until a newer metadata version is observed. Checks
and review still require their own exact causal proof; GitHub observations are
ordered within their server sequence/epoch. This is an explicit partial-order
limit, not a complete ordering of all snapshots.

Per-PR pending reservations coalesce consumers and windows. A demand arriving
after admission joins one coalesced successor after that read settles. There
is at most one active read and one successor at a time; a finite burst during
the first flight costs at most two validations. A genuinely later demand after
successor admission needs another successor. Backoff settles through existing
error boundaries immediately, retaining the unsatisfied client demand for the
next existing authorized read; no sleeping RPC, retry loop or timer is added.
Proofs retain only the latest occurrence per client/group (32 clients per
cached PR group); pending state caps at 300 PRs and rejects capacity overflow.
Scope or capacity rejection isolates that PR, settles/releases every owned
reservation, and leaves independent valid PR admissions running. The rejected
client demand remains unsatisfied for its next authorized read; it receives no
proof and never means confirmed absence.
Evidence evicts/disposes with the existing fact, semantic cache and pending
owners. Retired server epochs are bounded at eight per fact; cancelled Query
publications and server generation guards reject retired in-flight work.

Raw counters belong to their source checks observation. Aggregate GraphQL
signals cannot invent passed totals or carry contradictory old failed/pending
counts. Missing counts render with the existing unavailable/unknown count
shape while the known aggregate signal controls status. People and comment
breakdowns survive only with compatible head/base SHAs and review identity;
a newer opaque review change clears unproven supplementary data. Complete
review-thread counts carry their own observation, rather than borrowing the
signal request's age. Incompatible or incomplete comment breakdowns fall back
to a compatible observed aggregate.

## Cache and refresh contract

Central Query policies retain the 30-second Changes stale window and finite
GC. Server GitHub read caching, in-flight deduplication and REST/GraphQL
backoff protect the shared API budget across windows. A client Query cache
does not replace that server authority. GitHub-classified failures do not
trigger extra client retries. Configurable active/background/authored polling
and explicit refresh retain their distinct scopes.


Conditional validation has an explicit API cost. A relevant changed PR/group
may add one coalesced batched GraphQL signal command when existing raw data
predates its demand. Three surfaces sharing one demand do not add three calls;
M Stack members can ride the existing batch, without M forced member reads.
Identical replay, title/`updatedAt`-only change, topology, files, search, reviewer
lists and comments add zero conditional commands. Host polling at 30 seconds
(active) or five minutes (quiet) illustrates the cadence; manual/event-driven
transitions mean 120/hour is not a hard ceiling. Ordinary polling/backoff/TTLs
remain unchanged.

A genuinely new client/window with no retained fact-generation history may
issue one initial causal demand for that PR and conditionally validate when
the existing cached/pending observation cannot satisfy server receipt order.
An older client's proof is not aliased to it. This cold-client cost is separate
from replay/remount/duplicate delivery within a retained generation, which
creates no additional demand or conditional read. Source validation time
advances only after a real successful upstream admission, never on arrival.

Complete GraphQL aggregate success adds no REST calls. Its existing REST
fallback now reads complete check runs and combined legacy statuses by the
same immutable head SHA. Each source has a ten-page, 100-items-per-page cap;
missing/error/truncated/capped pages cannot certify passing or no-checks.
Lowercase outcomes and pending states are normalized, with failure before
pending before passing. A trailing fresh PR metadata read rejects head/base
changes before proof issuance; the proof's lower bound covers the earliest
contributing read, not completion. Fallback CLI cost is two PR metadata
commands, one reviews command, max(1, ceil(check-runs/100)) check commands and
max(1, ceil(legacy-statuses/100)) status commands. Reviews retain their existing
`--paginate --slurp` behavior without a new page cap: that single CLI command
may issue multiple HTTP requests. The manually paged checks/status commands
issue one HTTP request each. Backoff is never bypassed. The contracts are the
GitHub [check-runs](https://docs.github.com/en/rest/checks/runs#list-check-runs-for-a-git-reference)
and [combined statuses](https://docs.github.com/en/rest/commits/statuses#get-the-combined-status-for-a-specific-reference)
APIs. No additional scan is added on the normal GraphQL path.

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
Current and Stack PR rows begin with an independently focusable number badge
that copies the row's resolved PR URL. Copying by mouse, Enter or Space leaves
disclosure, checkout and navigation untouched; title and trailing controls keep
their separate actions. The badge replaces only the title-line number; subtitle,
status, branch name and delta columns retain their existing full-width grid
geometry. Pointer activation of metadata still discloses files, and the title
remains a native keyboard-focusable button. The header context-number badge
keeps its own behavior.
Authored title activation follows BB browser preferences; modifier clicks stay
native. Reviewer discovery/mutation remains server-owned, lazy on picker open.

The [status matrix](pull-request-status-matrix.md) is the intended common
precedence. Lifecycle and authoritative signals should control presentation;
do not create per-view status rules. Complete GraphQL review-thread data can
split resolved/unresolved comments; truncated data keeps the aggregate REST
fallback rather than guessing.

### Verification limits

BBPLUG-453 replaces the authority defects identified by BBPLUG-426/427 with
regressions at the raw-cache, server adapter, canonical publication and mounted
presentation boundaries. The matrix exercises thread badges, authored roots
and retained Stack layers, Changes header/current/sibling rows, labels/icons/
tones and lifecycle actions. Shared remote status uses one resolver; local
checkout, stash, queued and rebase overlays remain thread-scoped. Rebase state
is not promoted into another PR's remote review/check signal.

Focused checks, exact-SHA review, serial full validation and live acceptance
are separate gates recorded in BB Tasks. Mounted harness checks do not certify
host CSS/layout, themes or native interactions. BBPLUG-452's corrected inline
URL badge geometry remains a separate accepted change; this data change does
not alter its title/subtitle/delta layout.
