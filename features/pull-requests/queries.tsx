import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import type { PluginRpcClient } from "@get-bb/plugin-sdk/app";
import type { z } from "zod";
import type { rpcContract } from "../../contracts";
import { queryPolicies } from "../../query-runtime";
import type { PullRequestReviewerContract, threadPullRequest } from "./schemas";
import {
  factFromAuthoredPullRequest,
  factFromThreadPullRequest,
  mergePullRequestFacts,
  pullRequestFactKey,
  reconcileThreadPullRequestFactReferences,
  resolvePullRequestFact,
  type PullRequestFactDirectory,
} from "./facts";

// This remains type-only: the app bundle sees neither the server contract
// composer nor the root SDK runtime.
export type PullRequestRpc = PluginRpcClient<typeof rpcContract>;
export type AuthoredPullRequestPolling = { intervalMs: number };
export type ThreadPullRequest = z.infer<typeof threadPullRequest>;
export type ThreadPullRequestDirectory = Record<string, ThreadPullRequest | null>;

const root = ["work-sidebar", "pull-requests"] as const;
const THREAD_DIRECTORY_BATCH_SIZE = 200;

export const pullRequestKeys = {
  authored: (): QueryKey => [...root, "authored"],
  authoredStacks: (baseRevision?: number): QueryKey => [
    ...root,
    "authored",
    "stacks",
    ...(baseRevision == null ? [] : [baseRevision]),
  ],
  threadDirectory: (): QueryKey => [...root, "thread-directory"],
  factDirectory: (): QueryKey => [...root, "fact-directory"],
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
  threadDirectory: {
    // One directory can contain an entire active project roster. Retain it
    // only long enough to bridge a brief slot remount; the owner compacts it
    // synchronously whenever that roster changes or disappears.
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  },
  factDirectory: {
    // Facts are hydrated by the owned authored/thread/Changes reads. They are
    // never fetched independently, so their lifecycle follows the shared
    // Query cache rather than a second client-side GitHub request.
    staleTime: Infinity,
    gcTime: 15 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
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

export function hydratePullRequestFacts(
  client: QueryClient,
  facts: readonly ReturnType<typeof factFromAuthoredPullRequest>[],
  threadFactKeys?: Readonly<Record<string, string>>,
) {
  if (facts.length === 0 && threadFactKeys === undefined) return;
  client.setQueryData<PullRequestFactDirectory>(
    pullRequestKeys.factDirectory(),
    (current) => {
      const merged = mergePullRequestFacts(current, facts);
      return threadFactKeys === undefined
        ? merged
        : reconcileThreadPullRequestFactReferences(merged, threadFactKeys);
    },
  );
}

function resolveThreadPullRequestDirectory(
  threadDirectory: ThreadPullRequestDirectory | undefined,
  facts: PullRequestFactDirectory | undefined,
): ThreadPullRequestDirectory | undefined {
  if (!threadDirectory) return threadDirectory;
  return Object.fromEntries(
    Object.entries(threadDirectory).map(([threadId, pullRequest]) => {
      if (!pullRequest) return [threadId, null];
      const fact = resolvePullRequestFact(pullRequest, facts);
      return [
        threadId,
        {
          ...pullRequest,
          state: fact.state,
          title: fact.title,
          url: fact.url,
          head: fact.head,
          base: fact.base,
          attention: fact.attention ?? pullRequest.attention,
          signal: fact.signal,
        },
      ];
    }),
  );
}

function resolveAuthoredPullRequests<T extends {
  number: number;
  title: string;
  url: string;
  state: "open" | "draft";
  draft: boolean;
  head: string;
  base: string;
  checks: ReturnType<typeof factFromAuthoredPullRequest>["signal"]["checks"];
  review: ReturnType<typeof factFromAuthoredPullRequest>["signal"]["review"];
  approvers?: string[];
  changeRequesters?: string[];
  requestedReviewers?: string[];
  reviewCommentCount: number;
}>(
  pullRequests: readonly T[] | undefined,
  directory: PullRequestFactDirectory | undefined,
): T[] | undefined {
  if (!pullRequests) return pullRequests as T[] | undefined;
  return pullRequests.map((pullRequest) => {
    const fact = resolvePullRequestFact(pullRequest, directory);
    const resolved = directory?.facts[pullRequestFactKey(pullRequest)] ?? null;
    // An authored row seeds the directory with its own partial fact. Preserve
    // that exact wire shape until a richer thread/Changes fact is available.
    if (!resolved || (!resolved.checks && !resolved.review && !resolved.mergeability))
      return pullRequest;
    return {
      ...pullRequest,
      state: fact.state === "draft" ? "draft" : "open",
      draft: fact.draft,
      title: fact.title,
      url: fact.url,
      head: fact.head,
      base: fact.base,
      checks: fact.signal.checks,
      review: fact.signal.review,
      approvers: fact.signal.approvers,
      changeRequesters: fact.signal.changeRequesters,
      requestedReviewers: fact.signal.requestedReviewers,
      reviewCommentCount: fact.signal.reviewCommentCount,
      attention: fact.attention,
    } as T;
  });
}

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

async function sidebarThreadPullRequests(
  rpc: PullRequestRpc,
  threadIds: readonly string[],
): Promise<ThreadPullRequestDirectory> {
  const directory: ThreadPullRequestDirectory = {};
  // The server contract validates one bounded roster chunk. Keep one client
  // cache entry while covering every project thread instead of truncating
  // large rosters at the transport boundary.
  for (
    let start = 0;
    start < threadIds.length;
    start += THREAD_DIRECTORY_BATCH_SIZE
  ) {
    const result = await rpc.call("sidebarThreadPullRequests", {
      threadIds: threadIds.slice(start, start + THREAD_DIRECTORY_BATCH_SIZE),
    });
    if (!result.available)
      throw new Error(
        result.error ?? "GitHub thread pull requests are unavailable.",
      );
    Object.assign(directory, result.pullRequests);
  }
  return directory;
}

function compactThreadPullRequestDirectory(
  directory: ThreadPullRequestDirectory | undefined,
  threadIds: readonly string[],
): ThreadPullRequestDirectory {
  if (!directory) return {};
  return Object.fromEntries(
    threadIds.flatMap((threadId) =>
      Object.hasOwn(directory, threadId)
        ? [[threadId, directory[threadId]] as const]
        : [],
    ),
  );
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
  const queryClient = useQueryClient();
  const facts = useSharedPullRequestFactDirectory();
  const unorderedThreadIds = [...new Set(threadIds)].sort();
  const fingerprint = unorderedThreadIds.join("|");
  // Sidebar callers often create a fresh roster array while rendering. Keep
  // the effect's roster identity stable unless its actual membership changed.
  const normalizedThreadIds = useMemo(
    () => unorderedThreadIds,
    [fingerprint],
  );
  const active = enabled && normalizedThreadIds.length > 0;
  const previousFingerprint = useRef<string | null>(null);
  const query = useQuery({
    queryKey: pullRequestKeys.threadDirectory(),
    queryFn: () => sidebarThreadPullRequests(rpc, normalizedThreadIds),
    ...pullRequestPolicies.threadDirectory,
    enabled: active,
  });
  const { refetch } = query;
  const rawDirectory = query.data;
  useEffect(() => {
    if (!rawDirectory) return;
    hydratePullRequestFacts(
      queryClient,
      Object.values(rawDirectory)
        .filter((pullRequest): pullRequest is ThreadPullRequest => Boolean(pullRequest))
        .map(factFromThreadPullRequest),
      Object.fromEntries(
        Object.entries(rawDirectory).flatMap(([threadId, pullRequest]) =>
          pullRequest
            ? [[threadId, pullRequestFactKey(pullRequest)] as const]
            : [],
        ),
      ),
    );
  }, [queryClient, rawDirectory]);
  useEffect(() => {
    if (!active) {
      previousFingerprint.current = null;
      void queryClient.cancelQueries({
        queryKey: pullRequestKeys.threadDirectory(),
      });
      queryClient.setQueryData<ThreadPullRequestDirectory>(
        pullRequestKeys.threadDirectory(),
        {},
      );
      hydratePullRequestFacts(queryClient, [], {});
      return;
    }
    if (previousFingerprint.current === null) {
      previousFingerprint.current = fingerprint;
      return;
    }
    if (previousFingerprint.current === fingerprint) return;
    previousFingerprint.current = fingerprint;
    void (async () => {
      // The transport does not expose an AbortSignal. Cancel Query ownership
      // first so a late prior-roster response cannot publish over this
      // generation, then retain only facts that still belong to the roster.
      await queryClient.cancelQueries({
        queryKey: pullRequestKeys.threadDirectory(),
      });
      queryClient.setQueryData<ThreadPullRequestDirectory>(
        pullRequestKeys.threadDirectory(),
        (current) =>
          compactThreadPullRequestDirectory(current, normalizedThreadIds),
      );
      void refetch();
    })();
  }, [active, fingerprint, normalizedThreadIds, queryClient, refetch]);
  return {
    ...query,
    data: resolveThreadPullRequestDirectory(rawDirectory, facts.data),
  };
}

/** Passive observer of the canonical project-scoped fact directory. */
export function useSharedPullRequestFactDirectory() {
  return useQuery<PullRequestFactDirectory>({
    queryKey: pullRequestKeys.factDirectory(),
    queryFn: async (): Promise<PullRequestFactDirectory> => ({
      facts: {},
      threadFactKeys: {},
    }),
    ...pullRequestPolicies.factDirectory,
    enabled: false,
  });
}

/** Subscribes to the global directory without issuing a second roster read. */
export function useSharedThreadPullRequestDirectory() {
  return useQuery<ThreadPullRequestDirectory>({
    queryKey: pullRequestKeys.threadDirectory(),
    enabled: false,
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
  const facts = useSharedPullRequestFactDirectory();
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
  useEffect(() => {
    if (!enriched) return;
    hydratePullRequestFacts(client, enriched.map(factFromAuthoredPullRequest));
  }, [client, enriched]);
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
    data: resolveAuthoredPullRequests(enriched, facts.data),
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
