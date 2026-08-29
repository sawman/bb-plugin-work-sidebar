import type { TaskSummary } from "../../work-model";

export type TaskWorkflowRecord = TaskSummary & {
  assignee: "agent" | "human";
};

export type TaskWorkflowOwner = Readonly<{
  taskId: string;
  threadId: string;
  threadTitle: string;
  providerId: string;
  liveStatus: "starting" | "working" | "idle" | "completed" | "failed";
}>;

type TaskWorkflowInput = Readonly<{
  outcomeTaskId: string | null;
  tasks: readonly TaskWorkflowRecord[];
  owners: readonly TaskWorkflowOwner[];
}>;

type TaskWorkflowItem = Readonly<{
  task: TaskWorkflowRecord;
  owner: TaskWorkflowOwner | null;
}>;

const ownerRank: Readonly<Record<TaskWorkflowOwner["liveStatus"], number>> = {
  working: 5,
  starting: 4,
  failed: 3,
  idle: 2,
  completed: 1,
};

function ownersByTask(owners: readonly TaskWorkflowOwner[]) {
  const result = new Map<string, TaskWorkflowOwner>();
  for (const owner of owners) {
    const current = result.get(owner.taskId);
    if (!current || ownerRank[owner.liveStatus] > ownerRank[current.liveStatus])
      result.set(owner.taskId, owner);
  }
  return result;
}

/** One deterministic projection for the Work Tasks card. */
export function projectTaskWorkflow({
  outcomeTaskId,
  tasks,
  owners,
}: TaskWorkflowInput) {
  const uniqueTasks = new Map<string, TaskWorkflowRecord>();
  for (const task of tasks) uniqueTasks.set(task.id, task);
  const ownerByTask = ownersByTask(owners);
  const needsYou: TaskWorkflowItem[] = [];
  const inProgress: TaskWorkflowItem[] = [];
  const next: TaskWorkflowItem[] = [];
  const completed: TaskWorkflowItem[] = [];
  for (const task of uniqueTasks.values()) {
    if (task.id === outcomeTaskId) continue;
    const owner = ownerByTask.get(task.id) ?? null;
    const item = { task, owner };
    if (task.status === "done" || task.status === "canceled") {
      completed.push(item);
    } else if (task.assignee === "human") {
      needsYou.push(item);
    } else if (
      task.status === "in_progress" ||
      task.status === "in_review" ||
      owner?.liveStatus === "working" ||
      owner?.liveStatus === "starting"
    ) {
      inProgress.push(item);
    } else {
      next.push(item);
    }
  }
  return { needsYou, inProgress, next, completed };
}
