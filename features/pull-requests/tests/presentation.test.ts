import { describe, expect, it } from "vitest";
import {
  githubHealthPresentation,
  pullRequestPresentation,
  pullRequestSignalPresentation,
} from "../presentation";

describe("pull-request presentation semantics", () => {
  it.each([
    ["open", { icon: "GitPullRequest", label: "Open", tone: "open" }],
    ["draft", { icon: "GitPullRequest", label: "Draft", tone: "draft" }],
    ["closed", { icon: "X", label: "Closed", tone: "closed" }],
    ["merged", { icon: "GitMerge", label: "Merged", tone: "merged" }],
  ] as const)("presents %s consistently for left rows and Changes stack layers", (state, expected) => {
    expect(pullRequestPresentation({ state, draft: state === "draft" })).toEqual(expected);
  });

  it.each([
    ["failed", { icon: "X", label: "Checks failed", tone: "destructive" }],
    ["passing", { icon: "Check", label: "Checks passing", tone: "success" }],
    ["pending", { icon: "LoaderCircle", label: "Checks pending", tone: "muted" }],
    ["none", { icon: "Circle", label: "No checks", tone: "muted" }],
    ["unknown", { icon: "AlertCircle", label: "Checks unavailable", tone: "muted" }],
  ] as const)("uses one check label, tone, and icon for %s", (checks, expected) => {
    expect(pullRequestSignalPresentation({ checks, review: "none", reviewCommentCount: 0 }).checks).toEqual(expected);
  });

  it.each([
    ["approved", { icon: "Check", label: "Approved", tone: "success" }],
    ["changes_requested", { icon: "Wrench", label: "Changes requested", tone: "destructive" }],
    ["changes_requested_review_requested", { icon: "Eye", label: "Changes requested; re-review requested", tone: "warning", overlayIcon: "Wrench" }],
    ["review_requested", { icon: "Eye", label: "Review requested", tone: "warning" }],
    ["review_required", { icon: "Eye", label: "Review required", tone: "muted" }],
    ["none", { icon: "UserClock", label: "No reviewer requested", tone: "muted" }],
  ] as const)("preserves the review signal %s across both surfaces", (review, expected) => {
    expect(pullRequestSignalPresentation({ checks: "none", review, reviewCommentCount: 3 }).review).toEqual({ ...expected, count: 3 });
  });

  it("keeps comment counts, merged layers, archived repositories, and GitHub health semantic", () => {
    expect(pullRequestSignalPresentation({ checks: "passing", review: "approved", reviewCommentCount: 2 }).review.count).toBe(2);
    expect(pullRequestPresentation({ state: "closed", draft: false, mergedLayer: true })).toEqual({ icon: "GitMerge", label: "Merged", tone: "merged" });
    expect(pullRequestPresentation({ state: "open", draft: false, archivedRepository: true })).toEqual({ icon: "GitPullRequest", label: "Open", tone: "open" });
    expect(githubHealthPresentation({ state: "available", scope: "unknown", message: null, retryAt: null })).toBeNull();
    expect(githubHealthPresentation({ state: "rate_limited", scope: "graphql", message: "limited", retryAt: 1_000 }))
      .toEqual({ icon: "AlertCircle", label: "GraphQL limited", tone: "warning" });
    expect(githubHealthPresentation({ state: "unavailable", scope: "rest", message: "offline", retryAt: null }))
      .toEqual({ icon: "AlertCircle", label: "GitHub unavailable", tone: "destructive" });
  });
});
