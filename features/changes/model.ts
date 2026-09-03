import type { GitHubStackBranch, GitHubStackSignal } from "../../contracts.js";
import type { Changes, Repository } from "./schemas.js";

export type StackBranchSignals = Pick<
  GitHubStackSignal,
  "state" | "draft" | "attention" | "checks" | "review" | "reviewCommentCount"
>;

/** Merge the stack summary and branch-local signals without weakening RPC types. */
export function mergeStackBranchSignals(
  branch: GitHubStackBranch,
  changes: Changes,
  currentPullRequest = changes.currentPullRequest,
): StackBranchSignals | undefined {
  const stackPullRequest = changes.stack?.pullRequests.find(
    (pullRequest) =>
      pullRequest.number === branch.pr?.number ||
      pullRequest.head === branch.name,
  );
  const current =
    branch.pr?.number === currentPullRequest?.number
      ? currentPullRequest
      : null;

  if (current) {
    return {
      ...stackPullRequest,
      state: current.state,
      draft: current.state === "draft",
      attention: current.attention,
      ...current.signal,
    };
  }
  if (!branch.pr) return stackPullRequest;
  return {
    ...stackPullRequest,
    state: stackPullRequest?.state ?? branch.pr.state,
    draft: stackPullRequest?.draft ?? branch.pr.isDraft,
    attention: stackPullRequest?.attention,
    checks: branch.checks ?? stackPullRequest?.checks ?? "unknown",
    review: branch.review ?? stackPullRequest?.review ?? "none",
    reviewCommentCount: stackPullRequest?.reviewCommentCount ?? 0,
  };
}

export const changesKeys = {
  projection: (threadId: string) =>
    ["work-sidebar", "changes", threadId, "projection"] as const,
  fingerprint: (threadId: string, url: string) =>
    ["work-sidebar", "changes", threadId, "fingerprint", url] as const,
  fileDiff: (threadId: string, fingerprint: string | null, path: string) =>
    [
      "work-sidebar",
      "changes",
      threadId,
      "file-diff",
      fingerprint ?? "unknown",
      path,
    ] as const,
  pullRequestFileDiff: (threadId: string, pullRequestNumber: number, path: string) =>
    [
      "work-sidebar",
      "changes",
      threadId,
      "pull-request-file-diff",
      pullRequestNumber,
      path,
    ] as const,
};
export const changesPolicies = {
  projection: {
    staleTime: 30_000,
    gcTime: 10 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  },
  fingerprint: {
    staleTime: 0,
    gcTime: 2 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchIntervalInBackground: true,
  },
  fileDiff: {
    staleTime: Infinity,
    gcTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  },
} as const;

export function repositoryPresentation(repository: Repository) {
  if (repository.outcome !== "available")
    return { label: "Unavailable", tone: "unavailable" as const };
  return repository.hasUncommittedChanges
    ? { label: "Changed", tone: "changed" as const }
    : { label: "Clean", tone: "clean" as const };
}

export function changesHeaderLabel(
  changes: Changes | undefined,
  pending: boolean,
  error: boolean,
) {
  if (pending) return "Loading…";
  if (error) return "Unavailable";
  return changes?.currentPullRequest
    ? `#${changes.currentPullRequest.number}`
    : "No PR";
}
