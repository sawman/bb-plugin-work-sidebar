import type { BbPluginApi, PluginRpcHandlers } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { rpcContract, type GitHubStackBranch } from "../../contracts.js";
import type { ServerLifecycle } from "../../server-lifecycle.js";
import type { PullRequestChangesAdapter } from "../../shared/server-composition-dependencies.js";
import type { PluginRpcInput } from "../../shared/server-plugin-rpc.js";
import type { SidebarStack } from "../../work-model.js";
import {
  normalizePullRequestSignal,
  pullRequestAttentionFromSignal,
} from "./presentation.js";
import {
  fetchGitHubStack,
  needsGitHubPullRequestRecovery,
  readGitHubPullRequestFilePatch,
  readGitHubPullRequestRest,
  readGitHubPullRequestDiff,
  readGitHubSignals,
} from "./server-stack.js";
import type {
  CurrentPullRequest,
  GitHubPullRequest,
  GitHubReadRunner,
  GitHubSignal,
} from "./server-types.js";

const GITHUB_STACK_PLUGIN_ID = "gh-stack";

type GitHubStackProjection = {
  trunk: string;
  currentBranch: string | null;
  branches: GitHubStackBranch[];
  trunkBehind: number | null;
  prunableBranchCount: number | null;
};

type ThreadStackHandlers = Pick<
  PluginRpcHandlers<typeof rpcContract>,
  "sidebarPullRequestStacks" | "sidebarThreadPullRequests"
>;
export type ThreadStackService = ThreadStackHandlers & Pick<PullRequestChangesAdapter, "projection" | "checkout" | "fileDiff">;

const ghStackPayloadSchema = z.object({
  stack: z.object({
    trunk: z.string(),
    currentBranch: z.string().nullable(),
    branches: z.array(z.object({
      name: z.string(), isCurrent: z.boolean(), isMerged: z.boolean(), isQueued: z.boolean(), needsRebase: z.boolean(),
      hasStash: z.boolean(), stashCount: z.number().int().nonnegative().nullable(),
      pr: z.object({ number: z.number(), url: z.string().url(), state: z.string(), title: z.string().nullable(), isDraft: z.boolean(), metadataStale: z.boolean() }).nullable(),
      diff: z.object({
        additions: z.number(), deletions: z.number(),
        files: z.array(z.object({ path: z.string(), previousPath: z.string().nullable(), status: z.enum(["added", "deleted", "modified", "renamed", "untracked"]), additions: z.number().nullable(), deletions: z.number().nullable() })),
        truncated: z.boolean(),
      }).nullable(),
      aheadOfRemote: z.number().nullable(), behindRemote: z.number().nullable(),
    })),
    trunkBehind: z.number().nullable(), prunableBranchCount: z.number().int().nonnegative().nullable(),
  }).nullable(),
  pending: z.object({
    additions: z.number(),
    deletions: z.number(),
    files: z.array(z.object({
      path: z.string(),
      previousPath: z.string().nullable(),
      status: z.enum(["added", "deleted", "modified", "renamed", "untracked"]),
      additions: z.number().nullable(),
      deletions: z.number().nullable(),
    })),
    truncated: z.boolean(),
  }).nullable(),
  error: z.object({ kind: z.string(), message: z.string() }).nullable(),
  fetchedAt: z.number(),
});
const ghStackActionSchema = z.object({ ok: z.boolean(), message: z.string(), tone: z.enum(["success", "warning", "error"]).optional(), detail: z.string().nullable() });

function projectCurrentPullRequest(pullRequest: CurrentPullRequest): CurrentPullRequest {
  return {
    ...pullRequest,
    checks: { ...pullRequest.checks },
    review: { ...pullRequest.review },
    mergeability: { ...pullRequest.mergeability },
    signal: { ...pullRequest.signal },
  };
}

function currentPullRequestRecord(
  pullRequest: CurrentPullRequest,
): GitHubPullRequest {
  return {
    number: pullRequest.number,
    state: pullRequest.state,
    draft: pullRequest.state === "draft",
    head: pullRequest.head,
    base: pullRequest.base,
    title: pullRequest.title,
    url: pullRequest.url,
    reviewCommentCount: pullRequest.signal.reviewCommentCount,
  };
}

function restCurrentPullRequestState(
  pullRequest: GitHubPullRequest,
): CurrentPullRequest["state"] {
  if (pullRequest.state === "merged") return "merged";
  if (pullRequest.draft) return "draft";
  return pullRequest.state === "closed" ? "closed" : "open";
}

