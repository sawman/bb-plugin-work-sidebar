import type { ReactNode } from "react";
import { TaskLink } from "../tasks/task-navigation";
import { CopyBadge } from "../../components/ui/copy-badge";
import type { TaskStatus } from "../tasks/model";
import { TaskPriorityIcon } from "../tasks/priority";
import type { WorkItemReference } from "./work-item-model";

type GoalTask = {
  id: string;
  key: string;
  title: string;
  status: TaskStatus;
  priority: "urgent" | "high" | "medium" | "low" | "none";
};

export function WorkItemGoalRow({
  reference,
  label,
  task,
  actions,
}: {
  reference: WorkItemReference;
  label: string;
  task: GoalTask | undefined;
  actions: ReactNode;
}) {
  const copy = (
    <span className="ws-task-workflow-copy ws-work-item-reference">
      <span className="ws-task-workflow-title-line">
        <span className="ws-task-workflow-priority">
          {task ? <TaskPriorityIcon priority={task.priority} /> : null}
        </span>
        <CopyBadge
          value={task?.key ?? reference.id}
          label={task ? "current goal BB task" : "current goal Linear issue"}
          className="ws-task-workflow-key"
          variant="text"
        >
          {task?.key ?? reference.id}
        </CopyBadge>
        {task ? (
          <TaskLink
            taskKey={task.key}
            className="ws-task-workflow-open ws-task-workflow-title ws-work-item-reference-title"
            aria-label={`Open ${task.key} in Tasks`}
          >
            {task.title}
          </TaskLink>
        ) : (
          <span className="ws-task-workflow-title ws-work-item-reference-title">
            {label}
          </span>
        )}
      </span>
    </span>
  );
  return (
    <article
      className="ws-task-workflow-row ws-work-item-goal-row"
      data-state={task?.status}
      aria-label={`${task?.key ?? reference.id}: ${task?.title ?? label}`}
    >
      {copy}
      {actions}
    </article>
  );
}
