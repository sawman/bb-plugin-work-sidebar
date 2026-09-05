import { useId, useState, type ReactNode } from "react";
import { Icon } from "./icon";

/**
 * A counted, keyboard-accessible disclosure used by Work grouping cards.
 * Features may supply layout class names; the disclosure relationship and IDs
 * remain owned by this primitive.
 */
export function CountedDisclosure({
  title,
  count,
  countUnit,
  triggerId,
  unmountOnClose = true,
  defaultOpen = false,
  className = "",
  triggerClassName = "",
  metaClassName = "",
  countClassName = "",
  iconClassName = "",
  tone,
  children,
}: {
  title: string;
  count: number;
  countUnit: string;
  triggerId?: string;
  unmountOnClose?: boolean;
  defaultOpen?: boolean;
  className?: string;
  triggerClassName?: string;
  metaClassName?: string;
  countClassName?: string;
  iconClassName?: string;
  tone?: string;
  children: ReactNode;
}) {
  const id = useId();
  const [open, setOpen] = useState(defaultOpen);
  const resolvedTriggerId = triggerId ?? `${id}-trigger`;
  const panelId = `${id}-panel`;
  const label = `${title}: ${count} ${countUnit}${count === 1 ? "" : "s"}`;
  return (
    <section
      className={`ws-counted-disclosure ${className}`.trim()}
      data-tone={tone}
      data-expanded={open ? "true" : "false"}
      aria-labelledby={resolvedTriggerId}
    >
      <h3>
        <button
          id={resolvedTriggerId}
          type="button"
          className={`ws-counted-disclosure-trigger ${triggerClassName}`.trim()}
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={label}
          onClick={() => setOpen((current) => !current)}
        >
          <span>{title}</span>
          <span className={`ws-counted-disclosure-meta ${metaClassName}`.trim()} aria-hidden>
            <span className={`ws-counted-disclosure-count ${countClassName}`.trim()}>{count}</span>
            <Icon
              className={`ws-counted-disclosure-icon ${iconClassName}`.trim()}
              name={open ? "ChevronUp" : "ChevronDown"}
              aria-hidden
            />
          </span>
        </button>
      </h3>
      {open || !unmountOnClose ? (
        <div id={panelId} hidden={!open} className="ws-counted-disclosure-panel">
          {children}
        </div>
      ) : null}
    </section>
  );
}
