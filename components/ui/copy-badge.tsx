import type {
  HTMLAttributes,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import { toast } from "sonner";

type CopyBadgeProps = {
  value: string;
  copyValue?: string;
  label: string;
  className?: string;
  children: ReactNode;
  title?: string;
  tone?: string;
} & Omit<
  HTMLAttributes<HTMLSpanElement>,
  | "children"
  | "className"
  | "title"
  | "role"
  | "tabIndex"
  | "onPointerDown"
  | "onMouseDown"
  | "onContextMenu"
  | "onClick"
  | "onKeyDown"
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
    event: ReactMouseEvent<HTMLSpanElement> | ReactKeyboardEvent<HTMLSpanElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    copy();
  };

  return (
    <span
      {...spanProps}
      className={`ws-copy-badge${className ? ` ${className}` : ""}`}
      role="button"
      tabIndex={0}
      aria-label={`Copy ${label} ${value}`}
      title={title ?? `Copy ${value}`}
      data-tone={tone}
      onPointerDown={(event: ReactPointerEvent<HTMLSpanElement>) => {
        event.stopPropagation();
      }}
      onMouseDown={(event: ReactMouseEvent<HTMLSpanElement>) => {
        event.stopPropagation();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={activate}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") activate(event);
      }}
    >
      {children}
    </span>
  );
}
