import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { useRef } from "react";
import type { PluginRpcClient } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../contracts";
import { queryPolicies } from "../../query-runtime";
import type { PullRequestReviewerContract } from "./schemas";

// This remains type-only: the app bundle sees neither the server contract
// composer nor the root SDK runtime.
export type PullRequestRpc = PluginRpcClient<typeof rpcContract>;
export type AuthoredPullRequestPolling = { intervalMs: number };

const root = ["work-sidebar", "pull-requests"] as const;

export const pullRequestKeys = {
  authored: (): QueryKey => [...root, "authored"],
  authoredStacks: (baseRevision?: number): QueryKey => [
    ...root,
    "authored",
    "stacks",
    ...(baseRevision == null ? [] : [baseRevision]),
  ],
  sidebarStacks: (threadIds: readonly string[]): QueryKey => [
    ...root,
    "sidebar-stacks",
    ...threadIds,
  ],
  health: (): QueryKey => [...root, "health"],
  reviewers: (repository?: string): QueryKey => [
    ...root,
    "reviewers",
    ...(repository ? [repository] : []),
  ],
} as const;

export const pullRequestPolicies = {
  authored: {
    staleTime: 60_000,
    gcTime: 15 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: (polling: AuthoredPullRequestPolling): number =>
      polling.intervalMs,
  },
  authoredStacks: {
    staleTime: 60_000,
    gcTime: 15 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  },
  sidebarStacks: {
    staleTime: 60_000,
    gcTime: 15 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  },
  health: {
    ...queryPolicies.health,
    refetchInterval: 30_000,
  },
  reviewers: {
    staleTime: 24 * 60 * 60_000,
    gcTime: 24 * 60 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  },
} as const;

async function authoredPullRequests(rpc: PullRequestRpc, force = false) {
  const base = await rpc.call(
    "sidebarAuthoredPullRequests",
    force ? { force: true } : {},
  );
  if (!base.available)
    throw new Error(
      base.error ?? "GitHub authored pull requests are unavailable.",
    );
  return base.pullRequests;
}

async function authoredPullRequestStacks(rpc: PullRequestRpc) {
  const stacks = await rpc.call("sidebarAuthoredPullRequestStacks", null);
  if (!stacks.available)
    throw new Error(
      stacks.error ?? "GitHub pull-request stacks are unavailable.",
    );
  return stacks.pullRequests;
}

async function sidebarPullRequestStacks(
  rpc: PullRequestRpc,
  threadIds: readonly string[],
) {
  const result = await rpc.call("sidebarPullRequestStacks", {
    threadIds: [...threadIds],
  });
  if (!result.available)
    throw new Error(
      result.error ?? "GitHub pull-request stacks are unavailable.",
    );
  return result.stacks;
}

async function pullRequestReviewers(
  rpc: PullRequestRpc,
  repository: string,
  force = false,
): Promise<PullRequestReviewerContract[]> {
  const result = await rpc.call(
    "getPullRequestReviewers",
    force ? { repository, force: true } : { repository },
  );
  if (!result.available)
    throw new Error(result.error ?? "GitHub reviewers are unavailable.");
  return result.reviewers;
}

async function refreshLoadedReviewerDirectories(
  client: QueryClient,
  rpc: PullRequestRpc,
) {
  const loaded = client.getQueriesData({
    queryKey: pullRequestKeys.reviewers(),
  });
  await Promise.all(
    loaded.flatMap(([queryKey]) => {
      const repository = queryKey[3];
      if (typeof repository !== "string") return [];
      return [
        client.fetchQuery({
          queryKey: pullRequestKeys.reviewers(repository),
          queryFn: () => pullRequestReviewers(rpc, repository, true),
          ...pullRequestPolicies.reviewers,
          staleTime: 0,
        }),
      ];
    }),
  );
}

export function useSidebarPullRequestStacks(
  rpc: PullRequestRpc,
  threadIds: readonly string[],
  enabled: boolean,
) {
  const normalizedThreadIds = [...new Set(threadIds)].sort().slice(0, 200);
  return useQuery({
    queryKey: pullRequestKeys.sidebarStacks(normalizedThreadIds),
    queryFn: () => sidebarPullRequestStacks(rpc, normalizedThreadIds),
    ...pullRequestPolicies.sidebarStacks,
    enabled: enabled && normalizedThreadIds.length > 0,
  });
}

export function invalidateSidebarPullRequestStacks(client: {
  invalidateQueries(filters: {
    queryKey: QueryKey;
  }): Promise<unknown> | unknown;
}) {
  return client.invalidateQueries({
    queryKey: [...root, "sidebar-stacks"],
  });
}

