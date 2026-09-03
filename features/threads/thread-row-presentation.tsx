import type { ReactNode } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { ActionTooltip } from "@/components/ui/action-tooltip";
import { ThreadWorkspaceBadge } from "@/components/threads/thread-workspace-badge";
import {
  ThreadProviderLogo,
  type ThreadProvider,
} from "@/components/threads/thread-provider-logo";
import { pullRequestSummaryPresentation } from "@/features/pull-requests/presentation";
import type { ThreadPullRequest } from "@/features/pull-requests/queries";
import { PullRequestIdentifierBadge } from "@/features/pull-requests/identifier-badge";
import {
  queuedMessageDisplay,
  queuedMessageLabel,
  queuedMessageReason,
} from "./queued-messages";
import type { QueuedMessage } from "./schemas";
import type { ThreadProject } from "./thread-row-types";
import {
  threadProviderRuntimeState,
  threadProviderStatusLabel,
} from "./thread-runtime";

export function ThreadRuntimeProvider({
  thread,
  provider,
  activeChildren = 0,
  staleWorking,
  staleWorkingMinutes = 30,
}: {
  thread: PluginSidebarThread;
  provider?: ThreadProvider;
  activeChildren?: number;
  staleWorking: boolean;
  staleWorkingMinutes?: number;
}) {
  const runtimeState = threadProviderRuntimeState(
    thread,
    staleWorking,
    activeChildren,
  );
  const statusLabel = threadProviderStatusLabel(
    thread,
    staleWorking,
    activeChildren,
    runtimeState,
    staleWorkingMinutes,
  );
  return (
    <ThreadProviderLogo
      providerId={thread.providerId}
      provider={provider}
      runtimeState={runtimeState}
      statusLabel={statusLabel}
    />
  );
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
  pullRequest: ThreadPullRequest | null;
  pullRequestLoading: boolean;
}) {
  const pullRequestStatus = pullRequest
    ? pullRequestSummaryPresentation({
        state: pullRequest.state,
        draft: pullRequest.state === "draft",
        attention: pullRequest.attention,
        signal: pullRequest.signal,
      })
    : null;
  return (
    <span className="ws-thread-meta ws-sidebar-row-meta">
      {pullRequest && pullRequestStatus && (
        <PullRequestIdentifierBadge
          kind="pull-request"
          number={pullRequest.number}
          url={pullRequest.url}
          presentation={pullRequestStatus}
        />
      )}
      {stackNumber}
      <ThreadWorkspaceBadge
        branchName={thread.environment?.branchName ?? null}
        environmentName={thread.environment?.name}
        workspaceDisplayKind={thread.environment?.workspaceDisplayKind}
        project={project}
        projectLabel={projectLabel}
      />
      {pullRequestLoading && (
        <span
          className="ws-pr-meta"
          role="status"
          aria-label="Pull request loading"
        >
          PR loading…
        </span>
      )}
    </span>
  );
}

export function ThreadStatus({
  thread,
  hasComposerDraft,
  staleWorking = false,
  staleWorkingMinutes = 30,
  queuedMessage,
  queuedMessageNow = Date.now(),
}: {
  thread: PluginSidebarThread;
  hasComposerDraft: boolean;
  staleWorking?: boolean;
  staleWorkingMinutes?: number;
  queuedMessage?: QueuedMessage;
  queuedMessageNow?: number;
}) {
  return (
    <span className="ws-thread-trailing ws-sidebar-row-trailing">
      {hasComposerDraft && (
        <Icon
          name="Pencil"
          className="ws-composer-draft"
          aria-label="Unsent draft"
        />
      )}
      {thread.isPinned && (
        <Icon name="Pin" className="ws-thread-pin" aria-label="Pinned" />
      )}
      {staleWorking && (
        <Icon
          name="Clock"
          className="ws-status-stale-clock"
          aria-label={`${thread.indicatorLabel ?? "Thread activity"}; no agent update for ${staleWorkingMinutes} minutes`}
        />
      )}
      {queuedMessage && (
        <ActionTooltip label={queuedMessageReason(queuedMessage)}>
          {(tooltipId) => (
            <span
              className="ws-queued-message"
              role="status"
              aria-label={queuedMessageLabel(queuedMessage, queuedMessageNow)}
              aria-describedby={tooltipId}
            >
              <Icon name="MessageSquare" aria-hidden />
              {queuedMessageDisplay(queuedMessage, queuedMessageNow) && (
                <span aria-hidden>
                  {queuedMessageDisplay(queuedMessage, queuedMessageNow)}
                </span>
              )}
            </span>
          )}
        </ActionTooltip>
      )}
    </span>
  );
}
