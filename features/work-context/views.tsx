import { useEffect, useState } from "react";
import { experimental_useProviders, useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Icon, type IconName } from "../../components/ui/icon";
import { CopyBadge } from "../../components/ui/copy-badge";
import { ThreadProviderLogo } from "../../components/threads/thread-provider-logo";
import { Input } from "../../components/ui/input";
import { SearchCombobox } from "../../components/ui/combobox";
import { AssigneePicker } from "../tasks/assignee-picker";
import { TaskWorkflowCard } from "../tasks/workflow-card";
import { projectTaskWorkflow, type TaskWorkflowOwner } from "../tasks/workflow-model";
import type { rpcContract } from "../../contracts";
import {
  goalProgressPercent,
  readableStatus,
  runtimeStatusPresentation,
} from "../../work-model";
import { useTasksMutations } from "../tasks/mutations";
import { taskStatusPresentation, type TaskStatus } from "../tasks/model";
import { TaskPriorityIcon } from "../tasks/priority";
import { useTasksRead } from "../tasks/queries";
import {
  nextOutcomeStatus,
  previousOutcomeStatus,
} from "./model";
import {
  useLatestActivity,
  useWorkGoal,
  useWorkItemQueue,
  useWorkItemQueueMutation,
  useMoveWorkItemToExecution,
  useWorkOutcome,
  useWorkOutcomeMutation,
  useWorkPlan,
  useWorkProviderHealth,
  useWorkStatus,
} from "./queries";
import { CardState } from "./card-state";
import { BackgroundJobsCard } from "./background-jobs-view";
import { useTrackerMutations, useTrackerSearch, type useTracker } from "../tracker/queries";
import { projectWorkItem, promoteWorkItem, demoteCurrentWorkItem, type WorkItemReference } from "./work-item-model";

function useDebouncedValue(value: string, delay = 180) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);
  return debounced;
}

function StatusCard({ threadId }: { threadId: string }) {
  const query = useWorkStatus(threadId);
  const latestActivity = useLatestActivity(
    threadId,
    query.data?.currentThread.status,
  );
  const provider = useWorkProviderHealth(threadId);
  const providerDirectory = experimental_useProviders();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const data = query.data;
  const runtime = data ? runtimeStatusPresentation(data.currentThread) : null;
  const total = data?.children.filter((child) => !child.isArchived).length ?? 0;
  const active =
    data?.children.filter(
      (child) =>
        !child.isArchived && ["active", "starting"].includes(child.status),
    ).length ?? 0;
  return (
    <CardState
      title="Status"
      className="ws-status-card"
      trailing={
        data && runtime ? (
          <StatusHeading
            runtime={runtime}
            total={total}
            active={active}
            provider={provider.data ?? null}
            providerLogo={provider.data
              ? providerDirectory.providers.find(
                  (candidate) => candidate.id === provider.data!.providerId,
                )
              : undefined}
          />
        ) : undefined
      }
      pending={query.isPending}
      error={query.error}
      onRetry={() => void query.refetch()}
    >
      {latestActivity.data?.latest || latestActivity.data?.lastUser ? (
        <div className="ws-activity-list">
          {latestActivity.data?.lastUser ? (
            <ActivityRow
              label="User"
              entry={latestActivity.data.lastUser}
              expanded={expanded.has("user")}
              onToggle={() =>
                setExpanded((current) => {
                  const next = new Set(current);
                  next.has("user") ? next.delete("user") : next.add("user");
                  return next;
                })
              }
            />
          ) : null}
          {latestActivity.data?.latest ? (
            <ActivityRow
              label="Agent"
              entry={latestActivity.data.latest}
              expanded={expanded.has("agent")}
              onToggle={() =>
                setExpanded((current) => {
                  const next = new Set(current);
                  next.has("agent") ? next.delete("agent") : next.add("agent");
                  return next;
                })
              }
            />
          ) : null}
        </div>
      ) : null}
    </CardState>
  );
}

const runtimeIcons = {
  working: "LoaderCircle",
  waiting: "UserClock",
  blocked: "AlertCircle",
  complete: "Check",
  idle: "Circle",
} satisfies Record<ReturnType<typeof runtimeStatusPresentation>["tone"], IconName>;

function countLabel(count: number, description: string) {
  return `${count} ${description}${count === 1 ? "" : "s"}`;
}