export function useAuthoredPullRequests(
  rpc: PullRequestRpc,
  polling: AuthoredPullRequestPolling = { intervalMs: 300_000 },
) {
  const client = useQueryClient();
  const forceRefresh = useRef(false);
  const base = useQuery({
    queryKey: pullRequestKeys.authored(),
    queryFn: () => authoredPullRequests(rpc, forceRefresh.current),
    ...pullRequestPolicies.authored,
    refetchInterval: pullRequestPolicies.authored.refetchInterval(polling),
  });
  const stacks = useQuery({
    // A successful base read defines the stack projection generation. This
    // prevents a slightly later base response from hiding valid enrichment
    // until the next polling interval.
    queryKey: pullRequestKeys.authoredStacks(base.dataUpdatedAt),
    queryFn: () => authoredPullRequestStacks(rpc),
    enabled: base.isSuccess,
    ...pullRequestPolicies.authoredStacks,
  });
  const enriched = stacks.data ?? base.data;
  const refresh = async () => {
    await Promise.all([
      client.cancelQueries({ queryKey: pullRequestKeys.authored() }),
      client.cancelQueries({ queryKey: pullRequestKeys.authoredStacks() }),
    ]);
    forceRefresh.current = true;
    try {
      const refreshedBase = await base.refetch({ throwOnError: true });
      await Promise.all([
        client.fetchQuery({
          queryKey: pullRequestKeys.authoredStacks(refreshedBase.dataUpdatedAt),
          queryFn: () => authoredPullRequestStacks(rpc),
          ...pullRequestPolicies.authoredStacks,
        }),
        refreshLoadedReviewerDirectories(client, rpc),
      ]);
    } finally {
      forceRefresh.current = false;
    }
  };
  return {
    ...base,
    data: enriched,
    isFetching: base.isFetching || stacks.isFetching,
    stackError: stacks.error,
    refresh,
  };
}

export function useGitHubApiHealth(
  rpc: PullRequestRpc,
  { poll = false, enabled = true }: { poll?: boolean; enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: pullRequestKeys.health(),
    queryFn: () => rpc.call("getGitHubApiHealth", null),
    ...pullRequestPolicies.health,
    enabled,
    refetchInterval: poll ? pullRequestPolicies.health.refetchInterval : false,
    refetchIntervalInBackground: false,
  });
}

export function invalidateGitHubApiHealth(client: {
  invalidateQueries(filters: {
    queryKey: QueryKey;
  }): Promise<unknown> | unknown;
}) {
  return client.invalidateQueries({ queryKey: pullRequestKeys.health() });
}

export function useSetAuthoredPullRequestDraft(rpc: PullRequestRpc) {
  const client = useQueryClient();
  return useMutation({
    // The control can be invoked twice before React paints its disabled state.
    // A shared Query scope serializes that work without a duplicate React ref.
    scope: { id: "authored-pull-request-draft" },
    mutationFn: ({ url, draft }: { url: string; draft: boolean }) =>
      rpc.call("setAuthoredPullRequestDraft", { url, draft }),
    onSettled: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: pullRequestKeys.authored() }),
        client.invalidateQueries({
          queryKey: pullRequestKeys.authoredStacks(),
        }),
      ]);
    },
  });
}

export function usePullRequestReviewers(
  rpc: PullRequestRpc,
  repository: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: pullRequestKeys.reviewers(repository),
    queryFn: () => pullRequestReviewers(rpc, repository),
    ...pullRequestPolicies.reviewers,
    enabled: enabled && repository.length > 0,
  });
}

export function useUpdatePullRequestReviewers(
  rpc: PullRequestRpc,
  callbacks: {
    onSuccess?(): void;
    onError?(error: Error): void;
  } = {},
) {
  const client = useQueryClient();
  return useMutation({
    scope: { id: "pull-request-reviewers" },
    mutationFn: (input: {
      repository: string;
      number: number;
      reviewers: string[];
    }) => rpc.call("updatePullRequestReviewers", input),
    onSuccess: () => callbacks.onSuccess?.(),
    onError: (error) => callbacks.onError?.(error),
    onSettled: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: pullRequestKeys.authored() }),
        client.invalidateQueries({
          queryKey: pullRequestKeys.authoredStacks(),
        }),
        client.invalidateQueries({
          queryKey: [...root, "sidebar-stacks"],
        }),
      ]);
    },
  });
}
