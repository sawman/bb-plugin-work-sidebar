import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { Status } from "../../../components/ui/status";
import {
  githubHealthPresentation,
  isVisibleAuthoredPullRequest,
  normalizePullRequestSignal,
  pullRequestAttentionFromSignal,
  pullRequestPresentation,
  pullRequestSignalPresentation,
} from "../presentation";

describe("pull-request presentation semantics", () => {
  it.each([
    ["open", { icon: "Eye", label: "Review pending", tone: "open" }],
    ["draft", { icon: "GitPullRequest", label: "Draft", tone: "draft" }],
    ["closed", { icon: "X", label: "Closed", tone: "closed" }],
    ["merged", { icon: "GitMerge", label: "Merged", tone: "merged" }],
  ] as const)(
    "presents %s consistently for left rows and Changes stack layers",
    (state, expected) => {
      expect(
        pullRequestPresentation({ state, draft: state === "draft" }),
      ).toEqual(expected);
    },
  );

  it.each([
    ["failed", { icon: "X", label: "Checks failed", tone: "destructive" }],
    ["passing", { icon: "Check", label: "Checks passing", tone: "success" }],
    [
      "pending",
      { icon: "LoaderCircle", label: "Checks pending", tone: "muted" },
    ],
    ["none", { icon: "Circle", label: "No checks", tone: "muted" }],
    [
      "unknown",
      { icon: "AlertCircle", label: "Checks unavailable", tone: "muted" },
    ],
  ] as const)(
    "uses one check label, tone, and icon for %s",
    (checks, expected) => {
      expect(
        pullRequestSignalPresentation({
          checks,
          review: "none",
          reviewCommentCount: 0,
        }).checks,
      ).toEqual(expected);
    },
  );

  it("marks the partial-circle pending-check icon for continuous rotation", () => {
    const pending = pullRequestSignalPresentation({
      checks: "pending",
      review: "none",
      reviewCommentCount: 0,
    }).checks;
    const markup = renderToStaticMarkup(
      createElement(Status, { presentation: pending }),
    );

    expect(markup).toContain('data-motion="spin"');
  });

  it.each([
    ["approved", { icon: "Check", label: "Approved", tone: "success" }],
    [
      "changes_requested",
      { icon: "Wrench", label: "Changes requested", tone: "destructive" },
    ],
    [
      "review_requested",
      { icon: "Eye", label: "Review requested", tone: "warning" },
    ],
    [
      "review_required",
      { icon: "Eye", label: "Review required", tone: "warning" },
    ],
    [
      "none",
      { icon: "UserClock", label: "No reviewer requested", tone: "muted" },
    ],
  ] as const)(
    "preserves the review signal %s across both surfaces",
    (review, expected) => {
      expect(
        pullRequestSignalPresentation({
          checks: "none",
          review,
          reviewCommentCount: 3,
        }).review,
      ).toEqual({ ...expected, count: 3 });
    },
  );

  it("normalizes a dismissed changes request with re-review into review required", () => {
    expect(
      normalizePullRequestSignal({
        checks: "passing",
        review: { state: "changes_requested", reviewRequestCount: 2 },
        reviewCommentCount: 1,
      }),
    ).toEqual({
      checks: "passing",
      review: "review_required",
      reviewCommentCount: 1,
    });
    expect(
      pullRequestSignalPresentation({
        checks: "passing",
        review: "review_required",
        requestedReviewers: ["octocat", "platform-team"],
        reviewCommentCount: 1,
      }).review,
    ).toEqual({
      icon: "Eye",
      label: "Review required",
      tone: "warning",
      count: 1,
    });
  });

  it("keeps comment counts, merged layers, archived repositories, and GitHub health semantic", () => {
    expect(
      pullRequestSignalPresentation({
        checks: "passing",
        review: "approved",
        reviewCommentCount: 2,
      }).review.count,
    ).toBe(2);
    expect(
      pullRequestPresentation({
        state: "closed",
        draft: false,
        mergedLayer: true,
      }),
    ).toEqual({ icon: "GitMerge", label: "Merged", tone: "merged" });
    expect(
      githubHealthPresentation({
        state: "available",
        scope: "unknown",
        message: null,
        retryAt: null,
      }),
    ).toBeNull();
    expect(
      githubHealthPresentation({
        state: "rate_limited",
        scope: "graphql",
        message: "limited",
        retryAt: 1_000,
      }),
    ).toEqual({
      icon: "AlertCircle",
      label: "GraphQL limited",
      tone: "warning",
      detail: "limited",
    });
    expect(
      githubHealthPresentation({
        state: "unavailable",
        scope: "rest",
        message: "offline",
        retryAt: null,
      }),
    ).toEqual({
      icon: "AlertCircle",
      label: "GitHub unavailable",
      tone: "destructive",
      detail: "offline",
    });
  });

  it("makes both GitHub API budgets visible with a rate-limit warning", () => {
    expect(
      githubHealthPresentation({
        state: "rate_limited",
        scope: "graphql",
        message: "GitHub GraphQL is rate limited; using REST where possible.",
        retryAt: 1_000,
        limits: {
          graphql: { remaining: 0, limit: 5_000, resetAt: null },
          rest: { remaining: 4_812, limit: 5_000, resetAt: null },
        },
      }),
    ).toEqual({
      icon: "AlertCircle",
      label: "GraphQL limited · GQL 0/5,000 · REST 4,812/5,000",
      tone: "warning",
      detail:
        "GitHub GraphQL is rate limited; using REST where possible. GraphQL 0/5,000 · REST 4,812/5,000 remaining.",
    });
  });

  it.each([
    [
      "ready_to_merge",
      { icon: "Check", label: "Ready to merge", tone: "success" },
    ],
    ["checks_failed", { icon: "X", label: "CI failure", tone: "destructive" }],
    ["conflicts", { icon: "X", label: "Conflicts", tone: "destructive" }],
    [
      "changes_requested",
      { icon: "X", label: "Changes requested", tone: "destructive" },
    ],
    ["blocked", { icon: "Eye", label: "Review pending", tone: "open" }],
    ["checks_pending", { icon: "Eye", label: "Review pending", tone: "open" }],
    [
      "review_requested",
      { icon: "Eye", label: "Review pending", tone: "open" },
    ],
    ["none", { icon: "Eye", label: "Review pending", tone: "open" }],
  ] as const)(
    "preserves open attention %s after state precedence",
    (attention, expected) => {
      expect(
        pullRequestPresentation({ state: "open", draft: false, attention }),
      ).toEqual(expected);
      expect(
        pullRequestPresentation({ state: "merged", draft: false, attention }),
      ).toEqual({ icon: "GitMerge", label: "Merged", tone: "merged" });
    },
  );

  it.each([
    [
      { checks: "failed", review: "approved", reviewCommentCount: 0 },
      "checks_failed",
    ],
    [
      { checks: "passing", review: "changes_requested", reviewCommentCount: 0 },
      "changes_requested",
    ],
    [
      { checks: "passing", review: "approved", reviewCommentCount: 0 },
      "ready_to_merge",
    ],
    [
      { checks: "none", review: "approved", reviewCommentCount: 0 },
      "ready_to_merge",
    ],
    [
      { checks: "pending", review: "review_requested", reviewCommentCount: 0 },
      "checks_pending",
    ],
    [
      { checks: "none", review: "none", reviewCommentCount: 0 },
      "review_requested",
    ],
  ] as const)(
    "derives the summary badge state from CI and review signals",
    (signal, expected) => {
      expect(pullRequestAttentionFromSignal(signal)).toBe(expected);
    },
  );

  it("excludes archived repositories and exposes review counts to assistive technology", () => {
    expect(
      isVisibleAuthoredPullRequest({
        repository: "owner/archived",
        archivedRepositories: new Set(["owner/archived"]),
      }),
    ).toBe(false);
    expect(
      isVisibleAuthoredPullRequest({
        repository: "owner/active",
        archivedRepositories: new Set(["owner/archived"]),
      }),
    ).toBe(true);
    const markup = renderToStaticMarkup(
      createElement(Status, {
        presentation: {
          icon: "Eye",
          label: "Review requested",
          tone: "warning",
          count: 1,
        },
      }),
    );
    expect(markup).toContain('data-tone="warning"');
    expect(markup).toContain('aria-label="Review requested, 1 review comment"');
  });
});
