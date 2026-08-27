import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../contracts";
import type { rpcSchemas } from "../../contracts.schemas";
import type { z } from "zod";
import { workContextCardKeys, workContextCardPolicy } from "./model";

type WorkStatus = z.infer<typeof rpcSchemas.getWorkStatus.output>;
type WorkOutcome = z.infer<typeof rpcSchemas.getWorkOutcome.output>;
type WorkGoal = z.infer<typeof rpcSchemas.getWorkGoal.output>;
type WorkPlan = z.infer<typeof rpcSchemas.getWorkPlan.output>;

function useWorkContextCard<T>(threadId: string, key: keyof typeof workContextCardKeys, method: "getWorkStatus" | "getWorkOutcome" | "getWorkGoal" | "getWorkPlan") {
  const rpc = useRpc<typeof rpcContract>();
  return useQuery({
    queryKey: workContextCardKeys[key](threadId),
    queryFn: () => rpc.call(method, { threadId }) as Promise<T>,
    ...workContextCardPolicy,
  });
}

export const useWorkStatus = (threadId: string) => useWorkContextCard<WorkStatus>(threadId, "status", "getWorkStatus");
export const useWorkOutcome = (threadId: string) => useWorkContextCard<WorkOutcome>(threadId, "outcome", "getWorkOutcome");
export const useWorkGoal = (threadId: string) => useWorkContextCard<WorkGoal>(threadId, "goal", "getWorkGoal");
export const useWorkPlan = (threadId: string) => useWorkContextCard<WorkPlan>(threadId, "plan", "getWorkPlan");

export function useLegacyWorkContext(threadId: string) {
  const rpc = useRpc<typeof rpcContract>();
  return useQuery({
    queryKey: ["work-sidebar", "legacy-work-context", threadId],
    queryFn: () => rpc.call("getWorkContext", { threadId }),
    ...workContextCardPolicy,
  });
}

export function useLegacyWorkChanges(threadId: string) {
  const rpc = useRpc<typeof rpcContract>();
  return useQuery({
    queryKey: ["work-sidebar", "legacy-work-changes", threadId],
    queryFn: () => rpc.call("getWorkChanges", { threadId, pullRequests: false }),
    ...workContextCardPolicy,
  });
}

export function useLegacyWorkTracker(threadId: string) {
  const rpc = useRpc<typeof rpcContract>();
  return useQuery({
    queryKey: ["work-sidebar", "legacy-work-tracker", threadId],
    queryFn: () => rpc.call("getWorkTracker", { threadId }),
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
      mutationFn: ({ taskId, status }: { taskId: string; status: string }) => rpc.call("updateWorkTask", { taskId, status: status as never }),
      onSuccess: invalidate,
    }),
    create: useMutation({
      mutationKey: [...workContextCardKeys.outcome(threadId), "create"],
      mutationFn: ({ title }: { threadId: string; title: string }) => rpc.call("createWorkTask", { threadId, title, description: "Created from the Work sidebar.", parentTaskId: null }),
      onSuccess: invalidate,
    }),
  };
}
