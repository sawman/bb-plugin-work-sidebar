import { Icon } from "./icon";
import type { IconName } from "./icon";
import { ActionTooltip } from "./action-tooltip";

export type StatusPresentation = {
  icon: IconName;
  label: string;
  tone:
    | "open"
    | "draft"
    | "closed"
    | "merged"
    | "success"
    | "destructive"
    | "warning"
    | "muted";
  overlayIcon?: IconName;
  count?: number;
  reviewCommentCounts?: {
    unresolved: number;
    resolved: number;
  };
};

function reviewCommentCountLabel(count: number, resolution: string): string {
  return `${count} ${resolution} review comment${count === 1 ? "" : "s"}`;
}

export function Status({
  presentation,
  className,
  size = "default",
}: {
  presentation: StatusPresentation;
  className?: string;
  size?: "default" | "metadata";
}) {
  const countLabel = presentation.count
    ? `, ${presentation.count} review comment${presentation.count === 1 ? "" : "s"}`
    : "";
  const breakdownLabel = presentation.reviewCommentCounts
    ? `, ${reviewCommentCountLabel(presentation.reviewCommentCounts.unresolved, "unresolved")}, ${reviewCommentCountLabel(presentation.reviewCommentCounts.resolved, "resolved")}`
    : "";
  return (
    <ActionTooltip label={presentation.label}>
      {(tooltipId) => (
        <span
          className={["ws-status", className].filter(Boolean).join(" ")}
          data-size={size === "metadata" ? size : undefined}
          data-tone={presentation.tone}
          data-motion={presentation.icon === "LoaderCircle" ? "spin" : undefined}
          aria-describedby={tooltipId}
          role="img"
          aria-label={`${presentation.label}${breakdownLabel || countLabel}`}
        >
          <Icon name={presentation.icon} aria-hidden />
          {presentation.overlayIcon && (
            <Icon name={presentation.overlayIcon} aria-hidden />
          )}
          {presentation.count ? <b aria-hidden>{presentation.count}</b> : null}
          {presentation.reviewCommentCounts ? (
            <span className="ws-status-review-counts" aria-hidden>
              <span data-resolution="unresolved">
                <Icon name="MessageSquare" aria-hidden />
                <span>{presentation.reviewCommentCounts.unresolved}</span>
              </span>
              <span data-resolution="resolved">
                <Icon name="Check" aria-hidden />
                <span>{presentation.reviewCommentCounts.resolved}</span>
              </span>
            </span>
          ) : null}
        </span>
      )}
    </ActionTooltip>
  );
}
