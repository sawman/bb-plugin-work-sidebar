import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../contracts";
import { queryKeys, queryPolicies } from "../../query-runtime";

export function useTasksRead() {
  const rpc = useRpc<typeof rpcContract>();
  return useQuery({
    queryKey: queryKeys.sidebar.tasks.list(),
    queryFn: async () => {
      const result = await rpc.call("sidebarTasks", null);
      if (!result.available) throw new Error(result.error ?? "Tasks are unavailable.");
      return result;
    },
    ...queryPolicies.sidebarTasksList,
  });
}

export function useTaskLinksRead() {
  const rpc = useRpc<typeof rpcContract>();
  return useQuery({
    queryKey: queryKeys.sidebar.tasks.links(),
    queryFn: async () => {
      const result = await rpc.call("sidebarTaskLinks", null);
      if (!result.available) throw new Error(result.error ?? "Task links are unavailable.");
      return result;
    },
    ...queryPolicies.sidebarTaskLinks,
    refetchInterval: 30_000,
  });
}

/** The left sidebar owns the one Tasks-domain realtime subscription. */
export function useTasksRealtimeInvalidation() {
  const queryClient = useQueryClient();
  useRealtime("work-sidebar:changed", () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.sidebar.tasks.list() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.sidebar.tasks.links() });
  });
}
