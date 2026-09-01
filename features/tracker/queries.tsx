import { useMutation, useQuery, type QueryClient } from "@tanstack/react-query";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../contracts";
import { trackerKeys, trackerPolicy } from "./model";

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;

export function useTracker(threadId: string) {
  const rpc = useRpc<typeof rpcContract>();
  return useQuery({ queryKey: trackerKeys.context(threadId), queryFn: () => rpc.call("getWorkTracker", { threadId }), enabled: Boolean(threadId), ...trackerPolicy });
}

export function useTrackerSearch(threadId: string, query: string) {
  const rpc = useRpc<typeof rpcContract>(); const trimmed = query.trim();
  return useQuery({ queryKey: trackerKeys.search(threadId, trimmed), queryFn: () => rpc.call("searchLinearIssues", { threadId, query: trimmed }), enabled: Boolean(threadId && trimmed), ...trackerPolicy });
}

export function invalidateTracker(queryClient: QueryClient, threadId: string) {
  return queryClient.invalidateQueries({ queryKey: trackerKeys.context(threadId) });
}

export function useTrackerMutations(rpc: Rpc, threadId: string) {
  // Taskboard mutations publish work-sidebar:changed from the server after
  // durable storage/status writes. The Work panel owns that one invalidation;
  // mutating here too can cause a duplicate context read.
  return {
    link: useMutation({ mutationKey: [...trackerKeys.context(threadId), "link"], mutationFn: (key: string) => rpc.call("linkLinearIssue", { threadId, key }) }),
    unlink: useMutation({ mutationKey: [...trackerKeys.context(threadId), "unlink"], mutationFn: (key: string) => rpc.call("unlinkLinearIssue", { threadId, key }) }),
    primary: useMutation({ mutationKey: [...trackerKeys.context(threadId), "set-primary"], mutationFn: (key: string) => rpc.call("setPrimaryLinearIssue", { threadId, key }) }),
    status: useMutation({ mutationKey: [...trackerKeys.context(threadId), "status"], mutationFn: ({ key, statusId }: { key: string; statusId: string }) => rpc.call("updateLinearIssueStatus", { threadId, key, statusId }) }),
  };
}
