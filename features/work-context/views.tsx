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
  projectId,
  tracker,
}: {
  threadId: string;
  projectId: string | null;
  tracker: ReturnType<typeof useTracker>;
}) {
  const rpc = useRpc<typeof rpcContract>();
  // Work items stay current while their tab is visible, without making the
  // inactive left Tasks pane own an additional polling loop.
  const tasks = useTasksRead({ projectId, poll: true });
  const taskMutations = useTasksMutations(rpc, projectId);
  return (
    <section className="ws-work-context-cards" aria-label="Work context">
      <StatusCard threadId={threadId} />
      <WorkItemCard
        threadId={threadId}
        projectId={projectId}
        tasks={tasks}
        taskMutations={taskMutations}
        tracker={tracker}
      />
      <GoalCard threadId={threadId} />
      <PlanCard threadId={threadId} />
      <BackgroundJobsCard threadId={threadId} />
    </section>
  );
}
