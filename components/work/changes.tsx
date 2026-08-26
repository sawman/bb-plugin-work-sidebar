import { useMemo, useState } from "react";
import { Diff, Hunk, parseDiff } from "react-diff-view";
import type { GitHubStackBranch, GitHubStackSignal } from "../../contracts";
import { Icon, type IconName } from "../ui/icon";
import type { CurrentPullRequestView } from "../../work-model";

export type StackBranchSignals = Pick<GitHubStackSignal, "state" | "draft" | "checks" | "review" | "reviewCommentCount">;

function readableStatus(status: string): string {
  return status.replaceAll("-", " ").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function pullRequestStatus(pullRequest: CurrentPullRequestView): { icon: IconName; tone: string; label: string } {
  if (pullRequest.state === "closed") return { icon: "X", tone: "closed", label: "Closed" };
  if (pullRequest.state === "merged") return { icon: "Check", tone: "merged", label: "Merged" };
  if (pullRequest.state === "draft") return { icon: "GitPullRequest", tone: "draft", label: "Draft" };
  return pullRequest.attention === "checks_failed" || pullRequest.attention === "conflicts" || pullRequest.attention === "changes_requested"
    ? { icon: "X", tone: "problem", label: "Open with issues" }
    : { icon: "GitPullRequest", tone: "open", label: "Open" };
}

export function CurrentPullRequestCard({ pullRequest, expanded, onToggle }: { pullRequest: CurrentPullRequestView; expanded: boolean; onToggle(): void }) {
  const status = pullRequestStatus(pullRequest);
  const checkSignal = pullRequest.checks.failedCount > 0 ? { icon: "X" as const, tone: "problem", label: `${pullRequest.checks.failedCount} failing check${pullRequest.checks.failedCount === 1 ? "" : "s"}` } : pullRequest.checks.pendingCount > 0 ? { icon: "LoaderCircle" as const, tone: "pending", label: `${pullRequest.checks.pendingCount} check${pullRequest.checks.pendingCount === 1 ? "" : "s"} pending` } : pullRequest.checks.totalCount > 0 ? { icon: "Check" as const, tone: "success", label: "Checks passing" } : null;
  const rereviewRequested = pullRequest.review.state === "changes_requested" && pullRequest.review.reviewRequestCount > 0;
  const reviewRequested = !rereviewRequested && pullRequest.review.state !== "changes_requested" && pullRequest.review.reviewRequestCount > 0;
  const reviewSignal = pullRequest.review.state === "approved" ? { icon: "Check" as const, tone: "success", label: "Approved" } : rereviewRequested ? { icon: "Eye" as const, tone: "success", label: "Changes requested; re-review requested" } : pullRequest.review.state === "changes_requested" ? { icon: "Wrench" as const, tone: "problem", label: "Changes requested" } : reviewRequested || pullRequest.review.state === "review_requested" ? { icon: "Eye" as const, tone: "success", label: "Review requested" } : pullRequest.review.state === "review_required" ? { icon: "Eye" as const, tone: "pending", label: "Review required" } : { icon: "UserClock" as const, tone: "pending", label: "No reviewer requested" };
  return <article className="ws-current-pr-card"><div className="ws-current-pr-summary"><span className={`ws-pr-state-icon ws-pr-state-${status.tone}`} title={status.label} aria-label={status.label}><Icon name={status.icon} aria-hidden /></span><span><strong>#{pullRequest.number} {pullRequest.title}</strong><small>{pullRequest.head} · {readableStatus(pullRequest.review.state)} · {pullRequest.checks.passedCount}/{pullRequest.checks.totalCount} checks</small></span><span className="ws-current-pr-signals" aria-label="Pull request signals">{checkSignal && <span className={`ws-current-pr-signal ws-pr-state-${checkSignal.tone}`} title={checkSignal.label} aria-label={checkSignal.label}><Icon name={checkSignal.icon} aria-hidden /></span>}<span className={`ws-current-pr-signal ws-pr-state-${reviewSignal.tone}`} title={reviewSignal.label} aria-label={reviewSignal.label}>{rereviewRequested ? <span className="ws-review-rerequest"><Icon name="Eye" aria-hidden /><Icon name="Wrench" aria-hidden /></span> : <Icon name={reviewSignal.icon} aria-hidden />}</span></span></div><a className="ws-current-pr-open ws-pr-tooltip" data-tooltip="Open on GitHub" href={pullRequest.url} target="_blank" rel="noreferrer" aria-label={`Open pull request #${pullRequest.number} on GitHub`}>↗</a><button type="button" className="ws-current-pr-expand ws-pr-tooltip" data-tooltip={expanded ? "Hide PR details" : "Show PR details"} onClick={onToggle} aria-expanded={expanded} aria-label={`${expanded ? "Hide" : "Show"} details for pull request #${pullRequest.number}`}>{expanded ? "⌄" : "›"}</button>{expanded && <div className="ws-current-pr-details"><span>Review: {reviewSignal.label}</span><span>Checks: {pullRequest.checks.passedCount} passed · {pullRequest.checks.pendingCount} pending · {pullRequest.checks.failedCount} failed</span><span>Merge: {readableStatus(pullRequest.mergeability.state)}</span></div>}</article>;
}

export function WorkingTreeDiff({ patch }: { patch: string }) {
  const [view, setView] = useState<"unified" | "split">("unified");
  const files = useMemo(() => parseDiff(patch, { nearbySequences: "zip" }), [patch]);
  return <><div className="ws-diff-toolbar" role="group" aria-label="Diff view"><button type="button" className={view === "unified" ? "ws-diff-view-selected" : ""} onClick={() => setView("unified")}>Unified</button><button type="button" className={view === "split" ? "ws-diff-view-selected" : ""} onClick={() => setView("split")}>Split</button></div><div className="ws-review-diff">{files.map((file) => <Diff key={`${file.oldRevision}:${file.newRevision}`} viewType={view} diffType={file.type} hunks={file.hunks} optimizeSelection>{(hunks) => hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)}</Diff>)}</div></>;
}

