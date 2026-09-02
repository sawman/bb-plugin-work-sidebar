import { useId, type ReactNode } from "react";

/**
 * A compact rendered tooltip. The caller attaches the returned id to its
 * control or labelled content with `aria-describedby`; native `title`
 * tooltips are deliberately avoided because they are not reliable in BB.
 */
export function ActionTooltip({
  label,
  children,
  semantic = true,
}: {
  label: string;
  children(tooltipId: string): ReactNode;
  /** Tablists cannot own a tooltip role; the described rendered text remains. */
  semantic?: boolean;
}) {
  const tooltipId = useId();
  return (
    <span className="ws-action-tooltip">
      {children(tooltipId)}
      <span
        id={tooltipId}
        aria-label={semantic ? label : undefined}
        className="ws-action-tooltip-content"
        data-tooltip-label={label}
        role={semantic ? "tooltip" : undefined}
      />
    </span>
  );
}
