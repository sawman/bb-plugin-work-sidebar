import type {
  PluginSidebarPullRequest,
  PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import {
  normalizeIndicator,
  orderTaskLinksByRelevance,
  type ThreadTaskLink,
} from "@/work-model";
import { pullRequestPresentation } from "@/features/pull-requests/presentation";
import type { ThreadProject } from "./thread-row-types";

function indicatorGlyph(value: string): string {
  switch (normalizeIndicator(value)) {
    case "runtime":
    case "workflow":
    case "background-agent":
    case "background-command":
      return "●";
    case "unread-error":
      return "!";
    case "unread-success":
      return "•";
    case "waiting-for-input":
      return "?";
    default:
      return "";
  }
}

export function threadIsWorking(thread: PluginSidebarThread): boolean {
  const indicator = normalizeIndicator(String(thread.indicator));
  return (
    indicator === "runtime" ||
    indicator === "workflow" ||
    indicator === "background-agent" ||
    indicator === "background-command" ||
    indicator === "goal" ||
    indicator === "plan-mode" ||
    indicator === "working-draft"
  );
}

export function ThreadMetadata({
  thread,
  project,
  projectLabel,
  taskLinks,
  pullRequest,
  pullRequestLoading,
}: {
  thread: PluginSidebarThread;
  project?: ThreadProject;
  projectLabel: string;
  taskLinks?: readonly ThreadTaskLink[];
  pullRequest: PluginSidebarPullRequest | null;
  pullRequestLoading: boolean;
}) {
  const pullRequestStatus = pullRequest
    ? pullRequestPresentation({
        state: pullRequest.state,
        draft: pullRequest.state === "draft",
        attention: pullRequest.attention,
      })
    : null;
  return (
    <span className="ws-thread-meta">
      {pullRequest && pullRequestStatus && (
        <span
          className="ws-pr-meta ws-thread-token ws-thread-pr-token"
          data-tone={pullRequestStatus.tone}
          title={`PR #${pullRequest.number} · ${pullRequestStatus.label}`}
        >
          <Icon name={pullRequestStatus.icon} aria-hidden />
          <span>#{pullRequest.number}</span>
        </span>
      )}
      <span
        className="ws-thread-worktree"
        title={`${projectLabel} ${project?.isPersonal ? "work" : "project"} · ${thread.environment?.branchName || (project?.isPersonal ? "Personal" : projectLabel)}`}
      >
        <Icon name={project?.isPersonal ? "Laptop" : "FolderGit"} aria-hidden />
        <span>
          {thread.environment?.branchName ||
            (project?.isPersonal ? "Personal" : projectLabel)}
        </span>
      </span>
      {orderTaskLinksByRelevance(taskLinks ?? []).map((taskLink) => (
        <span
          className="ws-task-link"
          key={`${taskLink.task.id}:${taskLink.role}`}
          title={`${taskLink.task.title} · ${taskLink.task.key}`}
        >
          <Icon name="ListTodo" aria-hidden />
          <small className="ws-task-key">{taskLink.task.key}</small>
        </span>
      ))}
      {pullRequestLoading && (
        <span className="ws-pr-meta" role="status" aria-label="Pull request loading">
          PR loading…
        </span>
      )}
    </span>
  );
}

export function ThreadStatus({
  thread,
  hasComposerDraft,
}: {
  thread: PluginSidebarThread;
  hasComposerDraft: boolean;
}) {
  const indicator = normalizeIndicator(String(thread.indicator));
  const working = threadIsWorking(thread);
  return (
    <span className="ws-thread-trailing">
      {hasComposerDraft && (
        <Icon
          name="Pencil"
          className="ws-composer-draft"
          aria-label="Unsent draft"
        />
      )}
      <span
        className={`ws-status ws-status-${indicator} ${working ? "ws-status-working" : ""}`}
        role={thread.indicatorLabel ? "img" : undefined}
        aria-label={thread.indicatorLabel ?? undefined}
      >
        {working ? (
          <span className="ws-status-dots" aria-hidden>
            <i />
            <i />
            <i />
          </span>
        ) : (
          indicatorGlyph(String(thread.indicator))
        )}
      </span>
      {thread.isPinned && (
        <Icon name="Pin" className="ws-thread-pin" aria-label="Pinned" />
      )}
      {thread.isUnread && !working && indicator !== "unread-success" && (
        <span className="ws-unread-dot" title="Unread" />
      )}
    </span>
  );
}
