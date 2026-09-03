import { useId, type ReactNode } from "react";

/** Tooltip copy must remain a brief control hint, not secondary UI text. */
export const MAX_TOOLTIP_LABEL_LENGTH = 40;

export function compactTooltipLabel(label: string) {
  const normalized = label.replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_TOOLTIP_LABEL_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_TOOLTIP_LABEL_LENGTH - 1).trimEnd()}…`;
}

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
  const tooltipLabel = compactTooltipLabel(label);
  return (
    <span className="ws-action-tooltip">
      {children(tooltipId)}
      <span
        id={tooltipId}
        aria-label={semantic ? tooltipLabel : undefined}
        className="ws-action-tooltip-content"
        data-tooltip-label={tooltipLabel}
        role={semantic ? "tooltip" : undefined}
      />
    </span>
  );
}
