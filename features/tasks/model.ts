export type TaskStatus = "backlog" | "todo" | "in_progress" | "in_review" | "done" | "canceled";

const statusPresentation: Record<TaskStatus, { label: string; tone: "backlog" | "todo" | "progress" | "review" | "complete" | "canceled" }> = {
  backlog: { label: "Backlog", tone: "backlog" }, todo: { label: "To do", tone: "todo" },
  in_progress: { label: "In Progress", tone: "progress" }, in_review: { label: "In Review", tone: "review" },
  done: { label: "Done", tone: "complete" }, canceled: { label: "Canceled", tone: "canceled" },
};
export function taskStatusPresentation(status: TaskStatus) { return statusPresentation[status]; }
