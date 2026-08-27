import type { ReactElement } from "react";
import type { GitHubStackBranch } from "../../contracts.js";
import { Status } from "../../components/ui/status.js";
import {
  SurfaceCard,
  SurfaceCardHeading,
} from "../../components/ui/surface-card.js";
import type { CurrentPullRequestView } from "../../work-model.js";
import {
  normalizePullRequestSignal,
  pullRequestPresentation,
  pullRequestSignalPresentation,
  type PullRequestSignal,
} from "../pull-requests/presentation.js";
import { HostWorkingTreeRenderer } from "./host-renderer.js";
import type { Repository, WorkingTreeFileDiff } from "./schemas.js";
import { repositoryPresentation, type StackBranchSignals } from "./model";

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
    <div className="ws-current-pr-details ws-working-tree-files">
      {repository.changedFiles.map((file) => (
        <button
          type="button"
          className="ws-working-tree-file"
          key={file.path}
          onClick={() => onOpenFile(file.path)}
          aria-label={`Open uncommitted diff for ${file.path}`}
        >
          <b className={`ws-file-${file.status}`}>
            {file.status[0]?.toUpperCase()}
          </b>
          <em>{file.path}</em>
          <small>
            {file.insertions !== null ? `+${file.insertions}` : ""}{" "}
            {file.deletions !== null ? `−${file.deletions}` : ""}
          </small>
        </button>
      ))}
      {repository.changedFileCount > repository.changedFiles.length && (
        <small>
          Only the first {repository.changedFiles.length} files are shown.
        </small>
      )}
    </div>
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
            <em>−{repository.changedDeletions}</em> {expanded ? "⌄" : "›"}
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
            className="ws-text-button"
            onClick={onClose}
            aria-label={`Close diff for ${path}`}
          >
            Close
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

export function ChangesCurrentPullRequestCard({
  pullRequest,
  expanded,
  onToggle,
}: {
  pullRequest: CurrentPullRequestView;
  expanded: boolean;
  onToggle(): void;
}) {
  const signal = pullRequestSignalPresentation(pullRequest.signal);
  const status = pullRequestPresentation({
    state: pullRequest.state,
    draft: pullRequest.state === "draft",
    attention: pullRequest.attention,
  });
  return (
    <article className="ws-current-pr-card">
      <div className="ws-current-pr-summary">
        <Status presentation={status} />
        <span>
          <strong>
            #{pullRequest.number} {pullRequest.title}
          </strong>
          <small>
            {pullRequest.head} · {readableStatus(pullRequest.review.state)} ·{" "}
            {pullRequest.checks.passedCount}/{pullRequest.checks.totalCount}{" "}
            checks
          </small>
        </span>
        <span
          className="ws-current-pr-signals"
          aria-label="Pull request signals"
        >
          <Status presentation={signal.checks} />
          <Status presentation={signal.review} />
        </span>
      </div>
      <a
        className="ws-current-pr-open ws-pr-tooltip"
        data-tooltip="Open on GitHub"
        href={pullRequest.url}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open pull request #${pullRequest.number} on GitHub`}
      >
        ↗
      </a>
      <button
        type="button"
        className="ws-current-pr-expand ws-pr-tooltip"
        data-tooltip={expanded ? "Hide PR details" : "Show PR details"}
        onClick={onToggle}
        aria-expanded={expanded}
        aria-label={`${expanded ? "Hide" : "Show"} details for pull request #${pullRequest.number}`}
      >
        {expanded ? "⌄" : "›"}
      </button>
      {expanded && (
        <div className="ws-current-pr-details">
          <span>Review: {signal.review.label}</span>
          <span>
            Checks: {pullRequest.checks.passedCount} passed ·{" "}
            {pullRequest.checks.pendingCount} pending ·{" "}
            {pullRequest.checks.failedCount} failed
          </span>
          <span>Merge: {readableStatus(pullRequest.mergeability.state)}</span>
        </div>
      )}
    </article>
  );
}

export function ChangesStackBranchRow({
  branch,
  signals,
  expanded,
  checkingOut,
  onToggle,
  onCheckout,
}: {
  branch: GitHubStackBranch;
  signals?: StackBranchSignals;
  expanded: boolean;
  checkingOut: boolean;
  onToggle(): void;
  onCheckout(): void;
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
  const statePresentation = pullRequestPresentation({
    state: status === "blocked" ? "open" : status,
    draft: status === "draft",
    mergedLayer: merged,
    attention: branch.needsRebase ? "blocked" : undefined,
  });
  const visibleTitle = `${pr ? `#${pr.number} ` : ""}${title}`;
  const filesLabel = `${expanded ? "Hide" : "Show"} changed files for ${pr ? `pull request #${pr.number}` : branch.name}`;
  const hasFiles = fileCount > 0;
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
            if (hasFiles) onToggle();
          }}
          aria-disabled={!hasFiles}
          aria-expanded={expanded}
          aria-label={`${visibleTitle} — ${filesLabel}`}
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
          <span className="ws-stack-expand" aria-hidden>
            {expanded ? "⌄" : "›"}
          </span>
        </button>
        <span className="ws-stack-actions">
          {pr && (
            <a
              className="ws-pr-tooltip"
              data-tooltip="Open on GitHub"
              href={pr.url}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open pull request #${pr.number} on GitHub`}
            >
              ↗
            </a>
          )}
          <button
            type="button"
            className="ws-stack-checkout ws-pr-tooltip"
            data-tooltip={
              merged
                ? "Merged branch"
                : branch.isCurrent
                  ? "Current branch"
                  : `Check out ${branch.name}`
            }
            onClick={onCheckout}
            disabled={merged || branch.isCurrent || checkingOut}
            aria-label={
              checkingOut
                ? `Checking out ${branch.name}`
                : merged
                  ? "Merged branch"
                  : branch.isCurrent
                    ? "Current branch"
                    : `Check out ${branch.name}`
            }
          >
            {checkingOut ? "…" : "⇥"}
          </button>
        </span>
      </div>
      {expanded && branch.diff && (
        <div className="ws-stack-files">
          {branch.diff.files.map((file) => (
            <span key={file.path}>
              <b className={`ws-file-${file.status}`}>
                {file.status[0]?.toUpperCase()}
              </b>
              <em>{file.path}</em>
              <small>
                {file.additions !== null ? `+${file.additions}` : ""}{" "}
                {file.deletions !== null ? `−${file.deletions}` : ""}
              </small>
            </span>
          ))}
          {branch.diff.truncated && (
            <small className="ws-stack-files-truncated">
              Only the first {branch.diff.files.length} files are shown.
            </small>
          )}
        </div>
      )}
    </li>
  );
}
