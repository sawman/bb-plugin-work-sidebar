import type { IconName } from "../../components/ui/icon";

export type TaskStatus = "backlog" | "todo" | "in_progress" | "in_review" | "done" | "canceled";

const statusPresentation: Record<TaskStatus, { label: string; tone: "backlog" | "todo" | "progress" | "review" | "complete" | "canceled"; icon: IconName }> = {
  backlog: { label: "Backlog", tone: "backlog", icon: "ListTodo" }, todo: { label: "To do", tone: "todo", icon: "Circle" },
  in_progress: { label: "In Progress", tone: "progress", icon: "Hammer" }, in_review: { label: "In Review", tone: "review", icon: "Eye" },
  done: { label: "Done", tone: "complete", icon: "Check" }, canceled: { label: "Canceled", tone: "canceled", icon: "X" },
};
export function taskStatusPresentation(status: TaskStatus) { return statusPresentation[status]; }
