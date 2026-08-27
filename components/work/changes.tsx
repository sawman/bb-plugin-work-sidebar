import { useMemo, useState } from "react";
import { Diff, Hunk, parseDiff } from "react-diff-view";
import type { GitHubStackBranch, GitHubStackSignal } from "../../contracts";
import { Icon } from "../ui/icon";
import { Status } from "../ui/status";
import { normalizePullRequestSignal, pullRequestPresentation, pullRequestSignalPresentation, type PullRequestSignal } from "../../features/pull-requests/presentation";
import type { CurrentPullRequestView } from "../../work-model";

export type StackBranchSignals = Pick<GitHubStackSignal, "state" | "draft" | "checks" | "review" | "reviewCommentCount">;

function readableStatus(status: string): string {
  return status.replaceAll("-", " ").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function CurrentPullRequestCard({ pullRequest, expanded, onToggle }: { pullRequest: CurrentPullRequestView; expanded: boolean; onToggle(): void }) {
  const signal = pullRequestSignalPresentation(pullRequest.signal);
  const status = pullRequestPresentation({ state: pullRequest.state, draft: pullRequest.state === "draft", attention: pullRequest.attention });
  return <article className="ws-current-pr-card"><div className="ws-current-pr-summary"><Status presentation={status} /><span><strong>#{pullRequest.number} {pullRequest.title}</strong><small>{pullRequest.head} · {readableStatus(pullRequest.review.state)} · {pullRequest.checks.passedCount}/{pullRequest.checks.totalCount} checks</small></span><span className="ws-current-pr-signals" aria-label="Pull request signals"><Status presentation={signal.checks} /><Status presentation={signal.review} /></span></div><a className="ws-current-pr-open ws-pr-tooltip" data-tooltip="Open on GitHub" href={pullRequest.url} target="_blank" rel="noreferrer" aria-label={`Open pull request #${pullRequest.number} on GitHub`}>↗</a><button type="button" className="ws-current-pr-expand ws-pr-tooltip" data-tooltip={expanded ? "Hide PR details" : "Show PR details"} onClick={onToggle} aria-expanded={expanded} aria-label={`${expanded ? "Hide" : "Show"} details for pull request #${pullRequest.number}`}>{expanded ? "⌄" : "›"}</button>{expanded && <div className="ws-current-pr-details"><span>Review: {signal.review.label}</span><span>Checks: {pullRequest.checks.passedCount} passed · {pullRequest.checks.pendingCount} pending · {pullRequest.checks.failedCount} failed</span><span>Merge: {readableStatus(pullRequest.mergeability.state)}</span></div>}</article>;
}

export function WorkingTreeDiff({ patch }: { patch: string }) {
  const [view, setView] = useState<"unified" | "split">("unified");
  const files = useMemo(() => parseDiff(patch, { nearbySequences: "zip" }), [patch]);
  return <><div className="ws-diff-toolbar" role="group" aria-label="Diff view"><button type="button" className={view === "unified" ? "ws-diff-view-selected" : ""} onClick={() => setView("unified")}>Unified</button><button type="button" className={view === "split" ? "ws-diff-view-selected" : ""} onClick={() => setView("split")}>Split</button></div><div className="ws-review-diff">{files.map((file) => <Diff key={`${file.oldRevision}:${file.newRevision}`} viewType={view} diffType={file.type} hunks={file.hunks} optimizeSelection>{(hunks) => hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)}</Diff>)}</div></>;
}

export function StackBranchRow({ branch, signals, expanded, checkingOut, onToggle, onCheckout }: { branch: GitHubStackBranch; signals?: StackBranchSignals; expanded: boolean; checkingOut: boolean; onToggle(): void; onCheckout(): void }) {
  const pr = branch.pr;
  const title = pr?.title ?? branch.name;
  const fileCount = branch.diff?.files.length ?? 0;
  const merged = branch.isMerged || (pr?.state ?? signals?.state ?? "").toLowerCase() === "merged";
  const status = merged ? "merged" : (pr?.state ?? signals?.state) === "closed" ? "closed" : (pr?.isDraft ?? signals?.draft) ? "draft" : branch.needsRebase ? "blocked" : "open";
  const signal: PullRequestSignal | null = signals ? normalizePullRequestSignal({ checks: signals.checks ?? "unknown", review: signals.review ?? "none", reviewCommentCount: signals.reviewCommentCount }) : null;
  const presented = signal ? pullRequestSignalPresentation(signal) : null;
  const statePresentation = pullRequestPresentation({ state: status === "blocked" ? "open" : status, draft: status === "draft", mergedLayer: merged, attention: branch.needsRebase ? "blocked" : undefined });
  return <li className={`ws-stack-layer-item ${branch.isCurrent ? "ws-stack-current" : ""} ${merged ? "ws-stack-merged" : ""} ${expanded ? "ws-stack-expanded" : ""}`}><div className="ws-stack-layer"><Status presentation={statePresentation} className="ws-stack-state-icon" /><span className="ws-stack-layer-toggle"><strong>{pr ? `#${pr.number} ` : ""}{title}</strong><small><span className="ws-stack-subtitle-signals">{presented && <><Status presentation={presented.checks} /><Status presentation={presented.review} /></>}</span>{branch.name}{branch.diff ? <> · <b>+{branch.diff.additions}</b> <i>−{branch.diff.deletions}</i></> : null}</small></span><span className="ws-stack-actions">{pr && <a className="ws-pr-tooltip" data-tooltip="Open on GitHub" href={pr.url} target="_blank" rel="noreferrer" aria-label={`Open pull request #${pr.number} on GitHub`}>↗</a>}<button type="button" className="ws-stack-checkout ws-pr-tooltip" data-tooltip={merged ? "Merged branch" : branch.isCurrent ? "Current branch" : `Check out ${branch.name}`} onClick={onCheckout} disabled={merged || branch.isCurrent || checkingOut} aria-label={merged ? "Merged branch" : branch.isCurrent ? "Current branch" : `Check out ${branch.name}`}>{checkingOut ? "…" : "⇥"}</button>{fileCount > 0 && <button type="button" className="ws-stack-expand ws-pr-tooltip" data-tooltip={expanded ? "Hide changed files" : "Show changed files"} onClick={onToggle} aria-expanded={expanded} aria-label={`${expanded ? "Hide" : "Show"} changed files for ${branch.name}`}>{expanded ? "⌄" : "›"}</button>}</span></div>{expanded && branch.diff && <div className="ws-stack-files">{branch.diff.files.map((file) => <span key={file.path}><b className={`ws-file-${file.status}`}>{file.status[0]?.toUpperCase()}</b><em>{file.path}</em><small>{file.additions !== null ? `+${file.additions}` : ""} {file.deletions !== null ? `−${file.deletions}` : ""}</small></span>)}{branch.diff.truncated && <small className="ws-stack-files-truncated">Only the first {branch.diff.files.length} files are shown.</small>}</div>}</li>;
}
