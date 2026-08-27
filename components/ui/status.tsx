import { Icon } from "./icon";
import type { IconName } from "./icon";

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
}: {
  presentation: StatusPresentation;
  className?: string;
}) {
  const countLabel = presentation.count
    ? `, ${presentation.count} review comment${presentation.count === 1 ? "" : "s"}`
    : "";
  return (
    <span
      className={["ws-status", className].filter(Boolean).join(" ")}
      data-tone={presentation.tone}
      title={presentation.label}
      role="img"
      aria-label={`${presentation.label}${countLabel}`}
    >
      <Icon name={presentation.icon} aria-hidden />
      {presentation.overlayIcon && (
        <Icon name={presentation.overlayIcon} aria-hidden />
      )}
      {presentation.count ? <b aria-hidden>{presentation.count}</b> : null}
    </span>
  );
}