function applyRestPullRequestRecovery(
  current: CurrentPullRequest,
  recovered: Awaited<ReturnType<typeof readGitHubPullRequestRest>>,
): CurrentPullRequest {
  if (!recovered) return current;
  const { pullRequest, signal } = recovered;
  return {
    ...current,
    title: pullRequest.title || current.title,
    url: pullRequest.url || current.url,
    state: restCurrentPullRequestState(pullRequest),
    head: pullRequest.head || current.head,
    base: pullRequest.base || current.base,
    checks: recovered.checks,
    review: {
      reviewRequestCount: recovered.reviewRequestCount,
      state: signal.review,
    },
    attention: pullRequestAttentionFromSignal(signal),
    signal: { ...signal, reviewCommentCount: pullRequest.reviewCommentCount },
  };
}

/** GitHub facts refresh review/check state; BB still owns branch-local details. */
function applyGitHubPullRequestSignal(
  current: CurrentPullRequest,
  signal: GitHubSignal | undefined,
): CurrentPullRequest {
  if (!signal) return current;
  const checkState = signal.checks === "failed"
    ? "failing"
    : signal.checks === "none"
      ? "no_checks"
      : signal.checks;
  return {
    ...current,
    checks: {
      ...current.checks,
      state: checkState,
    },
    review: {
      reviewRequestCount: signal.requestedReviewers?.length ?? current.review.reviewRequestCount,
      state: signal.review,
    },
    attention: current.attention === "conflicts"
      ? current.attention
      : pullRequestAttentionFromSignal(signal),
    signal: {
      ...signal,
      reviewCommentCount: current.signal.reviewCommentCount,
    },
  };
}

function mergeRecoveredStackBranches(
  stack: GitHubStackProjection,
  recovered: readonly (GitHubPullRequest & { checks: GitHubStackBranch["checks"]; review: GitHubStackBranch["review"] })[],
): GitHubStackProjection {
  const byNumber = new Map(recovered.map((pullRequest) => [pullRequest.number, pullRequest]));
  return {
    ...stack,
    branches: stack.branches.map((branch) => {
      const pullRequest = branch.pr ? byNumber.get(branch.pr.number) : null;
      if (!pullRequest) return branch;
      return {
        ...branch,
        name: branch.name || pullRequest.head,
        pr: {
          ...branch.pr!,
          url: branch.pr!.url || pullRequest.url,
          state: branch.pr!.state || pullRequest.state,
          title: branch.pr!.title || pullRequest.title,
          isDraft: branch.pr!.isDraft || pullRequest.draft,
        },
        checks: pullRequest.checks,
        review: pullRequest.review,
      };
    }),
  };
}

function standalonePullRequestStack(
  pullRequest: CurrentPullRequest,
): GitHubStackProjection {
  return {
    trunk: pullRequest.base,
    currentBranch: pullRequest.head,
    branches: [
      {
        name: pullRequest.head,
        isCurrent: true,
        isMerged: pullRequest.state === "merged",
        isQueued: false,
        needsRebase: pullRequest.mergeability.mergeStateStatus === "BEHIND",
        hasStash: false,
        stashCount: null,
        pr: {
          number: pullRequest.number,
          url: pullRequest.url,
          state: pullRequest.state,
          title: pullRequest.title,
          isDraft: pullRequest.state === "draft",
          metadataStale: false,
        },
        diff: null,
        aheadOfRemote: null,
        behindRemote: null,
        checks: pullRequest.signal.checks,
        review: pullRequest.signal.review,
      },
    ],
    trunkBehind: null,
    prunableBranchCount: null,
  };
}

async function hydratePullRequestDiffs(
  stack: GitHubStackProjection | null,
  pullRequest: CurrentPullRequest | null,
  read: GitHubReadRunner,
): Promise<GitHubStackProjection | null> {
  const projection = stack ??
    (pullRequest ? standalonePullRequestStack(pullRequest) : null);
  const repository = pullRequest?.url.match(
    /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/\d+/,
  );
  if (!projection || !repository) return projection;
  return {
    ...projection,
    branches: await Promise.all(
      projection.branches.map(async (branch) => {
        if (branch.diff || !branch.pr) return branch;
        try {
          return {
            ...branch,
            diff: await readGitHubPullRequestDiff(
              repository[1],
              repository[2],
              branch.pr.number,
              (args, buffer) => read(args, buffer),
            ),
          };
        } catch {
          return branch;
        }
      }),
    ),
  };
}

