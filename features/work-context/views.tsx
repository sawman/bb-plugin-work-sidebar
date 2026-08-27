import { useState, type ReactNode } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { Icon } from "../../components/ui/icon";
import { WorkCard, WorkCardHeading } from "../../components/work/card";
import { Combobox } from "../../components/ui/combobox";
import { AssigneePicker } from "../../components/tasks/assignee-picker";
import type { rpcContract } from "../../contracts";
import { goalProgressPercent, readableStatus, runtimeStatusPresentation } from "../../work-model";
import { useTasksMutations } from "../tasks/mutations";
import { useTasksRead } from "../tasks/queries";
import { nextOutcomeStatus } from "./model";
import { useWorkGoal, useWorkOutcome, useWorkPlan, useWorkStatus } from "./queries";

function CardState({ title, pending, error, children }: { title: string; pending: boolean; error: Error | null; children: ReactNode }) {
  return <WorkCard className="ws-work-context-card" data-card={title.toLowerCase()}>
    <WorkCardHeading title={title} />
    {pending ? <p className="ws-card-note" aria-busy="true">Loading {title.toLowerCase()}…</p> : error ? <p className="ws-card-note" role="alert">{error.message}</p> : children}
  </WorkCard>;
}

function StatusCard({ threadId }: { threadId: string }) {
  const query = useWorkStatus(threadId);
  const status = query.data && runtimeStatusPresentation(query.data.currentThread);
  return <CardState title="Status" pending={query.isPending} error={query.error}>
    <h3>{status?.label ?? "Unknown"}</h3><p className="ws-card-note">{query.data?.children.filter((child) => !child.isArchived).length ?? 0} child agents</p>
    {query.data && <span className="ws-provider-health ws-provider-health-green" aria-label={`${query.data.currentThread.providerId === "codex" ? "Codex" : query.data.currentThread.providerId} provider status: Ready`} />}
  </CardState>;
}

function OutcomeCard({ threadId }: { threadId: string }) {
  const rpc = useRpc<typeof rpcContract>(); const query = useWorkOutcome(threadId); const [busy, setBusy] = useState(false);
  const outcome = query.data?.outcome; const next = outcome && nextOutcomeStatus(outcome.status) as typeof outcome.status | null;
  return <CardState title="Outcome" pending={query.isPending} error={query.error}>{outcome ? <><p className="ws-card-note">{outcome.key}</p><h3>{outcome.title}</h3>{next && <button type="button" disabled={busy} onClick={async () => { setBusy(true); try { await rpc.call("updateWorkTask", { taskId: outcome.id, status: next }); await query.refetch(); } finally { setBusy(false); } }}>{busy ? "Updating…" : `Move to ${readableStatus(next)}`}</button>}</> : <p className="ws-card-note">No current outcome.</p>}</CardState>;
}

function GoalCard({ threadId }: { threadId: string }) { const query = useWorkGoal(threadId); const goal = query.data; const percent = goal ? goalProgressPercent(goal) : null; return <CardState title="Goal" pending={query.isPending} error={query.error}>{goal ? <><h3>{goal.objective}</h3>{percent !== null && <div className="ws-progress" role="progressbar" aria-label="Goal token usage" aria-valuenow={percent}><span style={{ width: `${percent}%` }} /></div>}</> : <p className="ws-card-note">No goal supplied by this harness.</p>}</CardState>; }
function PlanCard({ threadId }: { threadId: string }) { const query = useWorkPlan(threadId); return <CardState title="Plan" pending={query.isPending} error={query.error}>{query.data?.items.length ? <div className="ws-plan">{query.data.items.map((item) => <div key={item.id} className={`ws-plan-item ws-plan-${item.status}`}><span aria-hidden="true">{item.status === "completed" ? "✓" : "○"}</span><span>{item.text}</span></div>)}</div> : <p className="ws-card-note">No plan supplied by this harness.</p>}</CardState>; }

/** Remote task records remain owned by the Tasks query slice. */
function TasksCard({ threadId }: { threadId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const tasks = useTasksRead();
  const outcome = useWorkOutcome(threadId);
  const mutations = useTasksMutations(rpc);
  const [selection, setSelection] = useState("");
  const records = tasks.data?.tasks ?? [];
  const attached = records.filter((task) => task.linkedThreadIds.includes(threadId));
  const available = records.filter((task) => !task.linkedThreadIds.includes(threadId));
  const busy = mutations.attachment.isPending || mutations.assignment.isPending;
  if (tasks.isPending) return <CardState title="Tasks" pending error={null}><></></CardState>;
  if (tasks.isError) return <WorkCard className="ws-work-context-card" data-card="tasks"><WorkCardHeading title="Tasks" /><p className="ws-card-note" role="alert">{tasks.error.message}</p><button type="button" onClick={() => void tasks.refetch()}>Try again</button></WorkCard>;
  return <WorkCard className="ws-thread-task-card ws-work-context-card" data-card="tasks">
    <WorkCardHeading title="Tasks" trailing={<span className="ws-section-count">{attached.length + (outcome.data?.executionTasks.length ?? 0)}</span>} />
    {attached.length ? <div className="ws-work-card-list">{attached.map((task) => <div key={task.id} className="ws-work-card-row">
      <span className="ws-work-card-key">{task.key}</span><span className="ws-work-card-copy">{task.title}</span>
      <AssigneePicker value={task.assignee} disabled={busy} onChange={(assignee) => void mutations.assignment.mutateAsync({ taskId: task.id, assignee })} />
      <button type="button" disabled={busy} onClick={() => void mutations.attachment.mutateAsync({ taskId: task.id, threadId, attached: false })} aria-label={`Detach ${task.key} from this thread`} title="Detach from this thread"><Icon name="X" aria-hidden /></button>
    </div>)}</div> : <p className="ws-card-note">No tasks are attached to this thread.</p>}
    <div className="ws-work-card-control"><Combobox value={selection} disabled={busy} options={available.map((task) => ({ value: task.id, label: task.key, detail: task.title }))} onChange={setSelection} placeholder="Add an existing task…" ariaLabel="Add task to this thread" /><button type="button" disabled={!selection || busy} onClick={() => void mutations.attachment.mutateAsync({ taskId: selection, threadId, attached: true }).then(() => setSelection(""))}>{mutations.attachment.isPending ? "…" : "Add"}</button></div>
    {outcome.data?.executionTasks.length ? <div className="ws-work-card-list ws-work-card-list-separated" aria-label="Execution tasks">{outcome.data.executionTasks.map((task) => <div key={task.id} className="ws-work-card-row"><span className={`ws-status-dot ws-status-dot-${task.status}`}>{task.status === "done" ? "✓" : "•"}</span><span className="ws-work-card-copy"><strong>{task.title}</strong><small>{task.key} · {readableStatus(task.status)}</small></span></div>)}</div> : null}
  </WorkCard>;
}

export function WorkContextCards({ threadId }: { threadId: string }) { return <section className="ws-work-context-cards" aria-label="Work context"><StatusCard threadId={threadId} /><OutcomeCard threadId={threadId} /><GoalCard threadId={threadId} /><PlanCard threadId={threadId} /></section>; }
