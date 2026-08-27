import { useQuery } from "@tanstack/react-query";
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
