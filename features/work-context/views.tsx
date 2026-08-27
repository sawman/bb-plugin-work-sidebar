import { useState, type ReactNode } from "react";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Icon } from "../../components/ui/icon";
import { Input } from "../../components/ui/input";
import {
  SurfaceCard,
  SurfaceCardHeading,
} from "../../components/ui/surface-card";
import { Combobox } from "../../components/ui/combobox";
import { AssigneePicker } from "./assignee-picker";
import type { rpcContract } from "../../contracts";
import {
  goalProgressPercent,
  readableStatus,
  runtimeStatusPresentation,
} from "../../work-model";
import { useTasksMutations } from "../tasks/mutations";
import { useTasksRead } from "../tasks/queries";
import { nextOutcomeStatus } from "./model";
import {
  useLatestActivity,
  useWorkGoal,
  useWorkOutcome,
  useWorkOutcomeMutation,
  useWorkPlan,
  useWorkProviderHealth,
  useWorkStatus,
} from "./queries";

type CardStateProps = {
  title: string;
  className?: string;
  pending: boolean;
  error: Error | null;
  onRetry: () => void;
  children: ReactNode;
};

function CardState({
  title,
  className = "",
  pending,
  error,
  onRetry,
  children,
}: CardStateProps) {
  return (
    <SurfaceCard
      className={`ws-work-context-card ${className}`}
      data-card={title.toLowerCase()}
    >
      <SurfaceCardHeading title={title} />
      {pending ? (
        <p className="ws-card-note" role="status" aria-busy="true">
          Loading {title.toLowerCase()}…
        </p>
      ) : null}
      {error ? (
        <div className="ws-card-note" role="alert">
          <span>{error.message}</span>
          <button type="button" onClick={onRetry}>
            Try again
          </button>
        </div>
      ) : null}
      {!pending && !error ? children : null}
    </SurfaceCard>
  );
}

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
      pending={query.isPending}
      error={query.error}
      onRetry={() => void query.refetch()}
    >
      <div className="ws-status-summary">
        <h3 className="ws-card-title">{runtime?.label ?? "Unknown"}</h3>
        <p className="ws-working-state">
          <span title={`${total} child agents`}>
            <Icon name="Bot" aria-hidden />
            {total}
          </span>
          <span title={`${active} active child agents`}>
            <Icon name="Wrench" aria-hidden />
            {active}
          </span>
        </p>
      </div>
      {latestActivity.data?.latest || latestActivity.data?.lastUser ? (
        <div className="ws-activity-list">
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
        </div>
      ) : null}
      {provider.data ? <ProviderHealth provider={provider.data} /> : null}
    </CardState>
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
  const text = expanded ? entry.text : entry.text.slice(0, 120);
  return (
    <button
      type="button"
      className={`ws-activity-item${entry.kind === "command" ? " ws-activity-item-command" : ""}${expanded ? " ws-activity-item-expanded" : ""}`}
      aria-expanded={expanded}
      onClick={onToggle}
    >
      <span className="ws-activity-label">{label}</span>
      {entry.kind === "command" ? (
        <code className="ws-activity-command">{text}</code>
      ) : (
        <span className="ws-activity-copy">{text}</span>
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
      aria-label={label}
      title={label}
    />
  );
}

function OutcomeCard({ threadId }: { threadId: string }) {
  const query = useWorkOutcome(threadId);
  const mutation = useWorkOutcomeMutation(threadId);
  const outcome = query.data?.outcome;
  const next = outcome ? nextOutcomeStatus(outcome.status) : null;
  const [title, setTitle] = useState("");
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
  return (
    <CardState
      title="Outcome"
      className={outcome ? "ws-outcome-card" : "ws-outcome-empty"}
      pending={query.isPending}
      error={query.error}
      onRetry={() => void query.refetch()}
    >
      {outcome ? (
        <>
          <p className="ws-card-note ws-outcome-key">{outcome.key}</p>
          <h3 className="ws-card-title">{outcome.title}</h3>
          {outcome.priority !== "none" ? (
            <p className="ws-card-note">
              {readableStatus(outcome.priority)} priority
            </p>
          ) : null}
          {outcome.dueDate ? (
            <p className="ws-card-note">Due {outcome.dueDate}</p>
          ) : null}
          {next ? (
            <button
              type="button"
              disabled={mutation.update.isPending}
              aria-label={`Move ${outcome.title} to ${readableStatus(next)}`}
              onClick={() =>
                void report(
                  mutation.update.mutateAsync({
                    taskId: outcome.id,
                    status: next,
                  }),
                  "Outcome updated",
                  "Could not update outcome",
                )
              }
            >
              {mutation.update.isPending
                ? "Updating…"
                : `Move to ${readableStatus(next)}`}
            </button>
          ) : null}
        </>
      ) : (
        <>
          <p className="ws-card-note">No current outcome.</p>
          <div className="ws-outcome-form">
            <Input
              aria-label="Outcome-oriented task title"
              placeholder="Outcome-oriented task title"
              value={title}
              disabled={
                !query.data?.tasksAvailable || mutation.create.isPending
              }
              onChange={(event) => setTitle(event.target.value)}
            />
            <button
              type="button"
              className="ws-outcome-create-button"
              disabled={
                !title.trim() ||
                !query.data?.tasksAvailable ||
                mutation.create.isPending
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
    </CardState>
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
              <span className="sr-only">{readableStatus(item.status)}</span>
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
  const attached = (tasks.data?.tasks ?? []).filter((task) =>
    task.linkedThreadIds.includes(threadId),
  );
  const available = (tasks.data?.tasks ?? []).filter(
    (task) => !task.linkedThreadIds.includes(threadId),
  );
  const busy = mutations.attachment.isPending || mutations.assignment.isPending;
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
        <p className="ws-section-count">
          {attached.length + (outcome.data?.executionTasks.length ?? 0)}
        </p>
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
          <p className="ws-card-note">No tasks are attached to this thread.</p>
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
            aria-label="Execution tasks"
          >
            {outcome.data.executionTasks.map((task) => (
              <div key={task.id} className="ws-work-card-row">
                <span className={`ws-status-dot ws-status-dot-${task.status}`}>
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
      <TasksCard threadId={threadId} />
      <OutcomeCard threadId={threadId} />
      <GoalCard threadId={threadId} />
      <PlanCard threadId={threadId} />
    </section>
  );
}
