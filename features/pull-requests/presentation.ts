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
  | "approved"
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
  if (input.attention === "checks_pending")
    return { icon: "LoaderCircle", label: "Checks pending", tone: "muted" };
  if (input.attention === "changes_requested")
    return { icon: "Wrench", label: "Changes requested", tone: "closed" };
  if (input.attention === "review_requested")
    return { icon: "Eye", label: "Review requested", tone: "warning" };
  if (input.attention === "approved")
    return { icon: "Check", label: "Approved", tone: "success" };
  return { icon: "Eye", label: "Review pending", tone: "open" };
}

/**
 * The one status matrix shared by PR, Thread, and Changes views. Signals own
 * review/check state; the aggregate preserves only branch-only conflicts.
 */
export function pullRequestSummaryPresentation(input: {
  state: PullRequestState;
  draft: boolean;
  attention?: PullRequestAttention | string | null;
  signal?: Pick<PullRequestSignal, "checks" | "review"> | null;
  mergedLayer?: boolean;
}): StatusPresentation {
  const signalAttention = input.signal
    ? pullRequestAttentionFromSignal(input.signal)
    : null;
  const aggregateAttention =
    input.attention && input.attention !== "none" ? input.attention : null;
  // A current signal supersedes an aggregate review/check summary. This also
  // prevents an older "none" aggregate from hiding an Approved review.
  const attention =
    aggregateAttention === "conflicts"
      ? aggregateAttention
      : (signalAttention ?? aggregateAttention);
  return pullRequestPresentation({
    state: input.state,
    draft: input.draft,
    attention,
    mergedLayer: input.mergedLayer,
  });
}

export function pullRequestAttentionFromSignal(
  signal: Pick<PullRequestSignal, "checks" | "review">,
): PullRequestAttention {
  if (signal.checks === "failed") return "checks_failed";
  if (signal.checks === "pending") return "checks_pending";
  if (signal.review === "review_requested" || signal.review === "review_required")
    return "review_requested";
  if (signal.review === "changes_requested") return "changes_requested";
  if (signal.review === "approved")
    return signal.checks === "passing" || signal.checks === "none"
      ? "ready_to_merge"
      : "approved";
  return "none";
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
      tone: "closed",
    },
    review_requested: {
      icon: "Eye",
      label: "Review requested",
      tone: "warning",
    },
    review_required: {
      icon: "Eye",
      label: "Review requested",
      tone: "warning",
    },
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
  // Identity-aware coercion happens on the GitHub-reading server. The client
  // sees only a count, which must never turn another reviewer's request into
  // a re-request for the person who asked for changes.
  const review = typeof input.review === "string" ? input.review : input.review.state;
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
  limits?: {
    graphql: { limit: number; remaining: number; resetAt: number | null } | null;
    rest: { limit: number; remaining: number; resetAt: number | null } | null;
  };
}): (StatusPresentation & { detail: string }) | null {
  if (health.state === "available") return null;
  const quota = (name: string, value: { limit: number; remaining: number } | null) =>
    value ? `${name} ${value.remaining.toLocaleString()}/${value.limit.toLocaleString()}` : null;
  const quotas = [
    quota("GraphQL", health.limits?.graphql ?? null),
    quota("REST", health.limits?.rest ?? null),
  ].filter((value): value is string => value !== null);
  const compactQuotas = [
    quota("GQL", health.limits?.graphql ?? null),
    quota("REST", health.limits?.rest ?? null),
  ].filter((value): value is string => value !== null);
  const resetAt =
    health.scope === "graphql"
      ? health.limits?.graphql?.resetAt
      : health.limits?.rest?.resetAt;
  const reset =
    resetAt != null
      ? ` Resets at ${new Date(resetAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`
      : "";
  return health.state === "rate_limited"
    ? {
        icon: "AlertCircle",
        label: `${health.scope === "graphql" ? "GraphQL limited" : "GitHub limited"}${compactQuotas.length ? ` · ${compactQuotas.join(" · ")}` : ""}`,
        tone: "warning",
        detail: `${health.message ?? "GitHub API is rate limited."}${quotas.length ? ` ${quotas.join(" · ")} remaining.` : ""}${reset}`,
      }
    : {
        icon: "AlertCircle",
        label: "GitHub unavailable",
        tone: "destructive",
        detail: health.message ?? "GitHub API is unavailable.",
      };
}
