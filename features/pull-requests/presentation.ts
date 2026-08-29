import type { StatusPresentation } from "../../components/ui/status";

export type PullRequestCheckState =
  "failed" | "passing" | "pending" | "none" | "unknown";
export type PullRequestReviewState =
  | "approved"
  | "changes_requested"
  | "review_requested"
  | "review_required"
  | "none";
export type PullRequestState = "closed" | "draft" | "merged" | "open";
export type PullRequestAttention =
  | "blocked"
  | "changes_requested"
  | "checks_failed"
  | "checks_pending"
  | "closed"
  | "conflicts"
  | "draft"
  | "merged"
  | "none"
  | "ready_to_merge"
  | "review_requested";
export type StatusTone =
  | "open"
  | "draft"
  | "closed"
  | "merged"
  | "success"
  | "destructive"
  | "warning"
  | "muted";

export type PullRequestSignal = {
  checks: PullRequestCheckState;
  review: PullRequestReviewState;
  requestedReviewers?: string[];
  reviewCommentCount: number;
};

export type { StatusPresentation } from "../../components/ui/status";

export function pullRequestPresentation(input: {
  state: PullRequestState;
  draft: boolean;
  attention?: string | null;
  mergedLayer?: boolean;
}): StatusPresentation {
  if (
    input.mergedLayer ||
    input.state === "merged" ||
    input.attention === "merged"
  )
    return { icon: "GitMerge", label: "Merged", tone: "merged" };
  if (input.state === "closed" || input.attention === "closed")
    return { icon: "X", label: "Closed", tone: "closed" };
  if (input.draft || input.state === "draft" || input.attention === "draft")
    return { icon: "GitPullRequest", label: "Draft", tone: "draft" };
  if (input.attention === "ready_to_merge")
    return { icon: "Check", label: "Ready to merge", tone: "success" };
  if (input.attention === "conflicts")
    return { icon: "X", label: "Conflicts", tone: "destructive" };
  if (input.attention === "checks_failed")
    return { icon: "X", label: "CI failure", tone: "destructive" };
  if (input.attention === "changes_requested")
    return { icon: "X", label: "Changes requested", tone: "destructive" };
  return { icon: "Eye", label: "Review pending", tone: "open" };
}

export function pullRequestAttentionFromSignal(
  signal: Pick<PullRequestSignal, "checks" | "review">,
): PullRequestAttention {
  if (signal.review === "changes_requested") return "changes_requested";
  if (signal.checks === "failed") return "checks_failed";
  if (
    (signal.checks === "passing" || signal.checks === "none") &&
    signal.review === "approved"
  )
    return "ready_to_merge";
  if (signal.checks === "pending") return "checks_pending";
  return "review_requested";
}

export function isVisibleAuthoredPullRequest(input: {
  repository: string;
  archivedRepositories: ReadonlySet<string>;
}): boolean {
  return (
    input.repository.length > 0 &&
    !input.archivedRepositories.has(input.repository)
  );
}

export function pullRequestSignalPresentation(signal: PullRequestSignal): {
  checks: StatusPresentation;
  review: StatusPresentation;
} {
  const checks: Record<PullRequestCheckState, StatusPresentation> = {
    failed: { icon: "X", label: "Checks failed", tone: "destructive" },
    passing: { icon: "Check", label: "Checks passing", tone: "success" },
    pending: { icon: "LoaderCircle", label: "Checks pending", tone: "muted" },
    none: { icon: "Circle", label: "No checks", tone: "muted" },
    unknown: {
      icon: "AlertCircle",
      label: "Checks unavailable",
      tone: "muted",
    },
  };
  const review: Record<PullRequestReviewState, StatusPresentation> = {
    approved: { icon: "Check", label: "Approved", tone: "success" },
    changes_requested: {
      icon: "Wrench",
      label: "Changes requested",
      tone: "destructive",
    },
    review_requested: {
      icon: "Eye",
      label: "Review requested",
      tone: "warning",
    },
    review_required: { icon: "Eye", label: "Review required", tone: "muted" },
    none: { icon: "UserClock", label: "No reviewer requested", tone: "muted" },
  };
  return {
    checks: checks[signal.checks],
    review: { ...review[signal.review], count: signal.reviewCommentCount },
  };
}

export function normalizePullRequestSignal(input: {
  checks:
    | PullRequestCheckState
    | {
        failedCount: number;
        passedCount: number;
        pendingCount: number;
        state: "failing" | "no_checks" | "passing" | "pending" | "unknown";
        totalCount: number;
      };
  review:
    | PullRequestReviewState
    | {
        reviewRequestCount: number;
        state:
          | "approved"
          | "changes_requested"
          | "none"
          | "review_requested"
          | "review_required";
      };
  reviewCommentCount?: number;
}): PullRequestSignal {
  const checks =
    typeof input.checks === "string"
      ? input.checks
      : input.checks.failedCount > 0 || input.checks.state === "failing"
        ? "failed"
        : input.checks.pendingCount > 0 || input.checks.state === "pending"
          ? "pending"
          : input.checks.totalCount > 0 || input.checks.state === "passing"
            ? "passing"
            : input.checks.state === "unknown"
              ? "unknown"
              : "none";
  const review =
    typeof input.review === "string"
      ? input.review
      : input.review.state === "changes_requested" &&
          input.review.reviewRequestCount > 0
        ? "review_required"
        : input.review.state;
  return {
    checks,
    review,
    reviewCommentCount: Math.max(0, input.reviewCommentCount ?? 0),
  };
}

export function githubHealthPresentation(health: {
  state: "available" | "rate_limited" | "unavailable";
  scope: "graphql" | "rest" | "unknown";
  message: string | null;
  retryAt: number | null;
}): StatusPresentation | null {
  if (health.state === "available") return null;
  return health.state === "rate_limited"
    ? {
        icon: "AlertCircle",
        label:
          health.scope === "graphql" ? "GraphQL limited" : "GitHub limited",
        tone: "warning",
      }
    : { icon: "AlertCircle", label: "GitHub unavailable", tone: "destructive" };
}
