import type { TaskSummary } from "../../work-model";

export type TaskWorkflowRecord = TaskSummary & {
  assignee: "agent" | "human";
  /** Completion metadata is optional because the Tasks summary is not required to carry it. */
  completedAt?: number | string | null;
  updatedAt?: number | string | null;
};

export type TaskWorkflowExecutionRecord = Omit<
  TaskWorkflowRecord,
  "assignee"
> & {
  assignee?: TaskWorkflowRecord["assignee"];
};

export type TaskWorkflowOwner = Readonly<{
  taskId: string;
  threadId: string | null;
  threadTitle: string | null;
  providerId: string | null;
  liveStatus: "starting" | "working" | "idle" | "completed" | "failed";
  isArchived?: boolean;
  unavailable?: boolean;
}>;

type TaskWorkflowInput = Readonly<{
  outcomeTaskId: string | null;
  /** Generic project/task links. */
  tasks: readonly TaskWorkflowRecord[];
  /** Binding-owned execution records take precedence over `tasks` by id. */
  executionTasks?: readonly TaskWorkflowExecutionRecord[];
  owners: readonly TaskWorkflowOwner[];
}>;

export type TaskWorkflowItem = Readonly<{
  task: TaskWorkflowRecord;
  owner: TaskWorkflowOwner | null;
  ownerUnavailable: boolean;
}>;

export const MAX_COMPLETED_TASK_PREVIEW = 5;

const ownerLivenessRank: Readonly<
  Record<TaskWorkflowOwner["liveStatus"], number>
> = {
  working: 0,
  starting: 1,
  idle: 2,
  failed: 3,
  completed: 4,
};

const taskStatusRank: Readonly<Record<TaskWorkflowRecord["status"], number>> = {
  in_progress: 0,
  in_review: 1,
  todo: 2,
  backlog: 3,
  done: 4,
  canceled: 5,
};

const taskPriorityRank: Readonly<
  Record<TaskWorkflowRecord["priority"], number>
> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
};

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function ownerIsUnavailable(owner: TaskWorkflowOwner): boolean {
  return (
    owner.isArchived === true ||
    owner.unavailable === true ||
    owner.threadId === null
  );
}

function ownerRank(owner: TaskWorkflowOwner | null): number {
  if (!owner || ownerIsUnavailable(owner)) return Number.MAX_SAFE_INTEGER;
  return ownerLivenessRank[owner.liveStatus];
}

function compareOwners(
  left: TaskWorkflowOwner,
  right: TaskWorkflowOwner,
): number {
  return (
    Number(ownerIsUnavailable(left)) - Number(ownerIsUnavailable(right)) ||
    ownerLivenessRank[left.liveStatus] - ownerLivenessRank[right.liveStatus] ||
    compareStrings(left.threadId ?? "", right.threadId ?? "") ||
    compareStrings(left.providerId ?? "", right.providerId ?? "")
  );
}

function ownersByTask(owners: readonly TaskWorkflowOwner[]) {
  const result = new Map<string, TaskWorkflowOwner>();
  for (const owner of owners) {
    const current = result.get(owner.taskId);
    if (!current || compareOwners(owner, current) < 0)
      result.set(owner.taskId, owner);
  }
  return result;
}

function compareItems(
  left: TaskWorkflowItem,
  right: TaskWorkflowItem,
  includeOwnerLiveness: boolean,
): number {
  return (
    (includeOwnerLiveness ? ownerRank(left.owner) - ownerRank(right.owner) : 0) ||
    taskPriorityRank[left.task.priority] - taskPriorityRank[right.task.priority] ||
    taskStatusRank[left.task.status] - taskStatusRank[right.task.status] ||
    compareStrings(left.task.key, right.task.key) ||
    compareStrings(left.task.id, right.task.id)
  );
}

function timestamp(value: number | string | null | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : -Infinity;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : -Infinity;
  }
  return -Infinity;
}

function completedAt(item: TaskWorkflowItem): number {
  return timestamp(item.task.completedAt ?? item.task.updatedAt);
}

/** One deterministic projection for the Work Tasks card. */
export function projectTaskWorkflow({
  outcomeTaskId,
  tasks,
  executionTasks = [],
  owners,
}: TaskWorkflowInput) {
  const uniqueTasks = new Map<string, TaskWorkflowRecord>();
  for (const task of tasks) uniqueTasks.set(task.id, task);

  // Populate generic records first, then overwrite by execution id. This
  // makes source precedence independent of arrival order and preserves the
  // complete execution record when the two records disagree.
  for (const execution of executionTasks) {
    const generic = uniqueTasks.get(execution.id);
    uniqueTasks.set(execution.id, {
      ...execution,
      assignee: execution.assignee ?? generic?.assignee ?? "agent",
    });
  }

  const ownerByTask = ownersByTask(owners);
  const needsYou: TaskWorkflowItem[] = [];
  const inProgress: TaskWorkflowItem[] = [];
  const next: TaskWorkflowItem[] = [];
  const completed: TaskWorkflowItem[] = [];

  for (const task of uniqueTasks.values()) {
    if (task.id === outcomeTaskId) continue;
    const owner = ownerByTask.get(task.id) ?? null;
    const item: TaskWorkflowItem = {
      task,
      owner,
      // A missing/archived owner is retained on the task instead of causing
      // it to disappear from Next or falsely looking actively owned.
      ownerUnavailable: owner === null || ownerIsUnavailable(owner),
    };

    if (task.status === "done" || task.status === "canceled") {
      completed.push(item);
    } else if (task.assignee === "human") {
      // Human review is explicit follow-up, even when the persisted status is
      // in_review rather than todo/in_progress.
      needsYou.push(item);
    } else if (
      task.status === "in_progress" ||
      task.status === "in_review" ||
      (owner !== null &&
        !ownerIsUnavailable(owner) &&
        (owner.liveStatus === "working" || owner.liveStatus === "starting"))
    ) {
      // Agent review remains active work; there is no separate reviewer field
      // in the Tasks record.
      inProgress.push(item);
    } else {
      next.push(item);
    }
  }

  needsYou.sort((left, right) => compareItems(left, right, false));
  inProgress.sort((left, right) => compareItems(left, right, true));
  next.sort((left, right) => compareItems(left, right, false));
  completed.sort(
    (left, right) =>
      completedAt(right) - completedAt(left) || compareItems(left, right, false),
  );

  return {
    needsYou,
    inProgress,
    next,
    // The section is intentionally bounded; the Tasks app remains the
    // full-history destination for older completions.
    completed: completed.slice(0, MAX_COMPLETED_TASK_PREVIEW),
    completedTotal: completed.length,
    hasMoreCompleted: completed.length > MAX_COMPLETED_TASK_PREVIEW,
  };
}
