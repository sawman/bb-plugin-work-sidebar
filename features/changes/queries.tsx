import { toast } from "sonner";
import { refreshChanges } from "./invalidation";
export { invalidateChanges, refreshChanges } from "./invalidation";
import { useMemo, useRef } from "react";
import { useDocumentVisibility } from "../../shared/use-document-visibility";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PluginRpcClient } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../contracts";
import { changesKeys, changesPolicies, remoteChangesIdentity, remoteFilesProjection } from "./model";
import type { Changes, RemoteFileHead } from "./schemas";
import { hydratePullRequestFacts, pullRequestKeys } from "../pull-requests/queries";
import { factFromPullRequest, factFromSidebarStackLayer, nativeValidationDemands, pullRequestFactKey, reconcileThreadPullRequestFactReferences, type PullRequestFactDirectory } from "../pull-requests/facts";

type ChangesRpc = PluginRpcClient<typeof rpcContract>;
export type ChangesPolling = {
  visiblePollMs: number;
  backgroundPollMs: number;
};
export function useChanges(
  rpc: ChangesRpc,
  threadId: string,
  polling: ChangesPolling,
  nativeAssociation?: string | null,
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
      const directory = client.getQueryData<PullRequestFactDirectory>(pullRequestKeys.factDirectory());
      const key = directory?.threadFactKeys[threadId];
      const demand = nativeValidationDemands(directory, key);
      const result = await rpc.call("getChangesPullRequests", { threadId,
        ...(key && demand ? { validationRequirements: { [key]: demand } } : {}) });
      if (!signal.aborted) {
        const currentAssociation = client.getQueryData<PullRequestFactDirectory>(pullRequestKeys.factDirectory())?.threadFactKeys[threadId];
        const returnedAssociation = result.currentPullRequest ? pullRequestFactKey(result.currentPullRequest) : undefined;
        if (currentAssociation !== key && currentAssociation !== returnedAssociation)
          throw new Error("PR association changed during the read. Retry the operation.");
        const facts = [
          ...(result.currentPullRequest ? [factFromPullRequest(result.currentPullRequest)] : []),
          ...(result.stack?.pullRequests.map(factFromSidebarStackLayer) ?? []),
        ];
        hydratePullRequestFacts(client, facts);
        client.setQueryData<PullRequestFactDirectory>(pullRequestKeys.factDirectory(), (current) => {
          if (!current) return current;
          const references = { ...current.threadFactKeys };
          const association = nativeAssociation === undefined ? returnedAssociation : nativeAssociation;
          if (association) references[threadId] = association;
          else delete references[threadId];
          return reconcileThreadPullRequestFactReferences(current, references);
        });
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
  const remoteIdentity = remoteChangesIdentity(summary.data);
  const remoteFiles = useQuery({
    queryKey: changesKeys.remoteFiles(remoteIdentity?.repository ?? "none", remoteIdentity?.content ?? "none"),
    queryFn: () => rpc.call("getChangesRemoteFiles", remoteIdentity!.input),
    enabled: Boolean(remoteIdentity),
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
        void refreshChanges(rpc, client, threadId).catch(() => { toast.error("Could not refresh Changes."); });
      previous.current = { identity, fingerprint: result.fingerprint };
      return result;
    },
    enabled: Boolean(url),
    ...changesPolicies.fingerprint,
    refetchInterval: visible ? polling.visiblePollMs : polling.backgroundPollMs,
  });
  const data = useMemo(() => {
    if (!summary.data) {
      // Native PR failure cannot hide independently available local Stack work.
      // Do not promote enrichment's remote identity or PR facts to summary authority.
      return summary.isError && projection.data ? {
        currentPullRequest: null,
        stack: null,
        stackUnavailableReason: summary.error.message,
        githubStack: projection.data.githubStack,
      } : undefined;
    }
    const enriched = projection.data;
    const sameIdentity = remoteChangesIdentity(enriched)?.content === remoteChangesIdentity(summary.data)?.content
      && enriched?.currentPullRequest?.url === summary.data.currentPullRequest?.url;
    const local = sameIdentity ? enriched?.githubStack : null;
    const withRemoteFiles = local?.stack ? { ...local, stack: { ...local.stack,
      branches: local.stack.branches.map((branch) => ({ ...branch,
        diff: branch.diff ?? remoteFiles.data?.files?.find((entry) =>
          entry.url.toLowerCase() === branch.pr?.url.toLowerCase() && entry.head === branch.name)?.diff ?? null,
      })),
    } } : local;
    return { ...summary.data, githubStack: withRemoteFiles ?? remoteFilesProjection(summary.data, remoteFiles.data) };
  }, [summary.data, summary.isError, summary.error, projection.data, remoteFiles.data]);
  return {
    ...summary,
    // Enrichment never publishes PR facts. Its potentially late response may
    // only fill branch/file metadata; summary owns PR identity and signals.
    data,
    repository,
    remoteFiles,
    localReady: Boolean(projection.data?.githubStack && remoteChangesIdentity(projection.data)?.content === remoteIdentity?.content
      && projection.data.currentPullRequest?.url === summary.data?.currentPullRequest?.url),
    refresh: () => refreshChanges(rpc, client, threadId),
    enrichment: projection,
    fingerprint,
  };
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
  identity?: string,
  expectedHead?: RemoteFileHead,
) {
  return useQuery({
    queryKey: changesKeys.pullRequestFileDiff(
      threadId,
      pullRequestNumber ?? 0,
      path ?? "none",
      identity,
    ),
    queryFn: async () => {
      const result = await rpc.call("getPullRequestFileDiff", {
        threadId,
        pullRequestNumber: pullRequestNumber!,
        path: path!,
        ...(expectedHead ? { expectedHead } : {}),
      });
      if (result.kind === "unavailable") throw new Error(result.message);
      return result;
    },
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
      void invalidateLocalChanges(client, threadId);
    },
    onSuccess: async (result, _branch, context) => {
      if (!result.ok) {
        if (context?.previous) client.setQueryData(queryKey, context.previous);
        if (context?.previousRepository) client.setQueryData(repositoryKey, context.previousRepository);
      }
      await invalidateLocalChanges(client, threadId);
    },
  });
}

function invalidateLocalChanges(client: ReturnType<typeof useQueryClient>, threadId: string) {
  return Promise.all(["repository", "summary", "projection", "file-diff", "pull-request-file-diff"].map((stage) =>
    client.invalidateQueries({ queryKey: ["work-sidebar", "changes", threadId, stage] }),
  ));
}
