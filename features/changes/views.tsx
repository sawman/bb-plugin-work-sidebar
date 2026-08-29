import type { ReactElement, ReactNode } from "react";
import type { GitHubStackBranch } from "../../contracts.js";
import { Icon } from "../../components/ui/icon.js";
import { Status } from "../../components/ui/status.js";
import {
  SurfaceCard,
  SurfaceCardHeading,
} from "../../components/ui/surface-card.js";
import type { CurrentPullRequestView } from "../../work-model.js";
import {
  normalizePullRequestSignal,
  pullRequestAttentionFromSignal,
  pullRequestPresentation,
  pullRequestSignalPresentation,
  type PullRequestSignal,
} from "../pull-requests/presentation.js";
import { HostWorkingTreeRenderer } from "./host-renderer.js";
import { ChangedFilesList } from "./file-list.js";
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
}: {
  repository: Repository;
  expanded: boolean;
  onToggle(): void;
  onOpenFile(path: string): void;
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
            <i>+{repository.changedInsertions}</i>{" "}
            <em>−{repository.changedDeletions}</em>
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
    </>
  );
}

export function ChangesRepositoryCard({
  repository,
  loading,
  expanded,
  onToggle,
  onOpenFile,
}: {
  repository: Repository | undefined;
  loading: boolean;
  expanded: boolean;
  onToggle(): void;
  onOpenFile(path: string): void;
}) {
  if (loading)
    return (
      <SurfaceCard className="ws-empty-state-card" aria-busy="true">
        <SurfaceCardHeading title="Repository" />
        <p className="ws-card-note">
          Loading pull requests and working-tree changes…
        </p>
      </SurfaceCard>
    );
  const presentation = repository
    ? repositoryPresentation(repository)
    : { label: "Unavailable", tone: "unavailable" as const };
  return (
    <SurfaceCard className="ws-repository-card">
      <SurfaceCardHeading
        title={repository?.branch ?? "Repository"}
        trailing={
          <span
            className={`ws-pill ${presentation.tone === "changed" ? "ws-pr-changes_requested" : ""}`}
          >
            {presentation.label}
          </span>
        }
      />
      {repository?.outcome === "available" ? (
        <RepositoryDetails
          repository={repository}
          expanded={expanded}
          onToggle={onToggle}
          onOpenFile={onOpenFile}
        />
      ) : (
        <p className="ws-card-note">
          {repository?.message ?? "Repository status is unavailable."}
        </p>
      )}
    </SurfaceCard>
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

function currentPullRequestBranch(
  pullRequest: CurrentPullRequestView,
  branch?: GitHubStackBranch | null,
): GitHubStackBranch {
  return {
    name: branch?.name ?? pullRequest.head,
    isCurrent: true,
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
  return (
    <div className="ws-current-pr-details">
      <span>Review: {signal.review.label}</span>
      <span>
        Checks: {pullRequest.checks.passedCount} passed ·{" "}
        {pullRequest.checks.pendingCount} pending ·{" "}
        {pullRequest.checks.failedCount} failed
      </span>
      <span>Merge: {readableStatus(pullRequest.mergeability.state)}</span>
    </div>
  );
}

export function ChangesCurrentPullRequestRow({
  pullRequest,
  branch,
  expanded,
  onToggle,
}: {
  pullRequest: CurrentPullRequestView;
  branch?: GitHubStackBranch | null;
  expanded: boolean;
  onToggle(): void;
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
        }}
        expanded={expanded}
        checkingOut={false}
        onToggle={onToggle}
        onCheckout={() => undefined}
        expandedDetails={
          <CurrentPullRequestDetails pullRequest={pullRequest} />
        }
      />
    </ol>
  );
}

function PullRequestFiles({
  diff,
}: {
  diff: GitHubStackBranch["diff"];
}): ReactElement {
  return (
    <ChangedFilesList
      files={diff?.files ?? null}
      truncated={diff?.truncated ?? false}
    />
  );
}

export function ChangesStackBranchRow({
  branch,
  signals,
  expanded,
  checkingOut,
  onToggle,
  onCheckout,
  expandedDetails,
}: {
  branch: GitHubStackBranch;
  signals?: StackBranchSignals;
  expanded: boolean;
  checkingOut: boolean;
  onToggle(): void;
  onCheckout(): void;
  expandedDetails?: ReactNode;
}) {
  const pr = branch.pr;
  const title = pr?.title ?? branch.name;
  const fileCount = branch.diff?.files.length ?? 0;
  const merged =
    branch.isMerged ||
    (pr?.state ?? signals?.state ?? "").toLowerCase() === "merged";
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
        reviewCommentCount: signals.reviewCommentCount,
      })
    : null;
  const presented = signal ? pullRequestSignalPresentation(signal) : null;
  const attention = branch.needsRebase
    ? "blocked"
    : signals?.attention && signals.attention !== "none"
      ? signals.attention
      : signal
        ? pullRequestAttentionFromSignal(signal)
        : undefined;
  const statePresentation = pullRequestPresentation({
    state: status === "blocked" ? "open" : status,
    draft: status === "draft",
    mergedLayer: merged,
    attention,
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
        <button
          type="button"
          className="ws-stack-layer-toggle"
          onClick={() => {
            if (hasDisclosure) onToggle();
          }}
          {...(hasDisclosure
            ? {
                "aria-expanded": expanded,
                "aria-label": `${visibleTitle} — ${filesLabel}`,
              }
            : { "aria-disabled": true, "aria-label": visibleTitle })}
        >
          <strong>{visibleTitle}</strong>
          <small>
            <span className="ws-stack-subtitle-signals">
              {presented && (
                <>
                  <Status presentation={presented.checks} />
                  <Status presentation={presented.review} />
                </>
              )}
            </span>
            {branch.name}
            {branch.diff ? (
              <>
                {" "}
                · <b>+{branch.diff.additions}</b>{" "}
                <i>−{branch.diff.deletions}</i>
              </>
            ) : null}
          </small>
        </button>
        <StackBranchActions
          pullRequest={pr}
          branchName={branch.name}
          merged={merged}
          current={branch.isCurrent}
          checkingOut={checkingOut}
          hasDisclosure={hasDisclosure}
          expanded={expanded}
          filesLabel={filesLabel}
          onCheckout={onCheckout}
          onToggle={onToggle}
        />
      </div>
      {expanded && (
        <>
          {expandedDetails}
          <PullRequestFiles diff={branch.diff} />
        </>
      )}
    </li>
  );
}
