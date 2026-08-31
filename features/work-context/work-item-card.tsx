import { useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { CopyBadge } from "../../components/ui/copy-badge";
import { Icon } from "../../components/ui/icon";
import { Input } from "../../components/ui/input";
import { SearchCombobox } from "../../components/ui/combobox";
import { AssigneePicker } from "../tasks/assignee-picker";
import { taskStatusPresentation, type TaskStatus } from "../tasks/model";
import { TaskPriorityIcon } from "../tasks/priority";
import type { useTasksMutations } from "../tasks/mutations";
import type { useTasksRead } from "../tasks/queries";
import type { rpcContract } from "../../contracts";
import {
  nextOutcomeStatus,
  previousOutcomeStatus,
} from "./model";
import {
  useMoveWorkItemToExecution,
  useWorkItemQueue,
  useWorkItemQueueMutation,
  useWorkOutcome,
  useWorkOutcomeMutation,
} from "./queries";
import { CardState } from "./card-state";
import { projectWorkItem, promoteWorkItem, demoteCurrentWorkItem, type WorkItemReference } from "./work-item-model";
import { useTrackerMutations, useTrackerSearch } from "../tracker/queries";
import type { useTracker } from "../tracker/queries";

function useDebouncedValue(value: string, delay = 180) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);
  return debounced;
}

type TasksRead = ReturnType<typeof useTasksRead>;
type TasksMutations = ReturnType<typeof useTasksMutations>;
type TrackerRead = ReturnType<typeof useTracker>;
type TaskSummary = {
  key: string;
  title: string;
  status: TaskStatus;
  priority: "urgent" | "high" | "medium" | "low" | "none";
  assignee?: "agent" | "human";
};
type WorkQueueValue = {
  current: WorkItemReference | null;
  backlog: readonly WorkItemReference[];
};

