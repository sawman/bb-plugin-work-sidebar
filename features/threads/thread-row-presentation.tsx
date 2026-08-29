import type { ReactNode } from "react";
import type {
  PluginSidebarPullRequest,
  PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { CopyBadge } from "@/components/ui/copy-badge";
import { ThreadWorkspaceBadge } from "@/components/threads/thread-workspace-badge";
import {
  ThreadProviderLogo,
  type ThreadProvider,
} from "@/components/threads/thread-provider-logo";
import { pullRequestPresentation } from "@/features/pull-requests/presentation";
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
    <span className="ws-thread-meta ws-sidebar-row-meta">
      {pullRequest && pullRequestStatus && (
        <CopyBadge
          value={`#${pullRequest.number}`}
          copyValue={`PR #${pullRequest.number}`}
          label="PR number"
          className="ws-pr-meta ws-thread-token ws-thread-pr-token"
          tone={pullRequestStatus.tone}
          title={`PR #${pullRequest.number} · ${pullRequestStatus.label}`}
        >
          <Icon name={pullRequestStatus.icon} aria-hidden />
          <span>#{pullRequest.number}</span>
        </CopyBadge>
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
}: {
  thread: PluginSidebarThread;
  hasComposerDraft: boolean;
  staleWorking?: boolean;
  staleWorkingMinutes?: number;
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
    </span>
  );
}
