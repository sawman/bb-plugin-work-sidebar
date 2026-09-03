import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { useEffect, useMemo, useRef } from "react";
import type { rpcContract } from "../../contracts";
import { queryKeys, queryPolicies } from "../../query-runtime";

export const AGENT_DETAIL_BATCH_MAX = 100;
export const AGENT_DETAIL_DIRECTORY_MAX = 200;

export type AgentDetailDirectory = Readonly<{
  facts: Readonly<Record<string, Readonly<{ model: string | null }>>>;
}>;

const EMPTY_AGENT_DETAIL_DIRECTORY: AgentDetailDirectory = { facts: {} };
const activeRosters = new WeakMap<QueryClient, Map<symbol, readonly string[]>>();

function normalizeRoster(threadIds: readonly string[]) {
  return [...new Set(threadIds)].sort().slice(0, AGENT_DETAIL_DIRECTORY_MAX);
}

function activeRoster(queryClient: QueryClient) {
  return normalizeRoster(
    [...(activeRosters.get(queryClient)?.values() ?? [])].flat(),
  );
}

function boundedPanelRoster(
  queryClient: QueryClient,
  roster: readonly string[],
) {
  const allowed = new Set(activeRoster(queryClient));
  return roster.filter((threadId) => allowed.has(threadId));
}

/** Keep only facts still needed by one mounted Agents panel, up to one cap. */
export function reconcileAgentDetailDirectory(
  directory: AgentDetailDirectory | undefined,
  roster: readonly string[],
): AgentDetailDirectory {
  const facts = directory?.facts ?? {};
  const retained = Object.fromEntries(
    normalizeRoster(roster)
      .filter((threadId) => facts[threadId] !== undefined)
      .map((threadId) => [threadId, facts[threadId]!]),
  );
  return { facts: retained };
}

function reconcileCachedDirectory(queryClient: QueryClient) {
  queryClient.setQueryData<AgentDetailDirectory>(
    queryKeys.agents.directory(),
    (directory) => reconcileAgentDetailDirectory(directory, activeRoster(queryClient)),
  );
}

function updateActiveRoster(
  queryClient: QueryClient,
  owner: symbol,
  roster: readonly string[],
) {
  let rosters = activeRosters.get(queryClient);
  if (!rosters) {
    rosters = new Map();
    activeRosters.set(queryClient, rosters);
  }
  rosters.set(owner, roster);
  reconcileCachedDirectory(queryClient);
}

function unregisterActiveRoster(queryClient: QueryClient, owner: symbol) {
  activeRosters.get(queryClient)?.delete(owner);
  reconcileCachedDirectory(queryClient);
}

function missingThreadIds(
  directory: AgentDetailDirectory | undefined,
  roster: readonly string[],
) {
  const facts = directory?.facts ?? {};
  return roster.filter((threadId) => facts[threadId] === undefined);
}

function chunkThreadIds(threadIds: readonly string[]) {
  const batches: string[][] = [];
  for (let index = 0; index < threadIds.length; index += AGENT_DETAIL_BATCH_MAX)
    batches.push(threadIds.slice(index, index + AGENT_DETAIL_BATCH_MAX));
  return batches;
}

/** Clear the bounded directory so every currently visible roster refetches. */
export async function invalidateAgentDetails(queryClient: QueryClient) {
  const queryKey = queryKeys.agents.directory();
  await queryClient.cancelQueries({ queryKey });
  queryClient.setQueryData<AgentDetailDirectory>(
    queryKey,
    EMPTY_AGENT_DETAIL_DIRECTORY,
  );
  return queryClient.invalidateQueries({ queryKey, refetchType: "none" });
}

export function useAgentDetails(threadIds: readonly string[]) {
  const rpc = useRpc<typeof rpcContract>();
  const queryClient = useQueryClient();
  const rosterOwner = useRef(Symbol("agent-detail-roster"));
  const roster = useMemo(() => normalizeRoster(threadIds), [threadIds]);
  const rosterKey = roster.join("\u0000");
  const query = useQuery<AgentDetailDirectory>({
    queryKey: queryKeys.agents.directory(),
    queryFn: async () => {
      const current = queryClient.getQueryData<AgentDetailDirectory>(
        queryKeys.agents.directory(),
      );
      const missing = missingThreadIds(
        current,
        boundedPanelRoster(queryClient, roster),
      );
      if (missing.length === 0)
        return reconcileAgentDetailDirectory(current, activeRoster(queryClient));
      const results = await Promise.all(
        chunkThreadIds(missing).map((batch) =>
          rpc.call("getAgentDetails", { threadIds: batch }),
        ),
      );
      const facts = { ...(current?.facts ?? {}) };
      for (const result of results)
        for (const agent of result.agents)
          facts[agent.threadId] = { model: agent.model };
      return reconcileAgentDetailDirectory({ facts }, activeRoster(queryClient));
    },
    enabled: false,
    ...queryPolicies.agentDetails,
  });
  const missing = missingThreadIds(
    query.data,
    boundedPanelRoster(queryClient, roster),
  );
  const missingKey = missing.join("\u0000");

  useEffect(() => {
    updateActiveRoster(queryClient, rosterOwner.current, roster);
    return () => unregisterActiveRoster(queryClient, rosterOwner.current);
  }, [queryClient]);
  useEffect(() => {
    updateActiveRoster(queryClient, rosterOwner.current, roster);
    const current = queryClient.getQueryData<AgentDetailDirectory>(
      queryKeys.agents.directory(),
    );
    if (
      missingThreadIds(
        current,
        boundedPanelRoster(queryClient, roster),
      ).length > 0
    )
      void query.refetch();
  }, [queryClient, query.refetch, rosterKey]);
  useEffect(() => {
    if (missing.length > 0) void query.refetch();
  }, [missingKey, query.refetch]);

  return query;
}
