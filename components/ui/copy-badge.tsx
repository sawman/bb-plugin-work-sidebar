import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import { toast } from "sonner";

export function CopyBadge({
  value,
  label,
  className,
  children,
  title,
  tone,
}: {
  value: string;
  label: string;
  className?: string;
  children: ReactNode;
  title?: string;
  tone?: string;
}) {
  const copy = () => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(value);
        toast.success(`Copied ${value}`);
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
