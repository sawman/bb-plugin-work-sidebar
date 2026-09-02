import type { DragEvent, MouseEvent as ReactMouseEvent } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../../components/ui/context-menu";
import { CopyBadge } from "../../components/ui/copy-badge";
import { ActionTooltip } from "../../components/ui/action-tooltip";
import { Icon } from "../../components/ui/icon";
import type {
  ThreadProvider,
} from "../../components/threads/thread-provider-logo";
import type {
  SidebarTask,
  TaskQueueNode,
  ThreadTaskLink,
} from "../../work-model";
import { taskStatusPresentation } from "./model";
import { TaskPriorityIcon } from "./priority";
import { ThreadAssignmentPicker } from "./thread-assignment-picker";

const TASK_STATUSES: readonly SidebarTask["status"][] = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "canceled",
];
const taskStatus = (status: SidebarTask["status"]) =>
  taskStatusPresentation(status);

export type TaskRowProps = {
  node: TaskQueueNode;
  siblings: readonly TaskQueueNode[];
  showProject: boolean;
  reorderDisabled: boolean;
  dragTaskId: string | null;
  dropTarget: { taskId: string; placement: "before" | "after" } | null;
  onDragTaskChange(taskId: string | null): void;
  onDragTargetChange(
    taskId: string | null,
    placement?: "before" | "after",
  ): void;
  onDropTask(
    sourceId: string,
    targetId: string,
    placement: "before" | "after",
  ): void;
  onMoveTask(taskId: string, direction: -1 | 1): void;
  onOpenThread(threadId: string, split?: boolean): void;
  onUpdateStatus(taskId: string, status: SidebarTask["status"]): Promise<void>;
  onDelete(task: SidebarTask): Promise<void>;
  activeThreadId: string | null;
  bindingLinks: ReadonlyMap<string, ThreadTaskLink>;
  bindingOwnerLinks: ReadonlyMap<string, ThreadTaskLink>;
  ownerThreads: ReadonlyMap<
    string,
    {
      title: string;
      providerId: string;
      provider?: ThreadProvider;
      unavailable?: boolean;
    }
  >;
  onAttachToThread(taskId: string, threadId: string): Promise<void>;
  onDetachFromThread(taskId: string, threadId: string): Promise<void>;
  updatingTaskId: string | null;
  onUpdateAssignee(taskId: string, assignee: SidebarTask["assignee"]): Promise<void>;
  updatingAssigneeTaskId: string | null;
  updatingAttachmentTaskId: string | null;
  selectedTaskIds: ReadonlySet<string>;
  onSelect(taskId: string, event: ReactMouseEvent<HTMLButtonElement>): void;
};

