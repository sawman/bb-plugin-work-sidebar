import { useState } from "react";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Icon, type IconName } from "../../components/ui/icon";
import { CopyBadge } from "../../components/ui/copy-badge";
import { Input } from "../../components/ui/input";
import { Combobox } from "../../components/ui/combobox";
import { AssigneePicker } from "./assignee-picker";
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
  projectWorkTaskBindingOwnership,
} from "./model";
import {
  useLatestActivity,
  useWorkGoal,
  useWorkOutcome,
  useWorkOutcomeMutation,
  useWorkPlan,
  useWorkProviderHealth,
  useWorkStatus,
} from "./queries";
import { CardState } from "./card-state";
import { BackgroundJobsCard } from "./background-jobs-view";

function StatusCard({ threadId }: { threadId: string }) {
  const query = useWorkStatus(threadId);
  const latestActivity = useLatestActivity(
    threadId,
    query.data?.currentThread.status,
  );
  const provider = useWorkProviderHealth(threadId);
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
}: {
  runtime: ReturnType<typeof runtimeStatusPresentation>;
  total: number;
  active: number;
  provider: Parameters<typeof ProviderHealth>[0]["provider"] | null;
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
      {provider ? <ProviderHealth provider={provider} /> : null}
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
}: {
  provider: {
    tone: string;
    providerName: string;
    status: string;
    statusUrl: string | null;
    message: string | null;
  };
}) {
  const navigate = useBbNavigate();
  const label = `${provider.providerName} provider status: ${readableStatus(provider.status)}. ${provider.message ?? "No provider message."}`;
  return provider.statusUrl ? (
    <button
      type="button"
      className={`ws-provider-health ws-provider-health-${provider.tone}`}
      aria-label={label}
      title={label}
      onClick={() => navigate.openUrl(provider.statusUrl!)}
    />
  ) : (
    <span
      className={`ws-provider-health ws-provider-health-${provider.tone}`}
      role="img"
      aria-label={label}
      title={label}
    />
  );
}

function OutcomeCard({ threadId }: { threadId: string }) {
  const query = useWorkOutcome(threadId);
  const mutation = useWorkOutcomeMutation(threadId);
  const outcome = query.data?.outcome;
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
      title="Outcome"
      className={outcome ? "ws-outcome-card" : "ws-outcome-empty"}
      trailing={
        outcome ? (
          <OutcomeHeading
            taskKey={outcome.key}
            priority={outcome.priority}
          />
        ) : undefined
      }
      pending={query.isPending}
      error={query.error}
      onRetry={() => void query.refetch()}
    >
      {outcome ? (
        <>
          <h3 className="ws-card-title">{outcome.title}</h3>
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
      ) : (
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
                    .then(() => setTitle("")),
                  "Outcome created and attached",
                  "Could not create outcome",
                )
              }
            >
              {mutation.create.isPending ? "Creating…" : "Create"}
            </button>
          </div>
        </>
      )}
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