/** Thread-facing Stack projection and gh-stack RPC adapter. REST enrichment stays in server-stack. */
export function createThreadStackService(
  bb: BbPluginApi,
  lifecycle: ServerLifecycle,
  read: GitHubReadRunner,
): ThreadStackService {
  const githubStackCall = <T>(method: string, input: PluginRpcInput, outputSchema: z.ZodType<T>) =>
    bb.sdk.plugins.callRpc({ pluginId: GITHUB_STACK_PLUGIN_ID, method, input, outputSchema });
  const stackForThread = async (threadId: string) => {
    const thread = await bb.sdk.threads.get({ threadId });
    if (!thread.environmentId) return { currentPullRequest: null, stack: null, reason: "This thread has no workspace branch." };
    try {
      const result = await bb.sdk.environments.pullRequest({ environmentId: thread.environmentId });
      if (result.outcome !== "available") {
        return { currentPullRequest: null, stack: null, reason: result.outcome === "unavailable" ? result.message : "No GitHub pull request is linked to this branch." };
      }
      let currentPullRequest = projectCurrentPullRequest({
        number: result.pullRequest.number, title: result.pullRequest.title, url: result.pullRequest.url, state: result.pullRequest.state,
        head: result.pullRequest.headRefName, base: result.pullRequest.baseRefName, checks: result.pullRequest.checks, review: result.pullRequest.review,
        attention: result.pullRequest.attention, mergeability: result.pullRequest.mergeability,
        signal: normalizePullRequestSignal({ checks: result.pullRequest.checks, review: result.pullRequest.review }),
      });
      const match = currentPullRequest.url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
      if (!match) return { currentPullRequest, stack: null, reason: "The linked pull request is not hosted on GitHub." };
      if (needsGitHubPullRequestRecovery(currentPullRequestRecord(currentPullRequest))) {
        currentPullRequest = applyRestPullRequestRecovery(
          currentPullRequest,
          await readGitHubPullRequestRest(
            match[1],
            match[2],
            currentPullRequest.number,
            lifecycle,
            (args, buffer) => read(args, buffer),
          ),
        );
      }
      const stack = await fetchGitHubStack(match[1], match[2], currentPullRequest.number, (args, buffer) => read(args, buffer), lifecycle);
      const signal = stack?.pullRequests.find((pullRequest) =>
        pullRequest.number === currentPullRequest.number,
      ) ?? (await readGitHubSignals(
        match[1],
        match[2],
        [currentPullRequest.number],
        lifecycle,
        (args, buffer) => read(args, buffer),
      )).get(currentPullRequest.number);
      currentPullRequest = applyGitHubPullRequestSignal(
        currentPullRequest,
        signal,
      );
      return stack ? { currentPullRequest, stack, reason: null } : { currentPullRequest, stack: null, reason: "This pull request is not part of a Stack." };
    } catch (error) {
      return { currentPullRequest: null, stack: null, reason: error instanceof Error ? `Pull request unavailable: ${error.message}` : "Pull request unavailable." };
    }
  };
  const projection: PullRequestChangesAdapter["projection"] = async (threadId) => {
    const remote = await stackForThread(threadId);
    try {
      const payload = await githubStackCall("getStack", { threadId }, ghStackPayloadSchema);
      const payloadStack = payload.stack ? {
        ...payload.stack,
        branches: payload.stack.branches.map((branch) => ({ ...branch })),
      } : remote.stack ? {
        trunk: remote.stack.base,
        currentBranch: null,
        branches: remote.stack.pullRequests.map((pullRequest) => ({
          name: pullRequest.head,
          isCurrent: pullRequest.number === remote.stack?.currentPullRequest,
          isMerged: pullRequest.state.toLowerCase() === "merged",
          isQueued: false,
          needsRebase: false,
          hasStash: false,
          stashCount: null,
          pr: { number: pullRequest.number, url: pullRequest.url, state: pullRequest.state, title: pullRequest.title, isDraft: pullRequest.draft, metadataStale: false },
          diff: null,
          aheadOfRemote: null,
          behindRemote: null,
          checks: pullRequest.checks,
          review: pullRequest.review,
        })),
        trunkBehind: null,
        prunableBranchCount: null,
      } : null;
      const stack = payloadStack && remote.stack
        ? mergeRecoveredStackBranches(payloadStack, remote.stack.pullRequests)
        : payloadStack;
      const stackWithChanges = await hydratePullRequestDiffs(
        stack,
        remote.currentPullRequest,
        read,
      );
      return {
        currentPullRequest: remote.currentPullRequest,
        stack: remote.stack,
        stackUnavailableReason: remote.reason,
        githubStack: { stack: stackWithChanges, pending: payload.pending, error: payload.error?.message ?? null },
      };
    } catch (error) {
      const fallbackStack = await hydratePullRequestDiffs(
        null,
        remote.currentPullRequest,
        read,
      );
      return {
        currentPullRequest: remote.currentPullRequest,
        stack: remote.stack,
        stackUnavailableReason: remote.reason,
        githubStack: remote.stack ? null : {
          stack: fallbackStack,
          pending: null,
          error: error instanceof Error ? error.message : "GitHub Stack is unavailable.",
        },
      };
    }
  };
  const handlers: ThreadStackHandlers = {
    async sidebarPullRequestStacks({ threadIds }) {
      try {
        const entries = await Promise.all([...new Set(threadIds)].map(async (threadId) => [threadId, await stackForThread(threadId)] as const));
        const stacks = Object.fromEntries(entries.flatMap(([threadId, entry]) => {
          if (!entry.stack) return [];
          const stack: SidebarStack = {
            id: `github-stack:${threadId}:${entry.stack.number}`,
            number: entry.stack.number,
            base: entry.stack.base,
            currentPullRequest: entry.stack.currentPullRequest,
            pullRequests: entry.stack.pullRequests.map((pullRequest) => ({
              number: pullRequest.number, title: pullRequest.title, state: pullRequest.state, draft: pullRequest.draft,
              url: pullRequest.url, head: pullRequest.head, base: pullRequest.base, checks: pullRequest.checks,
              review: pullRequest.review, reviewCommentCount: pullRequest.reviewCommentCount,
            })),
          };
          return [[threadId, stack] as const];
        }));
        return {
          available: true,
          stacks,
          mergeTargets: Object.fromEntries(entries.flatMap(([threadId, entry]) => entry.currentPullRequest?.base ? [[threadId, entry.currentPullRequest.base] as const] : [])),
          error: null,
        };
      } catch (error) {
        return { available: false, stacks: {}, mergeTargets: {}, error: error instanceof Error ? error.message : String(error) };
      }
    },
    async sidebarThreadPullRequests({ threadIds }) {
      try {
        const pullRequests: Record<
          string,
          (CurrentPullRequest & { stackNumber: number | null }) | null
        > = {};
        const uniqueThreadIds = [...new Set(threadIds)];
        // The directory is a roster read, not a serial N-request waterfall.
        // Keep concurrency bounded so its GitHub-backed entries still respect
        // the lifecycle's shared rate-limit and dedupe policy.
        for (let start = 0; start < uniqueThreadIds.length; start += 8) {
          const entries = await Promise.all(
            uniqueThreadIds.slice(start, start + 8).map(async (threadId) => {
              const stack = await stackForThread(threadId);
              return [
                threadId,
                stack.currentPullRequest
                  ? {
                      ...stack.currentPullRequest,
                      stackNumber: stack.stack?.number ?? null,
                    }
                  : null,
              ] as const;
            }),
          );
          for (const [threadId, pullRequest] of entries)
            pullRequests[threadId] = pullRequest;
        }
        return { available: true, pullRequests, error: null };
      } catch (error) {
        return { available: false, pullRequests: {}, error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
  const checkout: PullRequestChangesAdapter["checkout"] = (threadId, branch) =>
    githubStackCall("checkoutBranch", { threadId, branch }, ghStackActionSchema);
  const fileDiff: PullRequestChangesAdapter["fileDiff"] = async (
    threadId,
    pullRequestNumber,
    path,
  ) => {
    const remote = await stackForThread(threadId);
    const current = remote.currentPullRequest;
    const repository = current?.url.match(
      /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/\d+/,
    );
    if (!repository)
      return {
        kind: "unavailable",
        path,
        patch: null,
        message: "This pull request is no longer available for the thread.",
      };
    try {
      return await readGitHubPullRequestFilePatch(
        repository[1],
        repository[2],
        pullRequestNumber,
        path,
        (args, buffer) => read(args, buffer),
      );
    } catch (error) {
      return {
        kind: "unavailable",
        path,
        patch: null,
        message: error instanceof Error ? error.message : "Could not load the pull request file diff.",
      };
    }
  };
  return { ...handlers, projection, checkout, fileDiff };
}
