import { useEffect, useState } from "react";
import {
  experimental_useSidebarThreadActions,
  experimental_useSidebarThreadSplit,
} from "@get-bb/plugin-sdk/app";
import { CopyBadge } from "../../components/ui/copy-badge";
import { Icon, type IconName } from "../../components/ui/icon";
import {
  agentDurationLabel,
  agentRuntimePresentation,
  agentWorkspacePresentation,
  type AgentProjectionChild,
} from "./model";

export type AgentAnnotation = {
  taskKey: string | null;
  taskTitle: string | null;
  taskStatus: string | null;
  dispatchState: string | null;
  recoveryMessage: string | null;
};

function AgentDuration({ createdAt }: { createdAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (createdAt <= 0) return undefined;
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [createdAt]);
  const duration = agentDurationLabel(createdAt, now);
  return duration ? (
    <time
      className="ws-agent-duration"
      dateTime={new Date(createdAt).toISOString()}
      aria-label={`Agent thread age ${duration}`}
      title="Agent thread age"
    >
      {duration}
    </time>
  ) : null;
}

const runtimeIcons: Record<ReturnType<typeof agentRuntimePresentation>["tone"], IconName> = {
  working: "Bot",
  waiting: "UserClock",
  blocked: "AlertCircle",
  complete: "Check",
  idle: "Zzz",
};

const workspaceIcons: Record<NonNullable<ReturnType<typeof agentWorkspacePresentation>>["kind"], IconName> = {
  "managed-worktree": "FolderGit",
  "unmanaged-worktree": "GitBranch",
  workspace: "Laptop",
  host: "Laptop",
};

export function AgentRow({
  child,
  annotation,
  model,
}: {
  child: AgentProjectionChild;
  annotation: AgentAnnotation;
  model: string | null;
}) {
  const actions = experimental_useSidebarThreadActions();
  const { splitProps, isAvailable } = experimental_useSidebarThreadSplit(child.thread.id);
  const runtime = agentRuntimePresentation(child.thread);
  const workspace = agentWorkspacePresentation(child.thread);
  const title = child.thread.title ?? child.thread.titleFallback ?? "Untitled agent";
  const open = (split: boolean) => actions.open(child.thread.id, { split });
  return (
    <article
      className={`ws-agent-card${annotation.taskStatus === "in_review" ? " ws-agent-review" : ""}`}
      data-agent-state={runtime.tone}
      style={{ marginLeft: `${Math.min(child.depth - 1, 4) * 0.65}rem` }}
    >
      <span
        className={`ws-agent-state ws-agent-state-${runtime.tone}`}
        aria-label={child.thread.indicatorLabel ?? runtime.label}
        role="img"
      >
        <Icon name={runtimeIcons[runtime.tone]} aria-hidden />
      </span>
      <a
        {...splitProps}
        href="#"
        data-sidebar-thread-shortcut-target=""
        data-sidebar-thread-id={child.thread.id}
        className="ws-agent-target"
        aria-label={`Open ${title}`}
        onClick={(event) => {
          event.preventDefault();
          open(event.metaKey || event.ctrlKey);
        }}
      >
        <strong>{title}</strong>
        <span className="ws-agent-facts">
          <span className="ws-agent-fact" title="Agent model">
            <Icon name="Bot" aria-hidden />
            <span>{model ?? "Model unavailable"}</span>
          </span>
          {workspace ? (
            <CopyBadge
              value={workspace.label}
              copyValue={workspace.copyValue}
              label="agent workspace"
              className="ws-agent-workspace-badge"
              title={`${workspace.detail}: ${workspace.label}`}
              data-workspace-kind={workspace.kind}
            >
              <Icon name={workspaceIcons[workspace.kind]} aria-hidden />
              <span>{workspace.label}</span>
              <small>{workspace.detail}</small>
            </CopyBadge>
          ) : null}
          {annotation.taskKey ? (
            <span className="ws-agent-fact ws-agent-task" title="Assigned task">
              <Icon name="ListTodo" aria-hidden />
              <b>{annotation.taskKey}</b>
              {annotation.taskTitle ? <span>{annotation.taskTitle}</span> : null}
            </span>
          ) : null}
        </span>
        {annotation.recoveryMessage ? (
          <small>{annotation.recoveryMessage}</small>
        ) : null}
      </a>
      <span className="ws-agent-actions">
        <span className="ws-agent-action-buttons">
          <button
            type="button"
            className="ws-agent-action"
            onClick={() => open(false)}
            aria-label={`Open ${title}`}
            title="Open agent"
          >
            <Icon name="ArrowRight" aria-hidden />
          </button>
          {isAvailable ? (
            <button
              type="button"
              className="ws-agent-action"
              onClick={() => open(true)}
              aria-label={`Open ${title} in split`}
              title="Open in split"
            >
              <Icon name="Columns2" aria-hidden />
            </button>
          ) : null}
        </span>
        <AgentDuration createdAt={child.thread.createdAt} />
      </span>
    </article>
  );
}
