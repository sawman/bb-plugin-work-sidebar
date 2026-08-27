export type TaskStatus = "backlog" | "todo" | "in_progress" | "in_review" | "done" | "canceled";
export type TaskPriority = "urgent" | "high" | "medium" | "low" | "none";
export type TaskAssignee = "agent" | "human";

export type TaskRecord = {
  id: string;
  projectId: string;
  projectName: string;
  key: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  parentTaskId: string | null;
  position?: number;
  linkedThreadIds: string[];
  assignee: TaskAssignee;
};

const statusPresentation: Record<TaskStatus, { label: string; tone: "backlog" | "todo" | "progress" | "review" | "complete" | "canceled" }> = {
  backlog: { label: "Backlog", tone: "backlog" }, todo: { label: "To do", tone: "todo" },
  in_progress: { label: "In Progress", tone: "progress" }, in_review: { label: "In Review", tone: "review" },
  done: { label: "Done", tone: "complete" }, canceled: { label: "Canceled", tone: "canceled" },
};
const priorityPresentation: Record<TaskPriority, { label: string; tone: TaskPriority }> = {
  urgent: { label: "Urgent", tone: "urgent" }, high: { label: "High", tone: "high" }, medium: { label: "Medium", tone: "medium" }, low: { label: "Low", tone: "low" }, none: { label: "No priority", tone: "none" },
};

export function taskStatusPresentation(status: TaskStatus) { return statusPresentation[status]; }
export function taskPriorityPresentation(priority: TaskPriority) { return priorityPresentation[priority]; }
export function taskAssigneePresentation(assignee: TaskAssignee) { return assignee === "agent" ? { label: "Agent", icon: "Bot" as const } : { label: "Human", icon: "User" as const }; }

export function presentTask(task: TaskRecord) {
  return {
    ...task,
    status: taskStatusPresentation(task.status),
    priority: taskPriorityPresentation(task.priority),
    assignee: taskAssigneePresentation(task.assignee),
  };
}

export function filterTasksForProject<T extends TaskRecord>(tasks: readonly T[], projectId: string | null): T[] {
  return projectId === null ? [...tasks] : tasks.filter((task) => task.projectId === projectId);
}

export function tasksForThread<T extends TaskRecord>(tasks: readonly T[], threadId: string): T[] {
  return tasks.filter((task) => task.linkedThreadIds.includes(threadId));
}

export function orderTasksForPresentation<T extends TaskRecord>(tasks: readonly T[]): T[] {
  return [...tasks].sort((left, right) =>
    (left.position ?? Number.MAX_SAFE_INTEGER) - (right.position ?? Number.MAX_SAFE_INTEGER) ||
    left.projectName.localeCompare(right.projectName) || left.key.localeCompare(right.key) || left.id.localeCompare(right.id),
  );
}