const stackStatusIcon: Record<"merged" | "closed" | "draft" | "blocked" | "open", IconName> = { merged: "GitMerge", closed: "X", draft: "GitPullRequest", blocked: "X", open: "GitPullRequest" };

function StackReviewSignal({ review, commentCount }: { review: NonNullable<StackBranchSignals["review"]>; commentCount?: number }) {
  const rereviewRequested = review === "changes_requested_review_requested";
  const label = rereviewRequested ? "Changes requested; re-review requested" : review === "approved" ? "Approved" : review === "changes_requested" ? "Changes requested" : review === "review_requested" ? "Review requested" : review === "review_required" ? "Review required" : "No reviewer requested";
  const icon = review === "approved" ? "Check" : review === "changes_requested" ? "Wrench" : review === "review_requested" || review === "review_required" ? "Eye" : "UserClock";
  return <span className={`ws-stack-review ws-stack-signal-${review}`} title={label} aria-label={label}>
    {rereviewRequested ? <span className="ws-review-rerequest"><Icon name="Eye" aria-hidden /><Icon name="Wrench" aria-hidden /></span> : <Icon name={icon} aria-hidden />}
    {commentCount ? <b>{commentCount}</b> : null}
  </span>;
}

export function StackBranchRow({ branch, signals, expanded, checkingOut, onToggle, onCheckout }: { branch: GitHubStackBranch; signals?: StackBranchSignals; expanded: boolean; checkingOut: boolean; onToggle(): void; onCheckout(): void }) {
  const pr = branch.pr;
  const title = pr?.title ?? branch.name;
  const fileCount = branch.diff?.files.length ?? 0;
  const merged = branch.isMerged || (pr?.state ?? signals?.state ?? "").toLowerCase() === "merged";
  const status = merged ? "merged" : (pr?.state ?? signals?.state) === "closed" ? "closed" : (pr?.isDraft ?? signals?.draft) ? "draft" : branch.needsRebase ? "blocked" : "open";
  const label = merged ? "Merged" : pr?.state === "closed" ? "Closed" : pr?.isDraft ? "Draft" : branch.needsRebase ? "Blocked" : "Open";
  return <li className={`ws-stack-layer-item ${branch.isCurrent ? "ws-stack-current" : ""} ${merged ? "ws-stack-merged" : ""} ${expanded ? "ws-stack-expanded" : ""}`}><div className="ws-stack-layer"><span className={`ws-stack-state-icon ws-stack-node-${status}`} title={label} aria-label={label}><Icon name={stackStatusIcon[status]} aria-hidden /></span><span className="ws-stack-layer-toggle"><strong>{pr ? `#${pr.number} ` : ""}{title}</strong><small><span className="ws-stack-subtitle-signals">{signals?.checks && <span className={`ws-stack-signal ws-stack-signal-${signals.checks}`} title={signals.checks === "unknown" ? "Checks unavailable" : `Checks ${signals.checks}`}><Icon name={signals.checks === "passing" ? "Check" : signals.checks === "failed" ? "X" : signals.checks === "pending" ? "LoaderCircle" : signals.checks === "unknown" ? "AlertCircle" : "Circle"} aria-hidden /></span>}{signals?.review && <StackReviewSignal review={signals.review} commentCount={signals.reviewCommentCount} />}</span>{branch.name}{branch.diff ? <> · <b>+{branch.diff.additions}</b> <i>−{branch.diff.deletions}</i></> : null}</small></span><span className="ws-stack-actions">{pr && <a className="ws-pr-tooltip" data-tooltip="Open on GitHub" href={pr.url} target="_blank" rel="noreferrer" aria-label={`Open pull request #${pr.number} on GitHub`}>↗</a>}<button type="button" className="ws-stack-checkout ws-pr-tooltip" data-tooltip={merged ? "Merged branch" : branch.isCurrent ? "Current branch" : `Check out ${branch.name}`} onClick={onCheckout} disabled={merged || branch.isCurrent || checkingOut} aria-label={merged ? "Merged branch" : branch.isCurrent ? "Current branch" : `Check out ${branch.name}`}>{checkingOut ? "…" : "⇥"}</button>{fileCount > 0 && <button type="button" className="ws-stack-expand ws-pr-tooltip" data-tooltip={expanded ? "Hide changed files" : "Show changed files"} onClick={onToggle} aria-expanded={expanded} aria-label={`${expanded ? "Hide" : "Show"} changed files for ${branch.name}`}>{expanded ? "⌄" : "›"}</button>}</span></div>{expanded && branch.diff && <div className="ws-stack-files">{branch.diff.files.map((file) => <span key={file.path}><b className={`ws-file-${file.status}`}>{file.status[0]?.toUpperCase()}</b><em>{file.path}</em><small>{file.additions !== null ? `+${file.additions}` : ""} {file.deletions !== null ? `−${file.deletions}` : ""}</small></span>)}{branch.diff.truncated && <small className="ws-stack-files-truncated">Only the first {branch.diff.files.length} files are shown.</small>}</div>}</li>;
}
