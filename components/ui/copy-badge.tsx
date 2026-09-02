import type {
  HTMLAttributes,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import { toast } from "sonner";
import { ActionTooltip } from "./action-tooltip";

type CopyBadgeProps = {
  value: string;
  copyValue?: string;
  label: string;
  className?: string;
  children: ReactNode;
  title?: string;
  tone?: string;
  typography?: "context";
  variant?: "badge" | "text";
  onContextMenu?: HTMLAttributes<HTMLSpanElement>["onContextMenu"];
  onKeyDown?: HTMLAttributes<HTMLSpanElement>["onKeyDown"];
} & Omit<
  HTMLAttributes<HTMLSpanElement>,
  | "children"
  | "className"
  | "title"
  | "role"
  | "tabIndex"
  | "onPointerDown"
  | "onMouseDown"
  | "onClick"
  | "aria-label"
>;

export function CopyBadge({
  value,
  copyValue,
  label,
  className,
  children,
  title,
  tone,
  typography,
  variant = "badge",
  onContextMenu,
  onKeyDown,
  ...spanProps
}: CopyBadgeProps) {
  const clipboardValue = copyValue ?? value;
  const copy = () => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(clipboardValue);
        toast.success(`Copied ${clipboardValue}`);
      } catch {
        toast.error(`Could not copy ${label}`);
      }
    })();
  };
  const activate = (
    event:
      ReactMouseEvent<HTMLSpanElement> | ReactKeyboardEvent<HTMLSpanElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    copy();
  };

  return (
    <ActionTooltip label={title ?? `Copy ${value}`}>
      {(tooltipId) => <span
      {...spanProps}
      className={`ws-copy-badge ws-identifier-badge${className ? ` ${className}` : ""}`}
      role="button"
      tabIndex={0}
      aria-label={`Copy ${label} ${value}`}
      aria-describedby={tooltipId}
      data-tone={tone}
      data-typography={typography}
      data-variant={variant}
      onPointerDown={(event: ReactPointerEvent<HTMLSpanElement>) => {
        event.stopPropagation();
      }}
      onMouseDown={(event: ReactMouseEvent<HTMLSpanElement>) => {
        event.stopPropagation();
      }}
      onContextMenu={(event) => {
        onContextMenu?.(event);
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={activate}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        if (event.key === "Enter" || event.key === " ") activate(event);
      }}
    >
      {children}
      </span>}
    </ActionTooltip>
  );
}
