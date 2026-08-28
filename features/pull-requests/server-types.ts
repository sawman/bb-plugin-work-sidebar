import type { SidebarStack } from "../../work-model.js";

export interface CurrentPullRequest {
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
  attention: "blocked" | "changes_requested" | "checks_failed" | "checks_pending" | "closed" | "conflicts" | "draft" | "merged" | "none" | "ready_to_merge" | "review_requested";
  mergeability: {
    mergeStateStatus: "BEHIND" | "BLOCKED" | "CLEAN" | "DRAFT" | "HAS_HOOKS" | "DIRTY" | "UNKNOWN" | "UNSTABLE" | null;
    mergeable: "CONFLICTING" | "MERGEABLE" | "UNKNOWN" | null;
    state: "blocked" | "conflicts" | "draft" | "mergeable" | "unknown";
  };
  signal: {
    checks: "failed" | "passing" | "pending" | "none" | "unknown";
    review: "approved" | "changes_requested" | "changes_requested_review_requested" | "review_requested" | "review_required" | "none";
    reviewCommentCount: number;
  };
}

export type GitHubPullRequest = {
  number: number;
  state: string;
  draft: boolean;
  head: string;
  base: string;
  title: string;
  url: string;
  reviewCommentCount: number;
};

export type GitHubSignal = {
  checks: "failed" | "passing" | "pending" | "none" | "unknown";
  review: "approved" | "changes_requested" | "changes_requested_review_requested" | "review_requested" | "review_required" | "none";
  head?: string;
  base?: string;
};

export type GitHubApiRunner = (args: readonly string[], maxBuffer: number) => Promise<string>;
export type GitHubReadRunner = (args: readonly string[], maxBuffer: number, cacheTtlMs?: number) => Promise<string>;

export type AuthoredPullRequest = {
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
  reviewCommentCount: number;
  stack: SidebarStack | null;
};
