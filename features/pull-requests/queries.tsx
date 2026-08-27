import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

/** Typed RPC is supplied by BB at the composition edge; this narrow shape
 * keeps the browser slice independent from the server contract composer. */
export type PullRequestRpc = { call: (...args: any[]) => Promise<any> };

export type PullRequestPolling = {
  visiblePollMs: number;
  backgroundPollMs: number;
  isVisible(): boolean;
};
export type AuthoredPullRequestPolling = { intervalMs: number };

const root = ["work-sidebar", "pull-requests"] as const;

export const pullRequestKeys = {
  authored: (): QueryKey => [...root, "authored"],
  health: (): QueryKey => [...root, "health"],
  threadChanges: (threadId: string): QueryKey => [...root, "thread", threadId],
  fingerprint: (url: string): QueryKey => [...root, "fingerprint", url],
} as const;

export const pullRequestPolicies = {
  authored: { staleTime: 30_000, gcTime: 10 * 60_000, retry: false, refetchOnWindowFocus: false, refetchInterval: (polling: AuthoredPullRequestPolling): number => polling.intervalMs },
  health: { staleTime: 15_000, gcTime: 2 * 60_000, retry: false, refetchOnWindowFocus: false },
  threadChanges: { staleTime: 30_000, gcTime: 10 * 60_000, retry: false, refetchOnWindowFocus: false },
  fingerprint: {
    staleTime: 0,
    gcTime: 2 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: (polling: PullRequestPolling): number => polling.isVisible() ? polling.visiblePollMs : polling.backgroundPollMs,
  },
} as const;

async function authoredPullRequests(rpc: PullRequestRpc) {
  const base = await rpc.call("sidebarAuthoredPullRequests", {});
  if (!base.available) throw new Error(base.error ?? "GitHub authored pull requests are unavailable.");
  const stacks = await rpc.call("sidebarAuthoredPullRequestStacks", null);
  return stacks.available ? stacks.pullRequests : base.pullRequests;
}

export function useAuthoredPullRequests(rpc: PullRequestRpc, polling: AuthoredPullRequestPolling = { intervalMs: 300_000 }) {
  return useQuery({ queryKey: pullRequestKeys.authored(), queryFn: () => authoredPullRequests(rpc), ...pullRequestPolicies.authored, refetchInterval: pullRequestPolicies.authored.refetchInterval(polling) });
}

export function useGitHubApiHealth(rpc: PullRequestRpc) {
  return useQuery({ queryKey: pullRequestKeys.health(), queryFn: () => rpc.call("getGitHubApiHealth", null), ...pullRequestPolicies.health });
}

export function useAuthoredPullRequestRefresh() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: pullRequestKeys.authored() });
}

export function useSetAuthoredPullRequestDraft(rpc: PullRequestRpc) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ url, draft }: { url: string; draft: boolean }) => rpc.call("setAuthoredPullRequestDraft", { url, draft }),
    onSettled: async () => { await client.invalidateQueries({ queryKey: pullRequestKeys.authored() }); },
  });
}

export function useThreadPullRequestChanges(rpc: PullRequestRpc, threadId: string, polling: PullRequestPolling) {
  const client = useQueryClient();
  const changes = useQuery({
    queryKey: pullRequestKeys.threadChanges(threadId),
    queryFn: () => rpc.call("getThreadPullRequestChanges", { threadId }),
    ...pullRequestPolicies.threadChanges,
  });
  const url = changes.data?.currentPullRequest?.url as string | undefined;
  const fingerprint = useQuery({
    queryKey: pullRequestKeys.fingerprint(url ?? "none"),
    queryFn: () => rpc.call("getPullRequestFingerprint", { url }),
    enabled: Boolean(url),
    ...pullRequestPolicies.fingerprint,
    refetchInterval: pullRequestPolicies.fingerprint.refetchInterval(polling),
  });
  const previousFingerprint = useRef<string | null>(null);
  useEffect(() => {
    const next = fingerprint.data?.fingerprint as string | null | undefined;
    if (!next) return;
    const previous = previousFingerprint.current;
    previousFingerprint.current = next;
    // The fingerprint is an inexpensive REST heartbeat. A material change
    // invalidates only this thread's durable PR projection; it never fans out
    // into repository/file, task, tracker, or agent refreshes.
    if (previous && previous !== next) void invalidateThreadPullRequestChanges(client, threadId);
  }, [client, fingerprint.data?.fingerprint, threadId]);
  return changes;
}

export function invalidateThreadPullRequestChanges(client: { invalidateQueries(filters: { queryKey: QueryKey }): Promise<unknown> | unknown }, threadId: string) {
  return client.invalidateQueries({ queryKey: pullRequestKeys.threadChanges(threadId) });
}
