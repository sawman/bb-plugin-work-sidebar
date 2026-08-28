import { Icon, type IconName } from "../../components/ui/icon";
import type { SidebarTask } from "../../work-model";

type TaskPriority = SidebarTask["priority"];

const priorityPresentation = {
  urgent: { label: "Urgent priority", icon: "AlertCircle" },
  high: { label: "High priority", icon: "PriorityHigh" },
  medium: { label: "Medium priority", icon: "PriorityMedium" },
  low: { label: "Low priority", icon: "PriorityLow" },
} satisfies Record<Exclude<TaskPriority, "none">, { label: string; icon: IconName }>;

export function TaskPriorityIcon({ priority }: { priority: TaskPriority }) {
  if (priority === "none") return null;
  const presentation = priorityPresentation[priority];
  return (
    <span
      className={`ws-task-priority-icon ws-task-priority-${priority}`}
      data-priority={priority}
      role="img"
      aria-label={presentation.label}
      title={presentation.label}
    >
      <Icon name={presentation.icon} aria-hidden />
    </span>
  );
}
