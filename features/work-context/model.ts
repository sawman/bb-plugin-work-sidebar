import type { TaskStatus } from "../tasks/model";

export type WorkBindingOwner = {
  rootThreadId: string;
  outcomeTaskId: string;
  executionTaskId: string | null;
  ownerThreadId: string | null;
};

/**
 * Keeps generic task controls separate from durable Work bindings. Outcome
 * ownership lives on the root; execution ownership lives on its owner thread.
 */
export function projectWorkTaskBindingOwnership(
  threadId: string,
  bindings: readonly WorkBindingOwner[],
) {
  const bindingOwnedTaskIds = new Set<string>();
  const currentThreadBindingTaskIds = new Set<string>();
  for (const binding of bindings) {
    const taskId = binding.executionTaskId ?? binding.outcomeTaskId;
    const ownerThreadId = binding.executionTaskId
      ? binding.ownerThreadId
      : binding.rootThreadId;
    bindingOwnedTaskIds.add(taskId);
    if (ownerThreadId === threadId) currentThreadBindingTaskIds.add(taskId);
  }
  return { bindingOwnedTaskIds, currentThreadBindingTaskIds };
}

export function shouldPollWorkActivity(status: string | undefined): boolean {
  return status === "active" || status === "starting";
}

const outcomeStatusWorkflow: readonly TaskStatus[] = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
];

function adjacentOutcomeStatus(
  status: TaskStatus,
  offset: -1 | 1,
): TaskStatus | null {
  const index = outcomeStatusWorkflow.indexOf(status);
  return index < 0 ? null : (outcomeStatusWorkflow[index + offset] ?? null);
}

export function previousOutcomeStatus(status: TaskStatus): TaskStatus | null {
  return adjacentOutcomeStatus(status, -1);
}

export function nextOutcomeStatus(status: TaskStatus): TaskStatus | null {
  return adjacentOutcomeStatus(status, 1);
}
