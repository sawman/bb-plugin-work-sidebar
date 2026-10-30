import type { ReactElement, ReactNode } from "react";
import type { GitHubStackBranch } from "../../contracts.js";
import { Icon } from "../../components/ui/icon.js";
import { CopyBadge } from "../../components/ui/copy-badge.js";
import { Status } from "../../components/ui/status.js";
import {
  SurfaceCard,
  SurfaceCardHeading,
} from "../../components/ui/surface-card.js";
import type { CurrentPullRequestView } from "../../work-model.js";
import {
  normalizePullRequestSignal,
  pullRequestSummaryPresentation,
  pullRequestSignalPresentation,
  type PullRequestSignal,
} from "../pull-requests/presentation.js";
import { HostWorkingTreeRenderer } from "./host-renderer.js";
import { ChangedFilesList } from "./file-list.js";
import { ChangeLineDeltas } from "./line-deltas.js";
import type { Repository, WorkingTreeFileDiff } from "./schemas.js";
import { repositoryPresentation, type StackBranchSignals } from "./model";
import { StackBranchActions } from "./stack-branch-actions.js";

export function ChangesError({
  error,
  onRetry,
}: {
  error: Error;
  onRetry(): void;
}): ReactElement {
  return (
    <div className="ws-callout" role="alert">
      <strong>Could not load pull request changes</strong>
      <span>{error.message}</span>
      <button
        type="button"
        aria-label="Retry pull request changes"
        onClick={onRetry}
      >
        Try again
      </button>
    </div>
  );
}

function RepositoryFiles({
  repository,
  onOpenFile,
}: {
  repository: Repository;
  onOpenFile(path: string): void;
}) {
  return (
    <ChangedFilesList
      files={repository.changedFiles.map((file) => ({
        path: file.path,
        status: file.status,
        additions: file.insertions,
        deletions: file.deletions,
      }))}
      onOpenFile={onOpenFile}
    />
  );
}

function RepositoryDetails({
  repository,
  expanded,
  onToggle,
  onOpenFile,
  preview,
}: {
  repository: Repository;
  expanded: boolean;
  onToggle(): void;
  onOpenFile(path: string): void;
  preview?: ReactNode;
}) {
  const countLabel = `${expanded ? "Hide" : "Show"} ${repository.changedFileCount} working-tree file${repository.changedFileCount === 1 ? "" : "s"}`;
  return (
    <>
      <div className="ws-card-meta">
        <span>
          {repository.ahead}↑ {repository.behind}↓
        </span>
        <span>{repository.base ?? "—"}</span>
        {repository.changedFileCount > 0 && (
          <button
            type="button"
            className="ws-repository-changes-toggle"
            aria-expanded={expanded}
            onClick={onToggle}
            aria-label={countLabel}
          >
            <b>{repository.changedFileCount}</b> file
            {repository.changedFileCount === 1 ? "" : "s"}{" "}
            <ChangeLineDeltas
              additions={repository.changedInsertions}
              deletions={repository.changedDeletions}
              className="ws-repository-line-deltas"
            />
            <Icon
              className="ws-changes-disclosure-icon"
              name={expanded ? "ChevronDown" : "ChevronRight"}
            />
          </button>
        )}
      </div>
      {expanded && repository.changedFileCount > 0 && (
        <RepositoryFiles repository={repository} onOpenFile={onOpenFile} />
      )}
      {expanded && preview}
    </>
  );
}

