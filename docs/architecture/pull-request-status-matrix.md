# Pull-request status matrix

This is the intended shared precedence, implemented centrally by
`pullRequestSummaryPresentation` in
[`presentation.ts`](../../features/pull-requests/presentation.ts). The authored
PR list, thread rows, and Changes panel must use that resolver; individual
views may render separate checks and reviewer detail. The resolver receives
one canonical, source-ordered PR fact from the [data contract](changes-and-prs.md#source-evidence-and-native-observations),
including compatible raw counts and supplementary metadata. Mounted regression
coverage and live acceptance remain separate gates.

## Inputs and precedence

The PR lifecycle (`merged`, `closed`, and `draft`) always wins. For open PRs,
the current GitHub signal owns checks and review state. The aggregate PR
attention is used only when no current signal is available, except that a
branch conflict and known merge-queue membership remain authoritative because
they are not represented by the review/check signal. Failed checks or requested
changes block queue presentation; otherwise a queued PR stays queued, including
while checks are pending. A local queue overlay uses this same resolver only
in its owning thread's Changes projection. A local rebase flag does not replace
the shared remote lifecycle/check/review observation.

| Priority | Condition | Status |
| --- | --- | --- |
| 1 | Merged lifecycle | Merged |
| 2 | Closed lifecycle | Closed |
| 3 | Draft lifecycle | Draft |
| 4 | Branch conflict | Conflicts |
| 5 | Failed checks | CI failure |
| 6 | Queued, unless failed checks or changes requested | Queued to merge |
| 7 | Pending checks | Checks pending |
| 8 | Review re-requested or requested | Review requested |
| 9 | Changes requested | Changes requested |
| 10 | Approved and checks passing or absent | Ready to merge |
| 11 | Approved with checks unavailable | Approved |
| 12 | No current review request or signal | Review pending |

GitHub may report a historical changes-requested review alongside a new review
request. The server upgrades that to `review_required` only when every person
whose latest effective review requests changes is explicitly re-requested.
Another person's request, a team request, or a count without reviewer identity
does not qualify. The matrix then shows **Review requested** rather than
**Changes requested**. An `attention: "none"` aggregate is never allowed to
hide a current approved signal.

## Verification rule

When adding a PR source or display, add a presentation test for every matrix
branch it can emit. Do not add view-local precedence rules or copy status
labels into component state.
