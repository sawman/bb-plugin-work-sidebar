import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../contracts";
import { trackerKeys, trackerPolicy } from "./model";

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;

export function useTracker(threadId: string) {
  const rpc = useRpc<typeof rpcContract>();
  return useQuery({ queryKey: trackerKeys.context(threadId), queryFn: () => rpc.call("getWorkTracker", { threadId }), enabled: Boolean(threadId), ...trackerPolicy, refetchOnMount: "always" });
}

export function useTrackerSearch(threadId: string, query: string) {
  const rpc = useRpc<typeof rpcContract>(); const trimmed = query.trim();
  return useQuery({ queryKey: trackerKeys.search(threadId, trimmed), queryFn: () => rpc.call("searchLinearIssues", { threadId, query: trimmed }), enabled: Boolean(threadId && trimmed), ...trackerPolicy });
}

export function invalidateTracker(queryClient: QueryClient, threadId: string) {
  return queryClient.invalidateQueries({ queryKey: trackerKeys.context(threadId) });
}

export function useTrackerMutations(rpc: Rpc, threadId: string) {
  const client = useQueryClient(); const invalidate = () => invalidateTracker(client, threadId);
  return {
    link: useMutation({ mutationKey: [...trackerKeys.context(threadId), "link"], mutationFn: (key: string) => rpc.call("linkLinearIssue", { threadId, key }), onSuccess: invalidate }),
    unlink: useMutation({ mutationKey: [...trackerKeys.context(threadId), "unlink"], mutationFn: () => rpc.call("unlinkLinearIssue", { threadId }), onSuccess: invalidate }),
    status: useMutation({ mutationKey: [...trackerKeys.context(threadId), "status"], mutationFn: (statusId: string) => rpc.call("updateLinearIssueStatus", { threadId, statusId }), onSuccess: invalidate }),
  };
}
