import { useState } from "react";
import { toast } from "sonner";
import { SearchCombobox } from "../../components/ui/combobox";
import type { useTasksMutations } from "../tasks/mutations";
import type { useTasksRead } from "../tasks/queries";
import { TaskWorkflowCard } from "../tasks/workflow-card";
import { projectTaskWorkflow, type TaskWorkflowOwner } from "../tasks/workflow-model";
import { useWorkOutcome, useWorkStatus } from "./queries";
import { CardState } from "./card-state";

type TasksRead = ReturnType<typeof useTasksRead>;
type TasksMutations = ReturnType<typeof useTasksMutations>;

export function TasksCard({
  threadId,
  tasks,
  mutations,
}: {
  threadId: string;
  tasks: TasksRead;
  mutations: TasksMutations;
}) {
  const outcome = useWorkOutcome(threadId);
  const status = useWorkStatus(threadId);
  const [selection, setSelection] = useState("");
  const [attachmentPickerOpen, setAttachmentPickerOpen] = useState(false);
  const genericTasks = (tasks.data?.tasks ?? []).filter((task) => task.linkedThreadIds.includes(threadId));
  const executionTaskIds = new Set(outcome.data?.executionTasks.map((task) => task.id) ?? []);
  const available = (tasks.data?.tasks ?? []).filter(
    (task) => !task.linkedThreadIds.includes(threadId) && !executionTaskIds.has(task.id) && task.id !== outcome.data?.outcome?.id,
  );
  const threadById = new Map([
    ...(status.data?.children ?? []),
    ...(status.data ? [{ id: threadId, ...status.data.currentThread, isArchived: false }] : []),
  ].map((candidate) => [candidate.id, candidate]));
  const owners: TaskWorkflowOwner[] = (outcome.data?.bindings ?? [])
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
  const workflow = projectTaskWorkflow({
    outcomeTaskId: outcome.data?.outcome?.id ?? null,
    tasks: genericTasks,
    executionTasks: outcome.data?.executionTasks ?? [],
    owners,
  });
  const detachableTaskIds = new Set(genericTasks.filter((task) => !executionTaskIds.has(task.id)).map((task) => task.id));
  const busy = mutations.attachment.isPending || mutations.assignment.isPending || mutations.status.isPending;
  const report = (operation: Promise<unknown>, fallback: string) =>
    void operation.catch((error) => toast.error(error instanceof Error ? error.message : fallback));
  return (
    <CardState title="Tasks" pending={tasks.isPending} error={tasks.error} onRetry={() => void tasks.refetch()}>
      <div className="ws-thread-task-card">
        <div className="ws-work-card-control">
          <SearchCombobox
            ariaLabel="Add task to this thread"
            disabled={busy}
            emptyMessage="No matching tasks."
            emptyOption
            listboxLabel="Available tasks"
            onOpenChange={setAttachmentPickerOpen}
            onSelectionChange={(values) => setSelection(values[0] ?? "")}
            open={attachmentPickerOpen}
            options={available.map((task) => ({ value: task.id, label: task.key, detail: task.title }))}
            placeholder="Add an existing task…"
            portal
            selectedValues={selection ? [selection] : []}
          />
          <button
            type="button"
            disabled={!selection || busy}
            onClick={() =>
              report(
                mutations.attachment
                  .mutateAsync({ taskId: selection, threadId, attached: true })
                  .then(() => setSelection("")),
                "Could not attach task",
              )
            }
          >
            {mutations.attachment.isPending ? "…" : "Add"}
          </button>
        </div>
        <TaskWorkflowCard
          sections={workflow}
          busy={busy}
          detachableTaskIds={detachableTaskIds}
          onAssigneeChange={(taskId, assignee) =>
            report(
              mutations.assignment.mutateAsync({ taskId, assignee }),
              "Could not update task assignee",
            )
          }
          onStatusChange={(taskId, taskStatus) =>
            report(
              mutations.status.mutateAsync({ taskId, status: taskStatus }),
              "Could not update task status",
            )
          }
          onDetach={(taskId) => report(mutations.attachment.mutateAsync({ taskId, threadId, attached: false }), "Could not detach task")}
        />
      </div>
    </CardState>
  );
}