export function ChangesRepositoryCard({
  repository,
  loading,
  refreshing = false,
  expanded,
  contextMeta,
  onToggle,
  onOpenFile,
  preview,
}: {
  repository: Repository | undefined;
  loading: boolean;
  refreshing?: boolean;
  expanded: boolean;
  contextMeta?: ReactNode;
  onToggle(): void;
  onOpenFile(path: string): void;
  preview?: ReactNode;
}) {
  if (loading)
    return (
      <SurfaceCard className="ws-empty-state-card" aria-busy="true">
        <SurfaceCardHeading
          title="Repository"
          trailing={<RepositoryLoadingIndicator />}
        />
        <p className="ws-card-note">
          Loading pull requests and working-tree changes…
        </p>
      </SurfaceCard>
    );
  const presentation = repository
    ? repositoryPresentation(repository)
    : { label: "Unavailable", tone: "unavailable" as const };
  return (
    <SurfaceCard
      className="ws-repository-card"
      aria-busy={refreshing || undefined}
    >
      <SurfaceCardHeading
        title={repository?.branch ?? "Repository"}
        trailing={
          <span className="ws-repository-heading-meta">
            {refreshing ? <RepositoryLoadingIndicator /> : null}
            {contextMeta}
            <span
              className={`ws-pill ${presentation.tone === "changed" ? "ws-pr-changes_requested" : ""}`}
            >
              {presentation.label}
            </span>
          </span>
        }
      />
      {repository?.outcome === "available" ? (
        <RepositoryDetails
          repository={repository}
          expanded={expanded}
          onToggle={onToggle}
          onOpenFile={onOpenFile}
          preview={preview}
        />
      ) : (
        <p className="ws-card-note">
          {repository?.message ?? "Repository status is unavailable."}
        </p>
      )}
    </SurfaceCard>
  );
}

function RepositoryLoadingIndicator(): ReactElement {
  return (
    <span
      className="ws-repository-loading"
      role="status"
      aria-label="Refreshing repository"
    >
      <Icon
        name="RefreshCw"
        className="ws-refresh-icon"
        data-motion="spin"
        aria-hidden
      />
    </span>
  );
}

type WorkingTreeFileDiffQuery = {
  data: WorkingTreeFileDiff | undefined;
  error: Error | null;
  isError: boolean;
  isPending: boolean;
};

export function ChangesWorkingTreePreview({
  path,
  query,
  onClose,
}: {
  path: string;
  query: WorkingTreeFileDiffQuery;
  onClose(): void;
}): ReactElement {
  let content: ReactElement;
  if (query.isPending) {
    content = (
      <p className="ws-card-note" role="status">
        Loading diff…
      </p>
    );
  } else if (query.isError) {
    content = (
      <p className="ws-card-note" role="alert">
        {query.error?.message ?? "Could not load the file diff."}
      </p>
    );
  } else if (query.data?.kind === "patch") {
    content = <HostWorkingTreeRenderer file={query.data} />;
  } else {
    content = (
      <p className="ws-card-note">
        {query.data?.message ?? "No diff is available for this file."}
      </p>
    );
  }
  return (
    <SurfaceCard className="ws-working-tree-diff">
      <SurfaceCardHeading
        title={path}
        trailing={
          <button
            type="button"
            className="ws-icon-button"
            onClick={onClose}
            aria-label={`Close diff for ${path}`}
          >
            <Icon name="X" aria-hidden />
          </button>
        }
      />
      {content}
    </SurfaceCard>
  );
}

