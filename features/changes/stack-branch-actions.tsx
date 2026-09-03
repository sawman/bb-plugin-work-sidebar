import type { ReactElement } from "react";
import type { GitHubStackBranch } from "../../contracts.js";
import { Icon } from "../../components/ui/icon.js";
import { ActionTooltip } from "../../components/ui/action-tooltip.js";
import { PullRequestUrlLink } from "../pull-requests/pull-request-url-link.js";

type StackBranchActionsProps = {
  pullRequest: GitHubStackBranch["pr"];
  branchName: string;
  merged: boolean;
  current: boolean;
  checkingOut: boolean;
  hasDisclosure: boolean;
  expanded: boolean;
  filesLabel: string;
  externalOnModifier: boolean;
  onCheckout(): void;
  onToggle(): void;
};

export function StackBranchActions({
  pullRequest,
  branchName,
  merged,
  current,
  checkingOut,
  hasDisclosure,
  expanded,
  filesLabel,
  externalOnModifier,
  onCheckout,
  onToggle,
}: StackBranchActionsProps): ReactElement {
  const checkoutLabel = checkingOut
    ? `Checking out ${branchName}`
    : merged
      ? "Merged branch"
      : current
        ? "Current branch"
        : `Check out ${branchName}`;
  return (
    <span className="ws-stack-trailing-actions">
      <span className="ws-stack-action-slot">
        {pullRequest && (
          <ActionTooltip label="GitHub">
            {(tooltipId) => (
              <PullRequestUrlLink
                href={pullRequest.url}
                externalOnModifier={externalOnModifier}
                aria-label={`Open pull request #${pullRequest.number} on GitHub`}
                aria-describedby={tooltipId}
              >
                ↗
              </PullRequestUrlLink>
            )}
          </ActionTooltip>
        )}
      </span>
      <span className="ws-stack-action-slot">
        <ActionTooltip label={checkoutLabel}>
          {(tooltipId) => (
            <button
              type="button"
              className="ws-stack-checkout"
              onClick={onCheckout}
              disabled={merged || current || checkingOut}
              aria-label={checkoutLabel}
              aria-describedby={tooltipId}
            >
              {checkingOut ? "…" : "⇥"}
            </button>
          )}
        </ActionTooltip>
      </span>
      <span className="ws-stack-action-slot">
        {hasDisclosure && (
          <ActionTooltip label={filesLabel}>
            {(tooltipId) => (
              <button
                type="button"
                className="ws-stack-expand"
                aria-label={filesLabel}
                aria-describedby={tooltipId}
                aria-expanded={expanded}
                data-state={expanded ? "open" : "closed"}
                onClick={onToggle}
              >
                <Icon
                  className="ws-changes-disclosure-icon"
                  name={expanded ? "ChevronDown" : "ChevronRight"}
                />
              </button>
            )}
          </ActionTooltip>
        )}
      </span>
    </span>
  );
}
