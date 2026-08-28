import { useState, type ReactNode } from "react";
import { Icon } from "../../components/ui/icon";
import { Status } from "../../components/ui/status";
import {
  pullRequestPresentation,
  pullRequestSignalPresentation,
  type PullRequestSignal,
} from "./presentation";
import { orderStackLayers, type SidebarStack } from "../../work-model";
import { PullRequestIdentifierBadge } from "./identifier-badge";
import { StackNumberBadge } from "./stack-number";

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
  reviewCommentCount: number;
  stack: SidebarStack | null;
};
type AuthoredRow = Omit<AuthoredPullRequest, "stack">;

export function AuthoredPullRequestRow({
  pullRequest,
  stackControl,
  stackNumber,
  changingDraft,
  onToggleDraft,
}: {
  pullRequest: AuthoredRow;
  stackControl?: ReactNode;
  stackNumber?: number | null;
  changingDraft: boolean;
  onToggleDraft(pullRequest: AuthoredRow): void;
}) {
  const signal = pullRequestSignalPresentation(pullRequest);
  const state = pullRequestPresentation({
    state: pullRequest.state,
    draft: pullRequest.draft,
  });
  return (
    <article className="ws-pr-row ws-pr-compact-row">
      <span className="ws-pr-stack-slot">{stackControl}</span>
      <a
        className="ws-pr-target"
        href={pullRequest.url}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open pull request #${pullRequest.number}: ${pullRequest.title}`}
      >
        <span className="ws-pr-title ws-pr-target-title">
          {pullRequest.title}
        </span>
        <span className="ws-pr-context ws-pr-target-context">
          {stackNumber != null && <StackNumberBadge number={stackNumber} />}
          <PullRequestIdentifierBadge
            kind="pull-request"
            number={pullRequest.number}
          />
          <PullRequestIdentifierBadge kind="branch" name={pullRequest.head} />
        </span>
      </a>
      <span className="ws-pr-status-icons">
        <button
          type="button"
          className="ws-pr-state-toggle ws-pr-tooltip"
          data-tooltip={
            changingDraft
              ? "Updating…"
              : `${pullRequest.draft ? "Mark open" : "Mark draft"}`
          }
          disabled={changingDraft}
          aria-label={
            changingDraft
              ? "Updating pull request state"
              : `${pullRequest.draft ? "Mark open" : "Mark draft"}`
          }
          onClick={() => onToggleDraft(pullRequest)}
        >
          <Status
            presentation={
              changingDraft
                ? {
                    ...state,
                    icon: "LoaderCircle",
                    label: "Updating pull request state",
                  }
                : state
            }
          />
        </button>
        <Status presentation={signal.checks} />
        <Status presentation={signal.review} />
      </span>
    </article>
  );
}

export function AuthoredPullRequestStack({
  stack,
  changingDraftUrl,
  onToggleDraft,
}: {
  stack: SidebarStack;
  changingDraftUrl: string | null;
  onToggleDraft(pullRequest: AuthoredRow): void;
}) {
  const [expanded, setExpanded] = useState(false);
  const layers = orderStackLayers(stack.pullRequests, stack.base);
  const base = layers[0];
  if (!base) return null;
  const row = (
    layer: SidebarStack["pullRequests"][number],
    stackControl?: ReactNode,
    stackNumber?: number | null,
  ) => (
    <AuthoredPullRequestRow
      key={layer.number}
      stackControl={stackControl}
      stackNumber={stackNumber}
      changingDraft={changingDraftUrl === layer.url}
      onToggleDraft={onToggleDraft}
      pullRequest={{
        ...layer,
        repository: "",
        state: layer.draft ? "draft" : "open",
        checks: layer.checks ?? "unknown",
        review: layer.review ?? "none",
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