function readableStatus(status: string): string {
  return status
    .replaceAll("-", " ")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function checkSummary(checks: CurrentPullRequestView["checks"]): string {
  if (checks.failedCount === 0 && checks.pendingCount === 0) {
    return checks.passedCount > 0
      ? `${checks.passedCount} checks passed`
      : "No checks";
  }
  return [
    checks.passedCount > 0 ? `${checks.passedCount} passed` : null,
    checks.pendingCount > 0 ? `${checks.pendingCount} pending` : null,
    checks.failedCount > 0 ? `${checks.failedCount} failed` : null,
  ]
    .filter((value): value is string => value !== null)
    .join(" · ");
}

function currentPullRequestBranch(
  pullRequest: CurrentPullRequestView,
  branch?: GitHubStackBranch | null,
): GitHubStackBranch {
  return {
    name: branch?.name ?? pullRequest.head,
    isCurrent: branch?.isCurrent ?? true,
    isMerged: pullRequest.state === "merged",
    isQueued: branch?.isQueued ?? false,
    needsRebase: branch?.needsRebase ?? false,
    hasStash: branch?.hasStash ?? false,
    stashCount: branch?.stashCount ?? null,
    pr: {
      number: pullRequest.number,
      url: pullRequest.url,
      state: pullRequest.state,
      title: pullRequest.title,
      isDraft: pullRequest.state === "draft",
      metadataStale: branch?.pr?.metadataStale ?? false,
    },
    diff: branch?.diff ?? null,
    aheadOfRemote: branch?.aheadOfRemote ?? null,
    behindRemote: branch?.behindRemote ?? null,
    checks: pullRequest.signal.checks,
    review: pullRequest.signal.review,
  };
}

function CurrentPullRequestDetails({
  pullRequest,
}: {
  pullRequest: CurrentPullRequestView;
}) {
  const signal = pullRequestSignalPresentation(pullRequest.signal);
  const summary = [
    signal.review.label,
    checkSummary(pullRequest.checks),
    readableStatus(pullRequest.mergeability.state),
  ].join(" · ");
  return (
    <div className="ws-current-pr-details" aria-label={summary}>
      <span>{summary}</span>
    </div>
  );
}

export function ChangesCurrentPullRequestRow({
  pullRequest,
  branch,
  expanded,
  externalOnModifier = false,
  onToggle,
  onOpenFile,
  preview,
  filesLoading = false,
}: {
  pullRequest: CurrentPullRequestView;
  branch?: GitHubStackBranch | null;
  filesLoading?: boolean;
  expanded: boolean;
  externalOnModifier?: boolean;
  onToggle(): void;
  onOpenFile(path: string): void;
  preview?: ReactNode;
}) {
  const rowBranch = currentPullRequestBranch(pullRequest, branch);
  return (
    <ol
      className="ws-stack-rail"
      aria-label={`Pull request #${pullRequest.number}`}
    >
      <ChangesStackBranchRow
        branch={rowBranch}
        signals={{
          state: pullRequest.state,
          draft: pullRequest.state === "draft",
          attention: pullRequest.attention,
          checks: pullRequest.signal.checks,
          review: pullRequest.signal.review,
          reviewCommentCount: pullRequest.signal.reviewCommentCount,
          reviewCommentCounts: pullRequest.signal.reviewCommentCounts,
        }}
        expanded={expanded}
        filesLoading={filesLoading}
        externalOnModifier={externalOnModifier}
        checkingOut={false}
        onToggle={onToggle}
        onCheckout={() => undefined}
        onOpenFile={onOpenFile}
        preview={preview}
        expandedDetails={
          <CurrentPullRequestDetails pullRequest={pullRequest} />
        }
      />
    </ol>
  );
}

function PullRequestFiles({
  diff,
  loading = false,
  onOpenFile,
}: {
  diff: GitHubStackBranch["diff"];
  loading?: boolean;
  onOpenFile?: (path: string) => void;
}): ReactElement {
  if (!diff && loading)
    return (
      <div className="ws-stack-files ws-changes-file-list-scroll">
        <small role="status">Loading changed files…</small>
      </div>
    );
  return (
    <ChangedFilesList
      files={diff?.files ?? null}
      truncated={diff?.truncated ?? false}
      onOpenFile={onOpenFile}
      openFileLabel={(path) => `Open pull request diff for ${path}`}
    />
  );
}

export function ChangesStackBranchRow({
  branch,
  signals,
  expanded,
  externalOnModifier = false,
  checkingOut,
  checkoutAvailable = true,
  onToggle,
  onCheckout,
  onOpenFile,
  preview,
  expandedDetails,
  filesLoading = false,
}: {
  branch: GitHubStackBranch;
  signals?: StackBranchSignals;
  expanded: boolean;
  externalOnModifier?: boolean;
  checkingOut: boolean;
  checkoutAvailable?: boolean;
  onToggle(): void;
  onCheckout(): void;
  onOpenFile?: (path: string) => void;
  preview?: ReactNode;
  expandedDetails?: ReactNode;
  filesLoading?: boolean;
}) {
  const pr = branch.pr ? {
    ...branch.pr,
    state: signals?.state ?? branch.pr.state,
    isDraft: signals?.draft ?? branch.pr.isDraft,
    title: signals?.title ?? branch.pr.title,
    url: signals?.url ?? branch.pr.url,
  } : null;
  const title = pr?.title ?? branch.name;
  const fileCount = branch.diff?.files.length ?? 0;
  const merged = (signals?.state ?? (branch.isMerged ? "merged" : pr?.state ?? "")).toLowerCase() === "merged";
  const status = merged
    ? "merged"
    : (pr?.state ?? signals?.state) === "closed"
      ? "closed"
      : (pr?.isDraft ?? signals?.draft)
        ? "draft"
        : branch.needsRebase
          ? "blocked"
          : "open";
  const signal: PullRequestSignal | null = signals
    ? normalizePullRequestSignal({
        checks: signals.checks ?? "unknown",
        review: signals.review ?? "none",
        approvers: signals.approvers,
        changeRequesters: signals.changeRequesters,
        requestedReviewers: signals.requestedReviewers,
        reviewCommentCount: signals.reviewCommentCount,
        reviewCommentCounts: signals.reviewCommentCounts,
      })
    : null;
  const presented = signal
    ? pullRequestSignalPresentation(signal, {
        reviewCommentCountMode: "breakdown",
      })
    : null;
  const attention = branch.needsRebase ? "blocked" : branch.isQueued ? "queued" : signals?.attention;
  const statePresentation = pullRequestSummaryPresentation({
    state: status === "blocked" ? "open" : status,
    draft: status === "draft",
    mergedLayer: merged,
    attention,
    signal,
  });
  const visibleTitle = `${pr ? `#${pr.number} ` : ""}${title}`;
  const filesLabel = `${expanded ? "Hide" : "Show"} changed files for ${pr ? `pull request #${pr.number}` : branch.name}`;
  const hasDisclosure = Boolean(pr || branch.diff);
  return (
    <li
      className={`ws-stack-layer-item ${branch.isCurrent ? "ws-stack-current" : ""} ${merged ? "ws-stack-merged" : ""} ${expanded ? "ws-stack-expanded" : ""}`}
    >
      <div className="ws-stack-layer">
        <Status
          presentation={statePresentation}
          className="ws-stack-state-icon"
        />
        <div
          className="ws-stack-layer-summary"
          onClick={() => {
            if (hasDisclosure) onToggle();
          }}
        >
          <div className="ws-stack-layer-title">
            {pr && (
              <CopyBadge
                value={`#${pr.number}`}
                copyValue={pr.url}
                label="PR URL"
                title="Copy PR URL"
              >
                #{pr.number}
              </CopyBadge>
            )}
            <button
              type="button"
              className="ws-stack-layer-toggle"
              {...(hasDisclosure
                ? {
                    "aria-expanded": expanded,
                    "aria-label": `${visibleTitle} — ${filesLabel}`,
                  }
                : { "aria-disabled": true, "aria-label": visibleTitle })}
            >
              <strong>{title}</strong>
            </button>
          </div>
          <small>
            <span className="ws-stack-subtitle-signals">
              {presented && (
                <>
                  <Status presentation={presented.checks} size="metadata" />
                  <Status presentation={presented.review} size="metadata" />
                </>
              )}
            </span>
            {branch.name}
          </small>
          {branch.diff ? (
            <ChangeLineDeltas
              additions={branch.diff.additions}
              deletions={branch.diff.deletions}
              className="ws-stack-line-deltas"
            />
          ) : null}
        </div>
        <StackBranchActions
          pullRequest={pr}
          branchName={branch.name}
          merged={merged}
          current={branch.isCurrent}
          checkoutAvailable={checkoutAvailable}
          checkingOut={checkingOut}
          hasDisclosure={hasDisclosure}
          expanded={expanded}
          filesLabel={filesLabel}
          externalOnModifier={externalOnModifier}
          onCheckout={onCheckout}
          onToggle={onToggle}
        />
      </div>
      {expanded && (
        <>
          {expandedDetails}
          <PullRequestFiles diff={branch.diff} loading={filesLoading} onOpenFile={onOpenFile} />
          {preview}
        </>
      )}
    </li>
  );
}
