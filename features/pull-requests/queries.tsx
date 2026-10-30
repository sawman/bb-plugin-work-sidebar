import { invalidateRemoteChangesForRepository } from "../changes/invalidation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import type { PluginRpcClient } from "@get-bb/plugin-sdk/app";
import type { z } from "zod";
import type { rpcContract } from "../../contracts";
import { pullRequestAttentionFromSignal } from "./presentation";
import { queryPolicies } from "../../query-runtime";
import { useDocumentVisibility } from "../../shared/use-document-visibility";
import type { AuthoredPullRequestContract, PullRequestReviewerContract, threadPullRequest } from "./schemas";
import {
  factFromAuthoredPullRequest,
  factFromThreadPullRequest,
  factFromSidebarStackLayer,
  mergePullRequestFact,
  mergePullRequestFacts,
  mergeNativePullRequestFact,
  pullRequestFactKey,
  pullRequestFromFact,
  reconcileThreadPullRequestFactReferences,
  resolvePullRequestFact,
  type PullRequestFactDirectory,
} from "./facts";

// This remains type-only: the app bundle sees neither the server contract
// composer nor the root SDK runtime.
export type PullRequestRpc = PluginRpcClient<typeof rpcContract>;
export type AuthoredPullRequestPolling = {
  intervalMs: number;
  authoredLogin?: string;
};
export type ThreadPullRequest = z.infer<typeof threadPullRequest>;
export type ThreadPullRequestDirectory = Record<string, ThreadPullRequest | null>;

const root = ["work-sidebar", "pull-requests"] as const;

