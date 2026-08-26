import { useMemo, useState } from "react";
import { Diff, Hunk, parseDiff } from "react-diff-view";
import type { GitHubStackBranch, GitHubStackSignal } from "../../contracts";
import { Icon, type IconName } from "../ui/icon";
import type { CurrentPullRequestView } from "../../work-model";

export type StackBranchSignals = Pick<GitHubStackSignal, "state" | "draft" | "checks" | "review" | "reviewCommentCount">;

function readableStatus(status: string): string {
  return status.replaceAll("-", " ").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function pullRequestStatus(pullRequest: CurrentPullRequestView): { icon: string; tone: string; label: string } {
  if (pullRequest.state === "closed") return { icon: "×", tone: "closed", label: "Closed" };
  if (pullRequest.state === "merged") return { icon: "✓", tone: "merged", label: "Merged" };
  if (pullRequest.state === "draft") return { icon: "○", tone: "draft", label: "Draft" };
  return pullRequest.attention === "checks_failed" || pullRequest.attention === "conflicts" || pullRequest.attention === "changes_requested"
    ? { icon: "×", tone: "problem", label: "Open with issues" }
    : { icon: "●", tone: "open", label: "Open" };
}

export function CurrentPullRequestCard({ pullRequest, expanded, onToggle }: { pullRequest: CurrentPullRequestView; expanded: boolean; onToggle(): void }) {
  const status = pullRequestStatus(pullRequest);
  const checkSignal = pullRequest.checks.failedCount > 0 ? { icon: "×", tone: "problem", label: `${pullRequest.checks.failedCount} failing check${pullRequest.checks.failedCount === 1 ? "" : "s"}` } : pullRequest.checks.pendingCount > 0 ? { icon: "…", tone: "pending", label: `${pullRequest.checks.pendingCount} check${pullRequest.checks.pendingCount === 1 ? "" : "s"} pending` } : pullRequest.checks.totalCount > 0 ? { icon: "✓", tone: "success", label: "Checks passing" } : null;
  const reviewSignal = pullRequest.review.state === "approved" ? { icon: "✓", tone: "success", label: "Approved" } : pullRequest.review.state === "changes_requested" ? { icon: "×", tone: "problem", label: "Changes requested" } : { icon: "○", tone: "pending", label: readableStatus(pullRequest.review.state) };
  return <article className="ws-current-pr-card"><div className="ws-current-pr-summary"><span className={`ws-pr-state-icon ws-pr-state-${status.tone}`} title={status.label} aria-label={status.label}>{status.icon}</span><span><strong>#{pullRequest.number} {pullRequest.title}</strong><small>{pullRequest.head} · {readableStatus(pullRequest.review.state)} · {pullRequest.checks.passedCount}/{pullRequest.checks.totalCount} checks</small></span><span className="ws-current-pr-signals" aria-label="Pull request signals">{checkSignal && <span className={`ws-current-pr-signal ws-pr-state-${checkSignal.tone}`} title={checkSignal.label} aria-label={checkSignal.label}>{checkSignal.icon}</span>}<span className={`ws-current-pr-signal ws-pr-state-${reviewSignal.tone}`} title={reviewSignal.label} aria-label={reviewSignal.label}>{reviewSignal.icon}</span></span></div><a className="ws-current-pr-open ws-pr-tooltip" data-tooltip="Open on GitHub" href={pullRequest.url} target="_blank" rel="noreferrer" aria-label={`Open pull request #${pullRequest.number} on GitHub`}>↗</a><button type="button" className="ws-current-pr-expand ws-pr-tooltip" data-tooltip={expanded ? "Hide PR details" : "Show PR details"} onClick={onToggle} aria-expanded={expanded} aria-label={`${expanded ? "Hide" : "Show"} details for pull request #${pullRequest.number}`}>{expanded ? "⌄" : "›"}</button>{expanded && <div className="ws-current-pr-details"><span>Review: {readableStatus(pullRequest.review.state)}</span><span>Checks: {pullRequest.checks.passedCount} passed · {pullRequest.checks.pendingCount} pending · {pullRequest.checks.failedCount} failed</span><span>Merge: {readableStatus(pullRequest.mergeability.state)}</span></div>}</article>;
}

export function WorkingTreeDiff({ patch }: { patch: string }) {
  const [view, setView] = useState<"unified" | "split">("unified");
  const files = useMemo(() => parseDiff(patch, { nearbySequences: "zip" }), [patch]);
  return <><div className="ws-diff-toolbar" role="group" aria-label="Diff view"><button type="button" className={view === "unified" ? "ws-diff-view-selected" : ""} onClick={() => setView("unified")}>Unified</button><button type="button" className={view === "split" ? "ws-diff-view-selected" : ""} onClick={() => setView("split")}>Split</button></div><div className="ws-review-diff">{files.map((file) => <Diff key={`${file.oldRevision}:${file.newRevision}`} viewType={view} diffType={file.type} hunks={file.hunks} optimizeSelection>{(hunks) => hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)}</Diff>)}</div></>;
}

