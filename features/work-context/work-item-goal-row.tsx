import type { ReactNode } from "react";
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
  onOpenTask,
}: {
  reference: WorkItemReference;
  label: string;
  task: GoalTask | undefined;
  actions: ReactNode;
  onOpenTask(taskKey: string): void;
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
        <span className="ws-task-workflow-title ws-work-item-reference-title">
          {task?.title ?? label}
        </span>
      </span>
    </span>
  );
  return (
    <article
      className="ws-task-workflow-row ws-work-item-goal-row"
      data-state={task?.status}
      aria-label={`${task?.key ?? reference.id}: ${task?.title ?? label}`}
    >
      {task ? (
        <button
          type="button"
          className="ws-task-workflow-open"
          aria-label={`Open ${task.key} in Tasks`}
          onClick={() => onOpenTask(task.key)}
        >
          {copy}
        </button>
      ) : (
        copy
      )}
      {actions}
    </article>
  );
}
