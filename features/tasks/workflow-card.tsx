import { useId, useState } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { Icon } from "../../components/ui/icon";
import { ThreadProviderLogo } from "../../components/threads/thread-provider-logo";
import { taskStatusPresentation } from "./model";
import { TaskPriorityIcon } from "./priority";
import { AssigneePicker } from "./assignee-picker";
import {
  MAX_COMPLETED_TASK_PREVIEW,
  projectTaskWorkflow,
  type TaskWorkflowItem,
} from "./workflow-model";

type WorkflowSections = ReturnType<typeof projectTaskWorkflow>;

export function TaskWorkflowCard({
  sections,
  busy,
  onAssigneeChange,
  detachableTaskIds,
  onDetach,
}: {
  sections: WorkflowSections;
  busy: boolean;
  onAssigneeChange(taskId: string, assignee: "agent" | "human"): void;
  detachableTaskIds: ReadonlySet<string>;
  onDetach(taskId: string): void;
}) {
  const [completedOpen, setCompletedOpen] = useState(false);
  const idPrefix = useId();
  return (
    <div className="ws-task-workflow">
      <WorkflowSection id={`${idPrefix}-needs-you`} title="Needs you" tone="attention" items={sections.needsYou} busy={busy} onAssigneeChange={onAssigneeChange} detachableTaskIds={detachableTaskIds} onDetach={onDetach} />
      <WorkflowSection id={`${idPrefix}-in-progress`} title="In progress" items={sections.inProgress} busy={busy} onAssigneeChange={onAssigneeChange} detachableTaskIds={detachableTaskIds} onDetach={onDetach} />
      <WorkflowSection id={`${idPrefix}-next`} title="Next" items={sections.next} busy={busy} onAssigneeChange={onAssigneeChange} detachableTaskIds={detachableTaskIds} onDetach={onDetach} />
      <section className="ws-task-workflow-section" aria-labelledby={`${idPrefix}-completed`}>
        <h3>
          <button
            id={`${idPrefix}-completed`}
            type="button"
            className="ws-task-workflow-disclosure"
            aria-expanded={completedOpen}
            onClick={() => setCompletedOpen((open) => !open)}
          >
            <span>Completed ({sections.completedTotal})</span>
            <Icon name={completedOpen ? "ChevronUp" : "ChevronDown"} aria-hidden />
          </button>
        </h3>
        {completedOpen ? (
          <div className="ws-task-workflow-list">
            {sections.completed.slice(0, MAX_COMPLETED_TASK_PREVIEW).map((item) => (
              <WorkflowRow key={item.task.id} item={item} busy={busy} onAssigneeChange={onAssigneeChange} detachable={detachableTaskIds.has(item.task.id)} onDetach={onDetach} />
            ))}
          </div>
        ) : null}
        {sections.hasMoreCompleted ? <p className="ws-task-workflow-history">Older completed tasks are available in BB Tasks.</p> : null}
      </section>
      {!sections.needsYou.length && !sections.inProgress.length && !sections.next.length && !sections.completed.length ? (
        <p className="ws-card-note">No tasks are attached to this thread.</p>
      ) : null}
    </div>
  );
}

function WorkflowSection({
  id,
  title,
  tone,
  items,
  busy,
  onAssigneeChange,
  detachableTaskIds,
  onDetach,
}: {
  id: string;
  title: "Needs you" | "In progress" | "Next";
  tone?: "attention";
  items: readonly TaskWorkflowItem[];
  busy: boolean;
  onAssigneeChange(taskId: string, assignee: "agent" | "human"): void;
  detachableTaskIds: ReadonlySet<string>;
  onDetach(taskId: string): void;
}) {
  return (
    <section className="ws-task-workflow-section" data-tone={tone} aria-labelledby={id}>
      <h3 id={id}>{title}</h3>
      {items.length ? (
        <div className="ws-task-workflow-list">
          {items.map((item) => <WorkflowRow key={item.task.id} item={item} busy={busy} onAssigneeChange={onAssigneeChange} detachable={detachableTaskIds.has(item.task.id)} onDetach={onDetach} />)}
        </div>
      ) : null}
    </section>
  );
}

function WorkflowRow({
  item,
  busy,
  onAssigneeChange,
  detachable,
  onDetach,
}: {
  item: TaskWorkflowItem;
  busy: boolean;
  onAssigneeChange(taskId: string, assignee: "agent" | "human"): void;
  detachable: boolean;
  onDetach(taskId: string): void;
}) {
  const navigate = useBbNavigate();
  const { task, owner, ownerUnavailable } = item;
  const status = taskStatusPresentation(task.status);
  const ownerLabel = owner?.threadTitle ?? (ownerUnavailable ? "Owner unavailable" : null);
  const accessibleStatus = task.status === "canceled" ? "Canceled" : status.label;
  return (
    <article className="ws-task-workflow-row" data-state={task.status} data-owner-unavailable={ownerUnavailable || undefined} aria-label={`${task.key}: ${task.title}. ${accessibleStatus}.`}>
      <TaskPriorityIcon priority={task.priority ?? "none"} />
      <Icon name={status.icon} aria-hidden />
      <span className="ws-task-workflow-copy">
        <span className="ws-task-workflow-title">{task.title}</span>
        <span className="ws-task-workflow-meta">{task.key} · {status.label}</span>
        {ownerLabel ? (
          owner?.threadId && !ownerUnavailable ? (
            <button type="button" className="ws-task-workflow-owner" aria-label={`Open ${ownerLabel}`} onClick={() => navigate.toThread(owner.threadId!)}>
              <ThreadProviderLogo providerId={owner.providerId ?? "agent"} statusLabel={owner.liveStatus} />
              {ownerLabel}
            </button>
          ) : <span className="ws-task-workflow-owner" data-state="unavailable">{ownerLabel}</span>
        ) : null}
      </span>
      <AssigneePicker value={task.assignee} taskKey={task.key} disabled={busy} onChange={(assignee) => onAssigneeChange(task.id, assignee)} />
      {detachable ? <button type="button" disabled={busy} aria-label={`Detach ${task.key} from this thread`} onClick={() => onDetach(task.id)}><Icon name="X" aria-hidden /></button> : null}
    </article>
  );
}
