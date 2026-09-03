import type { HTMLAttributes } from "react";
import { BranchName } from "../../components/ui/branch-name";
import { CopyBadge } from "../../components/ui/copy-badge";
import { Icon } from "../../components/ui/icon";
import type { StatusPresentation } from "../../components/ui/status";

type PullRequestIdentifier =
  | {
      kind: "pull-request";
      number: number;
      url: string;
      presentation?: StatusPresentation;
      reviewDetail?: string;
    }
  | { kind: "branch"; name: string };

type PullRequestIdentifierProps = PullRequestIdentifier & {
  onContextMenu?: HTMLAttributes<HTMLSpanElement>["onContextMenu"];
  onKeyDown?: HTMLAttributes<HTMLSpanElement>["onKeyDown"];
};

/**
 * Badge tooltip copy is a one-to-one explanation of the visual state. Review
 * identities are useful only when that review state is what the badge shows.
 */
export function pullRequestBadgeTooltip(
  presentation?: StatusPresentation,
  reviewDetail?: string,
) {
  if (!presentation) return reviewDetail ?? "Pull request";
  const matchingReviewPrefix: Partial<Record<StatusPresentation["label"], string>> = {
    "Review requested": "Review:",
    "Changes requested": "Changes:",
    "Ready to merge": "Approved:",
    Approved: "Approved:",
  };
  const prefix = matchingReviewPrefix[presentation.label];
  return prefix && reviewDetail?.startsWith(prefix)
    ? reviewDetail
    : presentation.label;
}

export function PullRequestIdentifierBadge(
  identifier: PullRequestIdentifierProps,
) {
  if (identifier.kind === "branch") {
    return (
      <BranchName name={identifier.name} className="ws-pr-identifier-badge" />
    );
  }
  const value = `#${identifier.number}`;
  const stateLabel = pullRequestBadgeTooltip(
    identifier.presentation,
    identifier.reviewDetail,
  );

  return (
    <CopyBadge
      value={value}
      copyValue={identifier.url}
      label="PR number"
      className="ws-pr-identifier-badge ws-pr-number-badge"
      title={stateLabel}
      tone={identifier.presentation?.tone}
      aria-haspopup={identifier.onContextMenu ? "menu" : undefined}
      onContextMenu={identifier.onContextMenu}
      onKeyDown={identifier.onKeyDown}
    >
      <Icon
        name={identifier.presentation?.icon ?? "GitPullRequest"}
        data-motion={
          identifier.presentation?.icon === "LoaderCircle" ? "spin" : undefined
        }
        aria-hidden
      />
      <span>{value}</span>
    </CopyBadge>
  );
}
