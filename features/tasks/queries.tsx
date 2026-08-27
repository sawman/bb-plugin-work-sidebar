import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../contracts";
import { queryKeys, queryPolicies } from "../../query-runtime";

type TaskReadResult = { available: boolean; tasks: { id: string }[]; error: string | null };
type ReadSnapshot = { status: "pending" } | { status: "success"; data: readonly { id: string }[] } | { status: "error"; error: Error };

export function taskReadState(snapshot: ReadSnapshot): "loading" | "empty" | "populated" | "error" {
  if (snapshot.status === "pending") return "loading";
  if (snapshot.status === "error") return "error";
  return snapshot.data.length === 0 ? "empty" : "populated";
}

export function useTasksRead() {
  const rpc = useRpc<typeof rpcContract>();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.sidebar.tasks.list(),
    queryFn: async () => {
      const result = await rpc.call("sidebarTasks", null);
      if (!result.available) throw new Error(result.error ?? "Tasks are unavailable.");
      return result;
    },
    ...queryPolicies.sidebarTasksList,
  });
  useRealtime("work-sidebar:changed", () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.sidebar.tasks.list() });
  });
  return query;
}

export function useTaskLinksRead() {
  const rpc = useRpc<typeof rpcContract>();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.sidebar.tasks.links(),
    queryFn: async () => {
      const result = await rpc.call("sidebarTaskLinks", null);
      if (!result.available) throw new Error(result.error ?? "Task links are unavailable.");
      return result;
    },
    ...queryPolicies.sidebarTaskLinks,
  });
  useRealtime("work-sidebar:changed", () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.sidebar.tasks.links() });
  });
  return query;
}
