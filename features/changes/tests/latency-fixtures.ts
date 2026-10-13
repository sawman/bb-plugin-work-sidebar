export function currentPr(number = 1, title = `PR ${number}`) {
  return {
    number, title, url: `https://github.com/acme/repo/pull/${number}`,
    state: "open" as const, head: `feature/${number}`, base: "main",
    attention: "none" as const,
    checks: { state: "passing" as const, failedCount: 0, passedCount: 1, pendingCount: 0, totalCount: 1 },
    review: { state: "approved" as const, reviewRequestCount: 0 },
    mergeability: { mergeStateStatus: "CLEAN" as const, mergeable: "MERGEABLE" as const, state: "mergeable" as const },
    signal: { checks: "passing" as const, review: "approved" as const, reviewCommentCount: 0 },
  };
}
