import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

/** Tooltip copy must remain a brief control hint, not secondary UI text. */
export const MAX_TOOLTIP_LABEL_LENGTH = 40;

export function compactTooltipLabel(label: string) {
  const normalized = label.replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_TOOLTIP_LABEL_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_TOOLTIP_LABEL_LENGTH - 1).trimEnd()}…`;
}

type TooltipRect = {
  bottom: number;
  height: number;
  left: number;
  top: number;
  width: number;
};

type TooltipSize = { height: number; width: number };

const VIEWPORT_INSET = 8;
const TOOLTIP_GAP = 5;

/** Keeps tooltip text inside the visual viewport and flips below its control. */
export function fitTooltipPosition(
  anchor: TooltipRect,
  tooltip: TooltipSize,
  viewport: TooltipSize,
  inset = VIEWPORT_INSET,
) {
  const maxLeft = Math.max(inset, viewport.width - tooltip.width - inset);
  const left = Math.min(
    Math.max(inset, anchor.left + anchor.width / 2 - tooltip.width / 2),
    maxLeft,
  );
  const above = anchor.top - tooltip.height - TOOLTIP_GAP;
  const below = anchor.bottom + TOOLTIP_GAP;
  const top =
    above >= inset
      ? above
      : below + tooltip.height <= viewport.height - inset
        ? below
        : Math.min(
            Math.max(inset, above),
            Math.max(inset, viewport.height - tooltip.height - inset),
          );
  return { left, top };
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
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  useLayoutEffect(() => {
    if (!open || !anchorRef.current || !tooltipRef.current) return;
    const update = () => {
      const anchor = anchorRef.current?.getBoundingClientRect();
      const tooltip = tooltipRef.current?.getBoundingClientRect();
      if (!anchor || !tooltip) return;
      setPosition(
        fitTooltipPosition(
          anchor,
          { width: tooltip.width, height: tooltip.height },
          { width: window.innerWidth, height: window.innerHeight },
        ),
      );
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, tooltipLabel]);
  const tooltipStyle: CSSProperties = {
    left: position?.left ?? 0,
    top: position?.top ?? 0,
  };
  return (
    <span
      ref={anchorRef}
      className="ws-action-tooltip"
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      {children(tooltipId)}
      <span
        ref={tooltipRef}
        id={tooltipId}
        aria-label={semantic ? tooltipLabel : undefined}
        className="ws-action-tooltip-content"
        data-tooltip-label={tooltipLabel}
        data-open={open || undefined}
        role={semantic ? "tooltip" : undefined}
        style={tooltipStyle}
      />
    </span>
  );
}