export function TaskRow(props: TaskRowProps) {
  const {
    node,
    siblings,
    showProject,
    reorderDisabled,
    dragTaskId,
    dropTarget,
    onDragTaskChange,
    onDragTargetChange,
    onDropTask,
    onMoveTask,
    onOpenThread,
    onUpdateStatus,
    onDelete,
    activeThreadId,
    bindingLinks,
    bindingOwnerLinks,
    ownerThreads,
    onAttachToThread,
    onDetachFromThread,
    updatingTaskId,
    onUpdateAssignee,
    updatingAssigneeTaskId,
    selectedTaskIds,
    onSelect,
  } = props;
  const { task } = node;
  const bindingLink = bindingLinks.get(task.id) ?? null;
  const bindingOwnerLink = bindingOwnerLinks.get(task.id) ?? null;
  const bindingOwned = Boolean(bindingOwnerLink);
  const ownerThreadId = bindingOwnerLink?.threadId ?? task.linkedThreadIds[0] ?? null;
  const ownerThread = ownerThreadId ? (ownerThreads.get(ownerThreadId) ?? null) : null;
  const ownerThreadTitle = ownerThread?.title ?? bindingOwnerLink?.threadTitle ?? ownerThreadId;
  const pickerThreads = ownerThreadId && !ownerThread
    ? new Map(ownerThreads).set(ownerThreadId, {
        title: ownerThreadTitle ?? ownerThreadId,
        providerId: "agent",
        unavailable: true,
      })
    : ownerThreads;
  const bindingDescriptionId = `ws-task-binding-${task.id}`;
  const ownerState = ownerThreadId
    ? ownerThread
      ? `Owner thread ${ownerThread.title} via ${ownerThread.providerId}`
      : `Owner thread unavailable${ownerThreadTitle ? `: ${ownerThreadTitle}` : ""}`
    : null;
  const isUnowned = !ownerThreadId;
  const assigned = Boolean(
    bindingLink || (activeThreadId && task.linkedThreadIds.includes(activeThreadId)),
  );
  const status = taskStatus(task.status);
  const peers = siblings.filter(
    (candidate) =>
      candidate.task.projectId === task.projectId &&
      candidate.task.status === task.status &&
      candidate.task.parentTaskId === task.parentTaskId,
  );
  const index = peers.findIndex((candidate) => candidate.task.id === task.id);
  const interactive = (event: DragEvent<HTMLElement>) =>
    Boolean(
      (event.target as HTMLElement).closest(
        "button,a,select,summary,[role=button],[role=menu],[role=menuitem]",
      ),
    );
  const placement = (event: DragEvent<HTMLElement>): "before" | "after" => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return event.clientY > bounds.top + bounds.height / 2 ? "after" : "before";
  };
  const openAssignedThread = () =>
    task.linkedThreadIds[0] &&
    onOpenThread(task.linkedThreadIds[0], task.linkedThreadIds.length === 1);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <article
          className={`ws-task-row ws-sidebar-row ws-task-row-${node.role} ${selectedTaskIds.has(task.id) ? "ws-task-row-selected" : ""} ${dragTaskId === task.id ? "ws-task-dragging" : ""}`}
          data-selected={selectedTaskIds.has(task.id) || undefined}
          data-task-role={node.role}
          data-task-id={task.id}
          data-drop-placement={
            dropTarget?.taskId === task.id ? dropTarget.placement : undefined
          }
          draggable={!reorderDisabled}
          onDragStart={(event) => {
            if (reorderDisabled || interactive(event)) {
              event.preventDefault();
              return;
            }
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", task.id);
            onDragTaskChange(task.id);
          }}
          onDragOver={(event) => {
            if (
              reorderDisabled ||
              !dragTaskId ||
              dragTaskId === task.id ||
              !peers.some((candidate) => candidate.task.id === dragTaskId)
            )
              return;
            event.preventDefault();
            onDragTargetChange(task.id, placement(event));
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node))
              onDragTargetChange(null);
          }}
          onDrop={(event) => {
            if (!dragTaskId || dragTaskId === task.id) return;
            event.preventDefault();
            onDropTask(dragTaskId, task.id, placement(event));
            onDragTaskChange(null);
            onDragTargetChange(null);
          }}
          onDragEnd={() => {
            onDragTaskChange(null);
            onDragTargetChange(null);
          }}
        >
          <div className="ws-sidebar-row-main">
            <ActionTooltip label={task.title}>
              {(tooltipId) => <button
              className={`ws-task-assign ${assigned ? "ws-task-assigned" : ""}`}
              type="button"
              aria-pressed={selectedTaskIds.has(task.id)}
              aria-describedby={[ownerState ? bindingDescriptionId : null, tooltipId].filter(Boolean).join(" ")}
              onClick={(event) => onSelect(task.id, event)}
            >
              <span className="ws-task-title ws-sidebar-row-title">
                {task.title}
              </span>
              </button>}
            </ActionTooltip>
            <div className="ws-task-meta ws-sidebar-row-meta">
              {task.dueDate && (
                <span className="ws-task-badge">Due {task.dueDate}</span>
              )}
              {showProject && (
                <span className="ws-task-badge">{task.projectName}</span>
              )}
              {ownerState ? (
                <span id={bindingDescriptionId} className="ws-sr-only">
                  {ownerState}
                </span>
              ) : null}
              <ThreadAssignmentPicker
                taskKey={task.key}
                ownerThreadId={ownerThreadId}
                linkedThreadIds={task.linkedThreadIds}
                lockedThreadId={bindingOwnerLink?.threadId ?? null}
                threads={pickerThreads}
                disabled={props.updatingAttachmentTaskId === task.id}
                onToggle={(threadId, attached) => attached
                  ? onAttachToThread(task.id, threadId)
                  : onDetachFromThread(task.id, threadId)}
              />
            </div>
          </div>
          <div className="ws-task-row-actions ws-sidebar-row-trailing">
            <span className="ws-task-row-primary-info">
              <CopyBadge
                className="ws-task-key-badge"
                value={task.key}
                copyValue={`Task ${task.key}`}
                label="task"
              >
                {task.key}
              </CopyBadge>
              <span className="ws-task-priority-slot">
                <TaskPriorityIcon priority={task.priority} />
              </span>
              <ActionTooltip label={isUnowned
                ? "An unowned task can be reassigned from this row's context menu."
                : "Assignment is changed from the Work card when this task has an owner thread."}>
                {(tooltipId) => <span
                className="ws-task-assignee-readonly"
                role="img"
                aria-label={`${task.assignee === "agent" ? "Agent" : "Human"} assigned (read-only)`}
                aria-describedby={tooltipId}
              >
                <Icon name={task.assignee === "agent" ? "Bot" : "User"} aria-hidden />
                </span>}
              </ActionTooltip>
            </span>
            <span className="ws-task-row-controls">
              <ActionTooltip label={status.label}>
                {(tooltipId) => <label
                className={`ws-task-status-picker ws-task-status-${task.status}`}
                aria-describedby={tooltipId}
              >
                <Icon name={status.icon} aria-hidden />
                <span className="ws-sr-only">Change status for {task.key}</span>
                <select
                  value={task.status}
                  disabled={updatingTaskId === task.id}
                  aria-label={`Change status for ${task.key}: ${status.label}`}
                  onChange={(event) =>
                    void onUpdateStatus(
                      task.id,
                      event.target.value as SidebarTask["status"],
                    )
                  }
                >
                  {TASK_STATUSES.map((next) => (
                    <option key={next} value={next}>
                      {taskStatus(next).label}
                    </option>
                  ))}
                </select>
                </label>}
              </ActionTooltip>
            </span>
          </div>
          {node.children.length > 0 && (
            <div
              className="ws-task-children"
              role="group"
              aria-label={`Execution tasks for ${task.title}`}
            >
              {node.children.map((child) => (
                <TaskRow
                  key={child.id}
                  {...props}
                  node={{
                    task: child,
                    role: "execution",
                    children: [],
                    hasVisibleOutcomeParent: true,
                  }}
                  siblings={node.children.map((childTask) => ({
                    task: childTask,
                    role: "execution" as const,
                    children: [],
                    hasVisibleOutcomeParent: true,
                  }))}
                />
              ))}
            </div>
          )}
        </article>
      </ContextMenuTrigger>
      <ContextMenuContent aria-label={`Actions for ${task.key}`}>
        <ContextMenuLabel>{task.title}</ContextMenuLabel>
        {task.linkedThreadIds[0] && (
          <ContextMenuItem onSelect={openAssignedThread}>
            Open assigned thread
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem
          disabled={reorderDisabled || index <= 0}
          onSelect={() => onMoveTask(task.id, -1)}
        >
          Move up
        </ContextMenuItem>
        <ContextMenuItem
          disabled={reorderDisabled || index < 0 || index >= peers.length - 1}
          onSelect={() => onMoveTask(task.id, 1)}
        >
          Move down
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          disabled={bindingOwned}
          onSelect={() => void onDelete(task)}
        >
          Delete task
        </ContextMenuItem>
        {isUnowned ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuLabel>Unowned task responsibility</ContextMenuLabel>
            <ContextMenuItem
              disabled={
                task.assignee === "human" || updatingAssigneeTaskId === task.id
              }
              onSelect={() => {
                void onUpdateAssignee(task.id, "human").catch(() => undefined);
              }}
            >
              Assign to Human
            </ContextMenuItem>
            <ContextMenuItem
              disabled={
                task.assignee === "agent" || updatingAssigneeTaskId === task.id
              }
              onSelect={() => {
                void onUpdateAssignee(task.id, "agent").catch(() => undefined);
              }}
            >
              Assign to Agent
            </ContextMenuItem>
          </>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
}
