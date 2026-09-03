import { useRef, useState, type ReactNode } from "react";
import { Icon } from "../../components/ui/icon";
import { BbUrlLink } from "../../components/ui/url-link";
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
  pullRequestAttentionFromSignal,
  pullRequestPresentation,
  pullRequestSignalPresentation,
  type PullRequestSignal,
} from "./presentation";
import { orderStackLayers, type SidebarStack } from "../../work-model";
import { PullRequestIdentifierBadge } from "./identifier-badge";
import { StackNumberBadge } from "./stack-number";
import { ThreadProviderLogo } from "../../components/threads/thread-provider-logo";
import { ActionTooltip } from "../../components/ui/action-tooltip";
import {
  linkedThreadForStack,
  type PullRequestThreadReference,
} from "./thread-link";
import { PullRequestReviewerPicker } from "./reviewer-picker";
import type { PullRequestRpc } from "./queries";

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
type AuthoredRow = Omit<AuthoredPullRequest, "stack"> & {
  attention?: string | null;
};

export function AuthoredPullRequestRow({
  pullRequest,
  stackControl,
  stackNumber,
  linkedThread,
  changingDraft,
  onOpenPullRequest,
  onOpenThread,
  onToggleDraft,
  rpc,
}: {
  pullRequest: AuthoredRow;
  stackControl?: ReactNode;
  stackNumber?: number | null;
  linkedThread?: PullRequestThreadReference;
  changingDraft: boolean;
  onOpenPullRequest?(url: string): void;
  onOpenThread?(threadId: string): void;
  onToggleDraft(pullRequest: AuthoredRow): void;
  rpc?: PullRequestRpc;
}) {
  const reviewerTriggerRef = useRef<HTMLButtonElement>(null);
  const [reviewerPickerOpen, setReviewerPickerOpen] = useState(false);
  const signal = pullRequestSignalPresentation(pullRequest);
  const state = pullRequestPresentation({
    state: pullRequest.state,
    draft: pullRequest.draft,
    attention:
      pullRequest.attention ?? pullRequestAttentionFromSignal(pullRequest),
  });
  const stateAction = pullRequest.draft ? "Mark open" : "Mark draft";
  const reviewers = pullRequest.requestedReviewers?.filter(Boolean) ?? [];
  return (
    <>
      <ContextMenu>
      <ContextMenuTrigger asChild>
        <article className="ws-pr-row ws-pr-compact-row ws-sidebar-row">
          <span className="ws-pr-stack-slot">{stackControl}</span>
          <div className="ws-pr-target ws-sidebar-row-main">
            <BbUrlLink
              className="ws-pr-target-title ws-sidebar-row-title"
              href={pullRequest.url}
              aria-label={`Open pull request #${pullRequest.number}: ${pullRequest.title}`}
              onClick={(event) => {
                if (
                  !onOpenPullRequest ||
                  event.defaultPrevented ||
                  event.button !== 0 ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
                )
                  return;
                event.preventDefault();
                onOpenPullRequest(pullRequest.url);
              }}
            >
              {pullRequest.title}
            </BbUrlLink>
            <span className="ws-pr-context ws-pr-target-context ws-sidebar-row-meta">
              <ContextMenuTrigger asChild>
                <PullRequestIdentifierBadge
                  kind="pull-request"
                  number={pullRequest.number}
                  presentation={state}
                />
              </ContextMenuTrigger>
              {stackNumber != null && <StackNumberBadge number={stackNumber} />}
              <PullRequestIdentifierBadge
                kind="branch"
                name={pullRequest.head}
              />
            </span>
          </div>
          <span className="ws-pr-status-icons ws-sidebar-row-trailing">
            {linkedThread && onOpenThread ? (
              <ActionTooltip label={`Open ${linkedThread.title}`}>
                {(tooltipId) => (
                  <button
                    type="button"
                    className="ws-pr-thread-provider-link"
                    aria-label={`Open linked thread ${linkedThread.title}`}
                    aria-describedby={tooltipId}
                    onClick={() => onOpenThread(linkedThread.id)}
                  >
                    <ThreadProviderLogo
                      providerId={linkedThread.providerId}
                      provider={linkedThread.provider}
                      title={null}
                      tooltip={false}
                    />
                  </button>
                )}
              </ActionTooltip>
            ) : null}
            <Status presentation={signal.checks} />
            {rpc && pullRequest.repository ? (
              <button
                ref={reviewerTriggerRef}
                type="button"
                className="ws-pr-reviewer-trigger"
                aria-label={`Manage reviewers: ${signal.review.label}`}
                aria-haspopup="dialog"
                aria-expanded={reviewerPickerOpen}
                onClick={() => setReviewerPickerOpen(true)}
              >
                <Status presentation={signal.review} />
              </button>
            ) : (
              <Status presentation={signal.review} />
            )}
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
        {rpc && pullRequest.repository ? (
          <ContextMenuItem onSelect={() => setReviewerPickerOpen(true)}>
            Request reviewers…
          </ContextMenuItem>
        ) : null}
        <ContextMenuSeparator />
        <ContextMenuInfo>CI: {signal.checks.label}</ContextMenuInfo>
        <ContextMenuInfo>Review: {signal.review.label}</ContextMenuInfo>
        {!rpc ? (
          <ContextMenuInfo>
            Reviewers:{" "}
            {reviewers.length > 0 ? reviewers.join(", ") : "None requested"}
          </ContextMenuInfo>
        ) : null}
      </ContextMenuContent>
      </ContextMenu>
      {reviewerPickerOpen && rpc ? (
        <PullRequestReviewerPicker
          rpc={rpc}
          repository={pullRequest.repository}
          number={pullRequest.number}
          title={pullRequest.title}
          requestedReviewers={reviewers}
          anchorRef={reviewerTriggerRef}
          onClose={() => setReviewerPickerOpen(false)}
        />
      ) : null}
    </>
  );
}

export function AuthoredPullRequestStack({
  stack,
  changingDraftUrl,
  onOpenPullRequest,
  onOpenThread,
  onToggleDraft,
  threadsByBranch,
  repository = "",
  rpc,
}: {
  stack: SidebarStack;
  changingDraftUrl: string | null;
  onOpenPullRequest?(url: string): void;
  onOpenThread?(threadId: string): void;
  onToggleDraft(pullRequest: AuthoredRow): void;
  threadsByBranch?: ReadonlyMap<string, PullRequestThreadReference>;
  repository?: string;
  rpc?: PullRequestRpc;
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
      rpc={rpc}
      pullRequest={{
        ...layer,
        repository,
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
