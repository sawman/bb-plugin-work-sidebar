import type { ReactNode } from "react";
import type {
  PluginSidebarPullRequest,
  PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { normalizeIndicator } from "@/work-model";
import { pullRequestPresentation } from "@/features/pull-requests/presentation";
import { threadIsWorking, useStaleWorking } from "./thread-attention";
import type { ThreadProject } from "./thread-row-types";

function indicatorGlyph(value: string): string {
  switch (normalizeIndicator(value)) {
    case "unread-error":
      return "!";
    case "waiting-for-input":
      return "?";
    default:
      return "";
  }
}

export function ThreadMetadata({
  thread,
  project,
  projectLabel,
  stackNumber,
  pullRequest,
  pullRequestLoading,
}: {
  thread: PluginSidebarThread;
  project?: ThreadProject;
  projectLabel: string;
  stackNumber?: ReactNode;
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
      {stackNumber}
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
  const staleWorking = useStaleWorking(thread);
  const glyph = indicatorGlyph(String(thread.indicator));
  const statusLabel = staleWorking
    ? `${thread.indicatorLabel ?? "Thread is working"}; no agent update for 30 minutes`
    : thread.indicatorLabel;
  return (
    <span className="ws-thread-trailing">
      {hasComposerDraft && (
        <Icon
          name="Pencil"
          className="ws-composer-draft"
          aria-label="Unsent draft"
        />
      )}
      {(working || glyph) && (
        <span
          className={`ws-status ws-status-${indicator} ${working ? "ws-status-working" : ""}`}
          role={statusLabel ? "img" : undefined}
          aria-label={statusLabel ?? undefined}
        >
          {working ? (
            <>
              <span className="ws-status-dots" aria-hidden>
                <i />
                <i />
                <i />
              </span>
              {staleWorking && (
                <Icon
                  name="Clock"
                  className="ws-status-stale-clock"
                  aria-hidden
                />
              )}
            </>
          ) : (
            glyph
          )}
        </span>
      )}
      {indicator === "unread-success" && thread.indicatorLabel && (
        <span className="ws-sr-only">{thread.indicatorLabel}</span>
      )}
      {thread.isPinned && (
        <Icon name="Pin" className="ws-thread-pin" aria-label="Pinned" />
      )}
    </span>
  );
}
