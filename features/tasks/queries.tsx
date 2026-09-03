import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { useMemo } from "react";
import type { rpcContract } from "../../contracts";
import { queryKeys, queryPolicies } from "../../query-runtime";
import { invalidateTaskQueries } from "./mutations";
import { parseWorkSidebarRealtimeEvent } from "../../shared/work-realtime";
import {
  adaptSidebarTaskResponse,
  adaptTaskLinkResponse,
  mergeTaskFacts,
  resolveSidebarTasks,
  resolveTaskLinks,
  type TaskFactDirectory,
} from "./facts";
import {
  captureTaskFactHydrationRevision,
  isCurrentTaskFactHydration,
  optimisticTaskAssigneeIds,
} from "./fact-hydration-authority";

export function hydrateTaskFacts(
  queryClient: QueryClient,
  projectId: string | null,
  facts: Parameters<typeof mergeTaskFacts>[2],
  revision = captureTaskFactHydrationRevision(queryClient),
) {
  if (facts.length === 0) return;
  if (!isCurrentTaskFactHydration(queryClient, revision)) return;
  queryClient.setQueryData<TaskFactDirectory>(
    queryKeys.sidebar.tasks.facts(projectId),
    (previous) => {
      if (!isCurrentTaskFactHydration(queryClient, revision)) return previous;
      const merged = mergeTaskFacts(previous, projectId, facts);
      if (!previous) return merged;
      const optimisticIds = new Set(optimisticTaskAssigneeIds(queryClient));
      if (optimisticIds.size === 0) return merged;
      const mergedFacts = { ...merged.facts };
      for (const taskId of optimisticIds) {
        const previousFact = previous.facts[taskId];
        const mergedFact = mergedFacts[taskId];
        if (previousFact && mergedFact)
          mergedFacts[taskId] = {
            ...mergedFact,
            assignee: previousFact.assignee,
          };
      }
      return { ...merged, facts: mergedFacts };
    },
  );
}

export function useSharedTaskFactDirectory(projectId: string | null) {
  return useQuery<TaskFactDirectory>({
    queryKey: queryKeys.sidebar.tasks.facts(projectId),
    queryFn: async () => ({ projectId, facts: {} }),
    enabled: false,
    ...queryPolicies.taskFactDirectory,
  });
}

export function useTasksRead({
  projectId = null,
  poll = false,
}: {
  projectId?: string | null;
  poll?: boolean;
} = {}) {
  const rpc = useRpc<typeof rpcContract>();
  const queryClient = useQueryClient();
  const directory = useSharedTaskFactDirectory(projectId);
  const query = useQuery({
    queryKey: queryKeys.sidebar.tasks.list(projectId),
    queryFn: async () => {
      const revision = captureTaskFactHydrationRevision(queryClient);
      const result = await rpc.call("sidebarTasks", null);
      if (!result.available)
        throw new Error(result.error ?? "Tasks are unavailable.");
      const adapted = adaptSidebarTaskResponse(projectId, result);
      hydrateTaskFacts(queryClient, projectId, adapted.facts, revision);
      return {
        ...adapted.references,
        relationships: adapted.relationships,
      };
    },
    ...queryPolicies.sidebarTasksList,
    refetchInterval: poll ? 30_000 : false,
    refetchIntervalInBackground: false,
  });
  const data = useMemo(
    () =>
      query.data
        ? resolveSidebarTasks(
            query.data,
            query.data.relationships,
            directory.data,
          )
        : undefined,
    [directory.data, query.data],
  );
  return {
    ...query,
    data,
  };
}

export function useTaskLinksRead({
  projectId = null,
  poll = true,
}: {
  projectId?: string | null;
  poll?: boolean;
} = {}) {
  const rpc = useRpc<typeof rpcContract>();
  const queryClient = useQueryClient();
  const directory = useSharedTaskFactDirectory(projectId);
  const query = useQuery({
    queryKey: queryKeys.sidebar.tasks.links(projectId),
    queryFn: async () => {
      const revision = captureTaskFactHydrationRevision(queryClient);
      const result = await rpc.call("sidebarTaskLinks", null);
      if (!result.available)
        throw new Error(result.error ?? "Task links are unavailable.");
      const adapted = adaptTaskLinkResponse(result);
      hydrateTaskFacts(queryClient, projectId, adapted.facts, revision);
      return adapted.references;
    },
    ...queryPolicies.sidebarTaskLinks,
    refetchInterval: poll ? 30_000 : false,
    refetchIntervalInBackground: false,
  });
  const data = useMemo(
    () =>
      query.data ? resolveTaskLinks(query.data, directory.data) : undefined,
    [directory.data, query.data],
  );
  return {
    ...query,
    data,
  };
}

/** The left sidebar owns the one Tasks-domain realtime subscription. */
export function useTasksRealtimeInvalidation() {
  const queryClient = useQueryClient();
  useRealtime("work-sidebar:changed", (payload) => {
    if (parseWorkSidebarRealtimeEvent(payload)?.family !== "tasks") return;
    void invalidateTaskQueries(queryClient, ["list", "links"]);
  });
}