export const pullRequestKeys = {
  authored: (authoredLogin?: string): QueryKey => [
    ...root,
    "authored",
    ...(authoredLogin ? ["login", authoredLogin.toLowerCase()] : []),
  ],
  authoredStacks: (baseRevision?: number, authoredLogin?: string): QueryKey => [
    ...root,
    "authored",
    "stacks",
    ...(authoredLogin ? ["login", authoredLogin.toLowerCase()] : []),
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
    // Scoped enrichment belongs to mounted thread rows. Retain it briefly
    // across remounts; host keyed rows own native status freshness.
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
      let observed = current;
      for (const fact of facts) {
        if (!observed?.facts[fact.key] && Object.values(fact.observations ?? {}).some((clock) => clock?.source === "native" && !clock.native))
          observed = mergeNativePullRequestFact(observed, fact);
      }
      const merged = mergePullRequestFacts(observed, facts);
      return threadFactKeys === undefined
        ? merged
        : reconcileThreadPullRequestFactReferences(merged, threadFactKeys);
    },
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
  reviewCommentCounts?: ReturnType<typeof factFromAuthoredPullRequest>["signal"]["reviewCommentCounts"];
  stack?: AuthoredPullRequestContract["stack"];
}>(
  pullRequests: readonly T[] | undefined,
  directory: PullRequestFactDirectory | undefined,
): T[] | undefined {
  if (!pullRequests) return pullRequests as T[] | undefined;
  return pullRequests.flatMap((pullRequest): T[] => {
    const fact = resolvePullRequestFact(pullRequest, directory);
    // The authored roster contains open PRs; retained Stack membership can
    // still include the merged PR and must preserve its canonical lifecycle.
    if (fact.state === "merged" || fact.state === "closed") return [];
    const stack = pullRequest.stack ? { ...pullRequest.stack,
      pullRequests: pullRequest.stack.pullRequests.map((layer) => {
        const resolvedLayer = mergePullRequestFact(directory?.facts[pullRequestFactKey(layer)], factFromSidebarStackLayer(layer));
        return { ...layer, state: resolvedLayer.state, draft: resolvedLayer.draft,
          title: resolvedLayer.title, head: resolvedLayer.head, base: resolvedLayer.base,
          ...(resolvedLayer.observations ? { observations: resolvedLayer.observations } : {}),
          attention: resolvedLayer.attention, ...resolvedLayer.signal };
      }),
    } : pullRequest.stack;
    const resolved = directory?.facts[pullRequestFactKey(pullRequest)] ?? null;
    if (!resolved)
      return [{ ...pullRequest, ...(stack === undefined ? {} : { stack }) }];
    return [{
      ...pullRequest,
      ...(stack === undefined ? {} : { stack }),
      state: fact.state === "draft" ? "draft" : "open",
      draft: fact.draft,
      title: fact.title,
      url: fact.url,
      head: fact.head,
      base: fact.base,
      ...(resolved.observations ? { observations: resolved.observations } : {}),
      checks: fact.signal.checks,
      review: fact.signal.review,
      ...(fact.signal.approvers === undefined ? {} : { approvers: fact.signal.approvers }),
      ...(fact.signal.changeRequesters === undefined ? {} : { changeRequesters: fact.signal.changeRequesters }),
      ...(fact.signal.requestedReviewers === undefined ? {} : { requestedReviewers: fact.signal.requestedReviewers }),
      reviewCommentCount: fact.signal.reviewCommentCount,
      ...(fact.signal.reviewCommentCounts === undefined ? {} : { reviewCommentCounts: fact.signal.reviewCommentCounts }),
      ...(fact.attention === pullRequestAttentionFromSignal(fact.signal) ? {} : { attention: fact.attention }),
    } as T];
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

/** Passive projection of observed thread associations; never requests a roster. */
export function useSharedThreadPullRequestDirectory() {
  const facts = useSharedPullRequestFactDirectory();
  const data = useMemo(() => Object.fromEntries(Object.entries(facts.data?.threadFactKeys ?? {}).flatMap(([threadId, key]) => {
    const fact = facts.data?.facts[key];
    return fact ? [[threadId, { ...pullRequestFromFact(fact), stackNumber: null }]] : [];
  })), [facts.data]);
  return { ...facts, data };
}

export function invalidateThreadPullRequestDirectory(client: {
  invalidateQueries(filters: { queryKey: QueryKey }): Promise<unknown> | unknown;
}) {
  return client.invalidateQueries({ queryKey: pullRequestKeys.threadDirectory() });
}

export function useAuthoredPullRequests(
  rpc: PullRequestRpc,
  polling: AuthoredPullRequestPolling = { intervalMs: 300_000 },
  { enabled = true }: { enabled?: boolean } = {},
) {
  const client = useQueryClient();
  const facts = useSharedPullRequestFactDirectory();
  const visible = useDocumentVisibility();
  const observe = enabled && visible;
  const forceRefresh = useRef(false);
  const authoredLogin = polling.authoredLogin?.trim() ?? "";
  const base = useQuery({
    queryKey: pullRequestKeys.authored(authoredLogin),
    queryFn: () => authoredPullRequests(rpc, forceRefresh.current),
    ...pullRequestPolicies.authored,
    enabled: observe,
    refetchInterval: pullRequestPolicies.authored.refetchInterval(polling),
  });
  const stacks = useQuery({
    // A successful base read defines the stack projection generation. This
    // prevents a slightly later base response from hiding valid enrichment
    // until the next polling interval.
    queryKey: pullRequestKeys.authoredStacks(
      base.dataUpdatedAt,
      authoredLogin,
    ),
    queryFn: () => authoredPullRequestStacks(rpc),
    enabled: observe && base.isSuccess,
    ...pullRequestPolicies.authoredStacks,
  });
  const enriched = stacks.data ?? base.data;
  useEffect(() => {
    if (!enriched) return;
    hydratePullRequestFacts(client, enriched.flatMap((pullRequest) => [
      factFromAuthoredPullRequest(pullRequest),
      ...(pullRequest.stack?.pullRequests.map(factFromSidebarStackLayer) ?? []),
    ]));
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
          queryKey: pullRequestKeys.authoredStacks(
            refreshedBase.dataUpdatedAt,
            authoredLogin,
          ),
          queryFn: () => authoredPullRequestStacks(rpc),
          ...pullRequestPolicies.authoredStacks,
        }),
        refreshLoadedReviewerDirectories(client, rpc),
        invalidateThreadPullRequestDirectory(client),
        ...[...new Set((refreshedBase.data ?? []).map((item) => item.repository))]
          .map((repository) => invalidateRemoteChangesForRepository(client, repository)),
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
    onSettled: async (_data, _error, input) => {
      const repository = input.url.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\//)?.[1];
      await Promise.all([
        ...(repository ? [invalidateRemoteChangesForRepository(client, repository)] : []),
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
    onSettled: async (_data, _error, input) => {
      await Promise.all([
        invalidateRemoteChangesForRepository(client, input.repository),
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
