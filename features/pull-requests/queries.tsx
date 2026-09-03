import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import type { PluginRpcClient } from "@get-bb/plugin-sdk/app";
import type { z } from "zod";
import type { rpcContract } from "../../contracts";
import { queryPolicies } from "../../query-runtime";
import type { PullRequestReviewerContract, threadPullRequest } from "./schemas";

// This remains type-only: the app bundle sees neither the server contract
// composer nor the root SDK runtime.
export type PullRequestRpc = PluginRpcClient<typeof rpcContract>;
export type AuthoredPullRequestPolling = { intervalMs: number };
export type ThreadPullRequest = z.infer<typeof threadPullRequest>;
export type ThreadPullRequestDirectory = Record<string, ThreadPullRequest | null>;

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
  threadDirectory: (): QueryKey => [...root, "thread-directory"],
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
  threadDirectory: {
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

async function sidebarThreadPullRequests(
  rpc: PullRequestRpc,
  threadIds: readonly string[],
): Promise<ThreadPullRequestDirectory> {
  const directory: ThreadPullRequestDirectory = {};
  // The server contract validates one bounded roster chunk. Keep one client
  // cache entry while covering every project thread instead of truncating
  // large rosters at the transport boundary.
  for (let start = 0; start < threadIds.length; start += 200) {
    const result = await rpc.call("sidebarThreadPullRequests", {
      threadIds: threadIds.slice(start, start + 200),
    });
    if (!result.available)
      throw new Error(
        result.error ?? "GitHub thread pull requests are unavailable.",
      );
    Object.assign(directory, result.pullRequests);
  }
  return directory;
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

/**
 * One roster-wide PR fact directory feeds thread rows and the other PR
 * surfaces through the shared QueryClient. Roster changes refetch in place so
 * consumers retain one stable project-scoped cache key.
 */
export function useThreadPullRequestDirectory(
  rpc: PullRequestRpc,
  threadIds: readonly string[],
  enabled: boolean,
) {
  const normalizedThreadIds = [...new Set(threadIds)].sort();
  const fingerprint = normalizedThreadIds.join("|");
  const previousFingerprint = useRef<string | null>(null);
  const query = useQuery({
    queryKey: pullRequestKeys.threadDirectory(),
    queryFn: () => sidebarThreadPullRequests(rpc, normalizedThreadIds),
    ...pullRequestPolicies.threadDirectory,
    enabled: enabled && normalizedThreadIds.length > 0,
  });
  useEffect(() => {
    if (!enabled || !normalizedThreadIds.length) return;
    if (previousFingerprint.current === null) {
      previousFingerprint.current = fingerprint;
      return;
    }
    if (previousFingerprint.current === fingerprint) return;
    previousFingerprint.current = fingerprint;
    void query.refetch();
  }, [enabled, fingerprint, normalizedThreadIds.length, query]);
  return query;
}

/** Subscribes to the global directory without issuing a second roster read. */
export function useSharedThreadPullRequestDirectory() {
  return useQuery<ThreadPullRequestDirectory>({
    queryKey: pullRequestKeys.threadDirectory(),
    enabled: false,
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

export function invalidateThreadPullRequestDirectory(client: {
  invalidateQueries(filters: { queryKey: QueryKey }): Promise<unknown> | unknown;
}) {
  return client.invalidateQueries({ queryKey: pullRequestKeys.threadDirectory() });
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
        invalidateThreadPullRequestDirectory(client),
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
        invalidateThreadPullRequestDirectory(client),
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
        invalidateThreadPullRequestDirectory(client),
      ]);
    },
  });
}
