import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PluginRpcClient } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../contracts";
import { changesKeys, changesPolicies } from "./model";
import type { Changes } from "./schemas";
import { hydratePullRequestFacts, pullRequestKeys } from "../pull-requests/queries";
import { factFromPullRequest, factFromSidebarStackLayer, type PullRequestFactDirectory } from "../pull-requests/facts";

type ChangesRpc = PluginRpcClient<typeof rpcContract>;
export type ChangesPolling = {
  visiblePollMs: number;
  backgroundPollMs: number;
};
function useDocumentVisibility() {
  const [visible, setVisible] = useState(
    () =>
      typeof document === "undefined" || document.visibilityState === "visible",
  );
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}
export function useChanges(
  rpc: ChangesRpc,
  threadId: string,
  polling: ChangesPolling,
) {
  const client = useQueryClient();
  const visible = useDocumentVisibility();
  const stagePolling = {
    ...changesPolicies.projection,
    refetchInterval: visible ? polling.visiblePollMs : polling.backgroundPollMs,
    refetchIntervalInBackground: true,
  };
  const repository = useQuery({
    queryKey: changesKeys.repository(threadId),
    queryFn: () => rpc.call("getChangesRepository", { threadId }),
    ...stagePolling,
  });
  const summary = useQuery({
    queryKey: changesKeys.summary(threadId),
    queryFn: async ({ signal }) => {
      const before = client.getQueryData<PullRequestFactDirectory>(pullRequestKeys.factDirectory());
      const summaryState = client.getQueryState(changesKeys.summary(threadId));
      const coldMount = summaryState?.data === undefined && !summaryState?.isInvalidated;
      const result = await rpc.call("getChangesPullRequests", { threadId });
      if (!signal.aborted) {
        const current = client.getQueryData<PullRequestFactDirectory>(pullRequestKeys.factDirectory());
        const facts = [
          ...(result.currentPullRequest ? [factFromPullRequest(result.currentPullRequest)] : []),
          ...(result.stack?.pullRequests.map(factFromSidebarStackLayer) ?? []),
        ];
        // A newer directory/manual read can settle while this RPC is pending.
        // Only publish facts whose canonical record has not changed meanwhile.
        hydratePullRequestFacts(client, facts.filter((fact) =>
          current?.facts[fact.key] === before?.facts[fact.key]
            && !(coldMount && before?.facts[fact.key]
              && Date.now() - (before.observedAtByFact?.[fact.key] ?? 0) < changesPolicies.projection.staleTime),
        ));
      }
      return result;
    },
    ...stagePolling,
  });
  const projection = useQuery({
    queryKey: changesKeys.projection(threadId),
    queryFn: () => rpc.call("getChangesProjection", { threadId }),
    ...stagePolling,
  });
  const url = summary.data?.currentPullRequest?.url;
  const previous = useRef<{ identity: string; fingerprint: string | null }>({
    identity: "",
    fingerprint: null,
  });
  const fingerprint = useQuery({
    queryKey: changesKeys.fingerprint(threadId, url ?? "none"),
    queryFn: async ({ signal }) => {
      const result = await rpc.call("getChangesFingerprint", {
        threadId,
        url: url!,
      });
      if (signal.aborted) return result;
      const identity = `${threadId}:${url}`;
      if (
        previous.current.identity === identity &&
        result.fingerprint &&
        previous.current.fingerprint &&
        result.fingerprint !== previous.current.fingerprint
      )
        void invalidateChanges(client, threadId);
      previous.current = { identity, fingerprint: result.fingerprint };
      return result;
    },
    enabled: Boolean(url),
    ...changesPolicies.fingerprint,
    refetchInterval: visible ? polling.visiblePollMs : polling.backgroundPollMs,
  });
  const data = useMemo(() => {
    if (!summary.data) return undefined;
    const enriched = projection.data;
    const sameIdentity = enriched?.currentPullRequest?.url === summary.data.currentPullRequest?.url
      && enriched?.stack?.number === summary.data.stack?.number;
    return { ...summary.data, githubStack: sameIdentity ? enriched?.githubStack ?? null : null };
  }, [summary.data, projection.data]);
  return {
    ...summary,
    // Enrichment never publishes PR facts. Its potentially late response may
    // only fill branch/file metadata; summary owns PR identity and signals.
    data,
    repository,
    enrichment: projection,
    fingerprint,
  };
}
export function invalidateChanges(
  client: {
    invalidateQueries(filters: {
      queryKey: readonly unknown[];
    }): Promise<unknown> | unknown;
  },
  threadId: string,
) {
  return Promise.all([
    client.invalidateQueries({ queryKey: changesKeys.repository(threadId) }),
    client.invalidateQueries({ queryKey: changesKeys.summary(threadId) }),
    client.invalidateQueries({ queryKey: changesKeys.projection(threadId) }),
  ]);
}