export function WorkItemCard({
  threadId,
  tasks,
  taskMutations,
  tracker,
}: {
  threadId: string;
  tasks: TasksRead;
  taskMutations: TasksMutations;
  tracker: TrackerRead;
}) {
  const query = useWorkOutcome(threadId);
  const mutation = useWorkOutcomeMutation(threadId);
  const queueQuery = useWorkItemQueue(threadId);
  const queueMutation = useWorkItemQueueMutation(threadId);
  const executionMutation = useMoveWorkItemToExecution(threadId);
  const rpc = useRpc<typeof rpcContract>();
  const [trackerQuery, setTrackerQuery] = useState("");
  const trackerSearch = useTrackerSearch(threadId, useDebouncedValue(trackerQuery));
  const trackerMutations = useTrackerMutations(rpc, threadId);
  const outcome = query.data?.outcome;
  const workItem = projectWorkItem({
    outcome: outcome ?? null,
    linked: tracker.data?.items.map(({ item, statusOptions }) => ({ ...item, statusOptions })) ?? [],
    primaryLinearKey: tracker.data?.primaryKey ?? null,
    legacyState: query.data?.legacy.state ?? "none",
  });
  const queue = queueQuery.data?.configured ? queueQuery.data.queue : workItem.queue;
  const sidebarOutcome = tasks.data?.tasks.find((task) => task.id === outcome?.id);
  const taskById = new Map<string, TaskSummary>(
    (tasks.data?.tasks ?? []).map((task) => [task.id, {
      key: task.key,
      title: task.title,
      status: task.status,
      priority: task.priority,
      assignee: task.assignee,
    }]),
  );
  if (outcome) taskById.set(outcome.id, {
    key: outcome.key,
    title: outcome.title,
    status: outcome.status,
    priority: outcome.priority,
    assignee: sidebarOutcome?.assignee,
  });
  const linearByKey = new Map(
    (tracker.data?.items ?? []).map((linked) => [linked.item.key.toUpperCase(), linked]),
  );
  const labelForReference = (reference: WorkItemReference) => {
    if (reference.source === "bb_task") {
      const task = taskById.get(reference.id);
      return task ? `${task.key} · ${task.title}` : `BB task ${reference.id}`;
    }
    const linear = linearByKey.get(reference.id.toUpperCase());
    return linear ? `${linear.item.key} · ${linear.item.title}` : `Linear ${reference.id}`;
  };
  const detailsForReference = (reference: WorkItemReference) => {
    const task = reference.source === "bb_task" ? taskById.get(reference.id) : null;
    const linear = reference.source === "linear" ? linearByKey.get(reference.id.toUpperCase())?.item : null;
    return {
      title: task?.title ?? linear?.title ?? labelForReference(reference),
      description: reference.source === "linear" ? `Created from Linear ${reference.id}.` : `Created from BB Task ${reference.id}.`,
    };
  };
  const currentOutcome = Boolean(outcome && queue.current?.source === "bb_task" && queue.current.id === outcome.id);
  const legacy = query.data?.legacy;
  const previous = outcome ? previousOutcomeStatus(outcome.status) : null;
  const next = outcome ? nextOutcomeStatus(outcome.status) : null;
  const [title, setTitle] = useState("");
  const [adoptionNotice, setAdoptionNotice] = useState<{ message: string; tone: "error" | "success" } | null>(null);
  const report = async (operation: Promise<unknown>, success: string, failure: string) => {
    try {
      await operation;
      toast.success(success);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : failure);
    }
  };
  const trackerBusy = trackerMutations.link.isPending || trackerMutations.unlink.isPending || trackerMutations.status.isPending;
  const saveQueue = (nextQueue: WorkQueueValue) =>
    report(
      queueMutation.mutateAsync(nextQueue),
      "Work queue updated",
      "Could not update work queue",
    );
  const adoptLegacy = async () => {
    const taskId = legacy?.state === "adoptable" ? legacy.taskIds[0] : null;
    if (!taskId) return;
    setAdoptionNotice(null);
    try {
      await mutation.adopt.mutateAsync({ taskId });
      setAdoptionNotice({ message: "Legacy outcome adopted.", tone: "success" });
      toast.success("Legacy outcome adopted");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not adopt legacy outcome";
      setAdoptionNotice({ message, tone: "error" });
      toast.error(message);
    }
  };
  return (
    <CardState
      title="Work item"
      className={currentOutcome ? "ws-outcome-card" : "ws-outcome-empty"}
      trailing={<WorkItemSourceSummary queue={queue} />}
      pending={query.isPending}
      error={query.error}
      onRetry={() => void query.refetch()}
    >
      <WorkQueue
        queue={queue}
        labelForReference={labelForReference}
        bbTaskOptions={(tasks.data?.tasks ?? []).map((task) => ({ id: task.id, label: `${task.key} · ${task.title}` }))}
        taskById={taskById}
        outcomeTaskId={outcome?.id ?? null}
        pending={queueQuery.isPending || queueMutation.isPending || executionMutation.isPending || trackerBusy}
        onPromote={(reference) => void saveQueue(promoteWorkItem(queue, reference))}
        onDemote={() => void saveQueue(demoteCurrentWorkItem(queue))}
        onAddToBacklog={(reference) => void saveQueue({ ...queue, backlog: [...queue.backlog, reference] })}
        onMoveToExecution={(reference) => {
          void report(
            executionMutation.mutateAsync({
              reference,
              ...detailsForReference(reference),
            }),
            "Execution task created",
            "Could not create execution task",
          );
        }}
        onTaskStatus={(taskId, status) =>
          void report(
            taskMutations.status.mutateAsync({ taskId, status }),
            "BB task updated",
            "Could not update BB task",
          )
        }
        updatingAssignee={taskMutations.assignment.isPending}
        onUpdateAssignee={(taskId, assignee) =>
          void report(
            taskMutations.assignment.mutateAsync({ taskId, assignee }),
            "Task assignee updated",
            "Could not update task assignee",
          )
        }
        linearSearch={tracker.data?.visible ? {
          query: trackerQuery,
          options: (trackerQuery.trim() ? trackerSearch.data?.items ?? [] : tracker.data.suggestions)
            .map((item) => ({ value: item.key, label: item.key, detail: item.title }))
            .filter((item) => !linearByKey.has(item.value.toUpperCase())),
          searching: trackerSearch.isFetching,
          error: trackerSearch.error,
          onRetry: () => void trackerSearch.refetch(),
          onQueryChange: setTrackerQuery,
          onAdd: (key) => {
            setTrackerQuery("");
            void report(
              trackerMutations.link
                .mutateAsync(key)
                .then(() =>
                  saveQueue({
                    ...queue,
                    backlog: [...queue.backlog, { source: "linear", id: key }],
                  }),
                ),
              "Linear issue added to backlog",
              "Could not add Linear issue",
            );
          },
        } : null}
        linearError={tracker.error instanceof Error ? tracker.error : null}
        onRetryLinear={() => void tracker.refetch()}
      />
      {queue.current?.source === "linear" && linearByKey.get(queue.current.id.toUpperCase()) ? (
        <LinearStatusControl
          linked={linearByKey.get(queue.current.id.toUpperCase())!}
          busy={trackerBusy}
          onChange={(statusId) =>
            void report(
              trackerMutations.status
                .mutateAsync({ key: queue.current!.id, statusId })
                .then((item) => toast.success(`${item.key} moved to ${item.status}`)),
              "Linear issue updated",
              "Could not update Linear issue",
            )
          }
        />
      ) : null}
      {currentOutcome && outcome ? (
        <>
          {outcome.dueDate ? <p className="ws-card-note">Due {outcome.dueDate}</p> : null}
          <OutcomeStatusControls
            title={outcome.title}
            status={outcome.status}
            previous={previous}
            next={next}
            updating={mutation.update.isPending}
            onMove={(status) =>
              void report(
                mutation.update.mutateAsync({ taskId: outcome.id, status }),
                "Outcome updated",
                "Could not update outcome",
              )
            }
          />
        </>
      ) : !outcome ? (
        <>
          <p className="ws-card-note">No current outcome.</p>
          {legacy?.state === "adoptable" ? (
            <div className="ws-outcome-form">
              <p className="ws-card-note" role="status">{legacy.message ?? "One legacy outcome can be adopted."}</p>
              <button
                type="button"
                disabled={!query.data?.tasksAvailable || !legacy.taskIds[0] || mutation.adopt.isPending || mutation.create.isPending}
                onClick={() => void adoptLegacy()}
              >
                {mutation.adopt.isPending ? "Adopting legacy outcome…" : "Adopt legacy outcome"}
              </button>
            </div>
          ) : legacy && legacy.state !== "none" ? (
            <p className="ws-card-note" role="status">{legacy.message ?? "Legacy outcome adoption needs attention."}</p>
          ) : null}
          <div className="ws-outcome-form">
            <Input
              aria-label="Outcome-oriented task title"
              placeholder="Outcome-oriented task title"
              value={title}
              disabled={!query.data?.tasksAvailable || mutation.create.isPending || mutation.adopt.isPending}
              onChange={(event) => setTitle(event.target.value)}
            />
            <button
              type="button"
              className="ws-outcome-create-button"
              disabled={!title.trim() || !query.data?.tasksAvailable || mutation.create.isPending || mutation.adopt.isPending}
              aria-label="Create and attach outcome task"
              onClick={() =>
                void report(
                  mutation.create
                    .mutateAsync({ title: title.trim() })
                    .then((result) =>
                      queueMutation.mutateAsync({
                        current: { source: "bb_task", id: result.task.id },
                        backlog: queue.backlog,
                      }),
                    )
                    .then(() => setTitle("")),
                  "Outcome created and attached",
                  "Could not create outcome",
                )
              }
            >
              {mutation.create.isPending ? "Creating…" : "Create"}
            </button>
          </div>
          {workItem.createFromLinear ? (
            <button
              type="button"
              disabled={!query.data?.tasksAvailable || mutation.create.isPending || mutation.adopt.isPending}
              onClick={() =>
                void report(
                  mutation.create
                    .mutateAsync({
                      title: workItem.createFromLinear!.title,
                      priority: workItem.createFromLinear!.priority,
                    })
                    .then((result) =>
                      queueMutation.mutateAsync({
                        current: { source: "bb_task", id: result.task.id },
                        backlog: queue.backlog,
                      }),
                    ),
                  "Outcome created from Linear",
                  "Could not create outcome from Linear",
                )
              }
            >
              {mutation.create.isPending ? "Creating outcome…" : `Create outcome from ${workItem.createFromLinear.key}`}
            </button>
          ) : null}
        </>
      ) : null}
      {adoptionNotice ? (
        <p className="ws-card-note" role={adoptionNotice.tone === "error" ? "alert" : "status"}>
          {adoptionNotice.message}
        </p>
      ) : null}
    </CardState>
  );
}