const stackStatusIcon: Record<"merged" | "closed" | "draft" | "blocked" | "open", IconName> = { merged: "Check", closed: "X", draft: "Circle", blocked: "X", open: "GitPullRequest" };

export function StackBranchRow({ branch, signals, expanded, checkingOut, onToggle, onCheckout }: { branch: GitHubStackBranch; signals?: StackBranchSignals; expanded: boolean; checkingOut: boolean; onToggle(): void; onCheckout(): void }) {
  const pr = branch.pr;
  const title = pr?.title ?? branch.name;
  const fileCount = branch.diff?.files.length ?? 0;
  const status = branch.isMerged ? "merged" : (pr?.state ?? signals?.state) === "closed" ? "closed" : (pr?.isDraft ?? signals?.draft) ? "draft" : branch.needsRebase ? "blocked" : "open";
  const label = branch.isMerged ? "Merged" : pr?.state === "closed" ? "Closed" : pr?.isDraft ? "Draft" : branch.needsRebase ? "Blocked" : "Open";
  return <li className={`ws-stack-layer-item ${branch.isCurrent ? "ws-stack-current" : ""} ${expanded ? "ws-stack-expanded" : ""}`}><div className="ws-stack-layer"><span className={`ws-stack-state-icon ws-stack-node-${status}`} title={label} aria-label={label}><Icon name={stackStatusIcon[status]} aria-hidden /></span><span className="ws-stack-layer-toggle"><strong>{pr ? `#${pr.number} ` : ""}{title}</strong><small><span className="ws-stack-subtitle-signals">{signals?.checks && <span className={`ws-stack-signal ws-stack-signal-${signals.checks}`} title={`Checks ${signals.checks}`}><Icon name={signals.checks === "passing" ? "Check" : signals.checks === "failed" ? "X" : signals.checks === "pending" ? "LoaderCircle" : "Circle"} aria-hidden /></span>}{signals?.review && <span className={`ws-stack-review ws-stack-signal-${signals.review}`} title={readableStatus(signals.review)}><Icon name={signals.review === "approved" ? "Check" : signals.review === "changes_requested" ? "Wrench" : signals.review === "review_requested" ? "User" : signals.review === "review_required" ? "Eye" : "Circle"} aria-hidden />{signals.reviewCommentCount ? <b>{signals.reviewCommentCount}</b> : null}</span>}</span>{branch.name}{branch.diff ? <> · <b>+{branch.diff.additions}</b> <i>−{branch.diff.deletions}</i></> : null}</small></span><span className="ws-stack-actions">{pr && <a className="ws-pr-tooltip" data-tooltip="Open on GitHub" href={pr.url} target="_blank" rel="noreferrer" aria-label={`Open pull request #${pr.number} on GitHub`}>↗</a>}<button type="button" className="ws-stack-checkout ws-pr-tooltip" data-tooltip={branch.isCurrent ? "Current branch" : `Check out ${branch.name}`} onClick={onCheckout} disabled={branch.isCurrent || checkingOut} aria-label={branch.isCurrent ? "Current branch" : `Check out ${branch.name}`}>{checkingOut ? "…" : "⇥"}</button>{fileCount > 0 && <button type="button" className="ws-stack-expand ws-pr-tooltip" data-tooltip={expanded ? "Hide changed files" : "Show changed files"} onClick={onToggle} aria-expanded={expanded} aria-label={`${expanded ? "Hide" : "Show"} changed files for ${branch.name}`}>{expanded ? "⌄" : "›"}</button>}</span></div>{expanded && branch.diff && <div className="ws-stack-files">{branch.diff.files.map((file) => <span key={file.path}><b className={`ws-file-${file.status}`}>{file.status[0]?.toUpperCase()}</b><em>{file.path}</em><small>{file.additions !== null ? `+${file.additions}` : ""} {file.deletions !== null ? `−${file.deletions}` : ""}</small></span>)}{branch.diff.truncated && <small className="ws-stack-files-truncated">Only the first {branch.diff.files.length} files are shown.</small>}</div>}</li>;
}