export function useWorkingTreeFileDiff(
  rpc: ChangesRpc,
  threadId: string,
  fingerprint: string | null,
  path: string | null,
) {
  return useQuery({
    queryKey: changesKeys.fileDiff(threadId, fingerprint, path ?? "none"),
    queryFn: () => rpc.call("getWorkingTreeFileDiff", { threadId, path: path! }),
    enabled: Boolean(path),
    ...changesPolicies.fileDiff,
  });
}

export function usePullRequestFileDiff(
  rpc: ChangesRpc,
  threadId: string,
  pullRequestNumber: number | null,
  path: string | null,
) {
  return useQuery({
    queryKey: changesKeys.pullRequestFileDiff(
      threadId,
      pullRequestNumber ?? 0,
      path ?? "none",
    ),
    queryFn: () =>
      rpc.call("getPullRequestFileDiff", {
        threadId,
        pullRequestNumber: pullRequestNumber!,
        path: path!,
      }),
    enabled: Boolean(path && pullRequestNumber),
    ...changesPolicies.fileDiff,
  });
}

export function useCheckoutStackBranch(rpc: ChangesRpc, threadId: string) {
  const client = useQueryClient();
  const queryKey = changesKeys.projection(threadId);
  const repositoryKey = changesKeys.repository(threadId);
  return useMutation({
    mutationFn: (branch: string) => rpc.call("checkoutStackBranch", { threadId, branch }),
    onMutate: async (branch) => {
      await Promise.all([client.cancelQueries({ queryKey }), client.cancelQueries({ queryKey: repositoryKey })]);
      const previousRepository = client.getQueryData<Changes["repository"]>(repositoryKey);
      client.setQueryData<Changes["repository"]>(repositoryKey, (current) => current ? { ...current, branch } : current);
      const previous = client.getQueryData<Omit<Changes, "repository">>(queryKey);
      client.setQueryData<Omit<Changes, "repository">>(queryKey, (current) => {
        if (!current?.githubStack?.stack) return current;
        return {
          ...current,
          githubStack: {
            ...current.githubStack,
            stack: {
              ...current.githubStack.stack,
              currentBranch: branch,
              branches: current.githubStack.stack.branches.map((entry) => ({
                ...entry,
                isCurrent: entry.name === branch,
              })),
            },
          },
        };
      });
      return { previous, previousRepository };
    },
    onError: (_error, _branch, context) => {
      if (context?.previous) client.setQueryData(queryKey, context.previous);
      if (context?.previousRepository) client.setQueryData(repositoryKey, context.previousRepository);
      void invalidateChanges(client, threadId);
    },
    onSuccess: async (result, _branch, context) => {
      if (!result.ok) {
        if (context?.previous) client.setQueryData(queryKey, context.previous);
        if (context?.previousRepository) client.setQueryData(repositoryKey, context.previousRepository);
      }
      await invalidateChanges(client, threadId);
    },
  });
}
