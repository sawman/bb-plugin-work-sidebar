import {
  createContext,
  useContext,
  useEffect,
  useState,
  type PropsWithChildren,
} from "react";
import {
  experimental_useSidebarThreadActions,
  experimental_useSidebarThreadSplit,
} from "@get-bb/plugin-sdk/app";
import { CopyBadge } from "../../components/ui/copy-badge";
import { Icon, type IconName } from "../../components/ui/icon";
import { ActionTooltip } from "../../components/ui/action-tooltip";
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

const AgentClockContext = createContext(0);

export function AgentDurationClock({
  active,
  children,
}: PropsWithChildren<{ active: boolean }>) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [active]);
  return (
    <AgentClockContext.Provider value={now}>
      {children}
    </AgentClockContext.Provider>
  );
}

function AgentDuration({ createdAt }: { createdAt: number }) {
  const now = useContext(AgentClockContext);
  const duration = agentDurationLabel(createdAt, now);
  return duration ? (
    <ActionTooltip label="Age">
      {(tooltipId) => <time
      className="ws-agent-duration"
      dateTime={new Date(createdAt).toISOString()}
      aria-label={`Agent thread age ${duration}`}
      aria-describedby={tooltipId}
    >
      {duration}
      </time>}
    </ActionTooltip>
  ) : null;
}

const runtimeIcons: Record<
  ReturnType<typeof agentRuntimePresentation>["tone"],
  IconName
> = {
  working: "Bot",
  waiting: "UserClock",
  blocked: "AlertCircle",
  complete: "Check",
  idle: "Zzz",
};

const workspaceIcons: Record<
  NonNullable<ReturnType<typeof agentWorkspacePresentation>>["kind"],
  IconName
> = {
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
  const { splitProps, isAvailable } = experimental_useSidebarThreadSplit(
    child.thread.id,
  );
  const runtime = agentRuntimePresentation(child.thread);
  const workspace = agentWorkspacePresentation(child.thread);
  const title =
    child.thread.title ?? child.thread.titleFallback ?? "Untitled agent";
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
          <ActionTooltip label="Model">
            {(tooltipId) => <span className="ws-agent-fact" aria-describedby={tooltipId}>
            <Icon name="Bot" aria-hidden />
            <span>{model ?? "Model unavailable"}</span>
            </span>}
          </ActionTooltip>
          {workspace ? (
            <CopyBadge
              value={workspace.label}
              copyValue={workspace.copyValue}
              label="agent workspace"
              className="ws-agent-workspace-badge"
              variant="text"
              title={`${workspace.detail}: ${workspace.label}`}
              data-workspace-kind={workspace.kind}
            >
              <Icon name={workspaceIcons[workspace.kind]} aria-hidden />
              <span>{workspace.label}</span>
              <small>{workspace.detail}</small>
            </CopyBadge>
          ) : null}
          {annotation.taskKey ? (
            <ActionTooltip label="Task">
              {(tooltipId) => <span
              className="ws-agent-fact ws-agent-task"
              aria-describedby={tooltipId}
            >
              <Icon name="ListTodo" aria-hidden />
              <b>{annotation.taskKey}</b>
              {annotation.taskTitle ? (
                <span>{annotation.taskTitle}</span>
              ) : null}
              </span>}
            </ActionTooltip>
          ) : null}
        </span>
        {annotation.recoveryMessage ? (
          <small>{annotation.recoveryMessage}</small>
        ) : null}
      </a>
      <span className="ws-agent-actions">
        <span className="ws-agent-action-buttons">
          <ActionTooltip label="Open agent">
            {(tooltipId) => <button
            type="button"
            className="ws-agent-action"
            onClick={() => open(false)}
            aria-label={`Open ${title}`}
            aria-describedby={tooltipId}
            >
            <Icon name="ArrowRight" aria-hidden />
            </button>}
          </ActionTooltip>
          {isAvailable ? (
          <ActionTooltip label="Split">
              {(tooltipId) => <button
              type="button"
              className="ws-agent-action"
              onClick={() => open(true)}
              aria-label={`Open ${title} in split`}
              aria-describedby={tooltipId}
              >
              <Icon name="Columns2" aria-hidden />
              </button>}
            </ActionTooltip>
          ) : null}
        </span>
        <AgentDuration createdAt={child.thread.createdAt} />
      </span>
    </article>
  );
}
