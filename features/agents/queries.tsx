import { useQuery } from "@tanstack/react-query";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../contracts";
import { queryKeys, queryPolicies } from "../../query-runtime";

export function useAgentDetails(threadIds: readonly string[]) {
  const rpc = useRpc<typeof rpcContract>();
  const roster = [...new Set(threadIds)].sort();
  return useQuery({
    queryKey: queryKeys.agents.details(roster),
    queryFn: () => rpc.call("getAgentDetails", { threadIds: roster }),
    enabled: roster.length > 0,
    ...queryPolicies.agentDetails,
  });
}
