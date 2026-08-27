import type { TaskStatus } from "../tasks/model";

export function shouldPollWorkActivity(status: string | undefined): boolean {
  return status === "active" || status === "starting";
}

export function nextOutcomeStatus(status: TaskStatus): TaskStatus | null {
  return (
    (
      {
        backlog: "todo",
        todo: "in_progress",
        in_progress: "in_review",
        in_review: "done",
      } as Partial<Record<TaskStatus, TaskStatus>>
    )[status] ?? null
  );
}
