import { useMemo } from "react";
import { experimental_useSidebarThreads } from "@get-bb/plugin-sdk/app";
import { useTaskLinksRead } from "../tasks/queries";
import { useWorkOutcome } from "../work-context/queries";
import { AgentDurationClock, AgentRow } from "./agent-row";
import { projectAgentChildren } from "./model";
import { useAgentDetails } from "./queries";

export function AgentsView({
  threadId,
  projectId,
}: {
  threadId: string;
  projectId: string | null;
}) {
  const hostThreads = experimental_useSidebarThreads();
  // The Threads controller owns the single visible polling observer. Agents
  // still observe the shared cache for annotations but never add another
  // 30-second poller.
  const taskLinks = useTaskLinksRead({ projectId, poll: false });
  const outcome = useWorkOutcome(threadId, projectId);
  const children = useMemo(
    () => projectAgentChildren(hostThreads.threads, threadId),
    [hostThreads.threads, threadId],
  );
  const detailThreadIds = useMemo(
    () => children.map(({ thread }) => thread.id),
    [children],
  );
  const agentDetails = useAgentDetails(detailThreadIds);
  const modelsByThread = useMemo(
    () =>
      new Map(
        Object.entries(agentDetails.data?.facts ?? {}).map(([id, { model }]) => [
          id,
          model,
        ]),
      ),
    [agentDetails.data?.facts],
  );
  const bindingsByOwner = useMemo(
    () =>
      new Map(
        (outcome.data?.bindings ?? []).map((binding) => [
          binding.ownerThreadId,
          binding,
        ]),
      ),
    [outcome.data?.bindings],
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
    <div data-agent-view>
      <AgentDurationClock
        active={children.some(({ thread }) => thread.createdAt > 0)}
      >
        {children.map((child) => {
          const taskLink = taskLinks.data?.links[child.thread.id]?.[0];
          const binding = bindingsByOwner.get(child.thread.id);
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
      </AgentDurationClock>
      {children.length === 0 ? (
        <div className="ws-empty">
          No active delegated child threads are attached to this thread.
        </div>
      ) : null}
    </div>
  );
}