function StatusHeading({
  runtime,
  total,
  active,
  provider,
  providerLogo,
}: {
  runtime: ReturnType<typeof runtimeStatusPresentation>;
  total: number;
  active: number;
  provider: Parameters<typeof ProviderHealth>[0]["provider"] | null;
  providerLogo?: Parameters<typeof ThreadProviderLogo>[0]["provider"];
}) {
  return (
    <span className="ws-status-heading-meta">
      <span
        className={`ws-runtime-state ws-runtime-state-${runtime.tone}`}
        title={runtime.label}
      >
        <Icon name={runtimeIcons[runtime.tone]} aria-label={runtime.label} />
      </span>
      <span title={countLabel(total, "child agent")}>
        <Icon name="Bot" aria-hidden />
        <span aria-hidden>{total}</span>
        <span className="ws-sr-only">{countLabel(total, "child agent")}</span>
      </span>
      <span
        className="ws-active-agent-count"
        title={countLabel(active, "active child agent")}
      >
        <Icon name="Wrench" aria-hidden />
        <span aria-hidden>{active}</span>
        <span className="ws-sr-only">
          {countLabel(active, "active child agent")}
        </span>
      </span>
      {provider ? <ProviderHealth provider={provider} providerLogo={providerLogo} /> : null}
    </span>
  );
}

function ActivityRow({
  label,
  entry,
  expanded,
  onToggle,
}: {
  label: string;
  entry: { text: string; kind: string };
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={`ws-activity-item${entry.kind === "command" ? " ws-activity-item-command" : ""}${expanded ? " ws-activity-item-expanded" : ""}`}
      aria-expanded={expanded}
      onClick={onToggle}
    >
      <span className="ws-activity-label">{label}</span>
      {entry.kind === "command" ? (
        <code className="ws-activity-command">{entry.text}</code>
      ) : (
        <span className="ws-activity-copy">{entry.text}</span>
      )}
    </button>
  );
}

function ProviderHealth({
  provider,
  providerLogo,
}: {
  provider: {
    providerId: string;
    tone: string;
    providerName: string;
    status: string;
    statusUrl: string | null;
    message: string | null;
  };
  providerLogo?: Parameters<typeof ThreadProviderLogo>[0]["provider"];
}) {
  const navigate = useBbNavigate();
  const label = `${provider.providerName} provider status: ${readableStatus(provider.status)}. ${provider.message ?? "No provider message."}`;
  const icon = (
    <span aria-hidden className="ws-provider-health-icon">
      <ThreadProviderLogo
        providerId={provider.providerId}
        provider={providerLogo}
        runtimeState="idle"
      />
    </span>
  );
  return provider.statusUrl ? (
    <button
      type="button"
      className={`ws-provider-health ws-provider-health-${provider.tone}`}
      aria-label={label}
      title={label}
      onClick={() => navigate.openUrl(provider.statusUrl!)}
    >{icon}</button>
  ) : (
    <span
      className={`ws-provider-health ws-provider-health-${provider.tone}`}
      role="img"
      aria-label={label}
      title={label}
    >{icon}</span>
  );
}

type TasksRead = ReturnType<typeof useTasksRead>;
type TasksMutations = ReturnType<typeof useTasksMutations>;

