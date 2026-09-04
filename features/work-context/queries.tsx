import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { useMemo } from "react";
import type { rpcContract } from "../../contracts";
import type { rpcSchemas } from "../../contracts.schemas";
import type { z } from "zod";
import { queryKeys, queryPolicies } from "../../query-runtime";
import { shouldPollWorkActivity } from "./model";
import {
  adaptWorkOutcomeResponse,
  resolveWorkOutcome,
} from "../tasks/facts";
import {
  hydrateTaskFacts,
  useSharedTaskFactDirectory,
} from "../tasks/queries";
import {
  captureTaskFactHydrationRevision,
} from "../tasks/fact-hydration-authority";

type WorkStatus = z.infer<typeof rpcSchemas.getWorkStatus.output>;
type WorkOutcome = z.infer<typeof rpcSchemas.getWorkOutcome.output>;
type WorkGoal = z.infer<typeof rpcSchemas.getWorkGoal.output>;
type WorkPlan = z.infer<typeof rpcSchemas.getWorkPlan.output>;
type WorkActivity = z.infer<typeof rpcSchemas.getLatestActivity.output>;
type WorkBackgroundJobs = z.infer<
  typeof rpcSchemas.getWorkBackgroundJobs.output
>;

type WorkQueryKey = "goal" | "plan";

/** Shared cadence for durable Work-card data while the Work tab is visible. */
export const WORK_CARD_REFRESH_MS = 30_000;

function useWorkContextCard<T>(
  threadId: string,
  key: WorkQueryKey,
  method: "getWorkGoal" | "getWorkPlan",
) {
  const rpc = useRpc<typeof rpcContract>();
  return useQuery({
    queryKey: queryKeys.work[key](threadId),
    queryFn: () => rpc.call(method, { threadId }) as Promise<T>,
    ...queryPolicies.workContext,
    refetchOnMount: "always",
    refetchInterval: WORK_CARD_REFRESH_MS,
    refetchIntervalInBackground: false,
  });
}

export function useWorkStatus(
  threadId: string,
  { poll = false }: { poll?: boolean } = {},
) {
  const rpc = useRpc<typeof rpcContract>();
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: queryKeys.work.status(threadId),
    queryFn: async () => {
      const result = await rpc.call("getWorkStatus", { threadId }) as WorkStatus;
      if (result.provider) {
        queryClient.setQueryData(
          queryKeys.work.providerHealth(result.currentThread.providerId),
          result.provider,
        );
      }
      return result;
    },
    ...queryPolicies.workContext,
    refetchOnMount: "always",
    refetchInterval: poll ? WORK_CARD_REFRESH_MS : false,
    refetchIntervalInBackground: false,
  });
}

export function useLatestActivity(
  threadId: string,
  status: string | undefined,
) {
  const rpc = useRpc<typeof rpcContract>();
  return useQuery({
    queryKey: queryKeys.work.activity(threadId),
    queryFn: () =>
      rpc.call("getLatestActivity", { threadId }) as Promise<WorkActivity>,
    enabled: Boolean(threadId),
    ...queryPolicies.workActivity,
    refetchIntervalInBackground: false,
    refetchInterval: (query) =>
      query.state.fetchStatus !== "fetching" &&
      shouldPollWorkActivity(query.state.data?.currentThread.status ?? status)
        ? 2_000
        : false,
  });
}
export function useWorkOutcome(
  threadId: string,
  projectId: string | null = null,
) {
  const rpc = useRpc<typeof rpcContract>();
  const queryClient = useQueryClient();
  const directory = useSharedTaskFactDirectory(projectId);
  const query = useQuery({
    queryKey: queryKeys.work.outcome(threadId),
    queryFn: async () => {
      const revision = captureTaskFactHydrationRevision(queryClient);
      const result = await rpc.call("getWorkOutcome", { threadId });
      const adapted = adaptWorkOutcomeResponse(result);
      hydrateTaskFacts(queryClient, projectId, adapted.facts, revision);
      return adapted.references;
    },
    ...queryPolicies.workContext,
    refetchOnMount: "always",
    refetchInterval: WORK_CARD_REFRESH_MS,
    refetchIntervalInBackground: false,
  });
  const data = useMemo(
    () =>
      query.data
        ? resolveWorkOutcome(query.data, directory.data)
        : undefined,
    [directory.data, query.data],
  );
  data satisfies WorkOutcome | undefined;
  return {
    ...query,
    data,
  };
}
export function useWorkItemQueue(threadId: string) {
  const rpc = useRpc<typeof rpcContract>();
  return useQuery({
    queryKey: queryKeys.work.itemQueue(threadId),
    queryFn: () => rpc.call("getWorkItemQueue", { threadId }),
    ...queryPolicies.workContext,
    refetchOnMount: "always",
    // The Work tab is conditionally mounted, so this only keeps an actively
    // viewed Work-items card current. Do not spend background refreshes on a
    // hidden panel.
    refetchInterval: WORK_CARD_REFRESH_MS,
    refetchIntervalInBackground: false,
  });
}
export const useWorkGoal = (threadId: string) =>
  useWorkContextCard<WorkGoal>(threadId, "goal", "getWorkGoal");
