import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../contracts";
import { useTasksMutations } from "../tasks/mutations";
import { useTasksRead } from "../tasks/queries";
import { useTracker } from "../tracker/queries";
import { BackgroundJobsCard } from "./background-jobs-view";
import { GoalCard } from "./goal-card";
import { PlanCard } from "./plan-card";
import { StatusCard } from "./status-card";
import { WorkItemCard } from "./work-item-card";

export function WorkContextCards({
  threadId,
  tracker,
}: {
  threadId: string;
  tracker: ReturnType<typeof useTracker>;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const tasks = useTasksRead();
  const taskMutations = useTasksMutations(rpc);
  return (
    <section className="ws-work-context-cards" aria-label="Work context">
      <StatusCard threadId={threadId} />
      <WorkItemCard threadId={threadId} tasks={tasks} taskMutations={taskMutations} tracker={tracker} />
      <GoalCard threadId={threadId} />
      <PlanCard threadId={threadId} />
      <BackgroundJobsCard threadId={threadId} />
    </section>
  );
}
