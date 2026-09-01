import { useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { CopyBadge } from "../../components/ui/copy-badge";
import { Icon } from "../../components/ui/icon";
import { Input } from "../../components/ui/input";
import { SearchCombobox } from "../../components/ui/combobox";
import type { TaskStatus } from "../tasks/model";
import { TaskPriorityIcon } from "../tasks/priority";
import { TaskStatusControl } from "../tasks/workflow-card";
import { TaskWorkflowContent } from "./tasks-card";
import type { useTasksMutations } from "../tasks/mutations";
import type { useTasksRead } from "../tasks/queries";
import type { rpcContract } from "../../contracts";
import {
  useMoveWorkItemToExecution,
  useWorkItemQueue,
  useWorkItemQueueMutation,
  useWorkOutcome,
  useWorkOutcomeMutation,
  useWorkStatus,
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
  const workStatus = useWorkStatus(threadId);
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
  const persistedQueue = queueQuery.data?.queue;
  // Existing roots have no queue row until their first transition. Keep their
  // durable Outcome/Linear primary visible through the one-time projection;
  // the first queue mutation writes the explicit representation.
  const queue = queueQuery.data?.configured ? persistedQueue! : workItem.queue;
  const goalTaskIds = new Set(
    [queue.current, ...queue.backlog].flatMap((reference) =>
      reference?.source === "bb_task" ? [reference.id] : [],
    ),
  );
  const taskById = new Map<string, TaskSummary>(
    (tasks.data?.tasks ?? []).map((task) => [task.id, {
      key: task.key,
      title: task.title,
      status: task.status,
      priority: task.priority,
    }]),
  );
  if (outcome) taskById.set(outcome.id, {
    key: outcome.key,
    title: outcome.title,
    status: outcome.status,
    priority: outcome.priority,
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
  const legacy = query.data?.legacy;
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
  const saveQueue = (nextQueue: WorkQueueValue) => {
    void report(
      queueMutation.mutateAsync(nextQueue),
      "Work queue updated",
      "Could not update work queue",
    );
  };
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
      title="Work items"
      className={outcome ? "ws-outcome-card" : "ws-outcome-empty"}
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
        onAddGoal={(reference) => {
          const nextQueue = queue.current
            ? { ...queue, backlog: [...queue.backlog, reference] }
            : { ...queue, current: reference };
          if (reference.source === "bb_task") {
            void saveQueue(nextQueue);
            return;
          }
          void report(
            trackerMutations.link
              .mutateAsync(reference.id)
              .then(() => queueMutation.mutateAsync(nextQueue)),
            "Linear issue added to Goals",
            "Could not add Linear issue to Goals",
          );
        }}
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
        onAddToQueue={(reference) => {
          if (reference.source === "bb_task") {
            void report(
              taskMutations.attachment.mutateAsync({
                taskId: reference.id,
                threadId,
                attached: true,
              }),
              "Task added to Queue",
              "Could not add task to Queue",
            );
            return;
          }
          const item = linearByKey.get(reference.id.toUpperCase())?.item;
          const nextQueue = queue.current
            ? { ...queue, backlog: [...queue.backlog, reference] }
            : { ...queue, current: reference };
          void report(
            trackerMutations.link
              .mutateAsync(reference.id)
              .then(() => queueMutation.mutateAsync(nextQueue))
              .then(() => executionMutation.mutateAsync({
                reference,
                title: item?.title ?? reference.id,
                description: `Created from Linear ${reference.id}.`,
              })),
            "Linear issue added to Queue",
            "Could not add Linear issue to Queue",
          );
        }}
        linearSearch={tracker.data?.visible ? {
          query: trackerQuery,
          options: (trackerQuery.trim() ? trackerSearch.data?.items ?? [] : tracker.data.suggestions)
            .map((item) => ({ value: item.key, label: item.key, detail: item.title }))
            .filter((item) => !linearByKey.has(item.value.toUpperCase())),
          searching: trackerSearch.isFetching,
          error: trackerSearch.error,
          onRetry: () => void trackerSearch.refetch(),
          onQueryChange: setTrackerQuery,
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
      {!outcome ? (
        <>
          <p className="ws-card-note">No current Goal yet.</p>
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
              aria-label="New BB task title"
              placeholder="New BB task title"
              value={title}
              disabled={!query.data?.tasksAvailable || mutation.create.isPending || mutation.adopt.isPending}
              onChange={(event) => setTitle(event.target.value)}
            />
            <button
              type="button"
              className="ws-outcome-create-button"
              disabled={!title.trim() || !query.data?.tasksAvailable || mutation.create.isPending || mutation.adopt.isPending}
              aria-label="Create BB task as Goal"
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
                  "BB task created as Goal",
                  "Could not create BB task",
                )
              }
            >
              {mutation.create.isPending ? "Creating…" : "Create BB task"}
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
                  "BB task created from Linear",
                  "Could not create BB task from Linear",
                )
              }
            >
              {mutation.create.isPending ? "Creating BB task…" : `Create BB task from ${workItem.createFromLinear.key}`}
            </button>
          ) : null}
        </>
      ) : null}
      {adoptionNotice ? (
        <p className="ws-card-note" role={adoptionNotice.tone === "error" ? "alert" : "status"}>
          {adoptionNotice.message}
        </p>
      ) : null}
      {tasks.error ? (
        <div className="ws-callout" role="alert">
          {tasks.error.message}
          <button type="button" onClick={() => void tasks.refetch()}>Try again</button>
        </div>
      ) : (
        <TaskWorkflowContent
          threadId={threadId}
          tasks={tasks}
          mutations={taskMutations}
          outcome={query}
          status={workStatus}
          goalTaskIds={goalTaskIds}
          onMakeGoal={(taskId) =>
            void saveQueue(
              promoteWorkItem(queue, { source: "bb_task", id: taskId }),
            )
          }
        />
      )}
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
  onAddGoal,
  onAddToQueue,
  onMoveToExecution,
  onTaskStatus,
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
  onAddGoal(reference: WorkItemReference): void;
  onAddToQueue(reference: WorkItemReference): void;
  onMoveToExecution(reference: WorkItemReference): void;
  onTaskStatus(taskId: string, status: TaskStatus): void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [destination, setDestination] = useState<"goal" | "queue">("goal");
  const [search, setSearch] = useState("");
  const referenced = (reference: WorkItemReference) =>
    (queue.current?.source === reference.source && queue.current.id === reference.id) ||
    queue.backlog.some((item) => item.source === reference.source && item.id === reference.id);
  const bbOptions = bbTaskOptions
    .filter((task) => !referenced({ source: "bb_task", id: task.id }))
    .map((task) => ({ value: `bb_task:${task.id}`, label: task.label, detail: "BB task" }));
  const linearOptions = (linearSearch?.options ?? [])
    .filter((item) => !referenced({ source: "linear", id: item.value }))
    .map((item) => ({ value: `linear:${item.value}`, label: item.label, detail: item.detail }));
  const options = [...bbOptions, ...linearOptions];
  const close = () => {
    setSearch("");
    setDestination("goal");
    linearSearch?.onQueryChange("");
    setPickerOpen(false);
  };
  const selectReference = (value: string) => {
    const separator = value.indexOf(":");
    if (separator <= 0) return;
    const source = value.slice(0, separator) as WorkItemReference["source"];
    const id = value.slice(separator + 1);
    const reference = { source, id } as WorkItemReference;
    if (destination === "goal") onAddGoal(reference);
    else onAddToQueue(reference);
    close();
  };
  return (
    <section className="ws-work-item-queue" aria-label="Work queue">
      <div className="ws-task-workflow-section ws-work-item-goals">
        <h3>Goals</h3>
        {queue.current ? (
          <div className="ws-work-item-queue-current">
            <QueueReference
              reference={queue.current}
              label={labelForReference(queue.current)}
              task={taskById.get(queue.current.id)}
              showStatus={queue.current.source === "bb_task"}
              disabled={pending}
              onStatus={onTaskStatus}
            />
            <WorkItemQueueActions
              disabled={pending}
              onDefer={onDemote}
              onStart={() => onMoveToExecution(queue.current!)}
            />
          </div>
        ) : (
          <p className="ws-card-note">
            Choose a BB task or linked Linear issue as the current goal.
          </p>
        )}
        {queue.backlog.length ? (
          <div className="ws-work-item-backlog">
            <h3 className="ws-card-section-label">Backlog</h3>
            <div role="list" aria-label="Goal backlog">
              {queue.backlog.map((reference) => (
                <div
                  key={`${reference.source}:${reference.id}`}
                  role="listitem"
                  className="ws-work-item-backlog-row"
                >
                  <QueueReference
                    reference={reference}
                    label={labelForReference(reference)}
                    task={taskById.get(reference.id)}
                    showStatus={reference.source === "bb_task"}
                    disabled={pending}
                    onStatus={onTaskStatus}
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
      </div>
      <div className="ws-work-item-queue-add">
        <div
          className="ws-work-item-destination"
          role="group"
          aria-label="Task destination"
        >
          <button
            type="button"
            aria-pressed={destination === "goal"}
            disabled={pending}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setDestination("goal")}
          >
            Goal
          </button>
          <button
            type="button"
            aria-pressed={destination === "queue"}
            disabled={pending}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setDestination("queue")}
          >
            Queue
          </button>
        </div>
        <SearchCombobox
          ariaLabel={`Add a task to ${destination === "goal" ? "Goals" : "Queue"}`}
          busy={linearSearch?.searching ?? false}
          disabled={pending}
          error={linearSearch?.error ?? null}
          emptyMessage="No matching BB or Linear tasks."
          listboxLabel="Available BB and Linear tasks"
          onDismiss={close}
          onOpenChange={setPickerOpen}
          onQueryChange={(value) => {
            setSearch(value);
            linearSearch?.onQueryChange(value);
          }}
          onRetry={() => void linearSearch?.onRetry()}
          onSelectionChange={(values) => {
            const value = values[0];
            if (value) selectReference(value);
          }}
          open={pickerOpen}
          options={options}
          placeholder="Add BB or Linear task…"
          portal
          query={search}
          selectedValues={[]}
        />
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
}: {
  reference: WorkItemReference;
  label: string;
  task: TaskSummary | undefined;
  showStatus: boolean;
  disabled: boolean;
  onStatus(taskId: string, status: TaskStatus): void;
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
        {showStatus ? (
          <TaskStatusControl
            taskKey={task.key}
            status={task.status}
            busy={disabled}
            onChange={(status) => onStatus(reference.id, status)}
          />
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
