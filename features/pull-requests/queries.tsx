import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import { useRef } from "react";
import type { PluginRpcClient } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../contracts";
import { queryPolicies } from "../../query-runtime";

// This remains type-only: the app bundle sees neither the server contract
// composer nor the root SDK runtime.
export type PullRequestRpc = PluginRpcClient<typeof rpcContract>;
export type AuthoredPullRequestPolling = { intervalMs: number };

const root = ["work-sidebar", "pull-requests"] as const;

export const pullRequestKeys = {
  authored: (): QueryKey => [...root, "authored"],
  authoredStacks: (): QueryKey => [...root, "authored", "stacks"],
  sidebarStacks: (threadIds: readonly string[]): QueryKey => [
    ...root,
    "sidebar-stacks",
    ...threadIds,
  ],
  health: (): QueryKey => [...root, "health"],
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
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: (polling: AuthoredPullRequestPolling): number =>
      polling.intervalMs,
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
    throw new Error(result.error ?? "GitHub pull-request stacks are unavailable.");
  return result.stacks;
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
  invalidateQueries(filters: { queryKey: QueryKey }): Promise<unknown> | unknown;
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
    queryKey: pullRequestKeys.authoredStacks(),
    queryFn: () => authoredPullRequestStacks(rpc),
    enabled: base.isSuccess,
    ...pullRequestPolicies.authoredStacks,
    refetchInterval:
      pullRequestPolicies.authoredStacks.refetchInterval(polling),
  });
  const enriched =
    stacks.data && stacks.dataUpdatedAt >= base.dataUpdatedAt
      ? stacks.data
      : base.data;
  const refresh = async () => {
    await Promise.all([
      client.cancelQueries({ queryKey: pullRequestKeys.authored() }),
      client.cancelQueries({ queryKey: pullRequestKeys.authoredStacks() }),
    ]);
    forceRefresh.current = true;
    try {
      await base.refetch({ throwOnError: true });
      await stacks.refetch({ throwOnError: true });
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