function WorkItemCard({
  threadId,
  tasks,
  taskMutations,
  tracker,
}: {
  threadId: string;
  tasks: TasksRead;
  taskMutations: TasksMutations;
  tracker: ReturnType<typeof useTracker>;
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
  const persistedQueue = queueQuery.data?.queue;
  // Existing roots have no queue row until their first transition. Keep their
  // durable Outcome/Linear primary visible through the one-time projection;
  // the first queue mutation writes the explicit representation.
  const queue = queueQuery.data?.configured ? persistedQueue! : workItem.queue;
  const saveQueue = (next: typeof queue) =>
    void report(
      queueMutation.mutateAsync(next),
      "Work queue updated",
      "Could not update work queue",
    );
  const sidebarOutcome = tasks.data?.tasks.find(
    (task) => task.id === outcome?.id,
  );
  const taskById = new Map<string, {
    key: string;
    title: string;
    status: TaskStatus;
    priority: "urgent" | "high" | "medium" | "low" | "none";
    assignee?: "agent" | "human";
  }>(
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
  const labelForReference = (reference: WorkItemReference) =>
    reference.source === "bb_task"
      ? taskById.get(reference.id)
        ? `${taskById.get(reference.id)!.key} · ${taskById.get(reference.id)!.title}`
        : `BB task ${reference.id}`
      : linearByKey.get(reference.id.toUpperCase())
        ? `${linearByKey.get(reference.id.toUpperCase())!.item.key} · ${linearByKey.get(reference.id.toUpperCase())!.item.title}`
        : `Linear ${reference.id}`;
  const detailsForReference = (reference: WorkItemReference) => {
    const task = reference.source === "bb_task" ? taskById.get(reference.id) : null;
    const linear = reference.source === "linear" ? linearByKey.get(reference.id.toUpperCase())?.item : null;
    return { title: task?.title ?? linear?.title ?? labelForReference(reference), description: reference.source === "linear" ? `Created from Linear ${reference.id}.` : `Created from BB Task ${reference.id}.` };
  };
  const currentOutcome = Boolean(
    outcome &&
      queue.current?.source === "bb_task" &&
      queue.current.id === outcome.id,
  );
  const legacy = query.data?.legacy;
  const previous = outcome ? previousOutcomeStatus(outcome.status) : null;
  const next = outcome ? nextOutcomeStatus(outcome.status) : null;
  const [title, setTitle] = useState("");
  const [adoptionNotice, setAdoptionNotice] = useState<{
    message: string;
    tone: "error" | "success";
  } | null>(null);
  const report = async (
    operation: Promise<unknown>,
    success: string,
    failure: string,
  ) => {
    try {
      await operation;
      toast.success(success);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : failure);
    }
  };
  const trackerBusy =
    trackerMutations.link.isPending ||
    trackerMutations.unlink.isPending ||
    trackerMutations.status.isPending;
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
        pending={
          queueQuery.isPending ||
          queueMutation.isPending ||
          executionMutation.isPending ||
          trackerBusy
        }
        onPromote={(reference) => saveQueue(promoteWorkItem(queue, reference))}
        onDemote={() => saveQueue(demoteCurrentWorkItem(queue))}
        onAddToBacklog={(reference) => saveQueue({
          ...queue,
          backlog: [...queue.backlog, reference],
        })}
        onMoveToExecution={(reference) => {
          const details = detailsForReference(reference);
          void report(
            executionMutation.mutateAsync({ reference, ...details }),
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
                .then(() => saveQueue({ ...queue, backlog: [...queue.backlog, { source: "linear", id: key }] })),
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
          {outcome.dueDate ? (
            <p className="ws-card-note">Due {outcome.dueDate}</p>
          ) : null}
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
              <p className="ws-card-note" role="status">
                {legacy.message ?? "One legacy outcome can be adopted."}
              </p>
              <button
                type="button"
                disabled={
                  !query.data?.tasksAvailable ||
                  !legacy.taskIds[0] ||
                  mutation.adopt.isPending ||
                  mutation.create.isPending
                }
                onClick={() => void adoptLegacy()}
              >
                {mutation.adopt.isPending
                  ? "Adopting legacy outcome…"
                  : "Adopt legacy outcome"}
              </button>
            </div>
          ) : legacy && legacy.state !== "none" ? (
            <p className="ws-card-note" role="status">
              {legacy.message ?? "Legacy outcome adoption needs attention."}
            </p>
          ) : null}
          <div className="ws-outcome-form">
            <Input
              aria-label="Outcome-oriented task title"
              placeholder="Outcome-oriented task title"
              value={title}
              disabled={
                !query.data?.tasksAvailable ||
                mutation.create.isPending ||
                mutation.adopt.isPending
              }
              onChange={(event) => setTitle(event.target.value)}
            />
            <button
              type="button"
              className="ws-outcome-create-button"
              disabled={
                !title.trim() ||
                !query.data?.tasksAvailable ||
                mutation.create.isPending ||
                mutation.adopt.isPending
              }
              aria-label="Create and attach outcome task"
              onClick={() =>
                void report(
                  mutation.create
                    .mutateAsync({ title: title.trim() })
                    .then((result) => queueMutation.mutateAsync({
                      current: { source: "bb_task", id: result.task.id },
                      backlog: queue.backlog,
                    }))
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
                  mutation.create.mutateAsync({
                    title: workItem.createFromLinear!.title,
                    priority: workItem.createFromLinear!.priority,
                  }).then((result) => queueMutation.mutateAsync({
                    current: { source: "bb_task", id: result.task.id },
                    backlog: queue.backlog,
                  })),
                  "Outcome created from Linear",
                  "Could not create outcome from Linear",
                )
              }
            >
              {mutation.create.isPending
                ? "Creating outcome…"
                : `Create outcome from ${workItem.createFromLinear.key}`}
            </button>
          ) : null}
        </>
      ) : null}
      {adoptionNotice ? (
        <p
          className="ws-card-note"
          role={adoptionNotice.tone === "error" ? "alert" : "status"}
        >
          {adoptionNotice.message}
        </p>
      ) : null}
    </CardState>
  );
}