function WorkItemSourceSummary({ queue }: { queue: WorkQueueValue }) {
  const references = [queue.current, ...queue.backlog].filter((reference): reference is WorkItemReference => reference !== null);
  const sources = [...new Set(references.map((reference) => reference.source))];
  if (!sources.length) return null;
  return (
    <span className="ws-work-item-sources" role="group" aria-label="Connected work item sources">
      {sources.map((source) => (
        <span key={source}>{source === "bb_task" ? "BB" : "Linear"}</span>
      ))}
    </span>
  );
}

type LinearSearch = {
  query: string;
  options: readonly { value: string; label: string; detail: string }[];
  searching: boolean;
  error: Error | null;
  onQueryChange(value: string): void;
  onRetry(): void;
  onAdd(key: string): void;
};

function WorkQueue({
  queue,
  labelForReference,
  bbTaskOptions,
  linearSearch,
  linearError,
  onRetryLinear,
  taskById,
  outcomeTaskId,
  pending,
  onPromote,
  onDemote,
  onAddToBacklog,
  onMoveToExecution,
  onTaskStatus,
  updatingAssignee,
  onUpdateAssignee,
}: {
  queue: WorkQueueValue;
  labelForReference(reference: WorkItemReference): string;
  bbTaskOptions: readonly { id: string; label: string }[];
  linearSearch: LinearSearch | null;
  linearError: Error | null;
  onRetryLinear(): void;
  taskById: ReadonlyMap<string, TaskSummary>;
  outcomeTaskId: string | null;
  pending: boolean;
  onPromote(reference: WorkItemReference): void;
  onDemote(): void;
  onAddToBacklog(reference: WorkItemReference): void;
  onMoveToExecution(reference: WorkItemReference): void;
  onTaskStatus(taskId: string, status: TaskStatus): void;
  updatingAssignee: boolean;
  onUpdateAssignee(taskId: string, assignee: "agent" | "human"): void;
}) {
  const [adding, setAdding] = useState<"bb" | "linear" | null>(null);
  const [selection, setSelection] = useState("");
  const referenced = (reference: WorkItemReference) =>
    (queue.current?.source === reference.source && queue.current.id === reference.id) ||
    queue.backlog.some((item) => item.source === reference.source && item.id === reference.id);
  const options = bbTaskOptions
    .filter((task) => !referenced({ source: "bb_task", id: task.id }))
    .map((task) => ({ value: task.id, label: task.label }));
  const close = () => { setSelection(""); setAdding(null); };
  return (
    <section className="ws-work-item-queue" aria-label="Work queue">
      <div className="ws-work-item-queue-heading"><h3 className="ws-card-section-label">Current goal</h3></div>
      {queue.current ? (
        <div className="ws-work-item-queue-current">
          <QueueReference
            reference={queue.current}
            label={labelForReference(queue.current)}
            task={taskById.get(queue.current.id)}
            showStatus={queue.current.source === "bb_task" && queue.current.id !== outcomeTaskId}
            disabled={pending}
            onStatus={onTaskStatus}
            updatingAssignee={updatingAssignee}
            onUpdateAssignee={onUpdateAssignee}
          />
          <WorkItemQueueActions disabled={pending} onDefer={onDemote} onStart={() => onMoveToExecution(queue.current!)} />
        </div>
      ) : <p className="ws-card-note">Choose a BB task or linked Linear issue as the current goal.</p>}
      {queue.backlog.length ? (
        <div className="ws-work-item-backlog">
          <h3 className="ws-card-section-label">Backlog</h3>
          <div role="list" aria-label="Goal backlog">
            {queue.backlog.map((reference) => (
              <div key={`${reference.source}:${reference.id}`} role="listitem" className="ws-work-item-backlog-row">
                <QueueReference
                  reference={reference}
                  label={labelForReference(reference)}
                  task={taskById.get(reference.id)}
                  showStatus={reference.source === "bb_task"}
                  disabled={pending}
                  onStatus={onTaskStatus}
                  updatingAssignee={updatingAssignee}
                  onUpdateAssignee={onUpdateAssignee}
                />
                <WorkItemQueueActions
                  disabled={pending}
                  onMakeCurrent={() => onPromote(reference)}
                  onStart={() => onMoveToExecution(reference)}
                />
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <div className="ws-work-item-queue-add">
        <button type="button" className="ws-text-button" disabled={pending} onClick={() => setAdding("bb")}>Add BB task</button>
        {linearSearch ? (
          <button type="button" className="ws-text-button" disabled={pending} onClick={() => setAdding("linear")}>
            Add Linear issue
          </button>
        ) : null}
        {adding === "bb" ? (
          <SearchCombobox
            ariaLabel="Add BB task to work backlog"
            emptyMessage="No available BB tasks."
            emptyOption
            listboxLabel="Available BB tasks"
            onDismiss={close}
            onOpenChange={(open) => { if (!open) close(); }}
            onSelectionChange={(values) => {
              const id = values[0];
              if (id) {
                onAddToBacklog({ source: "bb_task", id });
                close();
              }
            }}
            open
            options={options}
            placeholder="Search BB tasks…"
            portal
            selectedValues={selection ? [selection] : []}
          />
        ) : null}
        {adding === "linear" && linearSearch ? (
          <SearchCombobox
            ariaLabel="Add Linear issue to work backlog"
            busy={linearSearch.searching}
            error={linearSearch.error}
            emptyMessage="No matching Linear issues."
            emptyOption
            listboxLabel="Available Linear issues"
            onDismiss={() => { close(); linearSearch.onQueryChange(""); }}
            onOpenChange={(open) => {
              if (!open) {
                close();
                linearSearch.onQueryChange("");
              }
            }}
            onQueryChange={linearSearch.onQueryChange}
            onRetry={linearSearch.onRetry}
            onSelectionChange={(values) => {
              const key = values[0];
              if (key) {
                linearSearch.onAdd(key);
                close();
              }
            }}
            open
            options={linearSearch.options}
            placeholder="Search Linear issues…"
            portal
            query={linearSearch.query}
            selectedValues={selection ? [selection] : []}
          />
        ) : null}
      </div>
      {linearError ? (
        <div className="ws-callout" role="alert">
          {linearError.message}
          <button type="button" onClick={onRetryLinear}>Try again</button>
        </div>
      ) : null}
    </section>
  );
}

function LinearStatusControl({
  linked,
  busy,
  onChange,
}: {
  linked: { item: { key: string }; statusOptions: readonly { id: string; name: string; current: boolean }[] };
  busy: boolean;
  onChange(statusId: string): void;
}) {
  const current = linked.statusOptions.find((option) => option.current)?.id ?? "";
  return (
    <label className="ws-work-item-linear-status">
      <span>Linear status</span>
      <select aria-label={`${linked.item.key} status`} disabled={busy} value={current} onChange={(event) => onChange(event.target.value)}>
        {linked.statusOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
      </select>
    </label>
  );
}

function QueueReference({
  reference,
  label,
  task,
  showStatus,
  disabled,
  onStatus,
  updatingAssignee,
  onUpdateAssignee,
}: {
  reference: WorkItemReference;
  label: string;
  task: TaskSummary | undefined;
  showStatus: boolean;
  disabled: boolean;
  onStatus(taskId: string, status: TaskStatus): void;
  updatingAssignee: boolean;
  onUpdateAssignee(taskId: string, assignee: "agent" | "human"): void;
}) {
  return (
    <span className="ws-work-item-reference">
      {task ? (
        <span className="ws-work-item-reference-meta">
          <TaskPriorityIcon priority={task.priority} />
          <CopyBadge value={task.key} label="task ID" className="ws-work-header-badge">{task.key}</CopyBadge>
        </span>
      ) : (
        <CopyBadge value={reference.id} label="Linear issue" className="ws-work-header-badge">{reference.id}</CopyBadge>
      )}
      <span className="ws-work-item-reference-title">{task?.title ?? label}</span>
      {task ? <span className="ws-work-item-reference-controls">
        {task.assignee ? (
          <AssigneePicker
            value={task.assignee}
            taskKey={task.key}
            disabled={disabled || updatingAssignee}
            onChange={(assignee) => onUpdateAssignee(reference.id, assignee)}
          />
        ) : null}
        {showStatus ? (
          <select
            aria-label={`${task.key} status`}
            disabled={disabled}
            value={task.status}
            onChange={(event) => onStatus(reference.id, event.target.value as TaskStatus)}
          >
            {(["backlog", "todo", "in_progress", "in_review", "done", "canceled"] as const).map((status) => (
              <option key={status} value={status}>{taskStatusPresentation(status).label}</option>
            ))}
          </select>
        ) : null}
      </span> : null}
    </span>
  );
}

function WorkItemQueueActions({
  disabled,
  onDefer,
  onMakeCurrent,
  onStart,
}: {
  disabled: boolean;
  onDefer?: () => void;
  onMakeCurrent?: () => void;
  onStart: () => void;
}) {
  return (
    <span className="ws-work-item-queue-actions" role="group" aria-label="Work item actions">
      {onDefer ? (
        <button type="button" className="ws-work-item-queue-action" disabled={disabled} aria-label="Defer" title="Defer current goal" onClick={onDefer}>
          <Icon name="Clock" aria-hidden />
        </button>
      ) : null}
      {onMakeCurrent ? (
        <button type="button" className="ws-work-item-queue-action" disabled={disabled} aria-label="Make current" title="Make current goal" onClick={onMakeCurrent}>
          <Icon name="ArrowRight" aria-hidden />
        </button>
      ) : null}
      <button type="button" className="ws-work-item-queue-action" disabled={disabled} aria-label="Start task" title="Start as task" onClick={onStart}>
        <Icon name="CircleHalf" aria-hidden />
      </button>
    </span>
  );
}

function OutcomeStatusControls({
  title,
  status,
  previous,
  next,
  updating,
  onMove,
}: {
  title: string;
  status: TaskStatus;
  previous: TaskStatus | null;
  next: TaskStatus | null;
  updating: boolean;
  onMove(status: TaskStatus): void;
}) {
  const current = taskStatusPresentation(status);
  const previousLabel = previous
    ? `Move ${title} back to ${taskStatusPresentation(previous).label}`
    : `No previous outcome status for ${title}`;
  const nextLabel = next
    ? `Move ${title} forward to ${taskStatusPresentation(next).label}`
    : `No next outcome status for ${title}`;
  return (
    <div className="ws-outcome-status-controls" role="group" aria-label={`Outcome status: ${current.label}`}>
      <button
        type="button"
        className="ws-outcome-status-step"
        disabled={!previous || updating}
        aria-label={previousLabel}
        title={previousLabel}
        onClick={() => { if (previous) onMove(previous); }}
      >
        <Icon name="ArrowLeft" aria-hidden />
      </button>
      <span
        className={`ws-outcome-status-current ws-outcome-status-${status}${updating ? " ws-outcome-status-updating" : ""}`}
        role="img"
        aria-label={`Current outcome status: ${current.label}`}
        title={current.label}
      >
        <Icon name={current.icon} aria-hidden />
        <span aria-hidden>{current.label}</span>
      </span>
      <button
        type="button"
        className="ws-outcome-status-step"
        disabled={!next || updating}
        aria-label={nextLabel}
        title={nextLabel}
        onClick={() => { if (next) onMove(next); }}
      >
        <Icon name="ArrowRight" aria-hidden />
      </button>
    </div>
  );
}
