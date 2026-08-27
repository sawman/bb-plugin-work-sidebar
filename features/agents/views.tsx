import { useMemo } from "react";
import {
  experimental_useSidebarThreadActions,
  experimental_useSidebarThreadSplit,
  experimental_useSidebarThreads,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "../../components/ui/icon";
import { readableStatus } from "../../work-model";
import { useTaskLinksRead } from "../tasks/queries";
import { useWorkOutcome } from "../work-context/queries";
import { agentRuntimePresentation, projectAgentChildren } from "./model";

type AgentAnnotation = {
  taskKey: string | null;
  taskStatus: string | null;
  dispatchState: string | null;
  recoveryMessage: string | null;
};

function AgentRow({
  child,
  annotation,
}: {
  child: ReturnType<typeof projectAgentChildren>[number];
  annotation: AgentAnnotation;
}) {
  const actions = experimental_useSidebarThreadActions();
  const { splitProps, isAvailable } = experimental_useSidebarThreadSplit(
    child.thread.id,
  );
  const runtime = agentRuntimePresentation(child.thread);
  const open = (split: boolean) => actions.open(child.thread.id, { split });
  return (
    <article
      className={`ws-agent-card${annotation.taskStatus === "in_review" ? " ws-agent-review" : ""}`}
      data-agent-state={runtime.tone}
      style={{ marginLeft: `${Math.min(child.depth - 1, 4) * 0.65}rem` }}
    >
      <Icon
        name="Bot"
        className={`ws-agent-state ws-agent-state-${runtime.tone}`}
        aria-label={child.thread.indicatorLabel ?? runtime.label}
      />
      <a
        {...splitProps}
        href="#"
        data-sidebar-thread-shortcut-target=""
        data-sidebar-thread-id={child.thread.id}
        className="ws-agent-target"
        aria-label={`Open ${child.thread.title ?? child.thread.titleFallback ?? "Untitled agent"}`}
        onClick={(event) => {
          event.preventDefault();
          open(event.metaKey || event.ctrlKey);
        }}
      >
        <strong>
          {child.thread.title ?? child.thread.titleFallback ?? "Untitled agent"}
        </strong>
        <small>
          {runtime.label}
          {annotation.taskKey ? ` · ${annotation.taskKey}` : ""}
          {annotation.dispatchState
            ? ` · ${readableStatus(annotation.dispatchState)}`
            : ""}
        </small>
        {annotation.recoveryMessage ? (
          <small>{annotation.recoveryMessage}</small>
        ) : null}
      </a>
      {isAvailable ? (
        <button
          type="button"
          className="ws-agent-split"
          onClick={() => open(true)}
          aria-label={`Open ${child.thread.title ?? child.thread.titleFallback ?? "Untitled agent"} in split`}
          title="Open in split"
        >
          <Icon name="Columns2" aria-hidden />
        </button>
      ) : null}
    </article>
  );
}

export function AgentsView({ threadId }: { threadId: string }) {
  const hostThreads = experimental_useSidebarThreads();
  const taskLinks = useTaskLinksRead();
  const outcome = useWorkOutcome(threadId);
  const children = useMemo(
    () => projectAgentChildren(hostThreads.threads, threadId),
    [hostThreads.threads, threadId],
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
              taskStatus: taskLink?.task.status ?? null,
              dispatchState: binding?.dispatchState ?? null,
              recoveryMessage: binding?.recoveryMessage ?? null,
            }}
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