function WorkItemSourceSummary({
  queue,
}: {
  queue: { current: WorkItemReference | null; backlog: readonly WorkItemReference[] };
}) {
  const references = [queue.current, ...queue.backlog].filter(
    (reference): reference is WorkItemReference => reference !== null,
  );
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
  queue: { current: WorkItemReference | null; backlog: readonly WorkItemReference[] };
  labelForReference(reference: WorkItemReference): string;
  bbTaskOptions: readonly { id: string; label: string }[];
  linearSearch: null | {
    query: string;
    options: readonly { value: string; label: string; detail: string }[];
    searching: boolean;
    error: Error | null;
    onQueryChange(value: string): void;
    onRetry(): void;
    onAdd(key: string): void;
  };
  linearError: Error | null;
  onRetryLinear(): void;
  taskById: ReadonlyMap<string, {
    key: string;
    title: string;
    status: TaskStatus;
    priority: "urgent" | "high" | "medium" | "low" | "none";
    assignee?: "agent" | "human";
  }>;
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
  return (
    <section className="ws-work-item-queue" aria-label="Work queue">
      <div className="ws-work-item-queue-heading">
        <h3 className="ws-card-section-label">Current goal</h3>
        {queue.current ? (
          <span>
            <button type="button" className="ws-text-button" disabled={pending} onClick={onDemote}>Defer</button>
            <button type="button" className="ws-text-button" disabled={pending} onClick={() => onMoveToExecution(queue.current!)}>Start task</button>
          </span>
        ) : null}
      </div>
      {queue.current ? (
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
      ) : (
        <p className="ws-card-note">Choose a BB task or linked Linear issue as the current goal.</p>
      )}
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
              <button type="button" className="ws-text-button" disabled={pending} onClick={() => onPromote(reference)}>
                Make current
              </button>
              <button type="button" className="ws-text-button" disabled={pending} onClick={() => onMoveToExecution(reference)}>
                Start task
              </button>
            </div>
          ))}
          </div>
        </div>
      ) : null}
      <div className="ws-work-item-queue-add">
        <button type="button" className="ws-text-button" disabled={pending} onClick={() => setAdding("bb")}>
          Add BB task
        </button>
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
            onDismiss={() => { setSelection(""); setAdding(null); }}
            onOpenChange={(open) => { if (!open) { setSelection(""); setAdding(null); } }}
            onSelectionChange={(values) => {
              const id = values[0];
              if (!id) return;
              onAddToBacklog({ source: "bb_task", id });
              setSelection("");
              setAdding(null);
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
            onDismiss={() => { setSelection(""); setAdding(null); linearSearch.onQueryChange(""); }}
            onOpenChange={(open) => { if (!open) { setSelection(""); setAdding(null); linearSearch.onQueryChange(""); } }}
            onQueryChange={linearSearch.onQueryChange}
            onRetry={linearSearch.onRetry}
            onSelectionChange={(values) => {
              const key = values[0];
              if (!key) return;
              linearSearch.onAdd(key);
              setSelection("");
              setAdding(null);
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
  task: {
    key: string;
    title: string;
    status: TaskStatus;
    priority: "urgent" | "high" | "medium" | "low" | "none";
    assignee?: "agent" | "human";
  } | undefined;
  showStatus: boolean;
  disabled: boolean;
  onStatus(taskId: string, status: TaskStatus): void;
  updatingAssignee: boolean;
  onUpdateAssignee(taskId: string, assignee: "agent" | "human"): void;
}) {
  return (
    <span className="ws-work-item-reference">
      <span className="ws-work-item-reference-title">{task?.title ?? label}</span>
      {task ? (
        <span className="ws-work-item-reference-meta">
          <CopyBadge value={task.key} label="task ID" className="ws-work-header-badge">{task.key}</CopyBadge>
          <TaskPriorityIcon priority={task.priority} />
          {task.assignee ? (
            <AssigneePicker
              value={task.assignee}
              taskKey={task.key}
              disabled={disabled || updatingAssignee}
              onChange={(assignee) => onUpdateAssignee(reference.id, assignee)}
            />
          ) : null}
        </span>
      ) : (
        <CopyBadge value={reference.id} label="Linear issue" className="ws-work-header-badge">{reference.id}</CopyBadge>
      )}
      {showStatus && task ? (
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
  // A task being worked does not mean this control is loading. Reserve the
  // spinner for transport activity and use a stable work mark for its state.
  const currentIcon = status === "in_progress" ? "Hammer" : current.icon;
  const previousLabel = previous
    ? `Move ${title} back to ${taskStatusPresentation(previous).label}`
    : `No previous outcome status for ${title}`;
  const nextLabel = next
    ? `Move ${title} forward to ${taskStatusPresentation(next).label}`
    : `No next outcome status for ${title}`;
  return (
    <div
      className="ws-outcome-status-controls"
      role="group"
      aria-label={`Outcome status: ${current.label}`}
    >
      <button
        type="button"
        className="ws-outcome-status-step"
        disabled={!previous || updating}
        aria-label={previousLabel}
        title={previousLabel}
        onClick={() => {
          if (previous) onMove(previous);
        }}
      >
        <Icon name="ArrowLeft" aria-hidden />
      </button>
      <span
        className={`ws-outcome-status-current ws-outcome-status-${status}${updating ? " ws-outcome-status-updating" : ""}`}
        role="img"
        aria-label={`Current outcome status: ${current.label}`}
        title={current.label}
      >
        <Icon name={currentIcon} aria-hidden />
        <span aria-hidden>{current.label}</span>
      </span>
      <button
        type="button"
        className="ws-outcome-status-step"
        disabled={!next || updating}
        aria-label={nextLabel}
        title={nextLabel}
        onClick={() => {
          if (next) onMove(next);
        }}
      >
        <Icon name="ArrowRight" aria-hidden />
      </button>
    </div>
  );
}

function GoalCard({ threadId }: { threadId: string }) {
  const query = useWorkGoal(threadId);
  const percent = query.data ? goalProgressPercent(query.data) : null;
  return (
    <CardState
      title="Goal"
      pending={query.isPending}
      error={query.error}
      onRetry={() => void query.refetch()}
    >
      {query.data ? (
        <>
          <p className="ws-card-content">{query.data.objective}</p>
          {percent !== null ? (
            <div
              className="ws-progress"
              role="progressbar"
              aria-label="Goal token usage"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
            >
              <span style={{ width: `${percent}%` }} />
            </div>
          ) : null}
        </>
      ) : (
        <p className="ws-card-note">No goal supplied by this harness.</p>
      )}
    </CardState>
  );
}

function PlanCard({ threadId }: { threadId: string }) {
  const query = useWorkPlan(threadId);
  return (
    <CardState
      title="Plan"
      pending={query.isPending}
      error={query.error}
      onRetry={() => void query.refetch()}
    >
      {query.data?.items.length ? (
        <div className="ws-plan">
          {query.data.items.map((item) => (
            <div
              key={item.id}
              className={`ws-plan-item ws-plan-${item.status}`}
            >
              <span aria-hidden="true">
                {item.status === "completed"
                  ? "✓"
                  : item.status === "in_progress"
                    ? "●"
                    : "○"}
              </span>
              <span>{item.text}</span>
              <span className="ws-sr-only">{readableStatus(item.status)}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="ws-card-note">No plan supplied by this harness.</p>
      )}
    </CardState>
  );
}

function TasksCard({
  threadId,
  tasks,
  mutations,
}: {
  threadId: string;
  tasks: TasksRead;
  mutations: TasksMutations;
}) {
  const outcome = useWorkOutcome(threadId);
  const status = useWorkStatus(threadId);
  const [selection, setSelection] = useState("");
  const [attachmentPickerOpen, setAttachmentPickerOpen] = useState(false);
  const genericTasks = (tasks.data?.tasks ?? []).filter((task) => task.linkedThreadIds.includes(threadId));
  const executionTaskIds = new Set(outcome.data?.executionTasks.map((task) => task.id) ?? []);
  const available = (tasks.data?.tasks ?? []).filter(
    (task) => !task.linkedThreadIds.includes(threadId) && !executionTaskIds.has(task.id) && task.id !== outcome.data?.outcome?.id,
  );
  const threadById = new Map([
    ...(status.data?.children ?? []),
    ...(status.data ? [{ id: threadId, ...status.data.currentThread, isArchived: false }] : []),
  ].map((candidate) => [candidate.id, candidate]));
  const owners: TaskWorkflowOwner[] = (outcome.data?.bindings ?? [])
    .filter((binding) => binding.executionTaskId !== null)
    .map((binding) => {
      const projectedOwner = binding.owner;
      const thread = binding.ownerThreadId ? threadById.get(binding.ownerThreadId) : null;
      const liveStatus = projectedOwner?.liveStatus ?? (thread?.status === "active" ? "working" : thread?.status === "starting" ? "starting" : thread?.status === "completed" ? "completed" : thread?.status === "failed" ? "failed" : "idle");
      return {
        taskId: binding.executionTaskId!,
        threadId: binding.ownerThreadId,
        threadTitle: projectedOwner?.title ?? thread?.title ?? binding.ownerThreadId,
        providerId: projectedOwner?.providerId ?? thread?.providerId ?? null,
        liveStatus,
        isArchived: projectedOwner?.isArchived ?? thread?.isArchived ?? binding.ownerThreadId !== null,
        unavailable: binding.owner === undefined ? !thread : projectedOwner === null,
      };
    });
  const workflow = projectTaskWorkflow({
    outcomeTaskId: outcome.data?.outcome?.id ?? null,
    tasks: genericTasks,
    executionTasks: outcome.data?.executionTasks ?? [],
    owners,
  });
  const detachableTaskIds = new Set(genericTasks.filter((task) => !executionTaskIds.has(task.id)).map((task) => task.id));
  const busy = mutations.attachment.isPending || mutations.assignment.isPending || mutations.status.isPending;
  const report = (operation: Promise<unknown>, fallback: string) =>
    void operation.catch((error) =>
      toast.error(error instanceof Error ? error.message : fallback),
    );
  return (
    <CardState
      title="Tasks"
      pending={tasks.isPending}
      error={tasks.error}
      onRetry={() => void tasks.refetch()}
    >
      <div className="ws-thread-task-card">
        <div className="ws-work-card-control">
          <SearchCombobox
            ariaLabel="Add task to this thread"
            disabled={busy}
            emptyMessage="No matching tasks."
            emptyOption
            listboxLabel="Available tasks"
            onOpenChange={setAttachmentPickerOpen}
            onSelectionChange={(values) => setSelection(values[0] ?? "")}
            open={attachmentPickerOpen}
            options={available.map((task) => ({ value: task.id, label: task.key, detail: task.title }))}
            placeholder="Add an existing task…"
            portal
            selectedValues={selection ? [selection] : []}
          />
          <button
            type="button"
            disabled={!selection || busy}
            onClick={() =>
              report(
                mutations.attachment
                  .mutateAsync({ taskId: selection, threadId, attached: true })
                  .then(() => setSelection("")),
                "Could not attach task",
              )
            }
          >
            {mutations.attachment.isPending ? "…" : "Add"}
          </button>
        </div>
        <TaskWorkflowCard
          sections={workflow}
          busy={busy}
          detachableTaskIds={detachableTaskIds}
          onAssigneeChange={(taskId, assignee) => report(mutations.assignment.mutateAsync({ taskId, assignee }), "Could not update task assignee")}
          onStatusChange={(taskId, status) => report(mutations.status.mutateAsync({ taskId, status }), "Could not update task status")}
          onDetach={(taskId) => report(mutations.attachment.mutateAsync({ taskId, threadId, attached: false }), "Could not detach task")}
        />
      </div>
    </CardState>
  );
}

export function WorkContextCards({
  threadId,
  tracker,
}: {
  threadId: string;
  tracker: ReturnType<typeof useTracker>;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const tasks = useTasksRead();
  const taskMutations = useTasksMutations(rpc);
  return (
    <section className="ws-work-context-cards" aria-label="Work context">
      <StatusCard threadId={threadId} />
      <WorkItemCard
        threadId={threadId}
        tasks={tasks}
        taskMutations={taskMutations}
        tracker={tracker}
      />
      <TasksCard threadId={threadId} tasks={tasks} mutations={taskMutations} />
      <GoalCard threadId={threadId} />
      <PlanCard threadId={threadId} />
      <BackgroundJobsCard threadId={threadId} />
    </section>
  );
}
