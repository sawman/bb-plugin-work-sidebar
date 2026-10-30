import type { SidebarStack } from "../../work-model.js";

export interface CurrentPullRequest {
  observations?: import("./schemas.js").PullRequestObservations;
  number: number;
  title: string;
  url: string;
  state: "closed" | "draft" | "merged" | "open";
  head: string;
  base: string;
  checks: {
    failedCount: number;
    passedCount: number;
    pendingCount: number;
    state: "failing" | "no_checks" | "passing" | "pending" | "unknown";
    totalCount: number;
  };
  review: {
    reviewRequestCount: number;
    state: "approved" | "changes_requested" | "none" | "review_requested" | "review_required";
  };
  attention: "approved" | "blocked" | "changes_requested" | "checks_failed" | "checks_pending" | "closed" | "conflicts" | "draft" | "merged" | "none" | "queued" | "ready_to_merge" | "review_requested";
  mergeability: {
    mergeStateStatus: "BEHIND" | "BLOCKED" | "CLEAN" | "DRAFT" | "HAS_HOOKS" | "DIRTY" | "UNKNOWN" | "UNSTABLE" | null;
    mergeable: "CONFLICTING" | "MERGEABLE" | "UNKNOWN" | null;
    state: "blocked" | "conflicts" | "draft" | "mergeable" | "unknown";
  };
  signal: {
    approvers?: string[];
    checks: "failed" | "passing" | "pending" | "none" | "unknown";
    changeRequesters?: string[];
    review: "approved" | "changes_requested" | "review_requested" | "review_required" | "none";
    requestedReviewers?: string[];
    reviewCommentCount: number;
    reviewCommentCounts?: ReviewCommentCounts | null;
  };
}

export type ReviewCommentCounts = {
  unresolved: number;
  resolved: number;
};

export type GitHubPullRequest = {
  observations?: import("./schemas.js").PullRequestObservations;
  number: number;
  state: "closed" | "draft" | "merged" | "open";
  draft: boolean;
  head: string;
  base: string;
  title: string;
  url: string;
  reviewCommentCount: number;
};

export type GitHubSignal = {
  reviewCommentCount?: number;
  observations?: import("./schemas.js").PullRequestObservations;
  title?: string;
  url?: string;
  state?: "open" | "closed" | "merged" | "draft";
  draft?: boolean;
  checkDetails?: CurrentPullRequest["checks"];
  reviewRequestCount?: number;
  mergeability?: CurrentPullRequest["mergeability"];
  attention?: CurrentPullRequest["attention"];
  approvers?: string[];
  checks: "failed" | "passing" | "pending" | "none" | "unknown";
  changeRequesters?: string[];
  review: "approved" | "changes_requested" | "review_requested" | "review_required" | "none";
  requestedReviewers?: string[];
  reviewCommentCounts?: ReviewCommentCounts;
  head?: string;
  base?: string;
};

export type GitHubApiRunner = (args: readonly string[], maxBuffer: number, policy?: import("../../shared/github/read-cache.js").GitHubReadPolicy) => Promise<string>;
export type GitHubReadRunner = (args: readonly string[], maxBuffer: number, cacheTtlMs?: number, identity?: string, policy?: import("../../shared/github/read-cache.js").GitHubReadPolicy) => Promise<string>;

export type AuthoredPullRequest = {
  observations?: import("./schemas.js").PullRequestObservations;
  attention?: CurrentPullRequest["attention"];
  mergeability?: CurrentPullRequest["mergeability"] | null;
  number: number;
  title: string;
  url: string;
  repository: string;
  state: "open" | "draft";
  draft: boolean;
  head: string;
  base: string;
  checks: GitHubSignal["checks"];
  review: GitHubSignal["review"];
  approvers?: string[];
  changeRequesters?: string[];
  requestedReviewers?: string[];
  reviewCommentCount: number;
  reviewCommentCounts?: ReviewCommentCounts | null;
  stack: SidebarStack | null;
};
