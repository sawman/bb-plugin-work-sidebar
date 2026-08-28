import { useId, useState, type ReactNode } from "react";
import { Icon } from "../../components/ui/icon";
import { Status } from "../../components/ui/status";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuInfo,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../../components/ui/context-menu";
import {
  pullRequestPresentation,
  pullRequestSignalPresentation,
  type PullRequestSignal,
} from "./presentation";
import { orderStackLayers, type SidebarStack } from "../../work-model";
import { PullRequestIdentifierBadge } from "./identifier-badge";
import { StackNumberBadge } from "./stack-number";
import { ThreadProviderLogo } from "../../components/threads/thread-provider-logo";
import {
  linkedThreadForStack,
  type PullRequestThreadReference,
} from "./thread-link";

export type AuthoredPullRequest = {
  number: number;
  title: string;
  url: string;
  repository: string;
  state: "open" | "draft";
  draft: boolean;
  head: string;
  base: string;
  checks: PullRequestSignal["checks"];
  review: PullRequestSignal["review"];
  requestedReviewers?: string[];
  reviewCommentCount: number;
  stack: SidebarStack | null;
};
type AuthoredRow = Omit<AuthoredPullRequest, "stack">;

export function AuthoredPullRequestRow({
  pullRequest,
  stackControl,
  stackNumber,
  linkedThread,
  changingDraft,
  onOpenPullRequest,
  onOpenThread,
  onToggleDraft,
}: {
  pullRequest: AuthoredRow;
  stackControl?: ReactNode;
  stackNumber?: number | null;
  linkedThread?: PullRequestThreadReference;
  changingDraft: boolean;
  onOpenPullRequest?(url: string): void;
  onOpenThread?(threadId: string): void;
  onToggleDraft(pullRequest: AuthoredRow): void;
}) {
  const threadTooltipId = useId();
  const signal = pullRequestSignalPresentation(pullRequest);
  const state = pullRequestPresentation({
    state: pullRequest.state,
    draft: pullRequest.draft,
  });
  const stateAction = pullRequest.draft ? "Mark open" : "Mark draft";
  const reviewers = pullRequest.requestedReviewers?.filter(Boolean) ?? [];
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <article className="ws-pr-row ws-pr-compact-row ws-sidebar-row">
          <span className="ws-pr-stack-slot">{stackControl}</span>
          <div className="ws-pr-target ws-sidebar-row-main">
            <a
              className="ws-pr-target-title ws-sidebar-row-title"
              href={pullRequest.url}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open pull request #${pullRequest.number}: ${pullRequest.title}`}
            >
              {pullRequest.title}
            </a>
            <span className="ws-pr-context ws-pr-target-context ws-sidebar-row-meta">
              <ContextMenuTrigger asChild>
                <PullRequestIdentifierBadge
                  kind="pull-request"
                  number={pullRequest.number}
                  presentation={state}
                />
              </ContextMenuTrigger>
              {stackNumber != null && <StackNumberBadge number={stackNumber} />}
              <PullRequestIdentifierBadge kind="branch" name={pullRequest.head} />
            </span>
          </div>
          <span className="ws-pr-status-icons ws-sidebar-row-trailing">
            {linkedThread && onOpenThread ? (
              <button
                type="button"
                className="ws-pr-thread-provider-link"
                aria-label={`Open linked thread ${linkedThread.title}`}
                aria-describedby={threadTooltipId}
                onClick={() => onOpenThread(linkedThread.id)}
              >
                <ThreadProviderLogo
                  providerId={linkedThread.providerId}
                  provider={linkedThread.provider}
                  title={null}
                />
                <span
                  className="ws-pr-thread-tooltip"
                  id={threadTooltipId}
                  role="tooltip"
                >
                  {linkedThread.title}
                </span>
              </button>
            ) : null}
            <Status presentation={signal.checks} />
            <Status presentation={signal.review} />
          </span>
        </article>
      </ContextMenuTrigger>
      <ContextMenuContent
        aria-label={`Actions for pull request #${pullRequest.number}`}
      >
        <ContextMenuLabel>PR #{pullRequest.number}</ContextMenuLabel>
        {onOpenPullRequest ? (
          <ContextMenuItem onSelect={() => onOpenPullRequest(pullRequest.url)}>
            Open pull request
          </ContextMenuItem>
        ) : null}
        {linkedThread && onOpenThread ? (
          <ContextMenuItem onSelect={() => onOpenThread(linkedThread.id)}>
            Open linked thread
          </ContextMenuItem>
        ) : null}
        <ContextMenuItem
          disabled={changingDraft}
          onSelect={() => onToggleDraft(pullRequest)}
        >
          {changingDraft ? "Updating…" : stateAction}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuInfo>CI: {signal.checks.label}</ContextMenuInfo>
        <ContextMenuInfo>Review: {signal.review.label}</ContextMenuInfo>
        <ContextMenuInfo>
          Reviewers: {reviewers.length > 0 ? reviewers.join(", ") : "None requested"}
        </ContextMenuInfo>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function AuthoredPullRequestStack({
  stack,
  changingDraftUrl,
  onOpenPullRequest,
  onOpenThread,
  onToggleDraft,
  threadsByBranch,
}: {
  stack: SidebarStack;
  changingDraftUrl: string | null;
  onOpenPullRequest?(url: string): void;
  onOpenThread?(threadId: string): void;
  onToggleDraft(pullRequest: AuthoredRow): void;
  threadsByBranch?: ReadonlyMap<string, PullRequestThreadReference>;
}) {
  const [expanded, setExpanded] = useState(false);
  const layers = orderStackLayers(stack.pullRequests, stack.base);
  const base = layers[0];
  if (!base) return null;
  const linkedThread = threadsByBranch
    ? linkedThreadForStack(layers, threadsByBranch)
    : undefined;
  const row = (
    layer: SidebarStack["pullRequests"][number],
    stackControl?: ReactNode,
    stackNumber?: number | null,
    promotedThread?: PullRequestThreadReference,
  ) => (
    <AuthoredPullRequestRow
      key={layer.number}
      stackControl={stackControl}
      stackNumber={stackNumber}
      linkedThread={promotedThread}
      changingDraft={changingDraftUrl === layer.url}
      onOpenPullRequest={onOpenPullRequest}
      onOpenThread={onOpenThread}
      onToggleDraft={onToggleDraft}
      pullRequest={{
        ...layer,
        repository: "",
        state: layer.draft ? "draft" : "open",
        checks: layer.checks ?? "unknown",
        review: layer.review ?? "none",
        requestedReviewers: layer.requestedReviewers,
        reviewCommentCount: layer.reviewCommentCount ?? 0,
      }}
    />
  );
  return (
    <section
      className={`ws-pr-stack ${expanded ? "ws-pr-stack-open" : "ws-pr-stack-closed"}`}
      aria-label={`Stack rooted at ${stack.base}`}
    >
      {row(
        base,
        layers.length > 1 ? (
          <button
            type="button"
            className="ws-pr-stack-disclosure"
            data-state={expanded ? "open" : "closed"}
            aria-expanded={expanded}
            aria-label={`${expanded ? "Collapse" : "Expand"} stack layers`}
            onClick={() => setExpanded((value) => !value)}
          >
            ›
          </button>
        ) : undefined,
        stack.number,
        linkedThread,
      )}
      {expanded &&
        layers.slice(1).map((layer) => (
          <div className="ws-pr-stack-layer-item" key={layer.number}>
            {row(layer)}
          </div>
        ))}
    </section>
  );
}
