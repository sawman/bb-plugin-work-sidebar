import { useEffect, useId, useRef, useState } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { Icon } from "../../components/ui/icon";
import { ThreadProviderLogo } from "../../components/threads/thread-provider-logo";
import { taskStatusPresentation } from "./model";
import { TaskPriorityIcon } from "./priority";
import { AssigneePicker } from "./assignee-picker";
import type { SidebarTask } from "../../work-model";
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
  onStatusChange,
  detachableTaskIds,
  onDetach,
  onMakeGoal,
}: {
  sections: WorkflowSections;
  busy: boolean;
  onAssigneeChange(taskId: string, assignee: "agent" | "human"): void;
  onStatusChange(taskId: string, status: SidebarTask["status"]): void;
  detachableTaskIds: ReadonlySet<string>;
  onDetach(taskId: string): void;
  onMakeGoal?(taskId: string): void;
}) {
  const idPrefix = useId();
  return (
    <div className="ws-task-workflow">
      <WorkflowSection
        id={`${idPrefix}-needs-you`}
        title="Needs you"
        tone="attention"
        items={sections.needsYou}
        defaultOpen
        busy={busy}
        onAssigneeChange={onAssigneeChange}
        onStatusChange={onStatusChange}
        detachableTaskIds={detachableTaskIds}
        onDetach={onDetach}
        onMakeGoal={onMakeGoal}
      />
      <WorkflowSection
        id={`${idPrefix}-queue`}
        title="Queue"
        items={sections.queue}
        defaultOpen
        busy={busy}
        onAssigneeChange={onAssigneeChange}
        onStatusChange={onStatusChange}
        detachableTaskIds={detachableTaskIds}
        onDetach={onDetach}
        onMakeGoal={onMakeGoal}
      />
      <WorkflowSection
        id={`${idPrefix}-completed`}
        title="Completed"
        items={sections.completed}
        total={sections.completedTotal}
        itemLimit={MAX_COMPLETED_TASK_PREVIEW}
        busy={busy}
        onAssigneeChange={onAssigneeChange}
        onStatusChange={onStatusChange}
        detachableTaskIds={detachableTaskIds}
        onDetach={onDetach}
        onMakeGoal={onMakeGoal}
      />
      {!sections.needsYou.length &&
      !sections.queue.length &&
      !sections.completed.length ? (
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
  total,
  itemLimit,
  defaultOpen = false,
  busy,
  onAssigneeChange,
  onStatusChange,
  detachableTaskIds,
  onDetach,
  onMakeGoal,
}: {
  id: string;
  title: "Needs you" | "Queue" | "Completed";
  tone?: "attention";
  items: readonly TaskWorkflowItem[];
  total?: number;
  itemLimit?: number;
  defaultOpen?: boolean;
  busy: boolean;
  onAssigneeChange(taskId: string, assignee: "agent" | "human"): void;
  onStatusChange(taskId: string, status: SidebarTask["status"]): void;
  detachableTaskIds: ReadonlySet<string>;
  onDetach(taskId: string): void;
  onMakeGoal?(taskId: string): void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const visibleItems = items.slice(0, itemLimit);
  const count = total ?? items.length;
  const label = `${title}: ${count} task${count === 1 ? "" : "s"}`;
  return (
    <section
      className="ws-task-workflow-section"
      data-tone={tone}
      aria-labelledby={id}
    >
      <h3>
        <button
          id={id}
          type="button"
          className="ws-task-workflow-disclosure"
          aria-expanded={open}
          aria-label={label}
          onClick={() => setOpen((current) => !current)}
        >
          <span>{title}</span>
          <span className="ws-task-workflow-disclosure-meta" aria-hidden>
            <span className="ws-task-workflow-count">{count}</span>
            <Icon
              className="ws-task-workflow-icon"
              name={open ? "ChevronUp" : "ChevronDown"}
            />
          </span>
        </button>
      </h3>
      {open && visibleItems.length ? (
        <div className="ws-task-workflow-list">
          {visibleItems.map((item) => (
            <WorkflowRow
              key={item.task.id}
              item={item}
              busy={busy}
              onAssigneeChange={onAssigneeChange}
              onStatusChange={onStatusChange}
              detachable={detachableTaskIds.has(item.task.id)}
              onDetach={onDetach}
              onMakeGoal={onMakeGoal}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function WorkflowRow({
  item,
  busy,
  onAssigneeChange,
  onStatusChange,
  detachable,
  onDetach,
  onMakeGoal,
}: {
  item: TaskWorkflowItem;
  busy: boolean;
  onAssigneeChange(taskId: string, assignee: "agent" | "human"): void;
  onStatusChange(taskId: string, status: SidebarTask["status"]): void;
  detachable: boolean;
  onDetach(taskId: string): void;
  onMakeGoal?(taskId: string): void;
}) {
  const navigate = useBbNavigate();
  const { task, owner, ownerUnavailable } = item;
  const status = taskStatusPresentation(task.status);
  const ownerLabel =
    task.assignee === "human" ? "You" : (owner?.threadTitle ?? "Agent");
  const accessibleStatus =
    task.status === "canceled" ? "Canceled" : status.label;
  return (
    <article
      className="ws-task-workflow-row"
      data-state={task.status}
      data-owner-unavailable={ownerUnavailable || undefined}
      aria-label={`${task.key}: ${task.title}. ${accessibleStatus}.`}
    >
      <span className="ws-task-workflow-copy">
        <span className="ws-task-workflow-title-line">
          <TaskPriorityIcon priority={task.priority ?? "none"} />
          <span className="ws-task-workflow-key">{task.key}</span>
          <span className="ws-task-workflow-title">{task.title}</span>
        </span>
        <span className="ws-task-workflow-meta">
          {owner?.threadId && !ownerUnavailable && task.assignee === "agent" ? (
            <button
              type="button"
              className="ws-task-workflow-owner"
              aria-label={`Open ${ownerLabel}`}
              onClick={() => navigate.toThread(owner.threadId!)}
            >
              <ThreadProviderLogo
                providerId={owner.providerId ?? "agent"}
                statusLabel={owner.liveStatus}
              />
              {ownerLabel}
            </button>
          ) : (
            <span
              className="ws-task-workflow-owner"
              data-state={ownerUnavailable ? "unavailable" : undefined}
            >
              {ownerLabel}
            </span>
          )}
        </span>
      </span>
      <span
        className="ws-task-workflow-actions"
        role="group"
        aria-label={`Actions for ${task.key}`}
      >
        <AssigneePicker
          value={task.assignee}
          taskKey={task.key}
          disabled={busy}
          onChange={(assignee) => onAssigneeChange(task.id, assignee)}
        />
        <TaskStatusControl
          taskKey={task.key}
          status={task.status}
          busy={busy}
          onChange={(next) => onStatusChange(task.id, next)}
        />
        {detachable && onMakeGoal ? (
          <button
            type="button"
            className="ws-task-workflow-action"
            disabled={busy}
            aria-label={`Make ${task.key} a goal`}
            title="Move to Goals"
            onClick={() => onMakeGoal(task.id)}
          >
            <Icon className="ws-task-workflow-icon" name="ArrowUp" aria-hidden />
          </button>
        ) : null}
        {detachable ? (
          <button
            type="button"
            className="ws-task-workflow-action"
            disabled={busy}
            aria-label={`Detach ${task.key} from this thread`}
            title="Detach from this thread"
            onClick={() => onDetach(task.id)}
          >
            <Icon className="ws-task-workflow-icon" name="X" aria-hidden />
          </button>
        ) : null}
      </span>
    </article>
  );
}

const taskStatuses: readonly SidebarTask["status"][] = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "canceled",
];

export function TaskStatusControl({
  taskKey,
  status,
  busy,
  onChange,
}: {
  taskKey: string;
  status: SidebarTask["status"];
  busy: boolean;
  onChange(status: SidebarTask["status"]): void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const presentation = taskStatusPresentation(status);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);
  return (
    <span className="ws-task-workflow-status" ref={root}>
      <button
        ref={trigger}
        type="button"
        className={`ws-task-status-${status}`}
        disabled={busy}
        aria-label={`Change status for ${taskKey}: ${presentation.label}`}
        title={`Change status: ${presentation.label}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Icon
          className="ws-task-workflow-icon"
          name={presentation.icon}
          aria-hidden
        />
      </button>
      {open ? (
        <span
          className="ws-task-workflow-status-options"
          role="listbox"
          aria-label={`Status for ${taskKey}`}
        >
          {taskStatuses.map((next) => (
            <button
              key={next}
              type="button"
              role="option"
              aria-selected={next === status}
              onClick={() => {
                onChange(next);
                setOpen(false);
              }}
            >
              <Icon name={taskStatusPresentation(next).icon} aria-hidden />
              {taskStatusPresentation(next).label}
            </button>
          ))}
        </span>
      ) : null}
    </span>
  );
}