export const useWorkPlan = (threadId: string) =>
  useWorkContextCard<WorkPlan>(threadId, "plan", "getWorkPlan");

type ProviderHealthIdentity = {
  providerId: string;
};

export function invalidateWorkProviderHealth(
  queryClient: QueryClient,
  identity: ProviderHealthIdentity | undefined,
) {
  if (!identity) return Promise.resolve();
  return queryClient.invalidateQueries({
    queryKey: queryKeys.work.providerHealth(identity.providerId),
  });
}

export function useWorkProviderHealth(
  threadId: string,
  identity?: ProviderHealthIdentity,
) {
  const rpc = useRpc<typeof rpcContract>();
  const providerId = identity?.providerId ?? threadId;
  return useQuery({
    queryKey: queryKeys.work.providerHealth(providerId),
    queryFn: () =>
      rpc.call("getWorkProviderStatus", {
        providerId,
      }),
    // Wait for the status read to identify the provider/environment. Starting
    // with a thread-keyed fallback would create a cold duplicate on every
    // thread switch before the shared key becomes available.
    enabled: Boolean(threadId && identity),
    ...queryPolicies.providerHealth,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}

export function useWorkBackgroundJobs(threadId: string) {
  const rpc = useRpc<typeof rpcContract>();
  return useQuery({
    queryKey: queryKeys.work.backgroundJobs(threadId),
    queryFn: () =>
      rpc.call("getWorkBackgroundJobs", { threadId }) as Promise<WorkBackgroundJobs>,
    enabled: Boolean(threadId),
    ...queryPolicies.workBackgroundJobs,
    refetchIntervalInBackground: false,
    refetchInterval: (query) =>
      query.state.fetchStatus === "fetching" ? false : 5_000,
  });
}

export function invalidateWorkContextCards(
  queryClient: QueryClient,
  threadId: string,
) {
  const keys = [
    queryKeys.work.status,
    queryKeys.work.activity,
    queryKeys.work.backgroundJobs,
    queryKeys.work.outcome,
    queryKeys.work.goal,
    queryKeys.work.plan,
    queryKeys.work.itemQueue,
  ];
  return Promise.all(
    keys.map((key) =>
      queryClient.invalidateQueries({ queryKey: key(threadId) }),
    ),
  );
}

export function useWorkOutcomeMutation(threadId: string) {
  const rpc = useRpc<typeof rpcContract>();
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: queryKeys.work.outcome(threadId),
    });
  return {
    create: useMutation({
      mutationKey: [...queryKeys.work.outcome(threadId), "create"],
      mutationFn: ({ title, priority }: {
        title: string;
        priority?: NonNullable<WorkOutcome["outcome"]>["priority"];
      }) =>
        rpc.call("createWorkTask", {
          threadId,
          title,
          description: "Created from the Work sidebar.",
          parentTaskId: null,
          ...(priority ? { priority } : {}),
        }),
      onSuccess: invalidate,
    }),
    adopt: useMutation({
      mutationKey: [...queryKeys.work.outcome(threadId), "adopt-legacy"],
      mutationFn: ({ taskId }: { taskId: string }) =>
        rpc.call("adoptLegacyOutcome", { rootThreadId: threadId, taskId }),
      onSuccess: invalidate,
    }),
  };
}

export function useWorkItemQueueMutation(threadId: string) {
  const rpc = useRpc<typeof rpcContract>();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: [...queryKeys.work.itemQueue(threadId), "save"],
    mutationFn: (queue: { current: { source: "bb_task" | "linear"; id: string } | null; backlog: readonly { source: "bb_task" | "linear"; id: string }[] }) =>
      rpc.call("saveWorkItemQueue", {
        threadId,
        queue: { ...queue, backlog: [...queue.backlog] },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.work.itemQueue(threadId) }),
  });
}

export function useMoveWorkItemToExecution(threadId: string) {
  const rpc = useRpc<typeof rpcContract>();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: [...queryKeys.work.itemQueue(threadId), "move-to-execution"],
    mutationFn: (input: {
      reference: { source: "bb_task" | "linear"; id: string };
      title: string;
      description?: string;
    }) => rpc.call("moveWorkItemToExecution", { threadId, ...input }),
    onSuccess: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.work.itemQueue(threadId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.work.outcome(threadId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.sidebar.tasks.list() }),
    ]),
  });
}
