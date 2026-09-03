import { describe, expect, it } from "vitest";
import {
  factFromAuthoredPullRequest,
  factFromThreadPullRequest,
  MAX_PULL_REQUEST_FACTS,
  mergePullRequestFacts,
  pullRequestFactKey,
  reconcileThreadPullRequestFactReferences,
  resolvePullRequestFact,
} from "../facts";

const authored = {
  number: 1402,
  title: "Review lifecycle",
  url: "https://github.com/SystemEarth/systemearth/pull/1402",
  repository: "SystemEarth/systemearth",
  state: "open" as const,
  draft: false,
  head: "feature/review",
  base: "main",
  checks: "passing" as const,
  review: "changes_requested" as const,
  changeRequesters: ["yojo-se"],
  reviewCommentCount: 2,
  stack: null,
};

const thread = {
  number: 1402,
  title: "Review lifecycle",
  url: "https://github.com/SystemEarth/systemearth/pull/1402",
  state: "open" as const,
  head: "feature/review",
  base: "main",
  checks: {
    failedCount: 0,
    passedCount: 4,
    pendingCount: 0,
    state: "passing" as const,
    totalCount: 4,
  },
  review: { reviewRequestCount: 1, state: "review_required" as const },
  attention: "review_requested" as const,
  mergeability: {
    mergeStateStatus: "CLEAN" as const,
    mergeable: "MERGEABLE" as const,
    state: "mergeable" as const,
  },
  signal: {
    checks: "passing" as const,
    review: "review_required" as const,
    changeRequesters: ["yojo-se"],
    requestedReviewers: ["yojo-se"],
    reviewCommentCount: 2,
  },
  stackNumber: 17,
};

describe("pull-request fact directory", () => {
  it("normalizes one fact identity across authored and thread envelopes", () => {
    expect(pullRequestFactKey(authored)).toBe("systemearth/systemearth#1402");
    const facts = mergePullRequestFacts(undefined, [
      factFromAuthoredPullRequest(authored),
      factFromThreadPullRequest(thread),
    ]);

    expect(Object.keys(facts.facts)).toEqual(["systemearth/systemearth#1402"]);
    expect(facts.facts["systemearth/systemearth#1402"]).toMatchObject({
      signal: { review: "review_required", requestedReviewers: ["yojo-se"] },
      checks: { totalCount: 4 },
      mergeability: { state: "mergeable" },
    });
  });

  it("lets every presentation consumer resolve the same authoritative review fact", () => {
    const facts = mergePullRequestFacts(undefined, [
      factFromAuthoredPullRequest(authored),
      factFromThreadPullRequest(thread),
    ]);
    expect(resolvePullRequestFact(authored, facts)).toMatchObject({
      signal: { review: "review_required", requestedReviewers: ["yojo-se"] },
      attention: "review_requested",
    });
  });

  it("does not let a lightweight authored envelope erase a detailed fact", () => {
    const directory = mergePullRequestFacts(undefined, [
      factFromThreadPullRequest(thread),
      factFromAuthoredPullRequest({
        ...authored,
        review: "changes_requested",
      }),
    ]);

    expect(directory.facts["systemearth/systemearth#1402"]?.signal.review).toBe(
      "review_required",
    );
    expect(directory.facts["systemearth/systemearth#1402"]?.checks).toMatchObject({
      totalCount: 4,
    });
  });

  it("bounds the project fact directory and retains refreshed facts", () => {
    const baseline = factFromAuthoredPullRequest(authored);
    const incoming = Array.from({ length: MAX_PULL_REQUEST_FACTS + 1 },
      (_, index) => ({
        ...baseline,
        key: `acme/sidebar#${index}`,
        number: index + 1,
        url: `https://github.com/acme/sidebar/pull/${index + 1}`,
      }),
    );
    const directory = mergePullRequestFacts(undefined, incoming);
    expect(Object.keys(directory.facts)).toHaveLength(MAX_PULL_REQUEST_FACTS);
    expect(directory.facts["acme/sidebar#0"]).toBeUndefined();
    const refreshed = mergePullRequestFacts(directory, [incoming[1]!]);
    expect(refreshed.facts["acme/sidebar#1"]).toBeTruthy();
    expect(Object.keys(refreshed.facts).at(-1)).toBe("acme/sidebar#1");
  });

  it("replaces roster relationships without discarding reusable facts", () => {
    const fact = factFromAuthoredPullRequest(authored);
    const directory = mergePullRequestFacts(undefined, [fact], {
      thr_removed: fact.key,
    });

    const reconciled = reconcileThreadPullRequestFactReferences(directory, {});

    expect(reconciled.facts[fact.key]).toEqual(fact);
    expect(reconciled.threadFactKeys).toEqual({});
  });
});