function OutcomeHeading({
  taskKey,
  priority,
}: {
  taskKey: string;
  priority: "urgent" | "high" | "medium" | "low" | "none";
}) {
  return (
    <span className="ws-outcome-heading-meta">
      <CopyBadge
        value={taskKey}
        label="task ID"
        className="ws-work-header-badge"
      >
        {taskKey}
      </CopyBadge>
      <TaskPriorityIcon priority={priority} />
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
        <Icon name={current.icon} aria-hidden />
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
          <h3 className="ws-card-title">{query.data.objective}</h3>
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

function TasksCard({ threadId }: { threadId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const tasks = useTasksRead();
  const outcome = useWorkOutcome(threadId);
  const mutations = useTasksMutations(rpc);
  const [selection, setSelection] = useState("");
  const { bindingOwnedTaskIds, currentThreadBindingTaskIds } =
    projectWorkTaskBindingOwnership(threadId, outcome.data?.bindings ?? []);
  const attached = (tasks.data?.tasks ?? []).filter((task) =>
    task.linkedThreadIds.includes(threadId) && !bindingOwnedTaskIds.has(task.id),
  );
  const available = (tasks.data?.tasks ?? []).filter(
    (task) =>
      !task.linkedThreadIds.includes(threadId) &&
      !bindingOwnedTaskIds.has(task.id),
  );
  const boundTaskCount = currentThreadBindingTaskIds.size;
  const taskCount = attached.length + boundTaskCount;
  const busy = mutations.attachment.isPending || mutations.assignment.isPending;
  const report = (operation: Promise<unknown>, fallback: string) =>
    void operation.catch((error) =>
      toast.error(error instanceof Error ? error.message : fallback),
    );
  return (
    <CardState
      title="Tasks"
      trailing={
        tasks.data ? (
          <span title={`${taskCount} task${taskCount === 1 ? "" : "s"}`}>
            <span aria-hidden>{taskCount}</span>
            <span className="ws-sr-only">
              {taskCount} task{taskCount === 1 ? "" : "s"}
            </span>
          </span>
        ) : undefined
      }
      pending={tasks.isPending}
      error={tasks.error}
      onRetry={() => void tasks.refetch()}
    >
      <div className="ws-thread-task-card">
        {boundTaskCount ? (
          <p className="ws-card-note" role="status">
            {boundTaskCount} work task{boundTaskCount === 1 ? "" : "s"}{" "}
            {boundTaskCount === 1 ? "is" : "are"} bound to this thread.
          </p>
        ) : null}
        {attached.length ? (
          <div className="ws-work-card-list">
            {attached.map((task) => (
              <div key={task.id} className="ws-work-card-row">
                <span className="ws-work-card-key">{task.key}</span>
                <span className="ws-work-card-copy">{task.title}</span>
                <AssigneePicker
                  value={task.assignee}
                  disabled={busy}
                  onChange={(assignee) =>
                    report(
                      mutations.assignment.mutateAsync({
                        taskId: task.id,
                        assignee,
                      }),
                      "Could not update task assignee",
                    )
                  }
                />
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`Detach ${task.key} from this thread`}
                  onClick={() =>
                    report(
                      mutations.attachment.mutateAsync({
                        taskId: task.id,
                        threadId,
                        attached: false,
                      }),
                      "Could not detach task",
                    )
                  }
                >
                  <Icon name="X" aria-hidden />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="ws-card-note">
            {boundTaskCount
              ? "No additional tasks are attached to this thread."
              : "No tasks are attached to this thread."}
          </p>
        )}
        <div className="ws-work-card-control">
          <Combobox
            value={selection}
            disabled={busy}
            options={available.map((task) => ({
              value: task.id,
              label: task.key,
              detail: task.title,
            }))}
            onChange={setSelection}
            placeholder="Add an existing task…"
            ariaLabel="Add task to this thread"
            className="ws-task-attachment-picker"
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
        {outcome.data?.executionTasks.length ? (
          <div
            className="ws-work-card-list ws-work-card-list-separated"
            role="group"
            aria-label="Execution tasks"
          >
            {outcome.data.executionTasks.map((task) => (
              <div key={task.id} className="ws-work-card-row">
                <span
                  className={`ws-status-dot ws-status-dot-${task.status}`}
                  aria-hidden
                >
                  {task.status === "done" ? "✓" : "•"}
                </span>
                <span className="ws-work-card-copy">
                  <strong>{task.title}</strong>
                  <small>
                    {task.key} · {readableStatus(task.status)}
                  </small>
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </CardState>
  );
}

export function WorkContextCards({ threadId }: { threadId: string }) {
  return (
    <section className="ws-work-context-cards" aria-label="Work context">
      <StatusCard threadId={threadId} />
      <OutcomeCard threadId={threadId} />
      <TasksCard threadId={threadId} />
      <GoalCard threadId={threadId} />
      <PlanCard threadId={threadId} />
      <BackgroundJobsCard threadId={threadId} />
    </section>
  );
}
