import { useMemo } from "react";
import { experimental_useSidebarThreads } from "@get-bb/plugin-sdk/app";
import { useTaskLinksRead } from "../tasks/queries";
import { useWorkOutcome } from "../work-context/queries";
import { AgentRow } from "./agent-row";
import { projectAgentChildren } from "./model";
import { useAgentDetails } from "./queries";


export function AgentsView({ threadId }: { threadId: string }) {
  const hostThreads = experimental_useSidebarThreads();
  // The Threads controller owns the single visible polling observer. Agents
  // still observe the shared cache for annotations but never add another
  // 30-second poller.
  const taskLinks = useTaskLinksRead({ poll: false });
  const outcome = useWorkOutcome(threadId);
  const children = useMemo(
    () => projectAgentChildren(hostThreads.threads, threadId),
    [hostThreads.threads, threadId],
  );
  const detailTargets = useMemo(
    () => children.map(({ thread }) => ({ id: thread.id, updatedAt: thread.updatedAt })),
    [children],
  );
  const agentDetails = useAgentDetails(detailTargets);
  const modelsByThread = useMemo(
    () => new Map(
      (agentDetails.data?.agents ?? []).map(({ threadId: id, model }) => [id, model]),
    ),
    [agentDetails.data?.agents],
  );

  if (hostThreads.status === "loading")
    return (
      <div className="ws-empty" role="status" aria-live="polite">
        Loading agents…
      </div>
    );
  if (hostThreads.status === "error")
    return (
      <div className="ws-callout" role="alert">
        Could not load agents from BB.
      </div>
    );

  return (
    <div className="ws-section-stack" data-agent-view>
      <header>
        <div>
          <h2>Agents</h2>
        </div>
        <span className="ws-section-count">{children.length}</span>
      </header>
      {children.map((child) => {
        const taskLink = taskLinks.data?.links[child.thread.id]?.[0];
        const binding = outcome.data?.bindings.find(
          (candidate) => candidate.ownerThreadId === child.thread.id,
        );
        return (
          <AgentRow
            key={child.thread.id}
            child={child}
            annotation={{
              taskKey: taskLink?.task.key ?? null,
              taskTitle: taskLink?.task.title ?? null,
              taskStatus: taskLink?.task.status ?? null,
              dispatchState: binding?.dispatchState ?? null,
              recoveryMessage: binding?.recoveryMessage ?? null,
            }}
            model={modelsByThread.get(child.thread.id) ?? null}
          />
        );
      })}
      {children.length === 0 ? (
        <div className="ws-empty">
          No active delegated child threads are attached to this thread.
        </div>
      ) : null}
    </div>
  );
}
