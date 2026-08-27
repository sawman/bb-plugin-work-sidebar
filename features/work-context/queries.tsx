import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { TaskStatus } from "../tasks/model";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../contracts";
import type { rpcSchemas } from "../../contracts.schemas";
import type { z } from "zod";
import { shouldPollWorkActivity, workActivityPolicy, workContextCardKeys, workContextCardPolicy } from "./model";

type WorkStatus = z.infer<typeof rpcSchemas.getWorkStatus.output>;
type WorkOutcome = z.infer<typeof rpcSchemas.getWorkOutcome.output>;
type WorkGoal = z.infer<typeof rpcSchemas.getWorkGoal.output>;
type WorkPlan = z.infer<typeof rpcSchemas.getWorkPlan.output>;
type WorkActivity = z.infer<typeof rpcSchemas.getLatestActivity.output>;

function useWorkContextCard<T>(threadId: string, key: keyof typeof workContextCardKeys, method: "getWorkStatus" | "getWorkOutcome" | "getWorkGoal" | "getWorkPlan") {
  const rpc = useRpc<typeof rpcContract>();
  return useQuery({
    queryKey: workContextCardKeys[key](threadId),
    queryFn: () => rpc.call(method, { threadId }) as Promise<T>,
    ...workContextCardPolicy,
    refetchOnMount: "always",
  });
}

export function useWorkStatus(threadId: string) {
  const rpc = useRpc<typeof rpcContract>();
  return useQuery({
    queryKey: workContextCardKeys.status(threadId),
    queryFn: () => rpc.call("getWorkStatus", { threadId }) as Promise<WorkStatus>,
    ...workContextCardPolicy,
    refetchOnMount: "always",
  });
}

export function useLatestActivity(threadId: string, status: string | undefined) {
  const rpc = useRpc<typeof rpcContract>();
  return useQuery({
    queryKey: workContextCardKeys.activity(threadId),
    queryFn: () => rpc.call("getLatestActivity", { threadId }) as Promise<WorkActivity>,
    enabled: Boolean(threadId),
    ...workActivityPolicy,
    refetchIntervalInBackground: false,
    refetchInterval: (query) => query.state.fetchStatus !== "fetching" && shouldPollWorkActivity(query.state.data?.currentThread.status ?? status) ? 2_000 : false,
  });
}
export const useWorkOutcome = (threadId: string) => useWorkContextCard<WorkOutcome>(threadId, "outcome", "getWorkOutcome");
export const useWorkGoal = (threadId: string) => useWorkContextCard<WorkGoal>(threadId, "goal", "getWorkGoal");
export const useWorkPlan = (threadId: string) => useWorkContextCard<WorkPlan>(threadId, "plan", "getWorkPlan");

export function invalidateWorkContextCards(queryClient: QueryClient, threadId: string) {
  return Promise.all(Object.values(workContextCardKeys).map((key) => queryClient.invalidateQueries({ queryKey: key(threadId) })));
}

export function useLegacyWorkContext(threadId: string) {
  const rpc = useRpc<typeof rpcContract>();
  return useQuery({
    queryKey: ["work-sidebar", "legacy-work-context", threadId],
    queryFn: () => rpc.call("getWorkContext", { threadId }),
    ...workContextCardPolicy,
  });
}

export function useLegacyProviderHealth(threadId: string) {
  const rpc = useRpc<typeof rpcContract>();
  return useQuery({
    queryKey: ["work-sidebar", "legacy-provider-health", threadId],
    queryFn: () => rpc.call("getWorkProviderStatus", { threadId }),
    ...workContextCardPolicy,
    refetchInterval: 30_000,
  });
}

export function useWorkOutcomeMutation(threadId: string) {
  const rpc = useRpc<typeof rpcContract>();
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: workContextCardKeys.outcome(threadId) });
  return {
    update: useMutation({
      mutationKey: [...workContextCardKeys.outcome(threadId), "update"],
      mutationFn: ({ taskId, status }: { taskId: string; status: TaskStatus }) => rpc.call("updateWorkTask", { taskId, status }),
      onSuccess: invalidate,
    }),
    create: useMutation({
      mutationKey: [...workContextCardKeys.outcome(threadId), "create"],
      mutationFn: ({ title }: { title: string }) => rpc.call("createWorkTask", { threadId, title, description: "Created from the Work sidebar.", parentTaskId: null }),
      onSuccess: invalidate,
    }),
  };
}
