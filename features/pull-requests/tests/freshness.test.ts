import { describe, expect, it } from "vitest";
import { factFromAuthoredPullRequest, factFromPullRequest, mergePullRequestFacts, pullRequestFromFact } from "../facts";
import { currentPr } from "../../changes/tests/latency-fixtures";
import type { PullRequestObservations } from "../schemas";

function observations(validatedAt: number, headSha = "head1", reviewIdentity = "approved:alice"): PullRequestObservations {
  const observation = { source: "github" as const, validatedAt, headSha, baseSha: "base", reviewIdentity };
  return Object.fromEntries(["title", "lifecycle", "head", "base", "checks", "review", "people", "comments", "mergeability"]
    .map((group) => [group, observation]));
}
function light(validatedAt: number, overrides: Record<string, unknown> = {}) {
  const current = currentPr(1, "Light title");
  return factFromAuthoredPullRequest({ ...current, repository: "acme/repo", draft: false, stack: null,
    checks: "passing", review: "approved", reviewCommentCount: 0, observations: observations(validatedAt), ...overrides } as never);
}

describe("source-ordered canonical PR publication", () => {
  it.each(["light-first", "detail-first"])("%s resolves fresh light over stale detail without inventing counts", (order) => {
    const stale = factFromPullRequest({ ...currentPr(1, "Old detailed title"), observations: observations(100),
      checks: { state: "pending", totalCount: 2, pendingCount: 2, passedCount: 0, failedCount: 0 },
      signal: { checks: "pending", review: "none", reviewCommentCount: 0 } });
    const fresh = light(200);
    const directory = mergePullRequestFacts(undefined, order === "light-first" ? [fresh, stale] : [stale, fresh]);
    const resolved = directory.facts[fresh.key];
    expect(resolved).toMatchObject({ title: "Light title", signal: { checks: "passing", review: "approved" } });
    expect(resolved.checks).toBeNull();
    expect(pullRequestFromFact(resolved).checks.totalCount).toBe(0);
    expect(directory.observedAtByFact?.[fresh.key]).toBe(200);
  });

  it("rejects an older same-PR response and does not advance validation on replay or unrelated PR writes", () => {
    const fresh = light(200);
    const first = mergePullRequestFacts(undefined, [fresh]);
    const replayed = mergePullRequestFacts(first, [light(100, { title: "Late old title" })]);
    expect(replayed.facts[fresh.key].title).toBe("Light title");
    const unrelated = { ...light(300), key: "acme/repo#2", number: 2, url: "https://github.com/acme/repo/pull/2" };
    expect(mergePullRequestFacts(replayed, [unrelated, fresh]).observedAtByFact?.[fresh.key]).toBe(200);
  });

  it("clears missing incompatible people/comments after head or review identity changes, and honors explicit empty lists", () => {
    const enriched = light(100, { approvers: ["alice"], reviewCommentCount: 4, reviewCommentCounts: { unresolved: 1, resolved: 3 } });
    const initial = mergePullRequestFacts(undefined, [enriched]);
    const changed = light(200, { observations: observations(200, "head2", "requested:bob"), review: "review_requested" });
    const next = mergePullRequestFacts(initial, [changed]).facts[enriched.key];
    expect(next.signal.approvers).toBeUndefined();
    expect(next.signal.reviewCommentCounts).toBeUndefined();
    expect(next.signal.reviewCommentCount).toBe(0);
    const cleared = light(300, { approvers: [], requestedReviewers: [], changeRequesters: [] });
    const final = mergePullRequestFacts(initial, [cleared]).facts[enriched.key];
    expect(final.signal.approvers).toEqual([]);
    expect(final.signal.requestedReviewers).toEqual([]);
    expect(final.signal.changeRequesters).toEqual([]);
  });

  it("distinguishes missing groups from explicit null clears without aging unrelated metadata", () => {
    const detail = factFromPullRequest({ ...currentPr(1, "Retained title"), observations: observations(100),
      signal: { checks: "passing", review: "approved", approvers: ["alice"], reviewCommentCount: 4,
        reviewCommentCounts: { unresolved: 1, resolved: 3 } } });
    const first = mergePullRequestFacts(undefined, [detail]);
    const missing = { ...light(200), observations: { checks: observations(200).checks } };
    const preserved = mergePullRequestFacts(first, [missing]);
    expect(preserved.facts[detail.key]).toMatchObject({ title: "Retained title", mergeability: detail.mergeability,
      signal: { approvers: ["alice"], reviewCommentCounts: { unresolved: 1, resolved: 3 } } });
    expect(preserved.facts[detail.key].observations?.title).toEqual(detail.observations?.title);
    const cleared = { ...light(300), mergeability: null,
      observations: { mergeability: observations(300).mergeability, comments: observations(300).comments },
      signal: { ...light(300).signal, reviewCommentCounts: null } };
    const result = mergePullRequestFacts(preserved, [cleared]).facts[detail.key];
    expect(result.mergeability).toBeNull();
    expect(result.signal.reviewCommentCounts).toBeNull();
    expect(result.title).toBe("Retained title");
  });
});
