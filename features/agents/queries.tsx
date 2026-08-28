import { useQuery } from "@tanstack/react-query";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../contracts";
import { queryKeys, queryPolicies } from "../../query-runtime";

export type AgentDetailTarget = {
  id: string;
  updatedAt: number;
};

export function useAgentDetails(targets: readonly AgentDetailTarget[]) {
  const rpc = useRpc<typeof rpcContract>();
  const threadIds = targets.map(({ id }) => id);
  const version = targets.map(({ id, updatedAt }) => `${id}:${updatedAt}`);
  return useQuery({
    queryKey: queryKeys.agents.details(version),
    queryFn: () => rpc.call("getAgentDetails", { threadIds }),
    enabled: threadIds.length > 0,
    ...queryPolicies.agentDetails,
    refetchOnMount: "always",
  });
}
