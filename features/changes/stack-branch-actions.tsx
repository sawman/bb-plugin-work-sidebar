import type { ReactElement } from "react";
import type { GitHubStackBranch } from "../../contracts.js";
import { Icon } from "../../components/ui/icon.js";

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
          <a
            className="ws-pr-tooltip"
            data-tooltip="Open on GitHub"
            href={pullRequest.url}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open pull request #${pullRequest.number} on GitHub`}
          >
            ↗
          </a>
        )}
      </span>
      <span className="ws-stack-action-slot">
        <button
          type="button"
          className="ws-stack-checkout ws-pr-tooltip"
          data-tooltip={checkoutLabel}
          onClick={onCheckout}
          disabled={merged || current || checkingOut}
          aria-label={checkoutLabel}
        >
          {checkingOut ? "…" : "⇥"}
        </button>
      </span>
      <span className="ws-stack-action-slot">
        {hasDisclosure && (
          <button
            type="button"
            className="ws-stack-expand ws-pr-tooltip"
            data-tooltip={filesLabel}
            aria-label={filesLabel}
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
      </span>
    </span>
  );
}
