import type { BbPluginApi, PluginRpcHandlers } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { rpcContract, type GitHubStackBranch } from "../../contracts.js";
import type { ServerLifecycle } from "../../server-lifecycle.js";
import type { PullRequestChangesAdapter } from "../../shared/server-composition-dependencies.js";
import type { PluginRpcInput } from "../../shared/server-plugin-rpc.js";
import type { SidebarStack } from "../../work-model.js";
import { normalizePullRequestSignal } from "./presentation.js";
import {
  fetchGitHubStack,
  readGitHubPullRequestDiff,
} from "./server-stack.js";
import type { CurrentPullRequest, GitHubReadRunner } from "./server-types.js";

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
export type ThreadStackService = ThreadStackHandlers & Pick<PullRequestChangesAdapter, "projection" | "checkout">;

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
      const currentPullRequest = projectCurrentPullRequest({
        number: result.pullRequest.number, title: result.pullRequest.title, url: result.pullRequest.url, state: result.pullRequest.state,
        head: result.pullRequest.headRefName, base: result.pullRequest.baseRefName, checks: result.pullRequest.checks, review: result.pullRequest.review,
        attention: result.pullRequest.attention, mergeability: result.pullRequest.mergeability,
        signal: normalizePullRequestSignal({ checks: result.pullRequest.checks, review: result.pullRequest.review }),
      });
      const match = currentPullRequest.url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
      if (!match) return { currentPullRequest, stack: null, reason: "The linked pull request is not hosted on GitHub." };
      const stack = await fetchGitHubStack(match[1], match[2], currentPullRequest.number, (args, buffer) => read(args, buffer), lifecycle);
      return stack ? { currentPullRequest, stack, reason: null } : { currentPullRequest, stack: null, reason: "This pull request is not part of a Stack." };
    } catch (error) {
      return { currentPullRequest: null, stack: null, reason: error instanceof Error ? `Pull request unavailable: ${error.message}` : "Pull request unavailable." };
    }
  };
  const projection: PullRequestChangesAdapter["projection"] = async (threadId) => {
    const remote = await stackForThread(threadId);
    try {
      const payload = await githubStackCall("getStack", { threadId }, ghStackPayloadSchema);
      const stack = payload.stack ? {
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
        const pullRequests: Record<string, { number: number; title: string; url: string; state: "closed" | "draft" | "merged" | "open"; attention: CurrentPullRequest["attention"] } | null> = {};
        for (const threadId of [...new Set(threadIds)]) {
          const stack = await stackForThread(threadId);
          const pullRequest = stack.currentPullRequest;
          pullRequests[threadId] = pullRequest ? { number: pullRequest.number, title: pullRequest.title, url: pullRequest.url, state: pullRequest.state, attention: pullRequest.attention } : null;
        }
        return { available: true, pullRequests, error: null };
      } catch (error) {
        return { available: false, pullRequests: {}, error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
  const checkout: PullRequestChangesAdapter["checkout"] = (threadId, branch) =>
    githubStackCall("checkoutBranch", { threadId, branch }, ghStackActionSchema);
  return { ...handlers, projection, checkout };
}
