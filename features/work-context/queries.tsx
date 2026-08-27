import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type { TaskStatus } from "../tasks/model";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../contracts";
import type { rpcSchemas } from "../../contracts.schemas";
import type { z } from "zod";
import { queryKeys, queryPolicies } from "../../query-runtime";
import { shouldPollWorkActivity } from "./model";

type WorkStatus = z.infer<typeof rpcSchemas.getWorkStatus.output>;
type WorkOutcome = z.infer<typeof rpcSchemas.getWorkOutcome.output>;
type WorkGoal = z.infer<typeof rpcSchemas.getWorkGoal.output>;
type WorkPlan = z.infer<typeof rpcSchemas.getWorkPlan.output>;
type WorkActivity = z.infer<typeof rpcSchemas.getLatestActivity.output>;

type WorkQueryKey = "status" | "outcome" | "goal" | "plan";

function useWorkContextCard<T>(
  threadId: string,
  key: WorkQueryKey,
  method: "getWorkStatus" | "getWorkOutcome" | "getWorkGoal" | "getWorkPlan",
) {
  const rpc = useRpc<typeof rpcContract>();
  return useQuery({
    queryKey: queryKeys.work[key](threadId),
    queryFn: () => rpc.call(method, { threadId }) as Promise<T>,
    ...queryPolicies.workContext,
    refetchOnMount: "always",
  });
}

export function useWorkStatus(threadId: string) {
  const rpc = useRpc<typeof rpcContract>();
  return useQuery({
    queryKey: queryKeys.work.status(threadId),
    queryFn: () =>
      rpc.call("getWorkStatus", { threadId }) as Promise<WorkStatus>,
    ...queryPolicies.workContext,
    refetchOnMount: "always",
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
export const useWorkOutcome = (threadId: string) =>
  useWorkContextCard<WorkOutcome>(threadId, "outcome", "getWorkOutcome");
export const useWorkGoal = (threadId: string) =>
  useWorkContextCard<WorkGoal>(threadId, "goal", "getWorkGoal");
export const useWorkPlan = (threadId: string) =>
  useWorkContextCard<WorkPlan>(threadId, "plan", "getWorkPlan");

export function useWorkProviderHealth(threadId: string) {
  const rpc = useRpc<typeof rpcContract>();
  return useQuery({
    queryKey: queryKeys.work.providerHealth(threadId),
    queryFn: () => rpc.call("getWorkProviderStatus", { threadId }),
    ...queryPolicies.health,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}

export function invalidateWorkContextCards(
  queryClient: QueryClient,
  threadId: string,
) {
  const keys = [
    queryKeys.work.status,
    queryKeys.work.activity,
    queryKeys.work.outcome,
    queryKeys.work.goal,
    queryKeys.work.plan,
    queryKeys.work.providerHealth,
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
    update: useMutation({
      mutationKey: [...queryKeys.work.outcome(threadId), "update"],
      mutationFn: ({
        taskId,
        status,
      }: {
        taskId: string;
        status: TaskStatus;
      }) => rpc.call("updateWorkTask", { taskId, status }),
      onSuccess: invalidate,
    }),
    create: useMutation({
      mutationKey: [...queryKeys.work.outcome(threadId), "create"],
      mutationFn: ({ title }: { title: string }) =>
        rpc.call("createWorkTask", {
          threadId,
          title,
          description: "Created from the Work sidebar.",
          parentTaskId: null,
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
