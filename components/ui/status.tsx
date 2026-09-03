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
};

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
  return (
    <ActionTooltip label={presentation.label}>
      {(tooltipId) => <span
      className={["ws-status", className].filter(Boolean).join(" ")}
      data-size={size === "metadata" ? size : undefined}
      data-tone={presentation.tone}
      data-motion={presentation.icon === "LoaderCircle" ? "spin" : undefined}
      aria-describedby={tooltipId}
      role="img"
      aria-label={`${presentation.label}${countLabel}`}
    >
      <Icon name={presentation.icon} aria-hidden />
      {presentation.overlayIcon && (
        <Icon name={presentation.overlayIcon} aria-hidden />
      )}
      {presentation.count ? <b aria-hidden>{presentation.count}</b> : null}
      </span>}
    </ActionTooltip>
  );
}
