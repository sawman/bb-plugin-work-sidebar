import type { ReactElement } from "react";
import type { GitHubStackBranch } from "../../contracts.js";
import { Icon } from "../../components/ui/icon.js";
import { ActionTooltip } from "../../components/ui/action-tooltip.js";
import { BbUrlLink } from "../../components/ui/url-link.js";

type StackBranchActionsProps = {
  pullRequest: GitHubStackBranch["pr"];
  branchName: string;
  merged: boolean;
  current: boolean;
  checkingOut: boolean;
  hasDisclosure: boolean;
  expanded: boolean;
  filesLabel: string;
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
              <BbUrlLink
                href={pullRequest.url}
                aria-label={`Open pull request #${pullRequest.number} on GitHub`}
                aria-describedby={tooltipId}
              >
                ↗
              </BbUrlLink>
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
