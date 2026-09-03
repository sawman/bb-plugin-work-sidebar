import { toast } from "sonner";
import type { useTasksMutations } from "../tasks/mutations";
import type { useTasksRead } from "../tasks/queries";
import { TaskWorkflowCard } from "../tasks/workflow-card";
import { projectTaskWorkflow, type TaskWorkflowOwner } from "../tasks/workflow-model";
import { useWorkOutcome, useWorkStatus } from "./queries";

type TasksRead = ReturnType<typeof useTasksRead>;
type TasksMutations = ReturnType<typeof useTasksMutations>;

/**
 * The execution portion of the unified Work item card. The card itself owns
 * goal selection; this component projects only the durable BB Tasks queue.
 */
export function TaskWorkflowContent({
  threadId,
  tasks,
  mutations,
  outcome,
  status,
  goalTaskIds,
  onMakeGoal,
}: {
  threadId: string;
  tasks: TasksRead;
  mutations: TasksMutations;
  outcome: ReturnType<typeof useWorkOutcome>;
  status: ReturnType<typeof useWorkStatus>;
  goalTaskIds?: ReadonlySet<string>;
  onMakeGoal?(taskId: string): void;
}) {
  const genericTasks = (tasks.data?.tasks ?? []).filter(
    (task) => task.linkedThreadIds.includes(threadId) && !goalTaskIds?.has(task.id),
  );
  const executionTaskIds = new Set(outcome.data?.executionTasks.map((task) => task.id) ?? []);
  const threadById = new Map([
    ...(status.data?.children ?? []),
    ...(status.data ? [{ id: threadId, ...status.data.currentThread, isArchived: false }] : []),
  ].map((candidate) => [candidate.id, candidate]));
  const bindingOwners: TaskWorkflowOwner[] = (outcome.data?.bindings ?? [])
    .filter((binding) => binding.executionTaskId !== null)
    .map((binding) => {
      const projectedOwner = binding.owner;
      const thread = binding.ownerThreadId ? threadById.get(binding.ownerThreadId) : null;
      const liveStatus = projectedOwner?.liveStatus ??
        (thread?.status === "active" ? "working" :
          thread?.status === "starting" ? "starting" :
            thread?.status === "completed" ? "completed" :
              thread?.status === "failed" ? "failed" : "idle");
      return {
        taskId: binding.executionTaskId!,
        threadId: binding.ownerThreadId,
        threadTitle: projectedOwner?.title ?? thread?.title ?? binding.ownerThreadId,
        providerId: projectedOwner?.providerId ?? thread?.providerId ?? null,
        liveStatus,
        isArchived: projectedOwner?.isArchived ?? thread?.isArchived ?? binding.ownerThreadId !== null,
        unavailable: binding.owner === undefined ? !thread : projectedOwner === null,
      };
    });
  // Generic agent tasks do not have a durable execution binding. When they
  // are linked to a live thread, still show that actual thread instead of the
  // unhelpful generic "Agent" fallback.
  const linkedOwners: TaskWorkflowOwner[] = genericTasks.flatMap((task) =>
    task.assignee === "agent"
      ? task.linkedThreadIds.flatMap((threadId) => {
          const thread = threadById.get(threadId);
          if (!thread) return [];
          return [{
            taskId: task.id,
            threadId,
            threadTitle: thread.title,
            providerId: thread.providerId,
            liveStatus:
              thread.status === "active" ? "working" :
              thread.status === "starting" ? "starting" :
              thread.status === "completed" ? "completed" :
              thread.status === "failed" ? "failed" : "idle",
            isArchived: thread.isArchived,
            unavailable: thread.isArchived,
          }];
        })
      : [],
  );
  const workflow = projectTaskWorkflow({
    outcomeTaskId: outcome.data?.outcome?.id ?? null,
    tasks: genericTasks,
    executionTasks: outcome.data?.executionTasks ?? [],
    owners: [...bindingOwners, ...linkedOwners],
  });
  const detachableTaskIds = new Set(genericTasks.filter((task) => !executionTaskIds.has(task.id)).map((task) => task.id));
  const busy =
    mutations.attachment.isPending ||
    mutations.status.isPending ||
    mutations.assignment.isPending;
  const report = (operation: Promise<unknown>, fallback: string) =>
    void operation.catch((error) => toast.error(error instanceof Error ? error.message : fallback));
  if (tasks.isPending) {
    return <p className="ws-card-note" role="status">Loading tasks…</p>;
  }
  return <div className="ws-thread-task-card">
    <TaskWorkflowCard
      sections={workflow}
      busy={busy}
      detachableTaskIds={detachableTaskIds}
      onStatusChange={(taskId, taskStatus) =>
        report(
          mutations.status.mutateAsync({ taskId, status: taskStatus }),
          "Could not update task status",
        )
      }
      onAssigneeChange={(taskId, assignee) =>
        report(
          mutations.assignment.mutateAsync({ taskId, assignee }),
          "Could not update task assignment",
        )
      }
      onDetach={(taskId) => report(mutations.attachment.mutateAsync({ taskId, threadId, attached: false }), "Could not detach task")}
      onMakeGoal={onMakeGoal}
    />
  </div>;
}
