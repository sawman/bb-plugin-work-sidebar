# Pull-request status matrix

All PR badges and main status icons resolve through
`pullRequestSummaryPresentation` in `features/pull-requests/presentation.ts`.
The authored PR list, thread rows, and Changes panel must use that resolver;
individual views may still render separate checks and reviewer detail.

## Inputs and precedence

The PR lifecycle (`merged`, `closed`, and `draft`) always wins. For open PRs,
the current GitHub signal owns checks and review state. The aggregate PR
attention is used only when no current signal is available, except that a
branch conflict remains authoritative because it is not represented by the
review/check signal.

| Priority | Condition | Status |
| --- | --- | --- |
| 1 | Merged lifecycle | Merged |
| 2 | Closed lifecycle | Closed |
| 3 | Draft lifecycle | Draft |
| 4 | Branch conflict | Conflicts |
| 5 | Failed checks | CI failure |
| 6 | Pending checks | Checks pending |
| 7 | Review re-requested or requested | Review requested |
| 8 | Changes requested | Changes requested |
| 9 | Approved and checks passing or absent | Ready to merge |
| 10 | Approved with checks unavailable | Approved |
| 11 | No current review request or signal | Review pending |

GitHub may report a historical changes-requested review alongside a new review
request. `normalizePullRequestSignal` turns that combination into
`review_required`, and the matrix therefore shows **Review requested** rather
than **Changes requested**. An `attention: "none"` aggregate is never allowed
to hide a current approved signal.

## Verification rule

When adding a PR source or display, add a presentation test for every matrix
branch it can emit. Do not add view-local precedence rules or copy status
labels into component state.
