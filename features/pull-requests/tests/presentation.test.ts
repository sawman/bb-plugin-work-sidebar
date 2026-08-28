import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { Status } from "../../../components/ui/status";
import {
  githubHealthPresentation,
  isVisibleAuthoredPullRequest,
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

  it("marks the partial-circle pending-check icon for continuous rotation", () => {
    const pending = pullRequestSignalPresentation({ checks: "pending", review: "none", reviewCommentCount: 0 }).checks;
    const markup = renderToStaticMarkup(createElement(Status, { presentation: pending }));

    expect(markup).toContain('data-motion="spin"');
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
    expect(githubHealthPresentation({ state: "available", scope: "unknown", message: null, retryAt: null })).toBeNull();
    expect(githubHealthPresentation({ state: "rate_limited", scope: "graphql", message: "limited", retryAt: 1_000 }))
      .toEqual({ icon: "AlertCircle", label: "GraphQL limited", tone: "warning" });
    expect(githubHealthPresentation({ state: "unavailable", scope: "rest", message: "offline", retryAt: null }))
      .toEqual({ icon: "AlertCircle", label: "GitHub unavailable", tone: "destructive" });
  });

  it.each([
    ["ready_to_merge", { icon: "Check", label: "Ready to merge", tone: "success" }],
    ["checks_failed", { icon: "X", label: "Checks failed", tone: "destructive" }],
    ["conflicts", { icon: "X", label: "Conflicts", tone: "destructive" }],
    ["changes_requested", { icon: "X", label: "Changes requested", tone: "destructive" }],
    ["blocked", { icon: "X", label: "Blocked", tone: "destructive" }],
  ] as const)("preserves open attention %s after state precedence", (attention, expected) => {
    expect(pullRequestPresentation({ state: "open", draft: false, attention })).toEqual(expected);
    expect(pullRequestPresentation({ state: "merged", draft: false, attention })).toEqual({ icon: "GitMerge", label: "Merged", tone: "merged" });
  });

  it("excludes archived repositories and exposes review counts to assistive technology", () => {
    expect(isVisibleAuthoredPullRequest({ repository: "owner/archived", archivedRepositories: new Set(["owner/archived"]) })).toBe(false);
    expect(isVisibleAuthoredPullRequest({ repository: "owner/active", archivedRepositories: new Set(["owner/archived"]) })).toBe(true);
    const markup = renderToStaticMarkup(createElement(Status, { presentation: { icon: "Eye", label: "Review requested", tone: "warning", count: 1 } }));
    expect(markup).toContain('data-tone="warning"');
    expect(markup).toContain('aria-label="Review requested, 1 review comment"');
  });
});
