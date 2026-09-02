import { useId, type ReactNode } from "react";

/**
 * A compact rendered tooltip for an icon-only action. The caller attaches the
 * returned id to its focusable control with `aria-describedby`.
 */
export function ActionTooltip({
  label,
  children,
}: {
  label: string;
  children(tooltipId: string): ReactNode;
}) {
  const tooltipId = useId();
  return (
    <span className="ws-action-tooltip">
      {children(tooltipId)}
      <span id={tooltipId} className="ws-action-tooltip-content" role="tooltip">
        {label}
      </span>
    </span>
  );
}
