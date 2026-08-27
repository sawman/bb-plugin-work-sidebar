import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { PluginRpcClient } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../contracts";

// This remains type-only: the app bundle sees neither the server contract
// composer nor the root SDK runtime.
export type PullRequestRpc = PluginRpcClient<typeof rpcContract>;
export type PullRequestPolling = { visiblePollMs: number; backgroundPollMs: number };
export type AuthoredPullRequestPolling = { intervalMs: number };

const root = ["work-sidebar", "pull-requests"] as const;

export const pullRequestKeys = {
  authored: (): QueryKey => [...root, "authored"],
  authoredStacks: (): QueryKey => [...root, "authored", "stacks"],
  health: (): QueryKey => [...root, "health"],
  threadChanges: (threadId: string): QueryKey => [...root, "thread", threadId],
  fingerprint: (url: string): QueryKey => [...root, "fingerprint", url],
} as const;

export const pullRequestPolicies = {
  authored: { staleTime: 30_000, gcTime: 10 * 60_000, retry: false, refetchOnWindowFocus: false, refetchInterval: (polling: AuthoredPullRequestPolling): number => polling.intervalMs },
  authoredStacks: { staleTime: 30_000, gcTime: 10 * 60_000, retry: false, refetchOnWindowFocus: false },
  health: { staleTime: Infinity, gcTime: Infinity, retry: false, refetchOnWindowFocus: false, pollInterval: 30_000 },
  threadChanges: { staleTime: 30_000, gcTime: 10 * 60_000, retry: false, refetchOnWindowFocus: false },
  fingerprint: { staleTime: 0, gcTime: 2 * 60_000, retry: false, refetchOnWindowFocus: false, refetchIntervalInBackground: true },
} as const;

function useDocumentVisibility(): boolean {
  const [visible, setVisible] = useState(() => typeof document === "undefined" || document.visibilityState === "visible");
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}

async function authoredPullRequests(rpc: PullRequestRpc, force = false) {
  const base = await rpc.call("sidebarAuthoredPullRequests", force ? { force: true } : {});
  if (!base.available) throw new Error(base.error ?? "GitHub authored pull requests are unavailable.");
  return base.pullRequests;
}

async function authoredPullRequestStacks(rpc: PullRequestRpc) {
  const stacks = await rpc.call("sidebarAuthoredPullRequestStacks", null);
  if (!stacks.available) throw new Error(stacks.error ?? "GitHub pull-request stacks are unavailable.");
  return stacks.pullRequests;
}

export function useAuthoredPullRequests(rpc: PullRequestRpc, polling: AuthoredPullRequestPolling = { intervalMs: 300_000 }) {
  const base = useQuery({ queryKey: pullRequestKeys.authored(), queryFn: () => authoredPullRequests(rpc), ...pullRequestPolicies.authored, refetchInterval: pullRequestPolicies.authored.refetchInterval(polling) });
  const stacks = useQuery({ queryKey: pullRequestKeys.authoredStacks(), queryFn: () => authoredPullRequestStacks(rpc), enabled: base.isSuccess, ...pullRequestPolicies.authoredStacks });
  const enriched = stacks.data && stacks.dataUpdatedAt >= base.dataUpdatedAt ? stacks.data : base.data;
  return { ...base, data: enriched, isFetching: base.isFetching || stacks.isFetching, stackError: stacks.error };
}

const healthSchedulers = new WeakMap<QueryClient, { owners: number; timer: ReturnType<typeof globalThis.setInterval> }>();

function useSharedHealthPolling(): void {
  const client = useQueryClient();
  useEffect(() => {
    const existing = healthSchedulers.get(client);
    if (existing) {
      existing.owners += 1;
      return () => {
        existing.owners -= 1;
        if (existing.owners === 0) { globalThis.clearInterval(existing.timer); healthSchedulers.delete(client); }
      };
    }
    const scheduler = { owners: 1, timer: globalThis.setInterval(() => { void client.invalidateQueries({ queryKey: pullRequestKeys.health() }); }, pullRequestPolicies.health.pollInterval) };
    healthSchedulers.set(client, scheduler);
    return () => {
      scheduler.owners -= 1;
      if (scheduler.owners === 0) { globalThis.clearInterval(scheduler.timer); healthSchedulers.delete(client); }
    };
  }, [client]);
}

export function useGitHubApiHealth(rpc: PullRequestRpc) {
  useSharedHealthPolling();
  return useQuery({ queryKey: pullRequestKeys.health(), queryFn: () => rpc.call("getGitHubApiHealth", null), ...pullRequestPolicies.health });
}

export function useAuthoredPullRequestRefresh(rpc: PullRequestRpc) {
  const client = useQueryClient();
  return async () => {
    await Promise.all([
      client.cancelQueries({ queryKey: pullRequestKeys.authored() }),
      client.cancelQueries({ queryKey: pullRequestKeys.authoredStacks() }),
    ]);
    const base = await authoredPullRequests(rpc, true);
    client.setQueryData(pullRequestKeys.authored(), base);
    const stacks = await authoredPullRequestStacks(rpc);
    client.setQueryData(pullRequestKeys.authoredStacks(), stacks);
  };
}

export function useSetAuthoredPullRequestDraft(rpc: PullRequestRpc) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ url, draft }: { url: string; draft: boolean }) => rpc.call("setAuthoredPullRequestDraft", { url, draft }),
    onSettled: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: pullRequestKeys.authored() }),
        client.invalidateQueries({ queryKey: pullRequestKeys.authoredStacks() }),
      ]);
    },
  });
}

export function useThreadPullRequestChanges(rpc: PullRequestRpc, threadId: string, polling: PullRequestPolling) {
  const client = useQueryClient();
  const visible = useDocumentVisibility();
  const changes = useQuery({ queryKey: pullRequestKeys.threadChanges(threadId), queryFn: () => rpc.call("getThreadPullRequestChanges", { threadId }), ...pullRequestPolicies.threadChanges });
  const url = changes.data?.currentPullRequest?.url;
  const fingerprint = useQuery({
    queryKey: pullRequestKeys.fingerprint(url ?? "none"),
    queryFn: () => rpc.call("getPullRequestFingerprint", { url: url! }),
    enabled: Boolean(url),
    ...pullRequestPolicies.fingerprint,
    refetchInterval: visible ? polling.visiblePollMs : polling.backgroundPollMs,
  });
  const previousFingerprint = useRef<string | null>(null);
  useEffect(() => {
    const next = fingerprint.data?.fingerprint;
    if (!next) return;
    const previous = previousFingerprint.current;
    previousFingerprint.current = next;
    if (previous && previous !== next) void invalidateThreadPullRequestChanges(client, threadId);
  }, [client, fingerprint.data?.fingerprint, threadId]);
  return changes;
}

export function invalidateThreadPullRequestChanges(client: { invalidateQueries(filters: { queryKey: QueryKey }): Promise<unknown> | unknown }, threadId: string) {
  return client.invalidateQueries({ queryKey: pullRequestKeys.threadChanges(threadId) });
}
