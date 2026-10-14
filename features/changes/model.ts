import type { GitHubStackBranch, GitHubStackSignal } from "../../contracts.js";
import type { Changes, Repository, RemoteFiles, RemoteFilesInput } from "./schemas.js";
import {
  pullRequestFactKey,
  type PullRequestFactDirectory,
} from "../pull-requests/facts";

export type StackBranchSignals = Pick<
  GitHubStackSignal,
  | "state"
  | "draft"
  | "attention"
  | "checks"
  | "review"
  | "approvers"
  | "changeRequesters"
  | "requestedReviewers"
  | "reviewCommentCount"
  | "reviewCommentCounts"
> & { title?: string; url?: string };

/** Merge the stack summary and branch-local signals without weakening RPC types. */
export function mergeStackBranchSignals(
  branch: GitHubStackBranch,
  changes: Omit<Changes, "repository">,
  currentPullRequest = changes.currentPullRequest,
  facts?: PullRequestFactDirectory,
): StackBranchSignals | undefined {
  const sharedFact = branch.pr
    ? facts?.facts[pullRequestFactKey(branch.pr)]
    : undefined;
  if (sharedFact)
    return {
      state: sharedFact.state,
      draft: sharedFact.draft,
      title: sharedFact.title,
      url: sharedFact.url,
      attention: sharedFact.attention,
      ...sharedFact.signal,
    };
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
      title: current.title,
      url: current.url,
      attention: current.attention,
      ...current.signal,
    };
  }
  if (!branch.pr) return stackPullRequest;
  return {
    ...stackPullRequest,
    state: stackPullRequest?.state ?? (branch.isMerged ? "merged" : branch.pr.state),
    draft: stackPullRequest?.draft ?? branch.pr.isDraft,
    attention: stackPullRequest?.attention,
    checks: branch.checks ?? stackPullRequest?.checks ?? "unknown",
    review: branch.review ?? stackPullRequest?.review ?? "none",
    reviewCommentCount: stackPullRequest?.reviewCommentCount ?? 0,
    reviewCommentCounts: stackPullRequest?.reviewCommentCounts,
  };
}

export function remoteChangesIdentity(summary: Omit<Changes, "repository" | "githubStack"> | undefined) {
  const current = summary?.currentPullRequest;
  if (!current) return null;
  const match = current.url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/\d+$/i);
  if (!match) return null;
  const repository = `${match[1]}/${match[2]}`.toLowerCase();
  const members = summary.stack?.pullRequests.length ? summary.stack.pullRequests : [current];
  if (members.some((member) => {
    const memberRepo = member.url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/\d+$/i);
    return !memberRepo || `${memberRepo[1]}/${memberRepo[2]}`.toLowerCase() !== repository;
  })) return null;
  const pullRequests = members.map((member) => ({
    url: member.url.replace(/^https:\/\/github\.com\/[^/]+\/[^/]+/i, `https://github.com/${repository}`),
    head: member.head, base: member.base,
  })).sort((left, right) => left.url.localeCompare(right.url));
  return { repository, content: JSON.stringify([summary.stack?.number ?? null, summary.stack?.base ?? current.base, pullRequests]), input: { pullRequests } satisfies RemoteFilesInput };
}

/** Remote-only rows are a readiness fallback; local roster/diffs always win. */
export function remoteFilesProjection(summary: Omit<Changes, "repository" | "githubStack">, remote: RemoteFiles | undefined) {
  if (!remote?.files?.length || !summary.currentPullRequest) return null;
  const members = summary.stack?.pullRequests.length ? summary.stack.pullRequests : [summary.currentPullRequest];
  return {
    stack: {
      trunk: summary.stack?.base ?? summary.currentPullRequest.base, currentBranch: null,
      trunkBehind: null, prunableBranchCount: null,
      branches: members.map((member) => ({
        name: member.head, isCurrent: false, isMerged: false, isQueued: false,
        needsRebase: false, hasStash: false, stashCount: null,
        aheadOfRemote: null, behindRemote: null,
        pr: { number: member.number, url: member.url, state: member.state, title: member.title,
          isDraft: "draft" in member ? member.draft : member.state === "draft", metadataStale: false },
        diff: remote.files.find((entry) => entry.url.toLowerCase() === member.url.toLowerCase()
          && entry.head === member.head && entry.base === member.base)?.diff ?? null,
      })),
    }, pending: null, error: null,
  };
}
export const changesKeys = {
  remoteFiles: (repository: string, content?: string) =>
    ["work-sidebar", "changes-remote", repository, ...(content === undefined ? [] : [content])] as const,
  repository: (threadId: string) =>
    ["work-sidebar", "changes", threadId, "repository"] as const,
  summary: (threadId: string) =>
    ["work-sidebar", "changes", threadId, "summary"] as const,
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
  pullRequestFileDiff: (threadId: string, pullRequestNumber: number, path: string, identity?: string) =>
    [
      "work-sidebar",
      "changes",
      threadId,
      "pull-request-file-diff",
      ...(identity === undefined ? [] : [identity]),
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
